import { expect, test } from "bun:test";
import { Models, resolveModel } from "../src/llm/models";

test("resolveModel accepts aliases, labels and ids", () => {
  expect(resolveModel("haiku")).toBe(Models.HAIKU);
  expect(resolveModel("Sonnet")).toBe(Models.SONNET);
  expect(resolveModel("opus 5.5")).toBe(Models.OPUS);
  expect(resolveModel(Models.OPUS)).toBe(Models.OPUS);
  expect(resolveModel("claude-custom-1")).toBe("claude-custom-1");
});

test("resolveModel rejects unknown names", () => {
  expect(resolveModel("gpt")).toBeUndefined();
  expect(resolveModel("  ")).toBeUndefined();
});
