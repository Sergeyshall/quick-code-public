import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadProjectInstructions } from "../src/agent/projectInstructions";
import { addToHistory, formatHistory, loadHistory, parseHistory, saveHistory } from "../src/session/commandHistory";
import { ensureDataDir, writeFileAtomic } from "../src/session/dataDir";
import { isSessionId, sanitizeHistory, sessionIdFor, SessionStore, sessionTitle } from "../src/session/SessionStore";

let root: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "quick-code-session-")));
});
afterEach(() => rm(root, { recursive: true, force: true }));

test("ensureDataDir creates .quick-code with a git-ignore and refuses a symlink", async () => {
  const dir = await ensureDataDir(root);
  expect(dir).toBe(path.join(root, ".quick-code"));
  expect(await readFile(path.join(dir, ".gitignore"), "utf8")).toContain("*");
  await ensureDataDir(root); // idempotent

  const other = path.join(root, "other");
  await mkdir(path.join(other, "target"), { recursive: true });
  await symlink(path.join(other, "target"), path.join(other, ".quick-code"));
  await expect(ensureDataDir(other)).rejects.toThrow("not a folder");
});

test("writeFileAtomic replaces a symlink instead of writing through it", async () => {
  const outside = path.join(root, "outside.txt");
  await writeFile(outside, "keep");
  await symlink(outside, path.join(root, "link.json"));
  await writeFileAtomic(path.join(root, "link.json"), "new");
  expect(await readFile(outside, "utf8")).toBe("keep");
  expect(await readFile(path.join(root, "link.json"), "utf8")).toBe("new");
});

test("session ids are minute timestamps with suffixes on collision", () => {
  const date = new Date(2026, 8, 28, 8, 5);
  expect(sessionIdFor(date, new Set())).toBe("2026-09-28-08-05");
  expect(sessionIdFor(date, new Set(["2026-09-28-08-05", "2026-09-28-08-05-2"]))).toBe("2026-09-28-08-05-3");
  expect(isSessionId("2026-09-28-08-05-3")).toBe(true);
  expect(isSessionId("../../etc/passwd")).toBe(false);
  expect(sessionTitle("  fix\n the   build ")).toBe("fix the build");
  expect(sessionTitle("x".repeat(100))).toHaveLength(60);
});

test("sanitizeHistory drops a dangling tool call", () => {
  const history = sanitizeHistory([
    { role: "user", text: "hi" },
    { role: "assistant", text: "", toolCalls: [{ id: "t1", name: "bash", input: {} }] },
  ]);
  expect(history.map((m) => m.role)).toEqual(["user"]);
});

test("SessionStore saves, lists, resumes the latest and rebuilds a lost index", async () => {
  const dataDir = await ensureDataDir(root);
  const store = await SessionStore.open(dataDir);
  expect(store.list()).toEqual([]);
  expect(await store.latest()).toBeNull();

  const a = store.create("m", new Date(2026, 8, 28, 8, 0));
  const b = store.create("m", new Date(2026, 8, 28, 8, 0));
  expect(b.id).toBe(`${a.id}-2`);

  a.title = "first";
  a.updatedAt = "2026-09-28T08:00:00.000Z";
  a.messages = [{ role: "user", text: "hello" }, { role: "assistant", text: "hi", toolCalls: [], providerData: [{ type: "text", text: "hi" }] }];
  a.transcript = [{ kind: "user", text: "hello" }, { kind: "agent", text: "hi" }];
  b.title = "second";
  b.updatedAt = "2026-09-28T09:00:00.000Z";
  await Promise.all([store.save(a), store.save(b)]);

  const files = await readdir(path.join(dataDir, "sessions"));
  expect(files.sort()).toEqual(["index.json", `session-${a.id}-2.json`, `session-${a.id}.json`]);
  expect(store.list().map((s) => s.title)).toEqual(["second", "first"]);
  expect((await store.latest())?.id).toBe(b.id);
  expect(await store.load(a.id)).toEqual(a);
  await expect(store.load("../x")).rejects.toThrow("Invalid session id");

  await writeFile(path.join(dataDir, "sessions", "index.json"), "{ broken");
  const reopened = await SessionStore.open(dataDir);
  expect(reopened.list().map((s) => s.id)).toEqual([b.id, a.id]);
});

test("command history round-trips Markdown, skips repeats and keeps the newest 50", async () => {
  const list = ["ls", "multi\nline", "- dash"];
  expect(parseHistory(formatHistory(list))).toEqual(list);

  let history: string[] = [];
  for (let i = 0; i < 60; i++) history = addToHistory(history, `cmd ${i}`);
  history = addToHistory(history, "cmd 59");
  expect(history).toHaveLength(50);
  expect(history[0]).toBe("cmd 10");
  expect(history.at(-1)).toBe("cmd 59");

  const dataDir = await ensureDataDir(root);
  expect(await loadHistory(dataDir)).toEqual([]);
  await saveHistory(dataDir, history);
  expect(await readFile(path.join(dataDir, "commands-history.md"), "utf8")).toStartWith("# quick-code command history");
  expect(await loadHistory(dataDir)).toEqual(history);
});

test("AGENTS.md is read from the project root but not through an escaping symlink", async () => {
  expect(await loadProjectInstructions(root)).toBeNull();
  await writeFile(path.join(root, "AGENTS.md"), "Use tabs.\n");
  expect(await loadProjectInstructions(root)).toEqual({ text: "Use tabs.", truncated: false });

  const project = path.join(root, "project");
  await mkdir(project);
  await symlink(path.join(root, "AGENTS.md"), path.join(project, "AGENTS.md"));
  expect(await loadProjectInstructions(project)).toBeNull();
});
