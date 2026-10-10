import { bashSkill } from "./bash";
import { readFileSkill } from "./readFile";
import type { Skill } from "./types";
import { writeFileSkill } from "./writeFile";

export const builtinSkills: Skill[] = [readFileSkill, writeFileSkill, bashSkill];

export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  constructor(skills: Skill[] = []) {
    for (const skill of skills) this.register(skill);
  }

  register(skill: Skill): void {
    if (this.skills.has(skill.schema.name)) {
      throw new Error(`Skill "${skill.schema.name}" is already registered.`);
    }
    this.skills.set(skill.schema.name, skill);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  schemas() {
    return [...this.skills.values()].map((skill) => skill.schema);
  }
}

export type { ApprovalRequest, Skill, SkillContext } from "./types";
