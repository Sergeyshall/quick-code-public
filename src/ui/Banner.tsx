import { Box, Text } from "ink";
import { homedir } from "node:os";
import pkg from "../../package.json";
import { modelLabel } from "../llm/models";
import { COMMANDS } from "./commands";
import { useTheme } from "./theme";

/** "ANSI Shadow" glyphs, 6 rows each. */
const GLYPHS: Record<string, string[]> = {
  Q: [" ██████╗ ", "██╔═══██╗", "██║   ██║", "██║▄▄ ██║", "╚██████╔╝", " ╚══▀▀═╝ "],
  U: ["██╗   ██╗", "██║   ██║", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
  I: ["██╗", "██║", "██║", "██║", "██║", "╚═╝"],
  C: [" ██████╗", "██╔════╝", "██║     ", "██║     ", "╚██████╗", " ╚═════╝"],
  K: ["██╗  ██╗", "██║ ██╔╝", "█████╔╝ ", "██╔═██╗ ", "██║  ██╗", "╚═╝  ╚═╝"],
  O: [" ██████╗ ", "██╔═══██╗", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
  D: ["██████╗ ", "██╔══██╗", "██║  ██║", "██║  ██║", "██████╔╝", "╚═════╝ "],
  E: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"],
  " ": ["  ", "  ", "  ", "  ", "  ", "  "],
};

function renderWord(word: string): string[] {
  return Array.from({ length: 6 }, (_, row) =>
    [...word].map((ch) => GLYPHS[ch]?.[row] ?? "").join(""),
  );
}

const LOGO = renderWord("QUICK CODE");
const LOGO_WIDTH = Math.max(...LOGO.map((line) => line.length));

export function shortenPath(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

export type BannerVariant = "full" | "compact" | "minimal";

/** Rows each banner variant occupies, so the caller can pick one that leaves room for the chat. */
export const BANNER_HEIGHT: Record<BannerVariant, number> = { full: 16, compact: 10, minimal: 2 };

/** The logo needs this many columns; below it the banner never uses the "full" variant. */
export const BANNER_LOGO_WIDTH = LOGO_WIDTH + 2;

interface BannerProps {
  model: string;
  rootDir: string;
  skills: string[];
  /** Current session id, or null before the first message of a new session. */
  sessionId: string | null;
  /** Short description of the loaded AGENTS.md, or null when the project has none. */
  instructions: string | null;
  variant: BannerVariant;
}

/** Header pinned to the top of the page: logo, credits and the current setup. */
export function Banner({ model, rootDir, skills, sessionId, instructions, variant }: BannerProps) {
  const theme = useTheme();
  const muted = theme.page.muted;
  /** Top-to-bottom logo gradient; a shorter list repeats its last color. */
  const gradient = (row: number) => theme.logo.gradient[Math.min(row, theme.logo.gradient.length - 1)];
  const session = sessionId ?? "new (saved after the first message)";
  const credits = (
    <Box paddingX={variant === "full" ? 1 : 0} flexShrink={0}>
      <Text wrap="truncate">
        {variant !== "full" && (
          <Text color={gradient(0)} bold>
            ⚡ QUICK CODE{" "}
          </Text>
        )}
        {variant === "full" && <Text color={theme.logo.title}>⚡ Quick Code</Text>}
        <Text color={muted}> by </Text>
        <Text color={theme.logo.author} bold>
          Sergii Shalapuda
        </Text>
        <Text color={muted}> · v{pkg.version}</Text>
      </Text>
    </Box>
  );

  if (variant === "minimal") {
    return (
      <Box flexDirection="column" flexShrink={0}>
        {credits}
        <Text wrap="truncate">
          <Text color={theme.page.accent}>{modelLabel(model)}</Text>
          <Text color={muted}> · session </Text>
          <Text color={sessionId ? theme.info.session : theme.page.text}>{session}</Text>
          <Text color={muted}> · {shortenPath(rootDir)}</Text>
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexShrink={0}>
      {variant === "full" && (
        <Box flexDirection="column" paddingX={1}>
          {LOGO.map((line, i) => (
            <Text key={i} color={gradient(i)} bold>
              {line}
            </Text>
          ))}
        </Box>
      )}
      {credits}
      <Box
        borderStyle="round"
        borderColor={theme.info.border}
        borderBackgroundColor={theme.page.bg}
        paddingX={1}
        flexDirection="column"
        width={variant === "full" ? LOGO_WIDTH + 2 : undefined}
      >
        <InfoRow label="Model" value={`${modelLabel(model)} (${model})`} color={theme.page.accent} />
        <InfoRow label="Directory" value={shortenPath(rootDir)} />
        <InfoRow label="Session" value={session} color={sessionId ? theme.info.session : undefined} />
        <InfoRow
          label="AGENTS.md"
          value={instructions ?? "none (add one to the project root for project instructions)"}
          color={instructions ? theme.info.ok : undefined}
        />
        <InfoRow label="Skills" value={skills.join(", ")} />
        <InfoRow label="Sandbox" value="files: this folder only · bash: asks before each command" color={theme.info.ok} />
        <InfoRow label="Commands" value={`${COMMANDS.map((cmd) => cmd.name).join(" · ")}  (type / to autocomplete)`} />
      </Box>
    </Box>
  );
}

function InfoRow({ label, value, color }: { label: string; value: string; color?: string }) {
  const theme = useTheme();
  return (
    <Box>
      <Box width={11} flexShrink={0}>
        <Text color={theme.page.muted}>{label}</Text>
      </Box>
      <Text color={color ?? theme.page.text} wrap="truncate-middle">
        {value}
      </Text>
    </Box>
  );
}

interface StatusBarProps {
  model: string;
  rootDir: string;
  messages: number;
  busy: boolean;
  width: number;
}

/** Live one-line status shown directly above the input box. */
export function StatusBar({ model, rootDir, messages, busy, width }: StatusBarProps) {
  const theme = useTheme();
  const wide = width >= 80;
  const sep = <Text color={theme.page.muted}> │ </Text>;

  return (
    <Box marginTop={1} paddingX={1}>
      <Text wrap="truncate-end">
        <Text backgroundColor={theme.status.badgeBg} color={theme.status.badgeText} bold>
          {` ◆ ${modelLabel(model)} `}
        </Text>
        {wide && <Text color={theme.page.muted}> {model}</Text>}
        {sep}
        <Text color={busy ? theme.status.busy : theme.status.ready}>{busy ? "● working" : "● ready"}</Text>
        {sep}
        <Text color={theme.status.text}>
          {messages} {wide ? (messages === 1 ? "message" : "messages") : "msg"}
        </Text>
        {sep}
        <Text color={theme.status.text}>{shortenPath(rootDir)}</Text>
      </Text>
    </Box>
  );
}
