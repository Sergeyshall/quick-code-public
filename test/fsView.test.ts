import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildTree,
  changedPaths,
  fit,
  formatSize,
  listDirectory,
  validateFolderName,
} from "../src/project/fsView";

let root: string;
beforeAll(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "quick-code-fs-")));
  await Bun.write(path.join(root, "b.txt"), "b");
  await Bun.write(path.join(root, "A.md"), "a");
  await Bun.write(path.join(root, "src", "index.ts"), "x");
  await Bun.write(path.join(root, "node_modules", "pkg", "index.js"), "x");
  await mkdir(path.join(root, "zeta"));
  await symlink(root, path.join(root, "loop"));
});
afterAll(() => rm(root, { recursive: true, force: true }));

test("lists folders first, then files, case-insensitively", async () => {
  const names = (await listDirectory(root)).map((e) => `${e.name}${e.isDir ? "/" : ""}`);
  expect(names).toEqual(["loop/", "node_modules/", "src/", "zeta/", "A.md", "b.txt"]);
});

test("tree expands normal folders but not ignored folders or symlinks", async () => {
  const { lines, truncated } = await buildTree(root);
  const rels = lines.map((l) => l.rel);
  expect(rels).toContain(path.join("src", "index.ts"));
  expect(rels).not.toContain(path.join("node_modules", "pkg"));
  expect(rels.some((r) => r.startsWith(`loop${path.sep}`))).toBe(false);
  expect(lines.find((l) => l.rel === "node_modules")?.collapsed).toBe(true);
  expect(lines.at(-1)?.prefix).toBe("└─ ");
  expect(truncated).toBe(false);
});

test("tree respects maxEntries", async () => {
  const tree = await buildTree(root, { maxEntries: 2 });
  expect(tree.lines).toHaveLength(2);
  expect(tree.truncated).toBe(true);
});

test("changedPaths reports new and modified entries", () => {
  const line = (rel: string, mtimeMs: number) => ({ rel, name: rel, isDir: false, collapsed: false, prefix: "", mtimeMs });
  const changed = changedPaths([line("a", 1), line("b", 1)], [line("a", 1), line("b", 2), line("c", 1)]);
  expect([...changed].sort()).toEqual(["b", "c"]);
});

test("formatting helpers", () => {
  expect(formatSize(999)).toBe("999");
  expect(formatSize(1536)).toBe("1.5K");
  expect(formatSize(5 * 1024 * 1024)).toBe("5.0M");
  expect(fit("abcdef", 4)).toBe("abc…");
  expect(fit("ab", 4, "right")).toBe("  ab");
  expect(fit("ab", 5, "center")).toBe(" ab  ");
});

test("validateFolderName", () => {
  expect(validateFolderName("new-app")).toBeNull();
  for (const bad of ["", ".", "..", "a/b", "a\\b", "a\0b"]) expect(validateFolderName(bad)).not.toBeNull();
});
