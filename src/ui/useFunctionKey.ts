import { useStdin, type StdinProps } from "ink";
import type { EventEmitter } from "node:events";
import { useEffect, useRef } from "react";

/** Escape sequences for F1-F10 across xterm, VT220 and the Linux console. */
const SEQUENCES: Record<string, number> = {
  "\x1bOP": 1,
  "\x1bOQ": 2,
  "\x1bOR": 3,
  "\x1bOS": 4,
  "\x1b[11~": 1,
  "\x1b[12~": 2,
  "\x1b[13~": 3,
  "\x1b[14~": 4,
  "\x1b[[A": 1,
  "\x1b[[B": 2,
  "\x1b[[C": 3,
  "\x1b[[D": 4,
  "\x1b[[E": 5,
  "\x1b[15~": 5,
  "\x1b[17~": 6,
  "\x1b[18~": 7,
  "\x1b[19~": 8,
  "\x1b[20~": 9,
  "\x1b[21~": 10,
};

/** The Insert key (xterm and VT220); like F-keys, useInput reports it as an empty input. */
export const INSERT_KEY = "\x1b[2~";

/** Number of the function key `sequence` encodes (F1 = 1), or undefined for anything else. */
export function functionKey(sequence: string): number | undefined {
  return SEQUENCES[sequence];
}

/**
 * Calls `handler` with the function key number (F3 = 3) on each press. Ink's useInput reports
 * F-keys as an empty input, so this listens to Ink's raw input events instead.
 */
export function useFunctionKey(handler: (key: number) => void, { isActive = true } = {}): void {
  useRawInput(
    (data) => {
      const key = functionKey(data);
      if (key !== undefined) handler(key);
    },
    { isActive },
  );
}

/** Calls `handler` with each raw chunk read from the terminal, before Ink parses it. */
export function useRawInput(handler: (data: string) => void, { isActive = true } = {}): void {
  // Ink's context carries this emitter; it is not part of the public typings.
  const { internal_eventEmitter: events } = useStdin() as StdinProps & { internal_eventEmitter?: EventEmitter };
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!isActive || !events) return;
    const onInput = (data: string) => latest.current(data);
    events.on("input", onInput);
    return () => {
      events.off("input", onInput);
    };
  }, [events, isActive]);
}
