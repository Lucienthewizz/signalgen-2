export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  // A spreadsheet must not execute formulas supplied in notes or names.
  if (typeof value === "string" && /^[=+@\-\t\r\n]/.test(text.trimStart()))
    text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}
export function toCsv(rows: unknown[][]) {
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
export function downloadCsv(filename: string, rows: unknown[][]) {
  const url = URL.createObjectURL(
    new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
