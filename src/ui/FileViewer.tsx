import { Box, Text, useInput } from "ink";
import path from "node:path";
import { useEffect, useMemo, useState } from "react";
import { hexLines, readForView, textLines, wrapLines, type ViewedFile } from "../project/fileView";
import { fit, formatSize } from "../project/fsView";
import { shortenPath } from "./Banner";
import { KeyHint } from "./FolderPicker";
import { useTheme } from "./theme";
import { useFunctionKey } from "./useFunctionKey";

const H_STEP = 8;

interface FileViewerProps {
  file: string;
  width: number;
  height: number;
  onClose: () => void;
}

/**
 * Midnight Commander style quick view (F3): read-only, full screen. F2 toggles wrapping,
 * F4 toggles hex, F3 / F10 / Esc / q close.
 */
export function FileViewer({ file, width, height, onClose }: FileViewerProps) {
  const theme = useTheme();
  const [data, setData] = useState<ViewedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wrap, setWrap] = useState(false);
  const [hex, setHex] = useState(false);
  const [top, setTop] = useState(0);
  const [left, setLeft] = useState(0);

  useEffect(() => {
    let cancelled = false;
    readForView(file).then(
      (result) => {
        if (cancelled) return;
        setData(result);
        setHex(result.binary);
      },
      (err: NodeJS.ErrnoException) => !cancelled && setError(err.code ?? err.message),
    );
    return () => {
      cancelled = true;
    };
  }, [file]);

  const textWidth = width - 2;
  const pageRows = height - 2;
  const source = useMemo(() => (data ? (hex ? hexLines(data.bytes) : textLines(data.bytes)) : []), [data, hex]);
  // Hex rows always fit the screen, so wrapping and panning only apply to text.
  const wrapped = wrap && !hex;
  const panning = !wrap && !hex;
  const rows = useMemo(() => (wrapped ? wrapLines(source, textWidth) : source), [source, wrapped, textWidth]);
  const notice = data?.truncated
    ? `── showing the first ${formatSize(data.bytes.length)} of ${formatSize(data.size)} ──`
    : data && data.size === 0
      ? "(empty file)"
      : null;
  const total = rows.length + (notice ? 1 : 0);
  const maxTop = Math.max(0, total - pageRows);
  const widest = useMemo(() => (panning ? source.reduce((max, l) => Math.max(max, [...l].length), 0) : 0), [source, panning]);

  const scroll = (to: number) => setTop(Math.max(0, Math.min(maxTop, to)));
  const toggleWrap = () => {
    setWrap((w) => !w);
    setTop(0);
    setLeft(0);
  };
  const toggleHex = () => {
    setHex((h) => !h);
    setTop(0);
    setLeft(0);
  };

  useFunctionKey((key) => {
    if (key === 3 || key === 10) onClose();
    else if (key === 2) toggleWrap();
    else if (key === 4) toggleHex();
  });

  useInput((input, key) => {
    if (key.escape || input === "q") onClose();
    else if (key.upArrow || input === "k") scroll(top - 1);
    else if (key.downArrow || input === "j") scroll(top + 1);
    else if (key.pageUp || input === "b") scroll(top - pageRows);
    else if (key.pageDown || input === " ") scroll(top + pageRows);
    else if (key.home || input === "g") scroll(0);
    else if (key.end || input === "G") scroll(maxTop);
    else if (key.leftArrow && panning) setLeft((l) => Math.max(0, l - H_STEP));
    else if (key.rightArrow && panning) setLeft((l) => Math.min(Math.max(0, widest - textWidth), l + H_STEP));
    else if (input === "w") toggleWrap();
    else if (input === "h") toggleHex();
  });

  const shown = Math.min(top + pageRows, rows.length);
  const percent = total <= pageRows ? 100 : Math.round((Math.min(top + pageRows, total) / total) * 100);
  const position = data
    ? ` ${hex ? "hex" : wrapped ? "wrap" : `col ${left + 1}`}  ${rows.length === 0 ? 0 : top + 1}-${shown}/${rows.length}  ${percent}%  ${formatSize(data.size)} `
    : " ";
  const title = ` ${shortenPath(file)}`;
  const headerTitle = fit(title, Math.max(0, width - position.length));

  const renderRow = (index: number) => {
    const line = rows[index];
    if (line !== undefined) {
      if (hex) return <HexRow line={line} width={textWidth} />;
      return fit(panning ? [...line].slice(left).join("") : line, textWidth);
    }
    return notice && index === rows.length ? <Text color={theme.viewer.notice}>{fit(notice, textWidth)}</Text> : " ";
  };

  return (
    <Box flexDirection="column" width={width} height={height} backgroundColor={theme.viewer.bg}>
      <Text color={theme.viewer.headerText} backgroundColor={theme.viewer.headerBg} wrap="truncate">
        {headerTitle}
        {position}
      </Text>
      <Box flexDirection="column" height={pageRows} paddingX={1} overflow="hidden">
        {error ? (
          <Text color={theme.navigator.warning} bold>
            {fit(`⚠ Cannot view ${path.basename(file)}: ${error}`, textWidth)}
          </Text>
        ) : !data ? (
          <Text color={theme.viewer.notice}>Loading…</Text>
        ) : (
          Array.from({ length: pageRows }, (_, i) => (
            <Text key={i} color={theme.viewer.text} wrap="truncate">
              {renderRow(top + i)}
            </Text>
          ))
        )}
      </Box>
      <Text wrap="truncate">
        <KeyHint k="F2" label={wrap ? "UnWrap" : "Wrap"} />
        <KeyHint k="F3" label="Quit" />
        <KeyHint k="F4" label={hex ? "Ascii" : "Hex"} />
        <KeyHint k="↑↓ PgUp PgDn" label="Scroll" />
        {panning && <KeyHint k="←→" label="Pan" />}
        <KeyHint k="Esc" label="Quit" />
      </Text>
    </Box>
  );
}

/** A hex dump row with the offset column highlighted. */
function HexRow({ line, width }: { line: string; width: number }) {
  const theme = useTheme();
  const text = fit(line, width);
  return (
    <Text>
      <Text color={theme.viewer.offset}>{text.slice(0, 8)}</Text>
      {text.slice(8)}
    </Text>
  );
}
