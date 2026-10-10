import { readFile } from "node:fs/promises";
import { resolveSafePath } from "../skills/pathGuard";

export const INSTRUCTIONS_FILE = "AGENTS.md";
/** Larger files are cut so a huge AGENTS.md cannot crowd out the conversation. */
const MAX_CHARS = 40_000;

export interface ProjectInstructions {
  text: string;
  truncated: boolean;
}

/**
 * Reads `AGENTS.md` from the project root, or returns null when there is none. It goes through
 * the path guard, so a symlinked AGENTS.md pointing outside the project is ignored.
 */
export async function loadProjectInstructions(rootDir: string): Promise<ProjectInstructions | null> {
  try {
    const file = await resolveSafePath(rootDir, INSTRUCTIONS_FILE);
    const text = (await readFile(file, "utf8")).trim();
    if (!text) return null;
    return text.length > MAX_CHARS
      ? { text: text.slice(0, MAX_CHARS), truncated: true }
      : { text, truncated: false };
  } catch {
    return null;
  }
}
