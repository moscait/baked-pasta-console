import { describe, expect, it } from 'vitest';
import { csvCell, csvFileName, toCsv } from './csv';

describe('csv', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('plain')).toBe('plain');
  });

  it('renders empty, array and object values', () => {
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(null)).toBe('');
    expect(csvCell(['ops', 'sales'])).toBe('ops; sales');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvCell(42)).toBe('42');
  });

  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('@sum')).toBe("'@sum");
  });

  it('joins rows with CRLF and a trailing newline', () => {
    expect(toCsv(['Name', 'Roles'], [['alice', ['ops']]])).toBe('Name,Roles\r\nalice,ops\r\n');
  });

  it('builds a dated file name from the caption', () => {
    expect(csvFileName('OpenZiti Edge Routers', new Date('2026-11-25T10:00:00Z'))).toBe(
      'openziti-edge-routers-2026-11-25.csv',
    );
    expect(csvFileName('***', new Date('2026-11-25T10:00:00Z'))).toBe('export-2026-11-25.csv');
  });
});
