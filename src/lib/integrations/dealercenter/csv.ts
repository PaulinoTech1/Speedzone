// Minimal RFC 4180 CSV parser with hard limits. No dependency, no eval, no
// formula interpretation: every cell is returned as a plain string.
export const csvLimits = { maxBytes: 1024 * 1024, maxRows: 600, maxColumns: 120, maxCellLength: 8192 } as const;

export class CsvError extends Error {}

export function parseCsv(input: string): string[][] {
  if (Buffer.byteLength(input, "utf8") > csvLimits.maxBytes) throw new CsvError("File is larger than 1 MB");
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const pushCell = () => {
    if (cell.length > csvLimits.maxCellLength) throw new CsvError(`A cell in row ${rows.length + 1} is too long`);
    row.push(cell); cell = "";
    if (row.length > csvLimits.maxColumns) throw new CsvError(`Row ${rows.length + 1} has too many columns`);
  };
  const pushRow = () => {
    pushCell();
    if (row.some(value => value.trim() !== "")) rows.push(row);
    if (rows.length > csvLimits.maxRows + 1) throw new CsvError(`File has more than ${csvLimits.maxRows} vehicles`);
    row = [];
  };
  while (i < text.length) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      cell += char; i++; continue;
    }
    if (char === '"' && cell === "") { quoted = true; i++; continue; }
    if (char === delimiter) { pushCell(); i++; continue; }
    if (char === "\r") { i++; if (text[i] === "\n") i++; pushRow(); continue; }
    if (char === "\n") { i++; pushRow(); continue; }
    cell += char; i++;
  }
  if (quoted) throw new CsvError("File has an unterminated quoted value");
  if (cell !== "" || row.length) pushRow();
  return rows;
}

function detectDelimiter(text: string) {
  const header = text.slice(0, text.search(/\r?\n|$/));
  const counts = [",", "\t", "|", ";"].map(d => [d, header.split(d).length] as const).sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 1 ? counts[0]![0] : ",";
}
