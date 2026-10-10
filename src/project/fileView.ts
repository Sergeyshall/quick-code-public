import { open } from "node:fs/promises";

/** The viewer reads at most this much of a file. */
export const MAX_VIEW_BYTES = 2 * 1024 * 1024;
const TAB_WIDTH = 4;
const BYTES_PER_HEX_LINE = 16;

export interface ViewedFile {
  bytes: Buffer;
  /** Size of the whole file; larger than `bytes.length` when it was cut at MAX_VIEW_BYTES. */
  size: number;
  truncated: boolean;
  binary: boolean;
}

/** Reads the start of a regular file for the quick viewer. Folders, pipes and devices are refused. */
export async function readForView(file: string, limit = MAX_VIEW_BYTES): Promise<ViewedFile> {
  const handle = await open(file, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("not a regular file");
    const bytes = Buffer.alloc(Math.min(info.size, limit));
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const data = bytes.subarray(0, bytesRead);
    return { bytes: data, size: info.size, truncated: info.size > bytesRead, binary: isBinary(data) };
  } finally {
    await handle.close();
  }
}

/** Same heuristic as git and most viewers: a NUL byte near the start means binary. */
export function isBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

/**
 * Splits text into display lines: tabs expanded, and control characters (which could move the
 * cursor or recolor the terminal) replaced with "·".
 */
export function textLines(bytes: Buffer): string[] {
  const lines = bytes.toString("utf8").split(/\r?\n/);
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines.map((line) => sanitize(expandTabs(line)));
}

function expandTabs(line: string): string {
  if (!line.includes("\t")) return line;
  let out = "";
  for (const ch of line) out += ch === "\t" ? " ".repeat(TAB_WIDTH - (out.length % TAB_WIDTH)) : ch;
  return out;
}

function sanitize(line: string): string {
  // eslint-disable-next-line no-control-regex
  return line.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "·");
}

/** Cuts lines into rows of at most `width` characters. */
export function wrapLines(lines: string[], width: number): string[] {
  const size = Math.max(1, width);
  return lines.flatMap((line) => {
    const chars = [...line];
    if (chars.length <= size) return [line];
    const rows: string[] = [];
    for (let i = 0; i < chars.length; i += size) rows.push(chars.slice(i, i + size).join(""));
    return rows;
  });
}

/** Classic hex dump: "00000010  48 65 6c 6c 6f 20 77 6f  72 6c 64 0a ...  |Hello world.|". */
export function hexLines(bytes: Uint8Array): string[] {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BYTES_PER_HEX_LINE) {
    const chunk = bytes.subarray(offset, offset + BYTES_PER_HEX_LINE);
    const hex = Array.from({ length: BYTES_PER_HEX_LINE }, (_, i) =>
      i < chunk.length ? chunk[i]!.toString(16).padStart(2, "0") : "  ",
    );
    const ascii = Array.from(chunk, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join("");
    lines.push(`${offset.toString(16).padStart(8, "0")}  ${hex.slice(0, 8).join(" ")}  ${hex.slice(8).join(" ")}  |${ascii}|`);
  }
  return lines;
}
