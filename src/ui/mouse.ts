import { EventEmitter } from "node:events";
import { useEffect, useRef } from "react";

/** SGR mouse report: ESC [ < button ; column ; row (M = press, m = release). */
// eslint-disable-next-line no-control-regex
const MOUSE_REPORT = /\x1b\[<(\d+);(\d+);(\d+)[Mm]/g;
const ENABLE = "\x1b[?1000h\x1b[?1006h";
const DISABLE = "\x1b[?1006l\x1b[?1000l";

export type WheelDirection = "up" | "down";

const wheel = new EventEmitter();

/** "up"/"down" for a vertical wheel button code, undefined for clicks, drags and horizontal scrolls. */
export function wheelDirection(button: number): WheelDirection | undefined {
  // Bit 64 marks wheel buttons, bit 1 the direction; bit 2 is the horizontal wheel. Modifier bits (4, 8, 16) are ignored.
  if ((button & 64) === 0 || (button & 2) !== 0) return undefined;
  return button & 1 ? "down" : "up";
}

/** Removes mouse reports from `chunk`, returning what is left and the wheel moves it contained. */
export function stripMouseReports(chunk: string): { rest: string; wheel: WheelDirection[] } {
  const moves: WheelDirection[] = [];
  const rest = chunk.replace(MOUSE_REPORT, (_match, button: string) => {
    const direction = wheelDirection(Number(button));
    if (direction) moves.push(direction);
    return "";
  });
  return { rest, wheel: moves };
}

/**
 * Turns on terminal mouse reporting and filters the reports out of `stdin` before Ink reads
 * them (Ink would otherwise type them into the focused input). Wheel moves go to useMouseWheel.
 * Returns a function that turns reporting off again; it also runs when the process exits.
 */
export function enableMouseWheel(stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream): () => void {
  const read = stdin.read.bind(stdin);
  stdin.read = ((size?: number) => {
    // Ink reads until null, so an all-mouse chunk is skipped by reading the next one.
    for (;;) {
      const chunk: string | Buffer | null = read(size);
      if (chunk === null) return null;
      const { rest, wheel: moves } = stripMouseReports(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      for (const direction of moves) wheel.emit("wheel", direction);
      if (rest !== "") return rest;
    }
  }) as typeof stdin.read;

  stdout.write(ENABLE);
  let enabled = true;
  const disable = () => {
    if (!enabled) return;
    enabled = false;
    stdout.write(DISABLE);
    stdin.read = read;
  };
  process.once("exit", disable);
  return disable;
}

/** Calls `handler` for each mouse wheel step while active. */
export function useMouseWheel(handler: (direction: WheelDirection) => void, { isActive = true } = {}): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!isActive) return;
    const onWheel = (direction: WheelDirection) => latest.current(direction);
    wheel.on("wheel", onWheel);
    return () => {
      wheel.off("wheel", onWheel);
    };
  }, [isActive]);
}
