import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { useCallback, useRef, useState } from "react";
import type { AgentService } from "../agent/AgentService";
import { INSTRUCTIONS_FILE, loadProjectInstructions } from "../agent/projectInstructions";
import { MODEL_OPTIONS, modelLabel, resolveModel } from "../llm/models";
import { addToHistory, loadHistory, saveHistory } from "../session/commandHistory";
import { ensureDataDir } from "../session/dataDir";
import {
  isSessionId,
  SessionStore,
  sessionTitle,
  type Session,
  type SessionMeta,
  type TranscriptEntry,
} from "../session/SessionStore";
import type { ApprovalRequest } from "../skills";
import { ApprovalPrompt, type ApprovalAnswer } from "./ApprovalPrompt";
import { Banner, BANNER_HEIGHT, BANNER_LOGO_WIDTH, shortenPath, StatusBar, type BannerVariant } from "./Banner";
import { COMMANDS, getSuggestions, type Suggestion } from "./commands";
import { FileViewer } from "./FileViewer";
import { FolderPicker } from "./FolderPicker";
import { ModelPicker } from "./ModelPicker";
import { useMouseWheel } from "./mouse";
import { ProjectTree } from "./ProjectTree";
import { SessionPicker } from "./SessionPicker";
import { Suggestions } from "./Suggestions";
import { DEFAULT_THEME, loadProjectTheme, THEME_FILE, ThemeContext, useTheme, writeDefaultTheme, type Theme } from "./theme";
import { useTerminalSize } from "./useTerminalSize";

/** Entries kept mounted in the transcript; older ones are dropped from rendering. */
const MAX_RENDERED_ENTRIES = 300;
const SCROLL_STEP = 3;

type Entry =
  | { id: number; kind: "user" | "agent" | "error" | "info"; text: string }
  | { id: number; kind: "tool"; text: string; isError: boolean }
  | { id: number; kind: "project"; rootDir: string }
  | { id: number; kind: "resumed"; session: SessionMeta };

type NewEntry = Entry extends infer E ? (E extends Entry ? Omit<E, "id"> : never) : never;

type Confirm = (request: ApprovalRequest) => Promise<boolean>;

interface AppProps {
  /** Builds a fresh agent sandboxed to `rootDir`; called on every project switch. */
  createAgent: (rootDir: string, confirm: Confirm) => AgentService;
  /** Folder the project navigator starts in. */
  initialDir: string;
  initialModel: string;
  skills: string[];
  onModelChange: (model: string) => void;
}

