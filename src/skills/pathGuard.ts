import { realpath } from "node:fs/promises";
import path from "node:path";
import { SkillError } from "./types";

/**
 * Resolves a model-supplied path and guarantees it stays inside `rootDir`.
 *
 * - Rejects empty paths and NUL bytes.
 * - Resolves `..` segments and absolute paths lexically, then checks containment.
 * - Resolves symlinks on the deepest existing ancestor, so a symlink inside the
 *   root that points outside it cannot be used to escape.
 *
 * `rootDir` must already be an absolute, symlink-resolved path.
 * Returns the absolute path (with symlinks resolved) that is safe to use.
 */
export async function resolveSafePath(rootDir: string, requested: string): Promise<string> {
  if (requested.trim() === "") {
    throw new SkillError("Path must not be empty.");
  }
  if (requested.includes("\0")) {
    throw new SkillError("Path must not contain NUL bytes.");
  }

  const lexical = path.resolve(rootDir, requested);
  assertInside(rootDir, lexical, requested);

  const real = await resolveRealPath(lexical);
  assertInside(rootDir, real, requested);

  return real;
}

function assertInside(rootDir: string, candidate: string, requested: string): void {
  const rel = path.relative(rootDir, candidate);
  const escapes = rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  if (escapes) {
    throw new SkillError(
      `Access denied: "${requested}" is outside the working directory. Only paths inside ${rootDir} are allowed.`,
    );
  }
}

/**
 * realpath() for paths that may not exist yet: resolves the deepest existing
 * ancestor and re-appends the missing tail.
 */
async function resolveRealPath(absolute: string): Promise<string> {
  const missing: string[] = [];
  let current = absolute;

  while (true) {
    try {
      const resolved = await realpath(current);
      return missing.length ? path.join(resolved, ...missing.reverse()) : resolved;
    } catch (err) {
      if (!isNotFound(err)) throw err;
      const parent = path.dirname(current);
      if (parent === current) throw err;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

function isNotFound(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
