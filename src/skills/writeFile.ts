import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveSafePath } from "./pathGuard";
import { requireString, SkillError, type Skill } from "./types";

export const writeFileSkill: Skill = {
  schema: {
    name: "writeFile",
    description:
      "Write UTF-8 text to a file in the current working directory, creating parent directories as needed and overwriting any existing file. The path must be relative to (and inside) the working directory.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the working directory." },
        content: { type: "string", description: "The full file content to write." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },

  describe(input) {
    return `Writing file ${String(input.path ?? "")}...`;
  },

  async execute(input, { rootDir }) {
    const requested = requireString(input, "path");
    const content = requireString(input, "content");
    const target = await resolveSafePath(rootDir, requested);

    if (target === rootDir) {
      throw new SkillError("Cannot write to the working directory itself.");
    }
    const existing = await stat(target).catch(() => undefined);
    if (existing && !existing.isFile()) {
      throw new SkillError(`Not a regular file: ${requested}`);
    }

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");

    const bytes = Buffer.byteLength(content, "utf8");
    return `Wrote ${bytes} bytes to ${path.relative(rootDir, target)}`;
  },
};
