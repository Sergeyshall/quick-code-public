import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, readlink, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { copyEntries, deleteEntries, freeCopyName, isInside } from "../src/project/fileOps";

const tempDir = async () => realpath(await mkdtemp(path.join(tmpdir(), "qc-ops-")));

test("isInside compares whole path segments", () => {
  expect(isInside("/a/b", "/a")).toBe(true);
  expect(isInside("/a", "/a")).toBe(true);
  expect(isInside("/ab", "/a")).toBe(false);
  expect(isInside("/", "/a")).toBe(false);
  expect(isInside("/a/..b", "/a")).toBe(true);
});

test("picks a free ' copy' name, keeping the extension", async () => {
  const taken = new Set(["/d/a.txt", "/d/a copy.txt", "/d/src", "/d/.env"]);
  const exists = async (file: string) => taken.has(file);
  expect(await freeCopyName("/d", "b.txt", exists)).toBe("b.txt");
  expect(await freeCopyName("/d", "a.txt", exists)).toBe("a copy 2.txt");
  expect(await freeCopyName("/d", "src", exists)).toBe("src copy");
  expect(await freeCopyName("/d", ".env", exists)).toBe(".env copy");
});

test("copies files and folders without overwriting anything", async () => {
  const root = await tempDir();
  await mkdir(path.join(root, "src/lib"), { recursive: true });
  await writeFile(path.join(root, "src/lib/x.ts"), "x");
  await writeFile(path.join(root, "a.txt"), "original");
  await mkdir(path.join(root, "out"));
  await writeFile(path.join(root, "out/a.txt"), "keep me");
  await symlink("a.txt", path.join(root, "link"));

  const result = await copyEntries(["src", "a.txt", "link"].map((n) => path.join(root, n)), path.join(root, "out"));
  expect(result).toEqual({ done: ["src", "a copy.txt", "link"], failed: [] });
  expect(await readFile(path.join(root, "out/src/lib/x.ts"), "utf8")).toBe("x");
  expect(await readFile(path.join(root, "out/a.txt"), "utf8")).toBe("keep me");
  expect(await readFile(path.join(root, "out/a copy.txt"), "utf8")).toBe("original");
  expect(await readlink(path.join(root, "out/link"))).toBe("a.txt");

  // Pasting into the same folder makes a copy next to the original.
  expect((await copyEntries([path.join(root, "a.txt")], root)).done).toEqual(["a copy.txt"]);
});

test("refuses to copy a folder into itself", async () => {
  const root = await tempDir();
  await mkdir(path.join(root, "src/inner"), { recursive: true });
  const result = await copyEntries([path.join(root, "src")], path.join(root, "src/inner"));
  expect(result.done).toEqual([]);
  expect(result.failed[0]).toContain("into itself");
  expect(await readdir(path.join(root, "src/inner"))).toEqual([]);
});

test("deletes files and folders but never protected folders or their parents", async () => {
  const root = await tempDir();
  const project = path.join(root, "work/project");
  await mkdir(path.join(project, "src"), { recursive: true });
  await writeFile(path.join(root, "a.txt"), "a");
  await mkdir(path.join(root, "old/deep"), { recursive: true });
  await symlink(project, path.join(root, "to-project"));

  const result = await deleteEntries(
    ["a.txt", "old", "work", "work/project", "to-project", "missing"].map((n) => path.join(root, n)),
    [project],
  );
  expect(result.done).toEqual(["a.txt", "old", "to-project"]);
  expect(result.failed).toEqual(['"work" is protected', '"project" is protected', '"missing": ENOENT']);
  // Removing the link left its target alone; files inside the project may still be deleted.
  expect(await readdir(path.join(project))).toEqual(["src"]);
  expect((await deleteEntries([path.join(project, "src")], [project])).done).toEqual(["src"]);
  expect((await deleteEntries(["/"], [])).failed).toEqual(['"/" is protected']);
});
