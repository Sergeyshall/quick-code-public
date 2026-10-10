import { MODEL_OPTIONS } from "../llm/models";

export interface SlashCommand {
  name: string;
  args?: string;
  description: string;
}

export const COMMANDS: SlashCommand[] = [
  { name: "/model", args: "[haiku|sonnet|opus]", description: "Choose the model for this session" },
  { name: "/project", args: "[path]", description: "Switch project folder (restarts the agent)" },
  { name: "/resume", args: "[session id]", description: "Resume a saved session of this project" },
  { name: "/clear", description: "Start a new conversation (the current one stays saved)" },
  { name: "/theme", description: "Reload .quick-code/theme.json (creates it from the defaults if missing)" },
  { name: "/exit", description: "Quit quick-code" },
];

export interface Suggestion {
  /** Text the input becomes when this suggestion is accepted. */
  value: string;
  label: string;
  hint?: string;
  description: string;
}

/** Autocomplete suggestions for the current input, or [] when none apply. */
export function getSuggestions(input: string): Suggestion[] {
  if (!input.startsWith("/")) return [];

  const space = input.indexOf(" ");
  if (space === -1) {
    const query = input.toLowerCase();
    return COMMANDS.filter((cmd) => cmd.name.startsWith(query)).map((cmd) => ({
      value: cmd.args ? `${cmd.name} ` : cmd.name,
      label: cmd.name,
      hint: cmd.args,
      description: cmd.description,
    }));
  }

  if (input.slice(0, space) === "/model") {
    const arg = input.slice(space + 1).trim().toLowerCase();
    return MODEL_OPTIONS.map((option) => ({ option, alias: option.label.split(" ")[0]!.toLowerCase() }))
      .filter(({ alias }) => alias.startsWith(arg) && alias !== arg)
      .map(({ option, alias }) => ({
        value: `/model ${alias}`,
        label: alias,
        hint: option.label,
        description: option.description,
      }));
  }

  return [];
}
