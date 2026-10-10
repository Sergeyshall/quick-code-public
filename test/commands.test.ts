import { expect, test } from "bun:test";
import { getSuggestions } from "../src/ui/commands";

const values = (input: string) => getSuggestions(input).map((s) => s.value);

test("lists all commands for a bare slash", () => {
  expect(values("/")).toEqual(["/model ", "/project ", "/resume ", "/clear", "/theme", "/exit"]);
});

test("filters commands by prefix", () => {
  expect(values("/c")).toEqual(["/clear"]);
  expect(values("/p")).toEqual(["/project "]);
  expect(values("/r")).toEqual(["/resume "]);
  expect(values("/t")).toEqual(["/theme"]);
  expect(values("/MO")).toEqual(["/model "]);
  expect(values("/nope")).toEqual([]);
});

test("suggests model aliases after /model", () => {
  expect(values("/model ")).toEqual(["/model haiku", "/model sonnet", "/model opus"]);
  expect(values("/model s")).toEqual(["/model sonnet"]);
  expect(values("/model sonnet")).toEqual([]);
});

test("ignores normal chat input", () => {
  expect(values("hello /model")).toEqual([]);
  expect(values("/clear now")).toEqual([]);
});
