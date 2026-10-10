import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessageParam,
  BetaTool,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import Models from "./models";
import type {
  AssistantMessage,
  ChatMessage,
  ILlmAdapter,
  LlmRequest,
  LlmResponse,
  StopReason,
  ToolCall,
} from "./types";

export const DEFAULT_MODEL = Models.HAIKU;

export interface AnthropicAdapterOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

export class AnthropicAdapter implements ILlmAdapter {
  private readonly client: Anthropic;
  private currentModel: string;
  private readonly maxTokens: number;

  constructor({ apiKey, model = DEFAULT_MODEL, maxTokens = 16000 }: AnthropicAdapterOptions) {
    this.client = new Anthropic({ apiKey });
    this.currentModel = model;
    this.maxTokens = maxTokens;
  }

  get name(): string {
    return `anthropic:${this.currentModel}`;
  }

  get model(): string {
    return this.currentModel;
  }

  /** Switches the model for subsequent requests; history is kept. */
  setModel(model: string): void {
    this.currentModel = model;
  }

  async complete(request: LlmRequest, signal?: AbortSignal): Promise<LlmResponse> {
    const response = await this.client.beta.messages.create(
      {
        model: this.currentModel,
        max_tokens: this.maxTokens,
        system: request.system,
        tools: request.tools.map(toAnthropicTool),
        messages: request.messages.map(toAnthropicMessage),
        // If a safety classifier declines, let the API retry on a suitable model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { signal },
    );

    return {
      message: fromAnthropicContent(response.content),
      stopReason: mapStopReason(response.stop_reason),
    };
  }
}

function toAnthropicTool(tool: LlmRequest["tools"][number]): BetaTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}

function toAnthropicMessage(message: ChatMessage): BetaMessageParam {
  switch (message.role) {
    case "user":
      return { role: "user", content: message.text };

    case "assistant": {
      // Replay the original blocks (including thinking) unchanged when we have them.
      if (Array.isArray(message.providerData)) {
        return { role: "assistant", content: message.providerData as BetaContentBlockParam[] };
      }
      const content: BetaContentBlockParam[] = [];
      if (message.text) content.push({ type: "text", text: message.text });
      for (const call of message.toolCalls) {
        content.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
      }
      return { role: "assistant", content };
    }

    case "tool":
      return {
        role: "user",
        content: message.results.map((result) => ({
          type: "tool_result" as const,
          tool_use_id: result.toolCallId,
          content: result.content,
          is_error: result.isError,
        })),
      };
  }
}

function fromAnthropicContent(content: BetaContentBlock[]): AssistantMessage {
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const block of content) {
    if (block.type === "text") {
      textParts.push(block.text);
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: isRecord(block.input) ? block.input : {},
      });
    }
  }

  return {
    role: "assistant",
    text: textParts.join("\n").trim(),
    toolCalls,
    providerData: content,
  };
}

function mapStopReason(reason: string | null): StopReason {
  switch (reason) {
    case "end_turn":
    case "tool_use":
    case "max_tokens":
    case "refusal":
      return reason;
    default:
      return "other";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
