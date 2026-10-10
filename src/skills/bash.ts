import { spawn } from "node:child_process";
import { requireString, SkillError, type Skill } from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 30_000;
/** Environment variables never exposed to model-run commands. */
const SECRET_ENV = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i;

/**
 * Runs a shell command in the project folder. A shell cannot be path-confined the way
 * readFile/writeFile are, so every command needs explicit user approval via `ctx.confirm`.
 */
export const bashSkill: Skill = {
  schema: {
    name: "bash",
    description:
      "Run a non-interactive bash command in the working directory and return its exit code, stdout and stderr. " +
      "The user must approve each command. Use it for builds, tests, git, and listing or searching files. " +
      "Stay inside the working directory; do not use it to read or modify files outside it.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The bash command to run." },
        timeout_ms: {
          type: "number",
          description: `Optional timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).`,
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },

  describe(input) {
    return `Running: ${String(input.command ?? "").split("\n")[0]}...`;
  },

  async execute(input, { rootDir, confirm }) {
    const command = requireString(input, "command");
    if (command.trim() === "") throw new SkillError("Command must not be empty.");
    const timeout = clampTimeout(input.timeout_ms);

    // Fail closed: without an approval channel nothing runs.
    const approved = confirm ? await confirm({ tool: "bash", title: "Run shell command", detail: command }) : false;
    if (!approved) throw new SkillError("The user declined to run this command.");

    const { code, signal, stdout, stderr, timedOut } = await run(command, rootDir, timeout);
    const parts = [
      timedOut ? `Timed out after ${timeout} ms` : `Exit code: ${code ?? signal}`,
      stdout && `stdout:\n${truncate(stdout)}`,
      stderr && `stderr:\n${truncate(stderr)}`,
    ];
    return parts.filter(Boolean).join("\n\n");
  },
};

function clampTimeout(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(value, MAX_TIMEOUT_MS);
}

export function scrubEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !SECRET_ENV.test(name)));
}

function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  const half = MAX_OUTPUT_CHARS / 2;
  return `${text.slice(0, half)}\n\n[... ${text.length - MAX_OUTPUT_CHARS} characters truncated ...]\n\n${text.slice(-half)}`;
}

interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function run(command: string, cwd: string, timeout: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // detached: the command gets its own process group so a timeout kills its children too.
    const child = spawn("/bin/bash", ["-c", command], {
      cwd,
      env: scrubEnv(process.env),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    // Bound memory for chatty commands; very long output keeps only its most recent part.
    const cap = (buf: string, chunk: Buffer) => (buf + chunk.toString("utf8")).slice(-MAX_OUTPUT_CHARS * 4);
    child.stdout.on("data", (chunk: Buffer) => (stdout = cap(stdout, chunk)));
    child.stderr.on("data", (chunk: Buffer) => (stderr = cap(stderr, chunk)));

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeout);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new SkillError(`Failed to start bash: ${err.message}`));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}
