import { expect, test } from "bun:test";
import { stripMouseReports, wheelDirection } from "../src/ui/mouse";

test("reads vertical wheel steps and ignores other mouse buttons", () => {
  expect(wheelDirection(64)).toBe("up");
  expect(wheelDirection(65)).toBe("down");
  expect(wheelDirection(64 + 16)).toBe("up"); // with Ctrl
  expect(wheelDirection(0)).toBeUndefined(); // left click
  expect(wheelDirection(66)).toBeUndefined(); // horizontal wheel
});

test("strips mouse reports so they never reach the text input", () => {
  expect(stripMouseReports("\x1b[<64;10;5M\x1b[<65;10;5Mhi\x1b[<0;3;4M\x1b[<0;3;4m")).toEqual({
    rest: "hi",
    wheel: ["up", "down"],
  });
  expect(stripMouseReports("\x1b[A")).toEqual({ rest: "\x1b[A", wheel: [] });
});
