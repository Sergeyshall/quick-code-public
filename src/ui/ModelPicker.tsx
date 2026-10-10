import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { ModelOption } from "../llm/models";
import { useTheme } from "./theme";

interface ModelPickerProps {
  options: ModelOption[];
  current: string;
  onSelect: (model: string) => void;
  onCancel: () => void;
}

/** Arrow-key list for choosing a model. Enter selects, Esc cancels, 1-9 jump. */
export function ModelPicker({ options, current, onSelect, onCancel }: ModelPickerProps) {
  const theme = useTheme();
  const [index, setIndex] = useState(() => Math.max(0, options.findIndex((o) => o.id === current)));

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
    } else if (key.upArrow) {
      setIndex((i) => (i - 1 + options.length) % options.length);
    } else if (key.downArrow || key.tab) {
      setIndex((i) => (i + 1) % options.length);
    } else if (key.return) {
      const option = options[index];
      if (option) onSelect(option.id);
    } else {
      const option = options[Number(input) - 1];
      if (option) onSelect(option.id);
    }
  });

  const labelWidth = Math.max(...options.map((o) => o.label.length));

  return (
    <Box
      borderStyle="round"
      borderColor={theme.picker.border}
      borderBackgroundColor={theme.page.bg}
      paddingX={1}
      flexDirection="column"
    >
      <Text color={theme.page.text} bold>
        Select model
      </Text>
      <Text color={theme.page.muted}>Switch the model for this session. The conversation is kept.</Text>
      <Box marginTop={1} flexDirection="column">
        {options.map((option, i) => {
          const selected = i === index;
          return (
            <Box key={option.id}>
              <Text color={selected ? theme.picker.selected : theme.page.text}>
                {selected ? "❯ " : "  "}
                {i + 1}. {option.label.padEnd(labelWidth)}
              </Text>
              <Text color={theme.picker.current}>{option.id === current ? " ✔" : "  "}</Text>
              <Text color={theme.page.muted}>
                {"  "}
                {option.description}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.page.muted}>↑/↓ to move · Enter to select · Esc to cancel</Text>
      </Box>
    </Box>
  );
}
