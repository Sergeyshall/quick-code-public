import type { ToolSchema } from "../llm/types";

export interface ApprovalRequest {
  tool: string;
  title: string;
  /** Exactly what will run, shown verbatim to the user. */
  detail: string;
}

export interface SkillContext {
  /** Absolute, symlink-resolved directory the skill is confined to. */
  rootDir: string;
  /** Asks the user to approve a sensitive action. Skills that need approval must deny when absent. */
  confirm?: (request: ApprovalRequest) => Promise<boolean>;
}

/**
 * A self-contained tool the agent can invoke. Skills receive untrusted,
 * model-generated input and must validate it themselves.
 */
export interface Skill {
  readonly schema: ToolSchema;
  /** Human-readable status shown in the spinner while the skill runs. */
  describe(input: Record<string, unknown>): string;
  /** Returns the text sent back to the model. Throw to report an error. */
  execute(input: Record<string, unknown>, ctx: SkillContext): Promise<string>;
}

export class SkillError extends Error {
  override name = "SkillError";
}

export function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string") {
    throw new SkillError(`Invalid input: "${key}" must be a string.`);
  }
  return value;
}
