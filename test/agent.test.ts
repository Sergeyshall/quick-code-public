import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentService, type AgentEvent } from "../src/agent/AgentService";
import type { ILlmAdapter, LlmRequest, LlmResponse } from "../src/llm/types";
import { builtinSkills, SkillRegistry } from "../src/skills";

let root: string;
beforeAll(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "quick-code-agent-")));
});
afterAll(() => rm(root, { recursive: true, force: true }));

/** Replays a fixed script of responses and records every request. */
class ScriptedAdapter implements ILlmAdapter {
  readonly name = "scripted";
  readonly requests: LlmRequest[] = [];
  constructor(private readonly script: LlmResponse[]) {}
  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(structuredClone(request));
    const next = this.script.shift();
    if (!next) throw new Error("script exhausted");
    return next;
  }
}

const toolTurn = (id: string, name: string, input: Record<string, unknown>): LlmResponse => ({
  stopReason: "tool_use",
  message: { role: "assistant", text: "", toolCalls: [{ id, name, input }] },
});
const final = (text: string): LlmResponse => ({
  stopReason: "end_turn",
  message: { role: "assistant", text, toolCalls: [] },
});

test("runs tool calls until the model returns final text", async () => {
  const llm = new ScriptedAdapter([
    toolTurn("t1", "writeFile", { path: "notes/a.txt", content: "hello" }),
    toolTurn("t2", "readFile", { path: "../escape.txt" }),
    final("done"),
  ]);
  const agent = new AgentService({ llm, skills: new SkillRegistry(builtinSkills), context: { rootDir: root } });
  const events: AgentEvent[] = [];

  expect(await agent.send("do it", (e) => events.push(e))).toBe("done");
  expect(await readFile(path.join(root, "notes/a.txt"), "utf8")).toBe("hello");

  expect(llm.requests[0]!.tools.map((t) => t.name)).toEqual(["readFile", "writeFile", "bash"]);
  const last = llm.requests[2]!.messages;
  expect(last.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant", "tool"]);
  const blocked = last[4];
  expect(blocked?.role === "tool" && blocked.results[0]!.isError).toBe(true);

  expect(events).toContainEqual({ type: "status", text: "Writing file notes/a.txt..." });
  expect(events.some((e) => e.type === "tool" && e.isError)).toBe(true);
});

test("rolls back history when the adapter throws", async () => {
  const llm = new ScriptedAdapter([toolTurn("t1", "readFile", { path: "missing.txt" })]);
  const agent = new AgentService({ llm, skills: new SkillRegistry(builtinSkills), context: { rootDir: root } });
  await expect(agent.send("x")).rejects.toThrow("script exhausted");

  llm["script"].push(final("ok"));
  expect(await agent.send("again")).toBe("ok");
  expect(llm.requests.at(-1)!.messages).toEqual([{ role: "user", text: "again" }]);
});

test("stops at maxSteps", async () => {
  const llm = new ScriptedAdapter(
    Array.from({ length: 5 }, (_, i) => toolTurn(`t${i}`, "readFile", { path: "nope" })),
  );
  const agent = new AgentService({
    llm, skills: new SkillRegistry(builtinSkills), context: { rootDir: root }, maxSteps: 3,
  });
  expect(await agent.send("loop")).toMatch(/Stopped after 3 steps/);
});

test("puts AGENTS.md into the system prompt, re-reading it every turn", async () => {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), "quick-code-agents-md-")));
  try {
    const llm = new ScriptedAdapter([final("one"), final("two"), final("three")]);
    const agent = new AgentService({ llm, skills: new SkillRegistry(builtinSkills), context: { rootDir: dir } });
    await agent.send("a");
    expect(llm.requests[0]!.system).not.toContain("project_instructions");

    await writeFile(path.join(dir, "AGENTS.md"), "Always answer in French.");
    await agent.send("b");
    expect(llm.requests[1]!.system).toContain('<project_instructions file="AGENTS.md">\nAlways answer in French.');

    agent.loadHistory([{ role: "user", text: "restored" }, { role: "assistant", text: "ok", toolCalls: [] }]);
    await agent.send("c");
    expect(llm.requests[2]!.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(agent.getHistory()).toHaveLength(4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
