import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { fit } from "../project/fsView";
import { useTheme } from "./theme";

interface ConfirmDialogProps {
  title: string;
  /** Question lines, centred; long ones are cut with "…". */
  lines: string[];
  width: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Midnight Commander style Yes/No box. "No" has the focus, so a stray Enter never confirms.
 * Tab or ←/→ move between the buttons, Enter presses the focused one, y/n answer directly, Esc cancels.
 */
export function ConfirmDialog({ title, lines, width, onConfirm, onCancel }: ConfirmDialogProps) {
  const dialog = useTheme().dialog;
  const [yes, setYes] = useState(false);

  useInput((input, key) => {
    if (key.escape || input.toLowerCase() === "n") onCancel();
    else if (input.toLowerCase() === "y") onConfirm();
    else if (key.tab || key.leftArrow || key.rightArrow) setYes((f) => !f);
    else if (key.return) (yes ? onConfirm : onCancel)();
  });

  const inner = width - 6; // dialog padding (2+2) and frame (1+1)
  const titleText = ` ${title} `;
  const left = "─".repeat(Math.max(0, Math.floor((inner - titleText.length) / 2)));
  const right = "─".repeat(Math.max(0, inner - titleText.length - left.length));
  const frame = (text: string) => <Text color={dialog.border}>{text}</Text>;
  const button = (label: string, focused: boolean) => (
    <Text color={focused ? dialog.bg : dialog.text} backgroundColor={focused ? dialog.focus : dialog.bg}>
      {focused ? "[< " : "[ "}
      <Text color={focused ? dialog.bg : dialog.title} backgroundColor={focused ? dialog.focus : dialog.bg} bold>
        {label[0]}
      </Text>
      {label.slice(1)}
      {focused ? " >]" : " ]"}
    </Text>
  );
  const buttonsWidth = 16; // "[< Yes >] [ No ]" or "[ Yes ] [< No >]"
  const buttonsPad = Math.max(0, Math.floor((inner - buttonsWidth) / 2));

  return (
    <Box>
      <Box position="absolute" top={1} left={2} width={width} height="100%" backgroundColor={dialog.shadow} />
      <Box flexDirection="column" width={width} backgroundColor={dialog.bg} paddingX={2} paddingY={1}>
        <Text>
          {frame(`┌${left}`)}
          <Text color={dialog.error} bold>
            {titleText}
          </Text>
          {frame(`${right}┐`)}
        </Text>
        {lines.map((line, i) => (
          <Text key={i}>
            {frame("│")}
            <Text color={dialog.text}>{fit(line, inner, "center")}</Text>
            {frame("│")}
          </Text>
        ))}
        <Text>{frame(`├${"─".repeat(inner)}┤`)}</Text>
        <Text>
          {frame("│")}
          {" ".repeat(buttonsPad)}
          {button("Yes", yes)} {button("No", !yes)}
          {" ".repeat(Math.max(0, inner - buttonsPad - buttonsWidth))}
          {frame("│")}
        </Text>
        <Text>{frame(`└${"─".repeat(inner)}┘`)}</Text>
      </Box>
    </Box>
  );
}
