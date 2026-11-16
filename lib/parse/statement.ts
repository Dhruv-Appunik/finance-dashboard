import Papa from "papaparse";
import * as XLSX from "xlsx";

export type Cell = string | number | Date | null | undefined;

export type ColumnMap = {
  headerRow: number;
  date: number;
  narration: number;
  debit: number | null;
  credit: number | null;
  amount: number | null;
  drcr: number | null;
  balance: number | null;
  reference: number | null;
};

export type RawTxn = {
  date: string; // YYYY-MM-DD
  narration: string;
  amount: number;
  direction: "debit" | "credit";
  balance: number | null;
  reference: string | null;
};

export function readRows(buffer: Buffer, fileName: string): Cell[][] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) {
    const text = buffer.toString("utf8").replace(/^﻿/, "");
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
    return parsed.data as Cell[][];
  }
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  // Use the sheet with the most rows; statements sometimes ship with a cover sheet.
  let best: Cell[][] = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
    if (rows.length > best.length) best = rows;
  }
  return best;
}

const str = (c: Cell) => (c == null ? "" : c instanceof Date ? c.toISOString() : String(c)).trim();

const H = {
  drcr: /^(dr ?\/ ?cr|cr ?\/ ?dr|debit ?\/ ?credit|credit ?\/ ?debit|txn type|transaction type|type)$/i,
  valueDate: /value ?(date|dt)/i,
  postDate: /post(ing|ed)? ?date/i,
  date: /(^|\b)(date|dt)\b|^txn date|^tran date|^transaction date/i,
  narration: /narration|description|particulars|transaction details|transaction remarks|remarks|details|merchant/i,
  debit: /withdrawal|debit|\bdr\b|paid out|money out/i,
  credit: /deposit|credit|\bcr\b|paid in|money in/i,
  amount: /amount|amt/i,
  balance: /balance|\bbal\b/i,
  reference: /ref|chq|cheque|utr|transaction id|txn id/i,
};

export function detectColumns(rows: Cell[][]): ColumnMap | null {
  const limit = Math.min(rows.length, 60);
  for (let r = 0; r < limit; r++) {
    const cells = (rows[r] || []).map(str);
    if (cells.filter(Boolean).length < 3) continue;
    const map: ColumnMap = {
      headerRow: r, date: -1, narration: -1, debit: null, credit: null, amount: null, drcr: null, balance: null, reference: null,
    };
    let valueDate = -1;
    cells.forEach((h, i) => {
      if (!h || h.length > 45) return;
      if (H.drcr.test(h)) { if (map.drcr == null) map.drcr = i; return; }
      if (H.balance.test(h)) { if (map.balance == null) map.balance = i; return; }
      if (H.valueDate.test(h) || H.postDate.test(h)) { if (valueDate < 0) valueDate = i; return; }
      if (H.date.test(h)) { if (map.date < 0) map.date = i; return; }
      if (H.narration.test(h)) { if (map.narration < 0) map.narration = i; return; }
      if (H.debit.test(h) && !H.credit.test(h)) { if (map.debit == null) map.debit = i; return; }
      if (H.credit.test(h) && !H.debit.test(h)) { if (map.credit == null) map.credit = i; return; }
      if (H.amount.test(h)) { if (map.amount == null && !/intl|international|foreign|reward|points/i.test(h)) map.amount = i; return; }
      if (H.reference.test(h)) { if (map.reference == null) map.reference = i; return; }
    });
    if (map.date < 0) map.date = valueDate;
    const hasMoney = map.amount != null || map.debit != null || map.credit != null;
    if (map.date >= 0 && map.narration >= 0 && hasMoney) return map;
  }
  return null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y: number, m: number, d: number) =>
  y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31
    ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    : null;
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

