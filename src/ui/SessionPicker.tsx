import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { SessionMeta } from "../session/SessionStore";
import { useTheme } from "./theme";

const VISIBLE = 8;

interface SessionPickerProps {
  sessions: SessionMeta[];
  current: string | null;
  onSelect: (id: string) => void;
  onCancel: () => void;
}

/** `/resume` list of saved sessions, newest first. Enter resumes, Esc cancels. */
export function SessionPicker({ sessions, current, onSelect, onCancel }: SessionPickerProps) {
  const theme = useTheme();
  const [index, setIndex] = useState(0);

  useInput((_input, key) => {
    const last = sessions.length - 1;
    if (key.escape) onCancel();
    else if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
    else if (key.downArrow) setIndex((i) => Math.min(last, i + 1));
    else if (key.pageUp) setIndex((i) => Math.max(0, i - VISIBLE));
    else if (key.pageDown) setIndex((i) => Math.min(last, i + VISIBLE));
    else if (key.return) {
      const session = sessions[index];
      if (session) onSelect(session.id);
    }
  });

  const start = Math.min(Math.max(0, index - VISIBLE + 1), Math.max(0, sessions.length - VISIBLE));
  const shown = sessions.slice(start, start + VISIBLE);

  return (
    <Box borderStyle="round" borderColor={theme.picker.border} borderBackgroundColor={theme.page.bg} paddingX={1} flexDirection="column">
      <Text color={theme.page.text} bold>
        Resume a session
      </Text>
      <Text color={theme.page.muted} wrap="truncate">
        {sessions.length} saved in .quick-code/sessions · the current one stays saved
      </Text>
      <Box marginTop={1} flexDirection="column">
        {start > 0 && <Text color={theme.page.muted}>  ↑ {start} newer</Text>}
        {shown.map((session) => {
          const selected = session === sessions[index];
          return (
            <Text key={session.id} wrap="truncate">
              <Text color={selected ? theme.picker.selected : theme.page.text} bold={selected}>
                {selected ? "❯ " : "  "}
                {formatWhen(session.updatedAt)}
              </Text>
              <Text color={theme.picker.detail}> {`${session.messageCount} msg`.padStart(7)} </Text>
              <Text color={selected ? theme.picker.selected : theme.page.text}>{session.title || "(untitled)"}</Text>
              {session.id === current && <Text color={theme.picker.current}> ✔ current</Text>}
            </Text>
          );
        })}
        {start + VISIBLE < sessions.length && <Text color={theme.page.muted}>  ↓ {sessions.length - start - VISIBLE} older</Text>}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.page.muted}>↑/↓ to move · Enter to resume · Esc to cancel</Text>
      </Box>
    </Box>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown date    ";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