export function App({ createAgent, initialDir, initialModel, skills, onModelChange }: AppProps) {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();
  const nextId = useRef(0);
  const [entries, setEntries] = useState<Entry[]>([]);
  const agentRef = useRef<AgentService | null>(null);
  const [rootDir, setRootDir] = useState<string | null>(null);
  const [pickingProject, setPickingProject] = useState(true);
  const [approval, setApproval] = useState<{ request: ApprovalRequest; resolve: (ok: boolean) => void } | null>(
    null,
  );
  /** Tools the user allowed for the rest of this project session. */
  const alwaysAllowed = useRef(new Set<string>());
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [model, setModel] = useState(initialModel);
  const [pickingModel, setPickingModel] = useState(false);
  const [messageCount, setMessageCount] = useState(0);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  // Bumped to remount TextInput so its cursor jumps to the end after a completion.
  const [inputKey, setInputKey] = useState(0);
  /** How many of the newest entries are scrolled out of view (0 = following the conversation). */
  const [scrollBack, setScrollBack] = useState(0);

  /** Session storage of the current project; null when `.quick-code` could not be used. */
  const storeRef = useRef<SessionStore | null>(null);
  const dataDirRef = useRef<string | null>(null);
  /** The conversation being recorded; null until the first message of a new session. */
  const sessionRef = useRef<Session | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionChoices, setSessionChoices] = useState<SessionMeta[] | null>(null);
  const [instructions, setInstructions] = useState<string | null>(null);
  /** Bumped on every project switch so a slow load for an old project is discarded. */
  const loadToken = useRef(0);
  /** Submitted inputs of this project, oldest first, and the ↑/↓ position in them (-1 = editing a draft). */
  const commandHistory = useRef<string[]>([]);
  const historyNav = useRef({ index: -1, draft: "" });
  /** Default colors, overridden by the project's `.quick-code/theme.json`. */
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  /** File open in the quick viewer (F3 in the navigator). */
  const [viewing, setViewing] = useState<string | null>(null);
  /** Paths copied with F5 in the navigator, pasted with F6; survives closing the navigator. */
  const [clipboard, setClipboard] = useState<string[]>([]);

  const overlay = pickingProject || pickingModel || sessionChoices !== null || approval !== null;
  const suggestions = status || overlay || suggestionsDismissed ? [] : getSuggestions(input);
  const activeSuggestion: Suggestion | undefined = suggestions[Math.min(suggestionIndex, suggestions.length - 1)];

  const onInputChange = useCallback((value: string) => {
    historyNav.current.index = -1;
    setInput(value);
    setSuggestionIndex(0);
    setSuggestionsDismissed(false);
  }, []);

  const completeWith = useCallback((suggestion: Suggestion) => {
    setInput(suggestion.value);
    setSuggestionIndex(0);
    setInputKey((k) => k + 1);
  }, []);

  useInput(
    (_input, key) => {
      if (key.upArrow) {
        setSuggestionIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
      } else if (key.downArrow) {
        setSuggestionIndex((i) => (i + 1) % suggestions.length);
      } else if (key.tab && activeSuggestion) {
        completeWith(activeSuggestion);
      } else if (key.escape) {
        setSuggestionsDismissed(true);
      }
    },
    { isActive: suggestions.length > 0 },
  );

  const push = useCallback((entry: NewEntry) => {
    setEntries((prev) => [...prev, { ...entry, id: nextId.current++ }]);
    setScrollBack(0);
  }, []);

  /** Replaces the whole transcript, e.g. after switching project or session. */
  const replaceEntries = useCallback((list: NewEntry[]) => {
    setEntries(list.map((entry) => ({ ...entry, id: nextId.current++ })) as Entry[]);
    setScrollBack(0);
  }, []);

  /** Shows a previous command in the input box (↑/↓), like a shell. */
  const recall = useCallback((value: string) => {
    setInput(value);
    setSuggestionsDismissed(true);
    setInputKey((k) => k + 1);
  }, []);

  useInput(
    (_input, key) => {
      const list = commandHistory.current;
      const nav = historyNav.current;
      if (key.upArrow && nav.index + 1 < list.length) {
        if (nav.index === -1) nav.draft = input;
        nav.index++;
        recall(list[list.length - 1 - nav.index]!);
      } else if (key.downArrow && nav.index >= 0) {
        nav.index--;
        recall(nav.index === -1 ? nav.draft : list[list.length - 1 - nav.index]!);
      }
    },
    { isActive: rootDir !== null && !overlay && !status && suggestions.length === 0 },
  );

  const rememberCommand = useCallback((text: string) => {
    historyNav.current = { index: -1, draft: "" };
    commandHistory.current = addToHistory(commandHistory.current, text);
    const dataDir = dataDirRef.current;
    if (dataDir) void saveHistory(dataDir, commandHistory.current).catch(() => {});
  }, []);

  useInput(
    (_input, key) => {
      if (key.pageUp) setScrollBack((n) => Math.min(entries.length - 1, n + SCROLL_STEP));
      else if (key.pageDown) setScrollBack((n) => Math.max(0, n - SCROLL_STEP));
    },
    { isActive: rootDir !== null && !overlay && entries.length > 1 },
  );

  // One entry per wheel step: trackpads send many steps per swipe.
  useMouseWheel(
    (direction) =>
      setScrollBack((n) => (direction === "up" ? Math.min(entries.length - 1, n + 1) : Math.max(0, n - 1))),
    { isActive: rootDir !== null && !overlay && viewing === null && entries.length > 1 },
  );

  const confirm = useCallback<Confirm>(async (request) => {
    if (alwaysAllowed.current.has(request.tool)) return true;
    return new Promise<boolean>((resolve) => setApproval({ request, resolve }));
  }, []);

  const answerApproval = useCallback(
    (answer: ApprovalAnswer) => {
      if (!approval) return;
      if (answer === "always") alwaysAllowed.current.add(approval.request.tool);
      setApproval(null);
      approval.resolve(answer !== "no");
    },
    [approval],
  );

  /** Makes `session` the current conversation: agent context, transcript and counters. */
  const restoreSession = useCallback(
    (session: Session, before: NewEntry[] = []) => {
      agentRef.current?.loadHistory(session.messages);
      sessionRef.current = session;
      setSessionId(session.id);
      setMessageCount(session.messageCount);
      const { messages: _messages, transcript, ...meta } = session;
      replaceEntries([...before, ...transcript, { kind: "resumed", session: meta }]);
    },
    [replaceEntries],
  );

  /**
   * Re-initializes the agent inside `dir` with fresh approvals, prepares `<dir>/.quick-code`,
   * and resumes the most recent saved session of that project.
   */
  const switchProject = useCallback(
    async (dir: string) => {
      const token = ++loadToken.current;
      const first = agentRef.current === null;
      agentRef.current = createAgent(dir, confirm);
      alwaysAllowed.current.clear();
      storeRef.current = null;
      dataDirRef.current = null;
      sessionRef.current = null;
      commandHistory.current = [];
      historyNav.current = { index: -1, draft: "" };
      setSessionId(null);
      setInstructions(null);
      setRootDir(dir);
      setPickingProject(false);
      setMessageCount(0);
      const before: NewEntry[] = first ? [] : [{ kind: "project", rootDir: dir }];
      replaceEntries(before);
      setStatus("Loading project…");
      try {
        const agentsMd = await loadProjectInstructions(dir);
        if (token !== loadToken.current) return;
        setInstructions(
          agentsMd && `loaded · ${agentsMd.text.split("\n").length} lines${agentsMd.truncated ? " (truncated)" : ""}`,
        );
        const dataDir = await ensureDataDir(dir);
        const projectTheme = await loadProjectTheme(dataDir);
        const store = await SessionStore.open(dataDir);
        const commands = await loadHistory(dataDir);
        const latest = await store.latest();
        if (token !== loadToken.current) return;
        dataDirRef.current = dataDir;
        storeRef.current = store;
        commandHistory.current = commands;
        setTheme(projectTheme.theme);
        if (latest) restoreSession(latest, before);
        if (projectTheme.warnings.length > 0) push({ kind: "error", text: themeWarning(projectTheme.warnings) });
      } catch (err) {
        if (token !== loadToken.current) return;
        const reason = err instanceof Error ? err.message : String(err);
        setTheme(DEFAULT_THEME);
        push({ kind: "error", text: `Session history is off for this project: ${reason}` });
      } finally {
        if (token === loadToken.current) setStatus(null);
      }
    },
    [confirm, createAgent, push, replaceEntries, restoreSession],
  );

  /** Saves the finished turn into the current session, starting a new session if needed. */
  const persistTurn = useCallback(
    (agent: AgentService, prompt: string, turn: TranscriptEntry[]) => {
      const store = storeRef.current;
      // The project (and its store) may have changed while the turn ran.
      if (!store || agent !== agentRef.current) return;
      let session = sessionRef.current;
      if (!session) {
        session = store.create(model);
        sessionRef.current = session;
        setSessionId(session.id);
      }
      session.title ||= sessionTitle(prompt);
      session.messageCount += 1;
      session.updatedAt = new Date().toISOString();
      session.model = model;
      session.messages = agent.getHistory();
      session.transcript.push(...turn);
      store.save(session).catch((err: unknown) => {
        push({ kind: "error", text: `Could not save the session: ${err instanceof Error ? err.message : String(err)}` });
      });
    },
    [model, push],
  );

  const resumeSession = useCallback(
    async (id: string) => {
      setSessionChoices(null);
      const store = storeRef.current;
      if (!store) return;
      try {
        restoreSession(await store.load(id));
      } catch (err) {
        push({ kind: "error", text: `Cannot resume ${id}: ${err instanceof Error ? err.message : String(err)}` });
      }
    },
    [push, restoreSession],
  );

  /** `/theme`: re-reads `.quick-code/theme.json`, first creating it from the defaults if missing. */
  const reloadTheme = useCallback(async () => {
    const dataDir = dataDirRef.current;
    if (!dataDir) {
      push({ kind: "error", text: "Themes need the project's .quick-code folder, which is not available." });
      return;
    }
    try {
      const created = await writeDefaultTheme(dataDir).then(
        () => true,
        (err: NodeJS.ErrnoException) => {
          if (err.code === "EEXIST") return false;
          throw err;
        },
      );
      const loaded = await loadProjectTheme(dataDir);
      setTheme(loaded.theme);
      const where = `.quick-code/${THEME_FILE}`;
      push({
        kind: "info",
        text: created
          ? `Created ${where} with the default colors. Edit it and run /theme again to apply your changes.`
          : `Theme reloaded from ${where}.`,
      });
      if (loaded.warnings.length > 0) push({ kind: "error", text: themeWarning(loaded.warnings) });
    } catch (err) {
      push({ kind: "error", text: `Cannot load the theme: ${err instanceof Error ? err.message : String(err)}` });
    }
  }, [push]);

  const cancelProjectPicker = useCallback(() => {
    // At startup there is no project yet, so Esc means "use the folder I started in".
    if (rootDir === null) void realpath(initialDir).then((dir) => switchProject(dir));
    else setPickingProject(false);
  }, [initialDir, rootDir, switchProject]);

  const changeModel = useCallback(
    (next: string) => {
      setPickingModel(false);
      if (next === model) {
        push({ kind: "info", text: `Model unchanged: ${modelLabel(next)} (${next})` });
        return;
      }
      onModelChange(next);
      setModel(next);
      push({ kind: "info", text: `Model set to ${modelLabel(next)} (${next})` });
    },
    [model, onModelChange, push],
  );

  const onSubmit = useCallback(
    async (value: string) => {
      let text = value.trim();
      if (!text || status) return;
      // Enter on a partial command ("/mo", "/model so") runs the highlighted suggestion.
      if (activeSuggestion && !isCompleteCommand(text)) {
        text = activeSuggestion.value.trim();
      }
      setInput("");
      setSuggestionIndex(0);
      rememberCommand(text);

      if (text === "/exit" || text === "/quit") {
        exit();
        return;
      }
      if (text === "/model" || text.startsWith("/model ")) {
        const arg = text.slice("/model".length).trim();
        if (!arg) {
          setPickingModel(true);
          return;
        }
        const next = resolveModel(arg);
        if (next) {
          changeModel(next);
        } else {
          const names = MODEL_OPTIONS.map((o) => o.label.split(" ")[0]!.toLowerCase()).join(", ");
          push({ kind: "error", text: `Unknown model "${arg}". Try one of: ${names}, or a full claude-* id.` });
        }
        return;
      }
      if (text === "/project" || text.startsWith("/project ")) {
        const arg = text.slice("/project".length).trim();
        if (!arg) {
          setPickingProject(true);
          return;
        }
        const target = path.resolve(rootDir ?? initialDir, arg.replace(/^~(?=$|\/)/, homedir()));
        const info = await stat(target).catch(() => undefined);
        if (!info?.isDirectory()) {
          push({ kind: "error", text: `Not a folder: ${shortenPath(target)}` });
        } else {
          const real = await realpath(target);
          if (path.dirname(real) === real) push({ kind: "error", text: "The filesystem root is too broad for a project." });
          else void switchProject(real);
        }
        return;
      }
      const agent = agentRef.current;
      if (!agent) return;
      if (text === "/clear") {
        agent.reset();
        const saved = sessionRef.current;
        sessionRef.current = null;
        setSessionId(null);
        setMessageCount(0);
        replaceEntries([
          {
            kind: "info",
            text: saved
              ? `Started a new conversation. Session ${saved.id} is saved; /resume brings it back.`
              : "Started a new conversation.",
          },
        ]);
        return;
      }
      if (text === "/theme") {
        await reloadTheme();
        return;
      }
      if (text === "/resume" || text.startsWith("/resume ")) {
        const arg = text.slice("/resume".length).trim();
        const store = storeRef.current;
        if (!store) {
          push({ kind: "error", text: "Session history is not available for this project." });
        } else if (arg) {
          if (isSessionId(arg)) await resumeSession(arg);
          else push({ kind: "error", text: `"${arg}" is not a session id (expected YYYY-MM-DD-HH-MM).` });
        } else if (store.list().length === 0) {
          push({ kind: "info", text: "No saved sessions in this project yet." });
        } else {
          setSessionChoices(store.list());
        }
        return;
      }

      const turn: TranscriptEntry[] = [];
      const record = (entry: TranscriptEntry) => {
        turn.push(entry);
        push(entry);
      };
      record({ kind: "user", text });
      setMessageCount((n) => n + 1);
      setStatus("Thinking...");
      try {
        const reply = await agent.send(text, (event) => {
          if (event.type === "status") setStatus(event.text);
          else record({ kind: "tool", text: `${event.name}: ${event.summary}`, isError: event.isError });
        });
        record({ kind: "agent", text: reply });
      } catch (err) {
        record({ kind: "error", text: err instanceof Error ? err.message : String(err) });
      } finally {
        persistTurn(agent, text, turn);
        setStatus(null);
      }
    },
    [
      activeSuggestion,
      changeModel,
      exit,
      initialDir,
      persistTurn,
      push,
      reloadTheme,
      rememberCommand,
      replaceEntries,
      resumeSession,
      rootDir,
      status,
      switchProject,
    ],
  );

  const showTree = rootDir !== null && columns >= 90;
  const treeWidth = Math.min(44, Math.floor(columns * 0.32));
  // Backdrop padding (2+2), page border (1+1) and page padding (1+1), minus the tree and its gap.
  const contentWidth = columns - 8 - (showTree ? treeWidth + 1 : 0);
  // Keep at least ~10 chat rows under the pinned banner: header/footer (2), page border (2), status + input (5).
  const chatRows = (variant: BannerVariant) => rows - 9 - BANNER_HEIGHT[variant];
  const bannerVariant: BannerVariant =
    contentWidth >= BANNER_LOGO_WIDTH && chatRows("full") >= 10 ? "full" : chatRows("compact") >= 8 ? "compact" : "minimal";
  const end = entries.length - scrollBack;
  const visibleEntries = entries.slice(Math.max(0, end - MAX_RENDERED_ENTRIES), end);

  return (
    <ThemeContext.Provider value={theme}>
      <Box width={columns} height={rows} flexDirection="column" backgroundColor={theme.backdrop.bg} paddingX={2}>
        <Box height={1} justifyContent="space-between" flexShrink={0}>
          <Box flexShrink={0} marginRight={2}>
            <Text color={theme.backdrop.text} bold>
              ⚡ QUICK CODE
            </Text>
          </Box>
          <Box flexShrink={1}>
            <Text color={theme.backdrop.text} wrap="truncate-start">
              {rootDir ? shortenPath(rootDir) : "no project selected"}
            </Text>
          </Box>
        </Box>

        <Box flexGrow={1} flexShrink={1} minHeight={0}>
          {rootDir !== null && (
            <Box
              flexGrow={1}
              flexDirection="row"
              columnGap={1}
              backgroundColor={theme.page.bg}
              borderStyle="round"
              borderColor={theme.page.border}
              borderBackgroundColor={theme.page.bg}
              paddingX={1}
              overflow="hidden"
            >
              <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                <Banner
                  model={model}
                  rootDir={rootDir}
                  skills={skills}
                  sessionId={sessionId}
                  instructions={instructions}
                  variant={bannerVariant}
                />
                <Box flexDirection="column" flexGrow={1} flexShrink={1} justifyContent="flex-end" overflow="hidden">
                  {visibleEntries.map((entry) => (
                    <EntryView key={entry.id} entry={entry} />
                  ))}
                </Box>

                <Box flexDirection="column" flexShrink={0}>
                  {status && !approval && (
                    <Box marginTop={1}>
                      <Text color={theme.status.busy}>
                        <Spinner type="dots" /> {status}
                      </Text>
                    </Box>
                  )}

                  <StatusBar
                    model={model}
                    rootDir={rootDir}
                    messages={messageCount}
                    busy={status !== null}
                    width={contentWidth}
                  />

                  {approval ? (
                    <ApprovalPrompt request={approval.request} onAnswer={answerApproval} />
                  ) : sessionChoices ? (
                    <SessionPicker
                      sessions={sessionChoices}
                      current={sessionId}
                      onSelect={(id) => void resumeSession(id)}
                      onCancel={() => setSessionChoices(null)}
                    />
                  ) : pickingModel ? (
                    <ModelPicker
                      options={MODEL_OPTIONS}
                      current={model}
                      onSelect={changeModel}
                      onCancel={() => setPickingModel(false)}
                    />
                  ) : (
                    <Box
                      borderStyle="round"
                      borderColor={status ? theme.input.borderBusy : theme.input.border}
                      borderBackgroundColor={theme.page.bg}
                      paddingX={1}
                    >
                      <Text color={theme.input.prompt}>{"> "}</Text>
                      <TextInput
                        key={inputKey}
                        value={input}
                        onChange={onInputChange}
                        onSubmit={onSubmit}
                        focus={!status && !pickingProject}
                        placeholder={status ? "Waiting for agent..." : "Ask quick-code something (/ for commands)"}
                      />
                    </Box>
                  )}

                  {suggestions.length > 0 && <Suggestions items={suggestions} selected={suggestionIndex} />}
                </Box>
              </Box>
              {showTree && <ProjectTree rootDir={rootDir} width={treeWidth} maxLines={rows - 7} />}
            </Box>
          )}
        </Box>

        <Box height={1} justifyContent="space-between" flexShrink={0}>
          <Text color={theme.backdrop.text} wrap="truncate-end">
            {scrollBack > 0 ? `↓ ${scrollBack} newer · ` : ""}PgUp/PgDn or wheel scroll · ↑/↓ history · /resume · /project folder · /model · /theme · Ctrl+C quit
          </Text>
          <Box flexShrink={0} marginLeft={2}>
            <Text color={theme.backdrop.text}>by Sergii Shalapuda</Text>
          </Box>
        </Box>

        {(pickingProject || rootDir === null) && (
          // Absolute children sit inside the backdrop padding, so size the overlay to that area.
          <Box
            position="absolute"
            top={0}
            left={0}
            width={columns - 4}
            height={rows}
            justifyContent="center"
            alignItems="center"
          >
            <Box>
              <Box position="absolute" top={1} left={2} width="100%" height="100%" backgroundColor={theme.backdrop.shadow} />
              <FolderPicker
                startDir={rootDir ?? initialDir}
                onSelect={(dir) => void switchProject(dir)}
                onCancel={cancelProjectPicker}
                onView={setViewing}
                clipboard={clipboard}
                onClipboardChange={setClipboard}
                protectedDirs={[...(rootDir ? [rootDir] : []), initialDir, homedir()]}
                active={viewing === null}
                cancelLabel={rootDir === null ? "Start dir" : "Cancel"}
              />
            </Box>
          </Box>
        )}

        {viewing && (
          // Full screen: absolute offsets are measured from the border box, not the padding.
          <Box position="absolute" top={0} left={0}>
            <FileViewer file={viewing} width={columns} height={rows} onClose={() => setViewing(null)} />
          </Box>
        )}
      </Box>
    </ThemeContext.Provider>
  );
}

