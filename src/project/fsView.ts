import { lstat, readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface DirEntry {
  name: string;
  /** Absolute path of the entry. */
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  mtimeMs: number;
}

/** Directory listing sorted Norton Commander style: folders first, then files, case-insensitive. */
export async function listDirectory(dir: string): Promise<DirEntry[]> {
  const dirents = await readdir(dir, { withFileTypes: true });
  const entries = await Promise.all(
    dirents.map(async (dirent): Promise<DirEntry | undefined> => {
      const full = path.join(dir, dirent.name);
      // stat() follows symlinks so linked folders are navigable; broken links fall back to lstat().
      const info = await stat(full).catch(() => lstat(full).catch(() => undefined));
      if (!info) return undefined;
      return {
        name: dirent.name,
        path: full,
        isDir: info.isDirectory(),
        isSymlink: dirent.isSymbolicLink(),
        size: info.size,
        mtimeMs: info.mtimeMs,
      };
    }),
  );
  return sortEntries(entries.filter((e): e is DirEntry => e !== undefined));
}

export function sortEntries<T extends { name: string; isDir: boolean }>(entries: T[]): T[] {
  return [...entries].sort(
    (a, b) =>
      Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** Folders listed in the tree but never expanded: large, generated, or irrelevant to the agent. */
export const COLLAPSED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  ".turbo",
  ".venv",
  "__pycache__",
  "target",
  ".quick-code",
]);

export interface TreeLine {
  /** Path relative to the tree root, used as a stable key. */
  rel: string;
  name: string;
  isDir: boolean;
  /** Folder shown but not expanded (ignored, symlinked, or past the depth limit). */
  collapsed: boolean;
  /** Box-drawing guides, e.g. "│  ├─ ". */
  prefix: string;
  mtimeMs: number;
}

export interface ProjectTree {
  lines: TreeLine[];
  /** True when `maxEntries` cut the walk short. */
  truncated: boolean;
}

export async function buildTree(
  root: string,
  { maxDepth = 4, maxEntries = 500 }: { maxDepth?: number; maxEntries?: number } = {},
): Promise<ProjectTree> {
  const lines: TreeLine[] = [];
  let truncated = false;

  async function walk(dir: string, depth: number, prefix: string): Promise<void> {
    const entries = await listDirectory(dir).catch(() => []);
    for (const [i, entry] of entries.entries()) {
      if (lines.length >= maxEntries) {
        truncated = true;
        return;
      }
      const last = i === entries.length - 1;
      // Never descend into symlinks: they may loop or point outside the project.
      const collapsed =
        entry.isDir && (entry.isSymlink || COLLAPSED_DIRS.has(entry.name) || depth + 1 >= maxDepth);
      lines.push({
        rel: path.relative(root, entry.path),
        name: entry.name,
        isDir: entry.isDir,
        collapsed,
        prefix: prefix + (last ? "└─ " : "├─ "),
        mtimeMs: entry.mtimeMs,
      });
      if (entry.isDir && !collapsed) {
        await walk(entry.path, depth + 1, prefix + (last ? "   " : "│  "));
      }
    }
  }

  await walk(root, 0, "");
  return { lines, truncated };
}

/** Paths that are new or modified in `next` compared with `prev`. */
export function changedPaths(prev: TreeLine[], next: TreeLine[]): Set<string> {
  const before = new Map(prev.map((line) => [line.rel, line.mtimeMs]));
  return new Set(next.filter((line) => before.get(line.rel) !== line.mtimeMs).map((line) => line.rel));
}

export function formatSize(bytes: number): string {
  if (bytes < 1000) return String(bytes);
  const units = ["K", "M", "G", "T"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}${units[unit]}`;
}

/** "YY-MM-DD HH:MM", as in the Norton Commander date column. */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getFullYear() % 100)}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** Pads or truncates to exactly `width` characters, marking cuts with "…". */
export function fit(text: string, width: number, align: "left" | "right" | "center" = "left"): string {
  if (width <= 0) return "";
  const chars = [...text];
  if (chars.length > width) return `${chars.slice(0, width - 1).join("")}…`;
  const gap = width - chars.length;
  if (align === "right") return " ".repeat(gap) + text;
  if (align === "center") return " ".repeat(Math.floor(gap / 2)) + text + " ".repeat(Math.ceil(gap / 2));
  return text + " ".repeat(gap);
}

/** Returns why `name` is not a valid single folder name, or null when it is. */
export function validateFolderName(name: string): string | null {
  if (name === "") return "Folder name must not be empty";
  if (name === "." || name === "..") return `"${name}" is not a valid folder name`;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return "Folder name must not contain / or \\";
  return null;
}
