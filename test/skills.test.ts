import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveSafePath } from "../src/skills/pathGuard";
import { readFileSkill } from "../src/skills/readFile";
import { writeFileSkill } from "../src/skills/writeFile";

let base: string;
let root: string;
let outside: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), "quick-code-test-")));
  root = path.join(base, "project");
  outside = path.join(base, "secret.txt");
  await Bun.write(path.join(root, "src", "hello.txt"), "hi");
  await writeFile(outside, "top secret");
  await symlink(outside, path.join(root, "link-to-secret"));
  await symlink(base, path.join(root, "link-to-parent"));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("resolveSafePath", () => {
  test.each(["src/hello.txt", "./src/hello.txt", "src/../src/hello.txt", "new/dir/file.txt"])(
    "allows %p",
    async (p) => {
      const resolved = await resolveSafePath(root, p);
      expect(resolved.startsWith(root + path.sep)).toBe(true);
    },
  );

  test("allows absolute paths that are inside the root", async () => {
    expect(await resolveSafePath(root, path.join(root, "src/hello.txt"))).toBe(
      path.join(root, "src/hello.txt"),
    );
  });

  test.each([
    "../secret.txt",
    "..",
    "src/../../secret.txt",
    "/etc/passwd",
    "link-to-secret",
    "link-to-parent/secret.txt",
    "link-to-parent/new-file.txt",
    "",
    "a\0b",
  ])("blocks %p", async (p) => {
    await expect(resolveSafePath(root, p)).rejects.toThrow();
  });

  test("blocks sibling directory with a shared prefix", async () => {
    await expect(resolveSafePath(root, `${root}-evil/x.txt`)).rejects.toThrow(/outside/);
  });
});

describe("skills", () => {
  const ctx = () => ({ rootDir: root });

  test("readFile reads inside root", async () => {
    expect(await readFileSkill.execute({ path: "src/hello.txt" }, ctx())).toContain("hi");
  });

  test("readFile refuses traversal and symlink escape", async () => {
    await expect(readFileSkill.execute({ path: "../secret.txt" }, ctx())).rejects.toThrow(/outside/);
    await expect(readFileSkill.execute({ path: "link-to-secret" }, ctx())).rejects.toThrow(/outside/);
  });

  test("writeFile writes inside root and creates directories", async () => {
    await writeFileSkill.execute({ path: "out/a/b.txt", content: "ok" }, ctx());
    expect(await readFile(path.join(root, "out/a/b.txt"), "utf8")).toBe("ok");
  });

  test("writeFile refuses to escape and leaves outside files untouched", async () => {
    for (const p of ["../secret.txt", outside, "link-to-secret", "link-to-parent/secret.txt"]) {
      await expect(writeFileSkill.execute({ path: p, content: "pwned" }, ctx())).rejects.toThrow();
    }
    expect(await readFile(outside, "utf8")).toBe("top secret");
  });

  test("writeFile validates input types", async () => {
    await expect(writeFileSkill.execute({ path: "x.txt", content: 42 }, ctx())).rejects.toThrow(/string/);
  });
});
