import { Box, Text } from "ink";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { useEffect, useState } from "react";
import { buildTree, changedPaths, COLLAPSED_DIRS, fit, type ProjectTree as Tree } from "../project/fsView";
import { useTheme } from "./theme";

const DEBOUNCE_MS = 150;
const POLL_MS = 2000;

/** Builds the project tree and rebuilds it whenever something under `rootDir` changes. */
export function useProjectTree(rootDir: string): { tree: Tree | null; changed: Set<string> } {
  const [state, setState] = useState<{ tree: Tree | null; changed: Set<string> }>({
    tree: null,
    changed: new Set(),
  });

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poller: ReturnType<typeof setInterval> | undefined;
    let watcher: FSWatcher | undefined;
    let previous: Tree | null = null;

    const refresh = async () => {
      const next = await buildTree(rootDir);
      if (disposed) return;
      const changed = previous ? changedPaths(previous.lines, next.lines) : new Set<string>();
      // A poll that finds nothing new keeps the last highlight instead of clearing it.
      if (previous && changed.size === 0 && next.lines.length === previous.lines.length) return;
      previous = next;
      setState({ tree: next, changed });
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), DEBOUNCE_MS);
    };
    const startPolling = () => {
      watcher?.close();
      poller ??= setInterval(() => void refresh(), POLL_MS);
    };

    void refresh();
    try {
      watcher = watch(rootDir, { recursive: true }, (_event, filename) => {
        // Churn inside collapsed folders (node_modules, .git, ...) never changes what we show.
        const first = filename?.toString().split(path.sep)[0];
        const nested = filename?.toString().includes(path.sep);
        if (first && nested && COLLAPSED_DIRS.has(first)) return;
        schedule();
      });
      watcher.on("error", startPolling);
    } catch {
      startPolling();
    }

    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(poller);
      watcher?.close();
    };
  }, [rootDir]);

  return state;
}

interface ProjectTreeProps {
  rootDir: string;
  width: number;
  maxLines: number;
}

/** Right-hand panel showing the live file tree of the selected project. */
export function ProjectTree({ rootDir, width, maxLines }: ProjectTreeProps) {
  const theme = useTheme();
  const { tree, changed } = useProjectTree(rootDir);
  const inner = width - 4;
  const lines = tree?.lines ?? [];
  const overflow = lines.length > maxLines;
  const shown = overflow ? lines.slice(0, maxLines - 1) : lines;
  const hidden = lines.length - shown.length;

  return (
    <Box
      flexDirection="column"
      width={width}
      flexShrink={0}
      borderStyle="double"
      borderColor={theme.tree.border}
      borderBackgroundColor={theme.page.bg}
      paddingX={1}
    >
      <Text wrap="truncate">
        <Text color={theme.tree.titleText} backgroundColor={theme.tree.titleBg} bold>
          {fit(` ${path.basename(rootDir) || rootDir}/ `, Math.min(inner, [...path.basename(rootDir)].length + 3))}
        </Text>
        <Text color={theme.page.muted}> {tree ? `${lines.length}${tree.truncated ? "+" : ""} items` : "scanning…"}</Text>
      </Text>
      {tree && lines.length === 0 && <Text color={theme.page.muted}>(empty folder)</Text>}
      {shown.map((line) => {
        const isChanged = changed.has(line.rel);
        const label = line.isDir ? `${line.name}/${line.collapsed && COLLAPSED_DIRS.has(line.name) ? " …" : ""}` : line.name;
        return (
          <Text key={line.rel} wrap="truncate">
            <Text color={theme.tree.guides}>{line.prefix}</Text>
            <Text color={isChanged ? theme.tree.changed : line.isDir ? theme.tree.dir : theme.tree.file} bold={line.isDir}>
              {label}
            </Text>
            {isChanged && <Text color={theme.tree.changed}> ●</Text>}
          </Text>
        );
      })}
      {(hidden > 0 || tree?.truncated) && (
        <Text color={theme.page.muted}>… {hidden > 0 ? `${hidden} more` : "more"}</Text>
      )}
    </Box>
  );
}