function themeWarning(warnings: string[]): string {
  const shown = warnings.slice(0, 5).join("; ");
  const more = warnings.length > 5 ? ` (+${warnings.length - 5} more)` : "";
  return `.quick-code/${THEME_FILE}: ${shown}${more}. Those colors use the defaults.`;
}

function isCompleteCommand(text: string): boolean {
  if (text === "/quit" || COMMANDS.some((cmd) => cmd.name === text)) return true;
  return text.startsWith("/model ") && resolveModel(text.slice("/model ".length)) !== undefined;
}

function EntryView({ entry }: { entry: Entry }) {
  const { chat, page } = useTheme();
  switch (entry.kind) {
    case "user":
      return (
        <Box marginTop={1}>
          <Text color={chat.userLabel} bold>
            You:{" "}
          </Text>
          <Text color={chat.userText}>{entry.text}</Text>
        </Box>
      );
    case "agent":
      return (
        <Box marginTop={1} flexDirection="column">
          <Text color={chat.agentLabel} bold>
            Agent:
          </Text>
          <Text color={chat.agentText}>{entry.text}</Text>
        </Box>
      );
    case "tool":
      return (
        <Text color={entry.isError ? chat.toolError : chat.tool}>
          {entry.isError ? "  ✗ " : "  ✓ "}
          {entry.text}
        </Text>
      );
    case "error":
      return (
        <Box marginTop={1}>
          <Text color={chat.error}>Error: {entry.text}</Text>
        </Box>
      );
    case "resumed":
      return (
        <Box marginTop={1}>
          <Text wrap="truncate">
            <Text color={chat.badgeText} backgroundColor={chat.resumedBadge} bold>
              {" ↺ Session "}
            </Text>
            <Text color={chat.resumedId}> {entry.session.id}</Text>
            <Text color={page.muted}>
              {" "}
              · {entry.session.messageCount} {entry.session.messageCount === 1 ? "message" : "messages"} restored · /clear
              starts a new one · /resume picks another
            </Text>
          </Text>
        </Box>
      );
    case "project":
      return (
        <Box marginTop={1}>
          <Text wrap="truncate-middle">
            <Text color={chat.badgeText} backgroundColor={chat.projectBadge} bold>
              {" 📁 Project "}
            </Text>
            <Text color={chat.projectPath}> {shortenPath(entry.rootDir)}</Text>
            <Text color={page.muted}> · agent restarted</Text>
          </Text>
        </Box>
      );
    case "info":
      return <Text color={chat.info}>{entry.text}</Text>;
  }
}