export function parseDate(cell: Cell): string | null {
  if (cell == null || cell === "") return null;
  if (cell instanceof Date) {
    if (isNaN(cell.getTime())) return null;
    // Spreadsheet dates come through at midnight UTC give or take the timezone offset; nudge to the nearest day.
    const d = new Date(cell.getTime() + 12 * 3600 * 1000);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  if (typeof cell === "number") {
    if (cell < 30000 || cell > 80000) return null; // Excel serial date range for roughly 1982 to 2119
    const d = new Date(Math.round((cell - 25569) * 86400 * 1000));
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(cell).trim().replace(/,/g, " ");
  let mt = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); // 2026-04-05
  if (mt) return iso(+mt[1], +mt[2], +mt[3]);
  mt = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})/); // 05/04/2026, Indian day-first order
  if (mt) return iso(fullYear(+mt[3]), +mt[2], +mt[1]);
  mt = s.match(/^(\d{1,2})[-/. ]?([A-Za-z]{3})[A-Za-z]*[-/. ]?'?(\d{2,4})/); // 05-Apr-2026, 05 Apr 26
  if (mt && MONTHS[mt[2].toLowerCase()]) return iso(fullYear(+mt[3]), MONTHS[mt[2].toLowerCase()], +mt[1]);
  mt = s.match(/^([A-Za-z]{3})[A-Za-z]* (\d{1,2}) +(\d{4})/); // Apr 05 2026
  if (mt && MONTHS[mt[1].toLowerCase()]) return iso(+mt[3], MONTHS[mt[1].toLowerCase()], +mt[2]);
  return null;
}

export function parseAmount(cell: Cell): { value: number; marker: "debit" | "credit" | null } | null {
  if (cell == null || cell === "") return null;
  if (typeof cell === "number") return isFinite(cell) ? { value: cell, marker: null } : null;
  if (cell instanceof Date) return null;
  let s = String(cell).trim();
  if (!s || /^[-–]+$/.test(s)) return null;
  let marker: "debit" | "credit" | null = null;
  if (/\bcr\b\.?|\(cr\)|credit/i.test(s)) marker = "credit";
  else if (/\bdr\b\.?|\(dr\)|debit/i.test(s)) marker = "debit";
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s);
  s = s.replace(/[^0-9.]/g, "");
  if (!s || s === ".") return null;
  const value = parseFloat(s);
  if (!isFinite(value)) return null;
  return { value: negative ? -value : value, marker };
}

export function extractTransactions(rows: Cell[][], map: ColumnMap, accountType: string): RawTxn[] {
  const out: RawTxn[] = [];
  for (let r = map.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const date = parseDate(row[map.date]);
    if (!date) continue;
    const narration = str(row[map.narration]).replace(/\s+/g, " ");
    let amount = 0;
    let direction: "debit" | "credit" | null = null;

    const debit = map.debit != null ? parseAmount(row[map.debit]) : null;
    const credit = map.credit != null ? parseAmount(row[map.credit]) : null;
    if (debit && Math.abs(debit.value) > 0) {
      amount = Math.abs(debit.value);
      direction = "debit";
    } else if (credit && Math.abs(credit.value) > 0) {
      amount = Math.abs(credit.value);
      direction = "credit";
    } else if (map.amount != null) {
      const a = parseAmount(row[map.amount]);
      if (!a || a.value === 0) continue;
      amount = Math.abs(a.value);
      const flag = map.drcr != null ? str(row[map.drcr]).toLowerCase() : "";
      if (/^(cr|c|credit)\b/.test(flag)) direction = "credit";
      else if (/^(dr|d|debit)\b/.test(flag)) direction = "debit";
      else if (a.marker) direction = a.marker;
      else if (accountType === "credit_card") direction = a.value < 0 ? "credit" : "debit";
      else direction = a.value < 0 ? "debit" : "credit";
    }
    if (!direction || amount <= 0) continue;
    if (!narration) continue;

    const bal = map.balance != null ? parseAmount(row[map.balance]) : null;
    const ref = map.reference != null ? str(row[map.reference]) : "";
    out.push({
      date,
      narration,
      amount: Math.round(amount * 100) / 100,
      direction,
      balance: bal ? bal.value : null,
      reference: ref && !/^0+$/.test(ref) && ref !== "-" ? ref : null,
    });
  }
  return out;
}
