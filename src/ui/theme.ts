import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createContext, useContext } from "react";
import defaults from "./theme.json";

/** Name of the per-project override inside `.quick-code/`. */
export const THEME_FILE = "theme.json";

type ThemeFile = typeof defaults;

/** Every color quick-code draws with; `undefined` means the terminal's own default color. */
export type Theme = {
  [G in keyof ThemeFile]: { [K in keyof ThemeFile[G]]: ThemeFile[G][K] extends string[] ? string[] : string | undefined };
};

const NAMED_COLORS = new Set(
  ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"].flatMap((c) => [c, `${c}Bright`]),
);
NAMED_COLORS.add("gray").add("grey");

/** True for what Ink can draw: a named ANSI color, #rgb / #rrggbb, rgb(r, g, b), ansi256(n), or "default". */
export function isColor(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return (
    value === "default" ||
    NAMED_COLORS.has(value) ||
    /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ||
    /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/.test(value) ||
    /^ansi256\(\s*\d{1,3}\s*\)$/.test(value)
  );
}

const toInk = (value: string) => (value === "default" ? undefined : value);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Applies `overrides` (the parsed contents of a theme.json) on top of the default theme. Only
 * the colors it names change; unknown keys and invalid colors are skipped and reported.
 */
export function resolveTheme(overrides: unknown = {}): { theme: Theme; warnings: string[] } {
  const warnings: string[] = [];
  if (!isObject(overrides)) return { theme: resolveTheme().theme, warnings: ["theme.json must contain a JSON object"] };
  const theme: Record<string, Record<string, string | string[] | undefined>> = {};

  for (const [group, colors] of Object.entries(defaults)) {
    const custom = overrides[group] ?? {};
    if (!isObject(custom)) warnings.push(`"${group}" must be an object`);
    theme[group] = {};
    for (const [key, fallback] of Object.entries(colors)) {
      const value = isObject(custom) ? custom[key] : undefined;
      const name = `${group}.${key}`;
      if (Array.isArray(fallback)) {
        const ok = Array.isArray(value) && value.length > 0 && value.every(isColor);
        if (value !== undefined && !ok) warnings.push(`${name} must be a non-empty list of colors`);
        theme[group][key] = (ok ? value : fallback).map((c) => toInk(c) ?? "white");
      } else {
        if (value !== undefined && !isColor(value)) warnings.push(`${name}: "${String(value)}" is not a color`);
        theme[group][key] = toInk(isColor(value) ? value : fallback);
      }
    }
    if (isObject(custom)) {
      for (const key of Object.keys(custom)) if (!(key in colors)) warnings.push(`unknown key ${group}.${key}`);
    }
  }
  for (const group of Object.keys(overrides)) {
    if (!(group in defaults) && !group.startsWith("$")) warnings.push(`unknown group "${group}"`);
  }
  return { theme: theme as Theme, warnings };
}

export const DEFAULT_THEME: Theme = resolveTheme().theme;

export interface LoadedTheme {
  theme: Theme;
  warnings: string[];
  /** Path of the project's theme.json, or null when the defaults are used. */
  file: string | null;
}

/** Reads `<dataDir>/theme.json` over the defaults; a missing file simply means the default theme. */
export async function loadProjectTheme(dataDir: string): Promise<LoadedTheme> {
  const file = path.join(dataDir, THEME_FILE);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { theme: DEFAULT_THEME, warnings: [], file: null };
    return { theme: DEFAULT_THEME, warnings: [`cannot read ${THEME_FILE}: ${(err as Error).message}`], file };
  }
  try {
    return { ...resolveTheme(JSON.parse(text)), file };
  } catch (err) {
    return { theme: DEFAULT_THEME, warnings: [`${THEME_FILE} is not valid JSON: ${(err as Error).message}`], file };
  }
}

/** Writes the full default theme to `<dataDir>/theme.json` as a starting point; never overwrites. */
export async function writeDefaultTheme(dataDir: string): Promise<string> {
  const file = path.join(dataDir, THEME_FILE);
  await writeFile(file, `${JSON.stringify(defaults, null, 2)}\n`, { flag: "wx" });
  return file;
}

export const ThemeContext = createContext<Theme>(DEFAULT_THEME);

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
