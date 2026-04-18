/**
 * Build an oxfmt-compatible Markdown table with padded columns so that the
 * generated file passes `oxfmt --check` without a reformat pass.
 *
 * Column width = max(header length, longest cell length, 3). Cells are
 * padded with trailing spaces; the separator row uses `-` characters of
 * the same width.
 *
 * Character width note: uses JavaScript `.length` (UTF-16 code units),
 * which matches oxfmt's own accounting for typical BMP characters used
 * in VENDOR.md generation (em-dash `—`, backticks, version strings).
 *
 * @param headers Column headers (top row)
 * @param rows    Data rows; each row must have `headers.length` cells
 * @returns       Lines ready to concatenate with `\n`
 */
export function formatMarkdownTable(headers: string[], rows: string[][]): string[] {
  const columnCount = headers.length;
  const widths: number[] = headers.map((h, i) => {
    const cellMax = rows.reduce((max, row) => Math.max(max, (row[i] ?? '').length), 0);
    return Math.max(h.length, cellMax, 3);
  });

  const formatRow = (cells: string[]): string => `| ${cells.map((cell, i) => cell.padEnd(widths[i])).join(' | ')} |`;

  const lines: string[] = [formatRow(headers), `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`];
  for (const row of rows) {
    const padded = Array.from({ length: columnCount }, (_, i) => row[i] ?? '');
    lines.push(formatRow(padded));
  }
  return lines;
}
