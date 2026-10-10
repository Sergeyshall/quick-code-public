#!/usr/bin/env bun
import { realpathSync } from "node:fs";
import { render } from "ink";
import { AgentService } from "./agent/AgentService";
import { AnthropicAdapter, DEFAULT_MODEL } from "./llm/AnthropicAdapter";
import { resolveModel } from "./llm/models";
import { builtinSkills, SkillRegistry } from "./skills";
import { App } from "./ui/App";
import { enableMouseWheel } from "./ui/mouse";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("quick-code: ANTHROPIC_API_KEY is not set. Export it or add it to a .env file in the current directory.");
  process.exit(1);
}

// The project navigator starts here; the chosen folder is symlink-resolved before use.
const startDir = realpathSync(process.cwd());
// QUICK_CODE_MODEL accepts an alias ("sonnet") or a full model id.
const envModel = process.env.QUICK_CODE_MODEL;
const model = envModel ? (resolveModel(envModel) ?? envModel) : DEFAULT_MODEL;
const llm = new AnthropicAdapter({ apiKey, model });

const skills = new SkillRegistry(builtinSkills);

// Mouse wheel scrolls the chat. Reporting blocks the terminal's own text selection (hold Shift,
// Option in iTerm2 or Fn in Terminal.app, to select), so QUICK_CODE_MOUSE=0 turns it off.
const disableMouse =
  process.env.QUICK_CODE_MOUSE !== "0" && process.stdin.isTTY ? enableMouseWheel(process.stdin, process.stdout) : undefined;

const app = render(
  <App
    createAgent={(rootDir, confirm) => new AgentService({ llm, skills, context: { rootDir, confirm } })}
    initialDir={startDir}
    initialModel={model}
    skills={builtinSkills.map((skill) => skill.schema.name)}
    onModelChange={(next) => llm.setModel(next)}
  />,
  { alternateScreen: true },
);
void app.waitUntilExit().finally(() => disableMouse?.());
