import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { hexLines, isBinary, readForView, textLines, wrapLines } from "../src/project/fileView";
import { functionKey } from "../src/ui/useFunctionKey";

test("reads the start of a file and flags truncation and binary content", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "qc-view-"));
  const text = path.join(dir, "a.txt");
  await writeFile(text, "hello world");
  expect(await readForView(text, 5)).toMatchObject({ size: 11, truncated: true, binary: false });
  expect((await readForView(text, 5)).bytes.toString()).toBe("hello");
  expect(await readForView(text)).toMatchObject({ truncated: false });

  const bin = path.join(dir, "b.bin");
  await writeFile(bin, Buffer.from([1, 0, 2]));
  expect((await readForView(bin)).binary).toBe(true);

  await expect(readForView(dir)).rejects.toThrow();
});

test("text lines expand tabs and neutralize control characters", () => {
  expect(textLines(Buffer.from("a\tb\r\nc\x1b[31m\n"))).toEqual(["a   b", "c·[31m"]);
  expect(textLines(Buffer.from(""))).toEqual([""]);
  expect(isBinary(Buffer.from("plain"))).toBe(false);
});

test("wraps long lines into rows", () => {
  expect(wrapLines(["abcdefg", "", "xy"], 3)).toEqual(["abc", "def", "g", "", "xy"]);
});

test("hex dump shows offset, bytes and printable text", () => {
  const [first, second] = hexLines(Buffer.from("0123456789abcdefXY\n"));
  expect(first).toBe("00000000  30 31 32 33 34 35 36 37  38 39 61 62 63 64 65 66  |0123456789abcdef|");
  expect(second).toStartWith("00000010  58 59 0a      ");
  expect(second).toEndWith("|XY.|");
});

test("recognizes F-key escape sequences from common terminals", () => {
  expect(functionKey("\x1bOR")).toBe(3);
  expect(functionKey("\x1b[13~")).toBe(3);
  expect(functionKey("\x1b[18~")).toBe(7);
  expect(functionKey("\x1b[21~")).toBe(10);
  expect(functionKey("r")).toBeUndefined();
});
