import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useState, type ReactNode } from "react";
import { fit } from "../project/fsView";
import { useTheme } from "./theme";

type Focus = "input" | "ok" | "cancel";

interface InputDialogProps {
  title: string;
  label: string;
  width: number;
  error?: string | null;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/**
 * Modal text prompt in the style of Midnight Commander's "Create a new Directory" dialog.
 * Enter confirms (or presses the focused button), Tab cycles input → OK → Cancel, Esc cancels.
 */
export function InputDialog({ title, label, width, error, onSubmit, onCancel }: InputDialogProps) {
  const dialog = useTheme().dialog;
  const [value, setValue] = useState("");
  const [focus, setFocus] = useState<Focus>("input");

  useInput((_input, key) => {
    if (key.escape) onCancel();
    else if (key.tab) {
      const order: Focus[] = ["input", "ok", "cancel"];
      const step = key.shift ? order.length - 1 : 1;
      setFocus((f) => order[(order.indexOf(f) + step) % order.length]!);
    } else if (key.return && focus !== "input") {
      if (focus === "ok") onSubmit(value);
      else onCancel();
    }
  });

  const inner = width - 6; // dialog padding (2+2) and frame (1+1)
  const titleText = ` ${title} `;
  const left = "─".repeat(Math.max(0, Math.floor((inner - titleText.length) / 2)));
  const right = "─".repeat(Math.max(0, inner - titleText.length - left.length));
  const frame = (text: string) => <Text color={dialog.border}>{text}</Text>;
  const row = (content: ReactNode) => (
    <Box>
      {frame("│")}
      <Box width={inner}>{content}</Box>
      {frame("│")}
    </Box>
  );
  const ok = focus === "ok";
  const cancel = focus === "cancel";
  const okLabel = "[< OK >]";
  const cancelLabel = "[ Cancel ]";
  const buttonsPad = Math.max(0, Math.floor((inner - okLabel.length - cancelLabel.length - 1) / 2));

  return (
    <Box>
      <Box position="absolute" top={1} left={2} width={width} height="100%" backgroundColor={dialog.shadow} />
      <Box flexDirection="column" width={width} backgroundColor={dialog.bg} paddingX={2} paddingY={1}>
        <Text>
          {frame(`┌${left}`)}
          <Text color={dialog.title}>{titleText}</Text>
          {frame(`${right}┐`)}
        </Text>
        {row(<Text color={dialog.text}>{fit(` ${label}`, inner)}</Text>)}
        {row(
          <Box paddingX={1} width={inner}>
            <Box width={inner - 2} height={1} overflow="hidden" backgroundColor={dialog.field}>
              <Text color={dialog.text}>
                <TextInput value={value} onChange={setValue} onSubmit={onSubmit} focus={focus === "input"} />
              </Text>
            </Box>
          </Box>,
        )}
        {error && row(<Text color={dialog.error}>{fit(` ⚠ ${error}`, inner)}</Text>)}
        <Text>{frame(`├${"─".repeat(inner)}┤`)}</Text>
        {row(
          <Text>
            {" ".repeat(buttonsPad)}
            <Text color={ok ? dialog.bg : dialog.text} backgroundColor={ok ? dialog.focus : dialog.bg}>
              {"[< "}
              <Text color={ok ? dialog.bg : dialog.title} backgroundColor={ok ? dialog.focus : dialog.bg} bold>
                O
              </Text>
              {"K >]"}
            </Text>{" "}
            <Text color={cancel ? dialog.bg : dialog.text} backgroundColor={cancel ? dialog.focus : dialog.bg}>
              {"[ "}
              <Text color={cancel ? dialog.bg : dialog.title} backgroundColor={cancel ? dialog.focus : dialog.bg} bold>
                C
              </Text>
              {"ancel ]"}
            </Text>
          </Text>,
        )}
        <Text>{frame(`└${"─".repeat(inner)}┘`)}</Text>
      </Box>
    </Box>
  );
}
