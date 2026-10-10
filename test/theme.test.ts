import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import defaults from "../src/ui/theme.json";
import { DEFAULT_THEME, isColor, loadProjectTheme, resolveTheme, writeDefaultTheme } from "../src/ui/theme";

const tempDir = () => mkdtemp(path.join(tmpdir(), "qc-theme-"));

test("accepts the color formats Ink can draw", () => {
  for (const c of ["cyan", "blueBright", "gray", "#abc", "#A0B1C2", "rgb(1, 2, 255)", "ansi256(208)", "default"]) {
    expect(isColor(c)).toBe(true);
  }
  for (const c of ["", "#abcd", "purple-ish", "rgb(1,2)", 12, null]) expect(isColor(c)).toBe(false);
});

test("the default theme maps \"default\" to the terminal color and agent answers are light yellow", () => {
  expect(DEFAULT_THEME.page.text).toBeUndefined();
  expect(DEFAULT_THEME.chat.agentText).toBe("#fdf3b5");
  expect(DEFAULT_THEME.logo.gradient).toHaveLength(6);
});

test("overrides only the colors they name", () => {
  const { theme, warnings } = resolveTheme({ chat: { agentText: "#ffffff" }, viewer: { bg: "black" } });
  expect(warnings).toEqual([]);
  expect(theme.chat.agentText).toBe("#ffffff");
  expect(theme.viewer.bg).toBe("black");
  expect(theme.chat.userLabel).toBe(DEFAULT_THEME.chat.userLabel);
  expect(theme.page).toEqual(DEFAULT_THEME.page);
});

test("reports and ignores invalid colors and unknown keys", () => {
  const { theme, warnings } = resolveTheme({
    page: { bg: "not-a-color", nope: "red" },
    logo: { gradient: [] },
    dialog: "blue",
    extra: {},
    $schema: "ignored",
  });
  expect(theme.page.bg).toBe(DEFAULT_THEME.page.bg);
  expect(theme.logo.gradient).toEqual(DEFAULT_THEME.logo.gradient);
  expect(theme.dialog).toEqual(DEFAULT_THEME.dialog);
  expect(warnings).toEqual([
    'page.bg: "not-a-color" is not a color',
    "unknown key page.nope",
    "logo.gradient must be a non-empty list of colors",
    '"dialog" must be an object',
    'unknown group "extra"',
  ]);
  expect(resolveTheme([]).warnings).toEqual(["theme.json must contain a JSON object"]);
});

test("loads a project's theme.json over the defaults", async () => {
  const dir = await tempDir();
  expect(await loadProjectTheme(dir)).toEqual({ theme: DEFAULT_THEME, warnings: [], file: null });

  await writeFile(path.join(dir, "theme.json"), JSON.stringify({ backdrop: { bg: "#000000" } }));
  const loaded = await loadProjectTheme(dir);
  expect(loaded.theme.backdrop.bg).toBe("#000000");
  expect(loaded.file).toBe(path.join(dir, "theme.json"));

  await writeFile(path.join(dir, "theme.json"), "{ nope");
  const broken = await loadProjectTheme(dir);
  expect(broken.theme).toBe(DEFAULT_THEME);
  expect(broken.warnings[0]).toContain("not valid JSON");
});

test("writes the full default theme once and never overwrites it", async () => {
  const dir = await tempDir();
  const file = await writeDefaultTheme(dir);
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(defaults);
  await writeFile(file, "{}");
  await expect(writeDefaultTheme(dir)).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(file, "utf8")).toBe("{}");
});
