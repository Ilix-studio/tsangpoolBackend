// utils/spreadsheetLetters.ts

/**
 * Converts a 1-indexed position into a spreadsheet-style letter code:
 * 1 -> "A", 26 -> "Z", 27 -> "AA", 28 -> "AB", ..., 52 -> "AZ", 53 -> "BA".
 * Used to assign each branch a stable challan-number prefix.
 */
export function numberToLetters(n: number): string {
  let result = "";
  let value = n;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}
