import { Box, Text, useInput } from "ink";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { useCallback, useEffect, useRef, useState } from "react";
import { copyEntries, deleteEntries, type OpResult } from "../project/fileOps";
import { fit, formatDate, formatSize, listDirectory, validateFolderName, type DirEntry } from "../project/fsView";
import { shortenPath } from "./Banner";
import { ConfirmDialog } from "./ConfirmDialog";
import { InputDialog } from "./InputDialog";
import { useTheme } from "./theme";
import { functionKey, INSERT_KEY, useRawInput } from "./useFunctionKey";
import { useTerminalSize } from "./useTerminalSize";

type Row = DirEntry & { isUp?: boolean };

interface FolderPickerProps {
  startDir: string;
  /** Called with the absolute, symlink-resolved folder the user picked. */
  onSelect: (dir: string) => void;
  onCancel: () => void;
  /** Opens the quick viewer (F3) on a file. */
  onView: (file: string) => void;
  /** Paths copied with F5; kept by the caller so they survive closing the navigator. */
  clipboard: string[];
  onClipboardChange: (paths: string[]) => void;
  /** Folders F8 must never delete, nor any folder containing them (e.g. the open project). */
  protectedDirs: string[];
  /** False while the viewer covers the panel, so keys go to the viewer only. */
  active?: boolean;
  cancelLabel?: string;
}

const SIZE_W = 7;
const DATE_W = 14;

/**
 * Norton Commander style folder browser. Enter opens a folder, ← / Backspace goes up,
 * Space picks the highlighted folder (or the current one on ".."), F3 views a file,
 * Ins marks entries, F5 copies them, F6 pastes, F7 creates a folder and F8 deletes.
 */
