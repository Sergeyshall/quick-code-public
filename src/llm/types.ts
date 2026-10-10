/**
 * Provider-neutral types for the LLM "brain". Nothing in here knows about
 * Anthropic (or any other vendor); adapters translate to and from these.
 */

/** JSON Schema describing a tool's input object. */
export interface JsonSchemaObject {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
}

export type ChatMessage =
  | { role: "user"; text: string }
  | {
      role: "assistant";
      text: string;
      toolCalls: ToolCall[];
      /**
       * Opaque, adapter-specific payload (e.g. the raw content blocks including
       * thinking blocks) that must be replayed verbatim on the next request.
       * Only the adapter that produced it may interpret it.
       */
      providerData?: unknown;
    }
  | { role: "tool"; results: ToolResult[] };

export type AssistantMessage = Extract<ChatMessage, { role: "assistant" }>;

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other";

export interface LlmRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolSchema[];
}

export interface LlmResponse {
  message: AssistantMessage;
  stopReason: StopReason;
}

export interface ILlmAdapter {
  readonly name: string;
  complete(request: LlmRequest, signal?: AbortSignal): Promise<LlmResponse>;
}
