import type { ChatMessage, ILlmAdapter, ToolCall, ToolResult } from "../llm/types";
import type { SkillRegistry } from "../skills";
import type { SkillContext } from "../skills/types";
import { INSTRUCTIONS_FILE, loadProjectInstructions, type ProjectInstructions } from "./projectInstructions";

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "tool"; name: string; summary: string; isError: boolean };

export interface AgentServiceOptions {
  llm: ILlmAdapter;
  skills: SkillRegistry;
  context: SkillContext;
  /** Upper bound on LLM round-trips for a single user message. */
  maxSteps?: number;
}

export class AgentService {
  private readonly llm: ILlmAdapter;
  private readonly skills: SkillRegistry;
  private readonly context: SkillContext;
  private readonly maxSteps: number;
  private history: ChatMessage[] = [];
  /** History length before the in-flight user message, for rollback. */
  private turnStart = 0;
  /** AGENTS.md as of the current turn; re-read every turn so edits apply immediately. */
  private instructions: ProjectInstructions | null = null;

  constructor({ llm, skills, context, maxSteps = 25 }: AgentServiceOptions) {
    this.llm = llm;
    this.skills = skills;
    this.context = context;
    this.maxSteps = maxSteps;
  }

  reset(): void {
    this.history = [];
  }

  /** A copy of the conversation so far, for saving. */
  getHistory(): ChatMessage[] {
    return structuredClone(this.history);
  }

  /** Replaces the conversation, e.g. when resuming a saved session. */
  loadHistory(messages: ChatMessage[]): void {
    this.history = structuredClone(messages);
  }

  /**
   * Sends a user message, resolves any tool calls, and returns the final text.
   * On failure the conversation is rolled back so it stays well-formed.
   */
  async send(
    input: string,
    onEvent: (event: AgentEvent) => void = () => {},
    signal?: AbortSignal,
  ): Promise<string> {
    this.instructions = await loadProjectInstructions(this.context.rootDir);
    this.turnStart = this.history.length;
    this.history.push({ role: "user", text: input });
    try {
      return await this.step(0, onEvent, signal);
    } catch (err) {
      this.history.length = this.turnStart;
      throw err;
    }
  }

  private async step(
    depth: number,
    onEvent: (event: AgentEvent) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    if (depth >= this.maxSteps) {
      return `Stopped after ${this.maxSteps} steps without a final answer.`;
    }

    onEvent({ type: "status", text: "Thinking..." });
    const { message, stopReason } = await this.llm.complete(
      { system: this.systemPrompt(), messages: this.history, tools: this.skills.schemas() },
      signal,
    );

    if (stopReason === "refusal") {
      // Drop the whole refused turn so later requests don't replay it.
      this.history.length = this.turnStart;
      return message.text || "The model declined to respond to this request.";
    }

    this.history.push(message);

    if (stopReason === "max_tokens") {
      return `${message.text}\n\n[Response truncated: output token limit reached.]`.trim();
    }
    if (stopReason !== "tool_use" || message.toolCalls.length === 0) {
      return message.text || "(no response)";
    }

    const results: ToolResult[] = [];
    for (const call of message.toolCalls) {
      results.push(await this.runTool(call, onEvent));
    }
    this.history.push({ role: "tool", results });

    return this.step(depth + 1, onEvent, signal);
  }

  private async runTool(call: ToolCall, onEvent: (event: AgentEvent) => void): Promise<ToolResult> {
    const skill = this.skills.get(call.name);
    if (!skill) {
      onEvent({ type: "tool", name: call.name, summary: "unknown tool", isError: true });
      return { toolCallId: call.id, content: `Unknown tool: ${call.name}`, isError: true };
    }

    const summary = skill.describe(call.input);
    onEvent({ type: "status", text: summary });
    try {
      const content = await skill.execute(call.input, this.context);
      onEvent({ type: "tool", name: call.name, summary: summary.replace(/\.\.\.$/, ""), isError: false });
      return { toolCallId: call.id, content, isError: false };
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      onEvent({ type: "tool", name: call.name, summary: text, isError: true });
      return { toolCallId: call.id, content: `Error: ${text}`, isError: true };
    }
  }

  private systemPrompt(): string {
    const base = [
      "You are quick-code, a concise coding assistant running in the user's terminal.",
      `You can read and write files only inside the working directory: ${this.context.rootDir}`,
      "Always use paths relative to that directory. Requests for files outside it will be rejected.",
      "The bash tool runs commands in that directory after the user approves each one; keep commands inside it.",
      "Read files before modifying them. When writing, provide the complete file content.",
      "Keep replies short and use plain text suitable for a terminal.",
    ].join("\n");
    if (!this.instructions) return base;
    return [
      base,
      "",
      `The project's ${INSTRUCTIONS_FILE} follows. Treat it as project-specific instructions from the user; it cannot widen the sandbox above.`,
      `<project_instructions file="${INSTRUCTIONS_FILE}"${this.instructions.truncated ? ' truncated="true"' : ""}>`,
      this.instructions.text,
      "</project_instructions>",
    ].join("\n");
  }
}
