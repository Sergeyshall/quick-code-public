import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { bashSkill, scrubEnv } from "../src/skills/bash";
import type { ApprovalRequest } from "../src/skills";

let root: string;
beforeAll(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "quick-code-bash-")));
});
afterAll(() => rm(root, { recursive: true, force: true }));

const allow = async () => true;

test("runs in the project folder and reports exit code and output", async () => {
  const out = await bashSkill.execute({ command: "pwd; echo oops >&2; exit 3" }, { rootDir: root, confirm: allow });
  expect(out).toContain("Exit code: 3");
  expect(out).toContain(`stdout:\n${root}`);
  expect(out).toContain("stderr:\noops");
});

test("asks for approval with the exact command", async () => {
  const seen: ApprovalRequest[] = [];
  const confirm = async (req: ApprovalRequest) => (seen.push(req), false);
  await expect(bashSkill.execute({ command: "echo hi" }, { rootDir: root, confirm })).rejects.toThrow(/declined/);
  expect(seen).toEqual([{ tool: "bash", title: "Run shell command", detail: "echo hi" }]);
});

test("fails closed without an approval channel", async () => {
  await expect(bashSkill.execute({ command: "echo hi" }, { rootDir: root })).rejects.toThrow(/declined/);
});

test("kills commands that exceed the timeout", async () => {
  const started = Date.now();
  const out = await bashSkill.execute({ command: "sleep 5", timeout_ms: 200 }, { rootDir: root, confirm: allow });
  expect(out).toMatch(/Timed out after 200 ms/);
  expect(Date.now() - started).toBeLessThan(3000);
});

test("does not expose secrets to commands", async () => {
  expect(scrubEnv({ ANTHROPIC_API_KEY: "x", GITHUB_TOKEN: "y", PATH: "/bin" })).toEqual({ PATH: "/bin" });
  process.env.QC_TEST_SECRET = "hunter2";
  const out = await bashSkill.execute({ command: "echo \"[$QC_TEST_SECRET]\"" }, { rootDir: root, confirm: allow });
  expect(out).toContain("[]");
  delete process.env.QC_TEST_SECRET;
});
