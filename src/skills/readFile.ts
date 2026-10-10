import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { resolveSafePath } from "./pathGuard";
import { requireString, SkillError, type Skill } from "./types";

const MAX_BYTES = 1024 * 1024;

export const readFileSkill: Skill = {
  schema: {
    name: "readFile",
    description:
      "Read a UTF-8 text file from the current working directory. The path must be relative to (and inside) the working directory.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the working directory." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },

  describe(input) {
    return `Reading file ${String(input.path ?? "")}...`;
  },

  async execute(input, { rootDir }) {
    const requested = requireString(input, "path");
    const target = await resolveSafePath(rootDir, requested);

    const info = await stat(target).catch(() => {
      throw new SkillError(`File not found: ${requested}`);
    });
    if (!info.isFile()) {
      throw new SkillError(`Not a regular file: ${requested}`);
    }
    if (info.size > MAX_BYTES) {
      throw new SkillError(`File too large (${info.size} bytes, limit ${MAX_BYTES}).`);
    }

    const content = await readFile(target, "utf8");
    return `File: ${path.relative(rootDir, target)}\n\n${content}`;
  },
};
