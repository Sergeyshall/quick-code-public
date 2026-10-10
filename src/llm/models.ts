export enum Models {
  HAIKU = "claude-haiku-5-5",
  SONNET = "claude-sonnet-5-5",
  OPUS = "claude-opus-5-5",
}

export interface ModelOption {
  id: string;
  label: string;
  description: string;
}

/** Models offered by the /model picker, in display order. */
export const MODEL_OPTIONS: ModelOption[] = [
  { id: Models.HAIKU, label: "Haiku 5.5", description: "Fastest and cheapest, good for simple edits" },
  { id: Models.SONNET, label: "Sonnet 5.5", description: "Balanced speed and capability" },
  { id: Models.OPUS, label: "Opus 5.5", description: "Most capable, for complex tasks" },
];

/**
 * Resolves user input (an alias like "sonnet", a label, or a full model id)
 * to a model id. Unknown full ids are passed through so custom models still work.
 */
export function resolveModel(input: string): string | undefined {
  const query = input.trim().toLowerCase();
  if (!query) return undefined;
  const match = MODEL_OPTIONS.find(
    (option) =>
      option.id === query ||
      option.label.toLowerCase() === query ||
      option.label.toLowerCase().split(" ")[0] === query,
  );
  if (match) return match.id;
  return query.startsWith("claude-") ? input.trim() : undefined;
}

export function modelLabel(id: string): string {
  return MODEL_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

export default Models;
