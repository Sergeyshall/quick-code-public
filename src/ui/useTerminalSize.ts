import { useStdout } from "ink";
import { useEffect, useState } from "react";

/** Terminal size that re-renders the caller when the window is resized. */
export function useTerminalSize(): { columns: number; rows: number } {
  const { stdout } = useStdout();
  const read = () => ({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
  const [size, setSize] = useState(read);

  useEffect(() => {
    const onResize = () => setSize(read());
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  return size;
}