export function FolderPicker({
  startDir,
  onSelect,
  onCancel,
  onView,
  clipboard,
  onClipboardChange,
  protectedDirs,
  active = true,
  cancelLabel = "Cancel",
}: FolderPickerProps) {
  const theme = useTheme();
  const nav = theme.navigator;
  const { columns, rows: termRows } = useTerminalSize();
  const [dir, setDir] = useState(startDir);
  const [rows, setRows] = useState<Row[]>([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** Outcome of the last copy, paste or delete; cleared like `error` when the selection moves. */
  const [notice, setNotice] = useState<string | null>(null);
  /** Paths marked with Ins in the open folder. */
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  /** True while the "Create a new Directory" dialog is open. */
  const [creating, setCreating] = useState(false);
  /** Entries waiting for the F8 confirmation. */
  const [deleting, setDeleting] = useState<Row[] | null>(null);
  /** Set while a paste or delete runs; keys are ignored meanwhile. */
  const [busy, setBusy] = useState<string | null>(null);
  const offset = useRef(0);

  // The card adds 9 rows around the list: padding, hint, borders, header, info line and key bar.
  // Fill the screen but keep a ~12 column margin on each side (card padding 2+2, backdrop padding 2+2)
  // and a few rows above and below.
  const width = Math.max(44, columns - 32);
  const height = Math.max(4, termRows - 18);

  /**
   * Lists `target` and only then switches to it, so an unreadable folder leaves the panel unchanged.
   * `focus` is an entry name to highlight, or a row number to stay near after a delete.
   */
  const open = useCallback(async (target: string, focus?: string | number) => {
    try {
      const list = await listDirectory(target);
      const parent = path.dirname(target);
      const up: Row[] =
        parent === target
          ? []
          : [{ name: "..", path: parent, isDir: true, isSymlink: false, size: 0, mtimeMs: 0, isUp: true }];
      const next = [...up, ...list];
      setDir(target);
      setRows(next);
      setIndex(
        typeof focus === "number"
          ? Math.max(0, Math.min(focus, next.length - 1))
          : Math.max(0, next.findIndex((row) => row.name === focus)),
      );
      // Marks belong to one folder: entering another one drops them, a refresh keeps the survivors.
      setMarked((prev) => new Set(next.filter((row) => prev.has(row.path)).map((row) => row.path)));
      offset.current = 0;
      setError(null);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "error";
      setError(`Cannot open ${path.basename(target) || target}: ${code}`);
    }
  }, []);

  useEffect(() => {
    void open(startDir);
  }, [open, startDir]);

  /** Moves the highlight; any warning or notice was about the previous entry, so it goes. */
  const move = (to: (i: number) => number) => {
    setIndex(to);
    setError(null);
    setNotice(null);
  };

  const choose = useCallback(
    async (target: string) => {
      const real = await realpath(target).catch(() => undefined);
      if (!real) {
        setError(`Cannot resolve ${target}`);
      } else if (path.dirname(real) === real) {
        setError("The filesystem root is too broad for a project.");
      } else {
        onSelect(real);
      }
    },
    [onSelect],
  );

  const createFolder = async (name: string) => {
    const trimmed = name.trim();
    const problem = validateFolderName(trimmed);
    if (problem) {
      setError(problem);
      return;
    }
    try {
      await mkdir(path.join(dir, trimmed));
      setCreating(false);
      await open(dir, trimmed);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      setError(code === "EEXIST" ? `"${trimmed}" already exists` : `Cannot create "${trimmed}": ${code ?? err}`);
    }
  };

  const goUp = () => {
    if (path.dirname(dir) !== dir) void open(path.dirname(dir), path.basename(dir));
  };

  const startCreating = () => {
    setCreating(true);
    setError(null);
  };

  const view = () => {
    const row = rows[index];
    if (row && !row.isDir) onView(row.path);
    else setError("F3 views files; Enter opens folders");
  };

  /** The marked entries, or else the highlighted one ("..") never counts. */
  const selection = (): Row[] => {
    if (marked.size > 0) return rows.filter((row) => marked.has(row.path));
    const row = rows[index];
    return row && !row.isUp ? [row] : [];
  };

  /** Ins: toggles the mark on the highlighted entry and moves down, as in Midnight Commander. */
  const toggleMark = () => {
    const row = rows[index];
    if (!row || row.isUp) return;
    setMarked((prev) => {
      const next = new Set(prev);
      if (!next.delete(row.path)) next.add(row.path);
      return next;
    });
    move((i) => Math.min(rows.length - 1, i + 1));
  };

  const copy = () => {
    const items = selection();
    if (items.length === 0) {
      setError("Highlight an entry or mark some with Ins, then press F5");
      return;
    }
    onClipboardChange(items.map((row) => row.path));
    setMarked(new Set());
    setError(null);
    setNotice(`Copied ${describeItems(items)}. Open the target folder and press F6 to paste.`);
  };

  /** Runs a paste or delete, then reloads the folder and reports the outcome. */
  const runOperation = async (
    label: string,
    work: () => Promise<OpResult>,
    focus: (result: OpResult) => string | number | undefined,
    verb: string,
    total: number,
  ) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    let result: OpResult;
    try {
      result = await work();
    } catch (err) {
      setBusy(null);
      setError(`${label.replace(/…$/, "")} failed: ${(err as NodeJS.ErrnoException).code ?? String(err)}`);
      return;
    }
    await open(dir, focus(result));
    setBusy(null);
    const count = result.done.length === 1 ? `"${result.done[0]}"` : `${result.done.length} items`;
    if (result.failed.length === 0) setNotice(`${verb} ${count}.`);
    else setError(`${verb} ${result.done.length} of ${total}. ${result.failed.join("; ")}`);
  };

  const paste = () => {
    if (clipboard.length === 0) {
      setError("Nothing to paste: copy entries with F5 first");
      return;
    }
    void runOperation(
      `Pasting ${clipboard.length === 1 ? "1 item" : `${clipboard.length} items`}…`,
      () => copyEntries(clipboard, dir),
      (result) => result.done[0],
      "Pasted",
      clipboard.length,
    );
  };

  const askDelete = () => {
    const items = selection();
    if (items.length === 0) setError("Highlight an entry or mark some with Ins, then press F8");
    else setDeleting(items);
  };

  const confirmDelete = () => {
    const items = deleting ?? [];
    setDeleting(null);
    void runOperation(
      `Deleting ${items.length === 1 ? "1 item" : `${items.length} items`}…`,
      () => deleteEntries(items.map((row) => row.path), protectedDirs),
      () => index,
      "Deleted",
      items.length,
    );
  };

  const idle = active && !creating && deleting === null && busy === null;

  useRawInput(
    (data) => {
      if (data === INSERT_KEY) return toggleMark();
      const fkey = functionKey(data);
      if (fkey === 3) view();
      else if (fkey === 5) copy();
      else if (fkey === 6) paste();
      else if (fkey === 7) startCreating();
      else if (fkey === 8) askDelete();
    },
    { isActive: idle },
  );

  useInput((input, key) => {
    if (!idle) return;
    const row = rows[index];
    const last = rows.length - 1;
    if (key.escape) onCancel();
    else if (key.upArrow) move((i) => Math.max(0, i - 1));
    else if (key.downArrow) move((i) => Math.min(last, i + 1));
    else if (key.pageUp) move((i) => Math.max(0, i - (height - 1)));
    else if (key.pageDown) move((i) => Math.min(last, i + (height - 1)));
    else if (key.home) move(() => 0);
    else if (key.end) move(() => last);
    else if (key.leftArrow || key.backspace || key.delete) goUp();
    else if (key.return || key.rightArrow) {
      if (row?.isUp) goUp();
      else if (row?.isDir) void open(row.path);
    } else if (key.ctrl) {
      // Fallbacks for terminals (and Mac keyboards) without F-keys or Ins.
      if (input === "n") startCreating();
      else if (input === "v") view();
      else if (input === "t") toggleMark();
      else if (input === "y") copy();
      else if (input === "p") paste();
      else if (input === "d") askDelete();
    } else if (input === " ") {
      void choose(row?.isDir && !row.isUp ? row.path : dir);
    } else if (input && !key.meta && input.length === 1) {
      // Quick search: jump to the next entry starting with the typed character.
      const ch = input.toLowerCase();
      const order = [...rows.slice(index + 1), ...rows.slice(0, index + 1)];
      const hit = order.find((r) => !r.isUp && r.name.toLowerCase().startsWith(ch));
      if (hit) move(() => rows.indexOf(hit));
    }
  });

  // Keep the highlighted row inside the viewport.
  if (index < offset.current) offset.current = index;
  if (index >= offset.current + height) offset.current = index - height + 1;
  const visible = rows.slice(offset.current, offset.current + height);

  const inner = width - 2;
  const nameW = inner - SIZE_W - DATE_W - 2;
  const title = ` ${shortenPath(dir)} `;
  const titleText = [...title].length > inner - 4 ? ` …${title.slice(-(inner - 7))}` : title;
  const titleLen = [...titleText].length;
  const leftBar = "═".repeat(Math.floor((inner - titleLen) / 2));
  const rightBar = "═".repeat(inner - titleLen - leftBar.length);
  const current = rows[index];

  const edge = (ch: string) => (
    <Text color={nav.border} backgroundColor={nav.bg}>
      {ch}
    </Text>
  );
  const divider = (bg: string | undefined, color: string | undefined) => (
    <Text color={color} backgroundColor={bg}>
      │
    </Text>
  );

  return (
    <Box flexDirection="column" width={width + 4} backgroundColor={theme.page.bg} paddingX={2} paddingY={1}>
      <Text wrap="truncate">
        <Text color={nav.heading} bold>
          📁 Select a project folder
        </Text>
        <Text color={theme.page.muted}>: the agent can only read and write inside it.</Text>
      </Text>
      <Text wrap="truncate">
        {edge(`╔${leftBar}`)}
        <Text color={nav.titleText} backgroundColor={nav.titleBg}>
          {titleText}
        </Text>
        {edge(`${rightBar}╗`)}
      </Text>
      <Text wrap="truncate">
        {edge("║")}
        <Text color={nav.columns} backgroundColor={nav.bg} bold>
          {fit("Name", nameW, "center")}
          {divider(nav.bg, nav.border)}
          {fit("Size", SIZE_W, "center")}
          {divider(nav.bg, nav.border)}
          {fit("Date", DATE_W, "center")}
        </Text>
        {edge("║")}
      </Text>
      {Array.from({ length: height }, (_, i) => {
        const row = visible[i];
        const selected = row !== undefined && row === current;
        const isMarked = row !== undefined && marked.has(row.path);
        const bg = selected ? nav.selectedBg : nav.bg;
        const fg = selected ? nav.selectedText : isMarked ? nav.marked : row?.isDir ? nav.dir : nav.file;
        const lines = selected ? nav.selectedText : nav.border;
        const name = row ? `${isMarked ? "*" : " "}${row.isDir ? "/" : " "}${row.name}` : "";
        const size = !row ? "" : row.isUp ? "UP--DIR" : row.isDir ? "<DIR>" : formatSize(row.size);
        const date = row && !row.isUp ? formatDate(row.mtimeMs) : "";
        return (
          <Text key={i} wrap="truncate">
            {edge("║")}
            <Text color={fg} backgroundColor={bg} bold={(row?.isDir || isMarked) && !selected}>
              {fit(name, nameW)}
              {divider(bg, lines)}
              {fit(size, SIZE_W, "right")}
              {divider(bg, lines)}
              {fit(date, DATE_W, "right")}
            </Text>
            {edge("║")}
          </Text>
        );
      })}
      <Text wrap="truncate">{edge(`╟${"─".repeat(nameW)}┴${"─".repeat(SIZE_W)}┴${"─".repeat(DATE_W)}╢`)}</Text>
      <Text wrap="truncate">
        {edge("║")}
        {busy ? (
          <Text color={nav.info} backgroundColor={nav.bg}>
            {fit(` ${busy}`, inner)}
          </Text>
        ) : error && !creating ? (
          <Text color={nav.warning} backgroundColor={nav.bg} bold>
            {fit(` ⚠ ${error}`, inner)}
          </Text>
        ) : notice ? (
          <Text color={nav.info} backgroundColor={nav.bg}>
            {fit(` ✓ ${notice}`, inner)}
          </Text>
        ) : marked.size > 0 ? (
          <Text color={nav.marked} backgroundColor={nav.bg} bold>
            {fit(` ${markedSummary(rows.filter((row) => marked.has(row.path)))}`, inner)}
          </Text>
        ) : (
          <Text color={nav.info} backgroundColor={nav.bg}>
            {fit(` ${current?.isUp ? path.basename(dir) || dir : (current?.name ?? "")}`, inner - SIZE_W - 1)}
            {fit(current?.isUp || current?.isDir ? "<DIR>" : current ? formatSize(current.size) : "", SIZE_W, "right")}{" "}
          </Text>
        )}
        {edge("║")}
      </Text>
      <Text wrap="truncate">{edge(`╚${"═".repeat(inner)}╝`)}</Text>
      <Text wrap="truncate">
        {fitHints(
          [
            { k: "Enter", label: "Open", rank: 0 },
            { k: "Space", label: "Select", rank: 0 },
            { k: "Esc", label: cancelLabel, rank: 0 },
            { k: "Ins", label: "Mark", rank: 2 },
            { k: "F3", label: "View", rank: 2 },
            { k: "F5", label: "Copy", rank: 1 },
            { k: "F6", label: clipboard.length > 0 ? `Paste ${clipboard.length}` : "Paste", rank: 1 },
            { k: "F7", label: "MkDir", rank: 2 },
            { k: "F8", label: "Delete", rank: 1 },
            { k: "←", label: "Up", rank: 3 },
            { k: "a-z", label: "Jump", rank: 3 },
          ],
          width,
        ).map((hint) => (
          <KeyHint key={hint.k} k={hint.k} label={hint.label} />
        ))}
      </Text>
      {deleting && (
        <Box position="absolute" top={0} left={0} width={width} height={height + 7} justifyContent="center" alignItems="center">
          <ConfirmDialog
            title="Delete"
            lines={deleteQuestion(deleting)}
            width={Math.min(width - 4, 64)}
            onConfirm={confirmDelete}
            onCancel={() => setDeleting(null)}
          />
        </Box>
      )}
      {creating && (
        // Last, so it paints over the panel; centred over it. absolute children are placed inside the card padding.
        <Box position="absolute" top={0} left={0} width={width} height={height + 7} justifyContent="center" alignItems="center">
          <InputDialog
            title="Create a new Directory"
            label="Enter directory name:"
            width={Math.min(width - 4, 64)}
            error={error}
            onSubmit={(value) => void createFolder(value)}
            onCancel={() => {
              setCreating(false);
              setError(null);
            }}
          />
        </Box>
      )}
    </Box>
  );
}

/** Info line while entries are marked: "3 marked: 2 files (14K), 1 folder". */
function markedSummary(items: Row[]): string {
  const files = items.filter((row) => !row.isDir);
  const folders = items.length - files.length;
  const bytes = files.reduce((sum, row) => sum + row.size, 0);
  const parts = [
    files.length > 0 && `${files.length} ${files.length === 1 ? "file" : "files"} (${formatSize(bytes)})`,
    folders > 0 && `${folders} ${folders === 1 ? "folder" : "folders"}`,
  ].filter(Boolean);
  return `${items.length} marked: ${parts.join(", ")} · F5 copy · F8 delete`;
}

function deleteQuestion(items: Row[]): string[] {
  const folders = items.filter((row) => row.isDir).length;
  const lines =
    items.length === 1
      ? [`Delete ${folders ? "folder" : "file"}`, `"${items[0]!.name}"?`]
      : [`Delete ${items.length} marked items?`];
  if (folders > 0) lines.push(folders === 1 && items.length === 1 ? "Everything in it is deleted too." : "Folders are deleted with everything in them.");
  lines.push("This cannot be undone.");
  return lines;
}

/** `"a.txt"`, or "3 items" when there are several. */
function describeItems(items: Row[]): string {
  return items.length === 1 ? `"${items[0]!.name}"` : `${items.length} items`;
}

interface Hint {
  k: string;
  label: string;
  /** 0 = always shown; higher ranks are dropped first when the line is too narrow. */
  rank: number;
}

/** The hints that fit on one line of `width` columns, dropping the highest ranks first, in their original order. */
export function fitHints(hints: Hint[], width: number): Hint[] {
  const size = (hint: Hint) => [...`${hint.k} ${hint.label} `].length;
  let shown = hints;
  for (let rank = Math.max(...hints.map((h) => h.rank)); rank > 0; rank--) {
    if (shown.reduce((sum, hint) => sum + size(hint), 0) - 1 <= width) break;
    shown = shown.filter((hint) => hint.rank < rank);
  }
  return shown;
}

/** Midnight Commander key bar item: the key, then its action on a colored label. */
export function KeyHint({ k, label }: { k: string; label: string }) {
  const { keys } = useTheme();
  return (
    <Text>
      <Text color={keys.key} bold>
        {`${k} `}
      </Text>
      <Text color={keys.labelText} backgroundColor={keys.labelBg}>
        {label}
      </Text>
      <Text> </Text>
    </Text>
  );
}
