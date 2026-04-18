import { formatMarkdownTable } from '../src/lib/markdown-table';

describe('formatMarkdownTable', () => {
  it('pads columns to the widest header-or-cell length, with a minimum of 3', () => {
    const lines = formatMarkdownTable(
      ['A', 'B'],
      [['x', 'yy']],
    );
    expect(lines).toEqual([
      '| A   | B   |',
      '| --- | --- |',
      '| x   | yy  |',
    ]);
  });

  it('matches the oxfmt-expected layout for the VENDOR.md sync-history row', () => {
    const lines = formatMarkdownTable(
      ['Date', 'From', 'To', 'Notes'],
      [['2026-04-17', '—', '11.24.4 (`733adc760d`)', 'scaffolded by lt CLI']],
    );
    expect(lines).toEqual([
      '| Date       | From | To                     | Notes                |',
      '| ---------- | ---- | ---------------------- | -------------------- |',
      '| 2026-04-17 | —    | 11.24.4 (`733adc760d`) | scaffolded by lt CLI |',
    ]);
  });

  it('handles multiple rows and short headers with long data', () => {
    const lines = formatMarkdownTable(
      ['A', 'B'],
      [
        ['short', 'x'],
        ['x', 'longer content'],
      ],
    );
    expect(lines).toEqual([
      '| A     | B              |',
      '| ----- | -------------- |',
      '| short | x              |',
      '| x     | longer content |',
    ]);
  });

  it('fills missing cells in under-sized rows with empty strings', () => {
    const lines = formatMarkdownTable(
      ['A', 'B', 'C'],
      [['one', 'two']],
    );
    expect(lines).toEqual([
      '| A   | B   | C   |',
      '| --- | --- | --- |',
      '| one | two |     |',
    ]);
  });
});
