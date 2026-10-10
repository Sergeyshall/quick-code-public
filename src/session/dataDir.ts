import { randomBytes } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** Per-project folder holding quick-code's own data (sessions, command history). */
export const DATA_DIR_NAME = ".quick-code";

/**
 * Makes sure `<rootDir>/.quick-code` exists and returns its path. A symlink or file with that
 * name is refused, so a checked-out repository cannot redirect our writes outside the project.
 */
export async function ensureDataDir(rootDir: string): Promise<string> {
  const dir = path.join(rootDir, DATA_DIR_NAME);
  await mkdir(dir, { recursive: true });
  const info = await lstat(dir);
  if (!info.isDirectory()) throw new Error(`${DATA_DIR_NAME} exists but is not a folder`);
  // Keep history (which can contain file contents and command output) out of git by default.
  await writeFile(path.join(dir, ".gitignore"), "# quick-code local data\n*\n", { flag: "wx" }).catch(ignoreExists);
  return dir;
}

/** Creates `dir` (inside a data dir) unless it exists, refusing symlinks. */
export async function ensureSubdir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  if (!(await lstat(dir)).isDirectory()) throw new Error(`${dir} is not a folder`);
  return dir;
}

/**
 * Writes via a fresh temp file and rename, so readers never see half a file and an existing
 * symlink at `file` is replaced rather than followed.
 */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, data, { flag: "wx" });
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

function ignoreExists(err: NodeJS.ErrnoException): void {
  if (err.code !== "EEXIST") throw err;
}
