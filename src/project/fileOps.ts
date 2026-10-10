import { access, cp, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";

export interface OpResult {
  /** Names created (paste) or removed (delete), in order. */
  done: string[];
  /** One line per entry that failed, e.g. `"a.txt": EACCES`. */
  failed: string[];
}

/** True when `inner` is `outer` itself or somewhere below it. */
export function isInside(inner: string, outer: string): boolean {
  const rel = path.relative(outer, inner);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}

/**
 * The entry's location with its parent folder symlink-resolved. The entry itself is not
 * followed: deleting a symlink removes the link, never its target.
 */
async function locate(entry: string): Promise<string> {
  return path.join(await realpath(path.dirname(entry)), path.basename(entry));
}

/** "a.txt" → "a copy.txt", then "a copy 2.txt", and so on: the first name `exists` rejects. */
export async function freeCopyName(
  dir: string,
  name: string,
  exists: (file: string) => Promise<boolean> = pathExists,
): Promise<string> {
  if (!(await exists(path.join(dir, name)))) return name;
  // A dotfile such as ".env" has no extension: its whole name is the stem.
  const ext = path.extname(name);
  const stem = ext && ext !== name ? name.slice(0, -ext.length) : name;
  const suffix = ext && ext !== name ? ext : "";
  for (let n = 1; ; n++) {
    const candidate = `${stem} copy${n === 1 ? "" : ` ${n}`}${suffix}`;
    if (!(await exists(path.join(dir, candidate)))) return candidate;
  }
}

async function pathExists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    // A dangling symlink fails access() but still occupies the name.
    () => stat(file).then(() => true, (err: NodeJS.ErrnoException) => err.code !== "ENOENT" && err.code !== "ENOTDIR"),
  );
}

/**
 * Copies files and folders into `destDir`. Never overwrites: a taken name gets a " copy" suffix,
 * like Finder. Symlinks are copied as links, and a folder cannot be copied into itself.
 */
export async function copyEntries(sources: string[], destDir: string): Promise<OpResult> {
  const result: OpResult = { done: [], failed: [] };
  const dest = await realpath(destDir);
  for (const source of sources) {
    const name = path.basename(source);
    try {
      const from = await locate(source);
      const info = await stat(from).catch(() => undefined);
      if (info?.isDirectory() && isInside(dest, await realpath(from))) {
        result.failed.push(`"${name}": cannot copy a folder into itself`);
        continue;
      }
      const target = await freeCopyName(dest, name);
      await cp(from, path.join(dest, target), {
        recursive: true,
        force: false,
        errorOnExist: true,
        verbatimSymlinks: true,
        preserveTimestamps: true,
      });
      result.done.push(target);
    } catch (err) {
      result.failed.push(`"${name}": ${describe(err)}`);
    }
  }
  return result;
}

/**
 * Deletes files and folders (folders with everything in them). Refuses the filesystem root and
 * any entry that is, or contains, one of `protectedDirs` (the open project, home, …).
 */
export async function deleteEntries(targets: string[], protectedDirs: string[]): Promise<OpResult> {
  const result: OpResult = { done: [], failed: [] };
  const guarded = await Promise.all(protectedDirs.map((dir) => realpath(dir).catch(() => path.resolve(dir))));
  for (const target of targets) {
    const name = path.basename(target) || target;
    try {
      const where = await locate(target);
      if (path.dirname(where) === where || guarded.some((dir) => isInside(dir, where))) {
        result.failed.push(`"${name}" is protected`);
        continue;
      }
      await rm(where, { recursive: true, force: false });
      result.done.push(name);
    } catch (err) {
      result.failed.push(`"${name}": ${describe(err)}`);
    }
  }
  return result;
}

function describe(err: unknown): string {
  return (err as NodeJS.ErrnoException).code ?? (err instanceof Error ? err.message : String(err));
}
