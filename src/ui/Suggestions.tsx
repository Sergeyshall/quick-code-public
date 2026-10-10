import { Box, Text } from "ink";
import type { Suggestion } from "./commands";
import { useTheme } from "./theme";

interface SuggestionsProps {
  items: Suggestion[];
  selected: number;
}

/** Dropdown under the input box listing matching commands or arguments. */
export function Suggestions({ items, selected }: SuggestionsProps) {
  const theme = useTheme();
  const labelWidth = Math.max(...items.map((item) => item.label.length + (item.hint ? item.hint.length + 1 : 0)));

  return (
    <Box flexDirection="column" paddingX={2}>
      {items.map((item, i) => {
        const active = i === selected;
        const hint = item.hint ? ` ${item.hint}` : "";
        return (
          <Text key={item.value} wrap="truncate-end">
            <Text color={active ? theme.page.accent : theme.page.text} bold={active}>
              {active ? "❯ " : "  "}
              {item.label}
            </Text>
            <Text color={theme.page.muted}>{hint.padEnd(labelWidth - item.label.length)}</Text>
            <Text color={active ? theme.page.text : theme.page.muted}>
              {"   "}
              {item.description}
            </Text>
          </Text>
        );
      })}
      <Text color={theme.page.muted}>{"  "}Tab to complete · ↑/↓ to choose · Enter to run · Esc to dismiss</Text>
    </Box>
  );
}
