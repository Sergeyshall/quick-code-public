import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./dataDir";

export const HISTORY_FILE = "commands-history.md";
export const MAX_HISTORY = 50;

const HEADER = `# quick-code command history\n\n<!-- Oldest first, newest last. Up to ${MAX_HISTORY} entries. -->\n\n`;

/** Parses the Markdown list written by `formatHistory`; continuation lines are indented by two spaces. */
export function parseHistory(markdown: string): string[] {
  const commands: string[] = [];
  for (const line of markdown.split("\n")) {
    if (line.startsWith("- ")) commands.push(line.slice(2));
    else if (line.startsWith("  ") && commands.length > 0) commands[commands.length - 1] += `\n${line.slice(2)}`;
  }
  return commands;
}

export function formatHistory(commands: string[]): string {
  return HEADER + commands.map((cmd) => `- ${cmd.split("\n").join("\n  ")}\n`).join("");
}

/** Appends `command` (skipping an immediate repeat) and drops the oldest entries beyond `max`. */
export function addToHistory(commands: string[], command: string, max = MAX_HISTORY): string[] {
  const next = commands.at(-1) === command ? commands : [...commands, command];
  return next.slice(-max);
}

export async function loadHistory(dataDir: string): Promise<string[]> {
  try {
    return parseHistory(await readFile(path.join(dataDir, HISTORY_FILE), "utf8")).slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}

export function saveHistory(dataDir: string, commands: string[]): Promise<void> {
  return writeFileAtomic(path.join(dataDir, HISTORY_FILE), formatHistory(commands));
}
