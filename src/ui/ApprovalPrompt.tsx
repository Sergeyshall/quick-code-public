import { Box, Text, useInput } from "ink";
import type { ApprovalRequest } from "../skills";
import { useTheme } from "./theme";

export type ApprovalAnswer = "yes" | "always" | "no";

interface ApprovalPromptProps {
  request: ApprovalRequest;
  onAnswer: (answer: ApprovalAnswer) => void;
}

/** Blocks the agent until the user allows or denies a sensitive tool call. */
export function ApprovalPrompt({ request, onAnswer }: ApprovalPromptProps) {
  const theme = useTheme();
  useInput((input, key) => {
    const ch = input.toLowerCase();
    if (ch === "y" || key.return) onAnswer("yes");
    else if (ch === "a") onAnswer("always");
    else if (ch === "n" || key.escape) onAnswer("no");
  });

  return (
    <Box
      borderStyle="round"
      borderColor={theme.approval.border}
      borderBackgroundColor={theme.page.bg}
      paddingX={1}
      flexDirection="column"
    >
      <Text color={theme.approval.title} bold>
        ⚠ {request.title}?
      </Text>
      <Box marginY={1} paddingX={1}>
        <Text color={theme.approval.command}>
          <Text color={theme.page.muted}>$ </Text>
          {request.detail}
        </Text>
      </Box>
      <Text>
        <Text color={theme.approval.yes} bold>
          y
        </Text>
        <Text color={theme.page.muted}>/Enter yes · </Text>
        <Text color={theme.approval.always} bold>
          a
        </Text>
        <Text color={theme.page.muted}> always this session · </Text>
        <Text color={theme.approval.no} bold>
          n
        </Text>
        <Text color={theme.page.muted}>/Esc no</Text>
      </Text>
    </Box>
  );
}
