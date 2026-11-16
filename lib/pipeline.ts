import crypto from "crypto";
import { db, getSetting, q, type Q } from "./db";
import { FLOW_BY_CATEGORY, SEED_CATEGORIES, type Owner } from "./seed";
import { matchMerchant, merchantForPayee } from "./merchants";
import { normaliseName, parseNarration } from "./parse/narration";
import { detectColumns, extractTransactions, readRows, type ColumnMap } from "./parse/statement";
import { hasClaude, hasJev, jevClassify, sonnetClassify, sonnetColumnMap, type PayeeContext, type Verdict } from "./llm";

export type Account = {
  id: number; name: string; bank: string; type: "savings" | "current" | "credit_card";
  last4: string | null; default_owner: Owner; column_map: string | null;
};
export type Payee = {
  id: number; display_name: string; normalised_name: string; upi_id: string | null;
  kind: "merchant" | "person" | "own_account" | "unknown"; is_mixed: number; mixed_limit: number | null;
};
export type Category = { id: number; name: string; grp: string; is_spend: number };
export type Txn = {
  id: number; account_id: number; txn_date: string; amount: number; direction: "debit" | "credit";
  narration_raw: string; mode: string | null; reference_no: string | null; payee_id: number | null;
  category_id: number | null; owner: Owner | null; flow_type: string | null; confidence: number | null;
  status: "classified" | "needs_review" | "confirmed"; classified_by: string | null; reason: string | null;
  linked_txn_id: number | null; note: string | null;
};

export const threshold = async () => Number(await getSetting("confidence_threshold", "0.85")) || 0.85;

const categories = async () => (await db().prepare("SELECT * FROM categories ORDER BY sort, id").all()) as Category[];
const hintFor = (name: string) => SEED_CATEGORIES.find((c) => c.name === name)?.hint || name;

export function deriveFlow(cat: Category | undefined, direction: "debit" | "credit"): string {
  if (!cat) return direction === "debit" ? "spend" : "income";
  if (FLOW_BY_CATEGORY[cat.name]) return FLOW_BY_CATEGORY[cat.name];
  if (cat.grp === "Income") return "income";
  return direction === "debit" ? "spend" : "refund";
}

async function ownNames(): Promise<string[]> {
  return (await getSetting("own_names", ""))
    .split(",")
    .map((s) => normaliseName(s))
    .filter((s) => s.length >= 3);
}

/* ---------- payees ---------- */

type PayeeRow = { id: number | null; display_name: string; normalised_name: string; upi_id: string | null; kind: Payee["kind"] };

/**
 * Matches each statement row to a payee in memory and creates the missing ones in one batch,
 * so a large upload does not make a database round trip per row.
 */
async function payeeResolver() {
  const existing = (await db().prepare("SELECT id, display_name, normalised_name, upi_id, kind FROM payees ORDER BY id").all()) as PayeeRow[];
  const byUpi = new Map<string, PayeeRow>();
  const byName = new Map<string, PayeeRow[]>();
  const merchants = new Map<string, PayeeRow>();
  const created: PayeeRow[] = [];

  const index = (p: PayeeRow) => {
    if (p.upi_id && !byUpi.has(p.upi_id)) byUpi.set(p.upi_id, p);
    if (!byName.has(p.normalised_name)) byName.set(p.normalised_name, []);
    byName.get(p.normalised_name)!.push(p);
    if (p.kind === "merchant" && !merchants.has(p.normalised_name)) merchants.set(p.normalised_name, p);
  };
  existing.forEach(index);

  const add = (p: PayeeRow) => {
    created.push(p);
    index(p);
    return p;
  };

  return {
    resolve(name: string, upiId: string | null, narration: string, mode: string): PayeeRow {
      const probe = mode === "UPI" || mode === "NEFT" || mode === "IMPS" || mode === "RTGS" ? `${name} ${upiId ?? ""}` : `${name} ${narration}`;
      const merchant = matchMerchant(probe);
      if (merchant) {
        const n = normaliseName(merchant.name);
        return merchants.get(n) ?? add({ id: null, display_name: merchant.name, normalised_name: n, upi_id: null, kind: "merchant" });
      }
      const n = normaliseName(name) || "UNKNOWN";
      if (upiId) return byUpi.get(upiId) ?? add({ id: null, display_name: name, normalised_name: n, upi_id: upiId, kind: "unknown" });
      const same = byName.get(n) || [];
      // Prefer a payee with no UPI id, then the oldest.
      const hit = same.find((p) => !p.upi_id) ?? same[0];
      return hit ?? add({ id: null, display_name: name, normalised_name: n, upi_id: null, kind: "unknown" });
    },
    async save() {
      if (!created.length) return;
      const results = await db().batch(
        created.map((p) =>
          p.kind === "merchant"
            ? q("INSERT INTO payees (display_name, normalised_name, kind) VALUES (?,?, 'merchant')", p.display_name, p.normalised_name)
            : q("INSERT INTO payees (display_name, normalised_name, upi_id) VALUES (?,?,?)", p.display_name, p.normalised_name, p.upi_id),
        ),
      );
      created.forEach((p, i) => { p.id = Number(results[i].lastInsertRowid); });
    },
  };
}

/* ---------- ingest ---------- */

export type IngestResult = {
  upload_id: number; rows: number; added: number; duplicates: number;
  period_start: string; period_end: string; classified: number; needs_review: number; warnings: string[];
};

export async function ingestStatement(accountId: number, fileName: string, buffer: Buffer): Promise<IngestResult> {
  const d = db();
  const account = (await d.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId)) as Account | undefined;
  if (!account) throw new Error("Account not found");
  const rows = readRows(buffer, fileName);
  if (rows.length === 0) throw new Error("The file is empty or could not be read.");

  let map: ColumnMap | null = detectColumns(rows);
  if (!map && account.column_map) map = JSON.parse(account.column_map) as ColumnMap;
  if (!map && hasClaude()) {
    map = await sonnetColumnMap(rows);
    await d.prepare("UPDATE accounts SET column_map = ? WHERE id = ?").run(JSON.stringify(map), accountId);
  }
  if (!map) {
    throw new Error(
      "Could not find the header row (date, narration and amount columns). Add an ANTHROPIC_API_KEY so Sonnet can map unusual layouts, or check the file.",
    );
  }
  const raw = extractTransactions(rows, map, account.type);
  if (raw.length === 0) throw new Error("No transactions were found in this file.");

  const dates = raw.map((r) => r.date).sort();
  const uploadId = (
    await d.prepare("INSERT INTO uploads (account_id, file_name, period_start, period_end, row_count, status) VALUES (?,?,?,?,?, 'processing')")
      .run(accountId, fileName, dates[0], dates[dates.length - 1], raw.length)
  ).lastInsertRowid;

  const resolver = await payeeResolver();
  const seen = new Map<string, number>();
  const prepared = raw.map((r) => {
    const p = parseNarration(r.narration, account.type);
    const reference = r.reference || p.reference;
    const base = `${accountId}|${r.date}|${r.amount.toFixed(2)}|${r.direction}|${reference || r.narration.toUpperCase()}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    const hash = crypto.createHash("sha1").update(`${base}#${n}`).digest("hex");
    return { r, p, reference, hash, payee: resolver.resolve(p.payeeName, p.upiId, r.narration, p.mode) };
  });
  await resolver.save();

  const results = await d.batch(
    prepared.map((x) =>
      q(
        `INSERT OR IGNORE INTO transactions
          (account_id, upload_id, txn_date, amount, direction, narration_raw, mode, reference_no, balance, payee_id, note, owner, dedupe_hash)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        accountId, uploadId, x.r.date, x.r.amount, x.r.direction, x.r.narration, x.p.mode, x.reference, x.r.balance, x.payee.id, x.p.note, account.default_owner, x.hash,
      ),
    ),
  );
  const added = results.reduce((sum, rs) => sum + rs.rowsAffected, 0);
  await d.prepare("UPDATE uploads SET added_count = ?, duplicate_count = ?, status = 'done' WHERE id = ?").run(added, raw.length - added, uploadId);

  const result = await classify("unprocessed");
  return {
    upload_id: uploadId, rows: raw.length, added, duplicates: raw.length - added,
    period_start: dates[0], period_end: dates[dates.length - 1], ...result,
  };
}

/* ---------- classification ---------- */

type Decision = {
  category: string; owner: Owner; flow?: string; confidence: number; status: "classified" | "needs_review"; by: string; reason: string;
};

const CARD_BILL = /^CC ?\d{6,}|\bCC ?\d{6,}.*AUTOPAY|CREDIT ?CARD|CC ?PAYMENT|CC ?BILL|CARD ?PAYMENT|CARDS? ?BILL|CCBILL|BILLDESK.*CARD|\bCRED\b|CREDCLUB|AUTOPAY.*CARD|CARD.*AUTOPAY/i;
const CARD_PAYMENT_RECEIVED = /PAYMENT|THANK ?YOU|BBPS|NEFT|IMPS|AUTOPAY|AUTO ?DEBIT|NETBANKING|\bUPI\b/i;
const REFUND = /REFUND|REVERSAL|REVERSED|\bREV\b|RVSL|CASHBACK|CHARGEBACK/i;

function structural(t: Txn, a: Account, p: Payee | undefined, own: string[]): Decision | null {
  const n = t.narration_raw;
  const base = { owner: a.default_owner, confidence: 1, status: "classified" as const, by: "structural" };
  if (p?.kind === "own_account") return { ...base, category: "Own-account transfer", reason: "Payee is marked as your own account" };
  if (a.type === "credit_card" && t.direction === "credit") {
    if (REFUND.test(n)) return { ...base, category: "Refund received", reason: "Refund or reversal on the card" };
    if (CARD_PAYMENT_RECEIVED.test(n)) return { ...base, category: "Card bill payment", reason: "Payment received on the card" };
    return { ...base, category: "Refund received", confidence: 0.9, reason: "Credit on a card that is not a bill payment" };
  }
  if (a.type !== "credit_card" && t.direction === "debit" && CARD_BILL.test(n))
    return { ...base, category: "Card bill payment", reason: "Narration shows a credit card bill payment" };
  if (t.mode === "ATM" && t.direction === "debit") return { ...base, category: "Cash withdrawal", reason: "ATM withdrawal" };
  if (t.mode === "CHARGE" && t.direction === "debit")
    return { ...base, category: a.type === "credit_card" ? "Credit card fees and interest" : "Bank charges", reason: "Bank fee or charge" };
  if (t.mode === "INTEREST" && t.direction === "credit") return { ...base, category: "Interest and dividends", reason: "Interest credited" };
  if (t.direction === "credit" && REFUND.test(n)) return { ...base, category: "Refund received", reason: "Refund or reversal" };
  if (p && own.length && a.type !== "credit_card") {
    const pn = p.normalised_name;
    if (own.some((o) => pn === o || pn.includes(o) || (pn.length >= 6 && o.includes(pn))))
      return { ...base, category: "Own-account transfer", confidence: 0.95, reason: "Payee name matches one of your own names" };
  }
  return null;
}

type RuleRow = { id: number; payee_id: number; category_id: number; owner: Owner | null; scope: string; amount_limit: number | null };

function findRule(rules: RuleRow[] | undefined, amount: number) {
  for (const r of rules || []) {
    if (r.scope === "always") return r;
    if (r.scope === "above_amount" && r.amount_limit != null && amount >= r.amount_limit) return r;
    if (r.scope === "below_amount" && r.amount_limit != null && amount < r.amount_limit) return r;
  }
  return null;
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

const SAVE_DECISION =
  "UPDATE transactions SET category_id=?, owner=?, flow_type=?, confidence=?, status=?, classified_by=?, reason=? WHERE id=? AND status != 'confirmed'";
const DAY = 86_400_000;

export async function classify(scope: "unprocessed" | "unconfirmed"): Promise<{ classified: number; needs_review: number; warnings: string[] }> {
  const d = db();
  const cats = await categories();
  const catByName = new Map(cats.map((c) => [c.name, c]));
  const catById = new Map(cats.map((c) => [c.id, c]));
  const accounts = new Map(((await d.prepare("SELECT * FROM accounts").all()) as Account[]).map((a) => [a.id, a]));
  const payees = new Map(((await d.prepare("SELECT * FROM payees").all()) as Payee[]).map((p) => [p.id, p]));
  const own = await ownNames();
  const warnings: string[] = [];
  const limit = await threshold();

  // Rules are read once. Within a payee, specific rules (above or below an amount) come before the catch-all.
  const rulesByPayee = new Map<number, RuleRow[]>();
  for (const r of (await d.prepare("SELECT * FROM rules ORDER BY payee_id, scope = 'always', id DESC").all()) as RuleRow[]) {
    if (!rulesByPayee.has(r.payee_id)) rulesByPayee.set(r.payee_id, []);
    rulesByPayee.get(r.payee_id)!.push(r);
  }

  const where = scope === "unprocessed" ? "classified_by IS NULL" : "status != 'confirmed'";
  const txns = (await d.prepare(`SELECT * FROM transactions WHERE ${where} ORDER BY txn_date, id`).all()) as Txn[];

  // Decisions are collected and written in batches, so a big upload is a few requests, not one per row.
  const pending: Q[] = [];
  const apply = (t: Txn, dec: Decision) => {
    const cat = catByName.get(dec.category) || catByName.get("Uncategorised")!;
    pending.push(q(SAVE_DECISION, cat.id, dec.owner, dec.flow || deriveFlow(cat, t.direction), dec.confidence, dec.status, dec.by, dec.reason, t.id));
  };
  const flush = async () => { await d.batch(pending.splice(0)); };

  // Steps 1 to 3: structural checks, your rules, the seed merchant list.
  const forModel: Txn[] = [];
  for (const t of txns) {
    const a = accounts.get(t.account_id)!;
    const p = t.payee_id ? payees.get(t.payee_id) : undefined;
    const s = structural(t, a, p, own);
    if (s) { apply(t, s); continue; }
    if (p) {
      const rule = findRule(rulesByPayee.get(p.id), t.amount);
      if (rule) {
        const cat = catById.get(rule.category_id);
        if (cat) {
          apply(t, { category: cat.name, owner: rule.owner || a.default_owner, confidence: 1, status: "classified", by: "rule", reason: "Your saved rule for this payee" });
          continue;
        }
      }
      if (p.is_mixed) {
        const m = merchantForPayee(p.normalised_name, p.display_name);
        apply(t, {
          category: m?.category || (t.category_id ? catById.get(t.category_id)?.name || "Uncategorised" : "Uncategorised"),
          owner: a.default_owner, confidence: 0.5, status: "needs_review", by: "pending",
          reason: "This payee is marked as mixed, so each larger payment is asked separately",
        });
        continue;
      }
      const m = p.kind === "merchant" ? merchantForPayee(p.normalised_name, p.display_name) : null;
      if (m && m.owner && t.direction === "debit") {
        apply(t, { category: m.category, owner: m.owner, confidence: 0.9, status: "classified", by: "merchant_list", reason: `Known merchant: ${m.name}` });
        continue;
      }
      if (m && t.direction === "credit" && m.category === "Client revenue") {
        apply(t, { category: m.category, owner: "business", confidence: 0.9, status: "classified", by: "merchant_list", reason: `Known payment gateway: ${m.name}` });
        continue;
      }
    }
    forModel.push(t);
  }
  await flush();

  // Own-account transfers: an equal and opposite entry in another bank account within two days.
  // Looks at every unsettled bank transaction, not only this upload, because the two sides usually arrive in different files.
  const unsettled = (await d.prepare(
    `SELECT t.* FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE a.type != 'credit_card' AND t.linked_txn_id IS NULL
       AND (t.status = 'needs_review' OR (t.status = 'classified' AND t.flow_type = 'transfer_own'))
     ORDER BY t.txn_date, t.id`,
  ).all()) as Txn[];
  const byAmount = new Map<number, Txn[]>();
  for (const t of unsettled) {
    if (!byAmount.has(t.amount)) byAmount.set(t.amount, []);
    byAmount.get(t.amount)!.push(t);
  }
  const paired = new Set<number>();
  for (const t of unsettled) {
    if (t.status !== "needs_review" || t.amount < 500 || t.flow_type === "transfer_own" || paired.has(t.id)) continue;
    let other: Txn | undefined;
    let best = Infinity;
    for (const o of byAmount.get(t.amount) || []) {
      if (o.account_id === t.account_id || o.direction === t.direction || paired.has(o.id)) continue;
      const gap = Math.abs(Date.parse(o.txn_date) - Date.parse(t.txn_date)) / DAY;
      if (gap <= 2 && gap < best) { other = o; best = gap; }
    }
    if (!other) continue;
    const dec = (acct: Account, counter: Account): Decision => ({
      category: "Own-account transfer", owner: acct.default_owner, confidence: 0.8, status: "needs_review", by: "structural",
      reason: `Same amount moved ${t.direction === "debit" ? "to" : "from"} ${counter.name} within two days. Confirm if this is your own account.`,
    });
    const a1 = accounts.get(t.account_id)!;
    const a2 = accounts.get(other.account_id)!;
    if (other.flow_type === "transfer_own" && other.status === "classified") {
      // The other side was already recognised as your own account, so this side is settled too.
      apply(t, { category: "Own-account transfer", owner: a1.default_owner, confidence: 0.95, status: "classified", by: "structural", reason: `Matches your own transfer in ${a2.name}` });
    } else {
      apply(t, dec(a1, a2));
      apply(other, dec(a2, a1));
    }
    pending.push(q("UPDATE transactions SET linked_txn_id = ? WHERE id = ?", other.id, t.id));
    pending.push(q("UPDATE transactions SET linked_txn_id = ? WHERE id = ?", t.id, other.id));
    paired.add(t.id);
    paired.add(other.id);
  }
  await flush();

  // Step 4: Jev, then Sonnet, one question per payee and direction.
  const groups = new Map<string, Txn[]>();
  for (const t of forModel) {
    if (paired.has(t.id)) continue;
    const key = `${t.payee_id}|${t.direction}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const debitCats = cats.filter((c) => c.grp !== "Income" && c.name !== "Refund received").map((c) => ({ name: c.name, hint: hintFor(c.name) }));
  const creditCats = cats
    .filter((c) => c.grp === "Income" || ["Refund received", "Own-account transfer", "Investments"].includes(c.name))
    .map((c) => ({ name: c.name, hint: hintFor(c.name) }));

  type Group = { id: number; txns: Txn[]; ctx: PayeeContext; verdict?: Verdict; fallback: Decision };
  const list: Group[] = [];
  let gid = 0;
  for (const g of groups.values()) {
    const t0 = g[0];
    const p = t0.payee_id ? payees.get(t0.payee_id) : undefined;
    const a0 = accounts.get(t0.account_id)!;
    const m = p?.kind === "merchant" ? merchantForPayee(p.normalised_name, p.display_name) : null;
    const accs = [...new Set(g.map((t) => t.account_id))].map((id) => accounts.get(id)!);
    list.push({
      id: gid++,
      txns: g,
      ctx: {
        payee_name: p?.display_name || "Unknown",
        upi_id: p?.upi_id || null,
        payee_kind: p?.kind || "unknown",
        direction: t0.direction,
        payment_modes: [...new Set(g.map((t) => t.mode || "OTHER"))],
        transaction_count: g.length,
        amounts: g.slice(0, 12).map((t) => t.amount),
        notes: [...new Set(g.map((t) => t.note).filter(Boolean) as string[])].slice(0, 6),
        sample_narrations: g.slice(0, 3).map((t) => t.narration_raw.slice(0, 140)),
        paid_from_accounts: accs.map((a) => ({ name: a.name, default_owner: a.default_owner })),
      },
      fallback: m
        ? { category: m.category, owner: a0.default_owner, confidence: 0.6, status: "needs_review", by: "merchant_list", reason: `${m.name} is used for both personal and business, so the owner needs your answer` }
        : {
            category: t0.direction === "credit" ? "Other income" : "Uncategorised",
            owner: a0.default_owner, confidence: 0.3, status: "needs_review", by: "pending",
            reason: hasJev() || hasClaude() ? "The model was not confident" : "No AI key is set, so this needs your answer",
          },
    });
  }

  if (hasJev()) {
    await pool(list, 6, async (g) => {
      try {
        g.verdict = await jevClassify(g.ctx, g.ctx.direction === "debit" ? debitCats : creditCats);
      } catch (e) {
        if (warnings.length < 3) warnings.push(`Jev: ${(e as Error).message}`);
      }
    });
  }
  if (hasClaude()) {
    const unsure = list.filter((g) => !g.verdict || g.verdict.confidence < limit);
    const examples = (
      (await d.prepare(
        `SELECT p.display_name n, c.name c, r.owner o FROM rules r JOIN payees p ON p.id = r.payee_id JOIN categories c ON c.id = r.category_id
         WHERE r.source = 'user' ORDER BY r.id DESC LIMIT 30`,
      ).all()) as { n: string; c: string; o: string | null }[]
    ).map((r) => `${r.n} -> ${r.c}${r.o ? ` (${r.o})` : ""}`);
    for (const dir of ["debit", "credit"] as const) {
      const part = unsure.filter((g) => g.ctx.direction === dir);
      if (!part.length) continue;
      try {
        const res = await sonnetClassify(part.map((g) => ({ id: g.id, ctx: g.ctx })), dir === "debit" ? debitCats : creditCats, examples);
        for (const g of part) {
          const v = res.get(g.id);
          if (v && (!g.verdict || v.confidence >= g.verdict.confidence || v.confidence >= limit)) g.verdict = v;
        }
      } catch (e) {
        if (warnings.length < 3) warnings.push(`Sonnet: ${(e as Error).message}`);
      }
    }
  }

  for (const g of list) {
    const v = g.verdict;
    for (const t of g.txns) {
      if (!v) { apply(t, g.fallback); continue; }
      const ok = v.confidence >= limit;
      apply(t, { category: v.category, owner: v.owner, confidence: v.confidence, status: ok ? "classified" : "needs_review", by: v.by === "jev" ? "jev" : "llm", reason: v.reason });
    }
  }
  await flush();

  await syncQuestions();
  let classified = 0;
  let needs = 0;
  for (let i = 0; i < txns.length; i += 500) {
    const ids = txns.slice(i, i + 500).map((t) => t.id);
    const rows = (await d.prepare(`SELECT status, COUNT(*) c FROM transactions WHERE id IN (${ids.join(",")}) GROUP BY status`).all()) as { status: string; c: number }[];
    for (const r of rows) {
      if (r.status === "needs_review") needs += r.c;
      else classified += r.c;
    }
  }
  return { classified, needs_review: needs, warnings };
}

/* ---------- questions ---------- */

export async function syncQuestions() {
  await db().batch([
    q(
      `INSERT INTO questions (payee_id)
       SELECT DISTINCT t.payee_id FROM transactions t
       WHERE t.status = 'needs_review' AND t.payee_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.payee_id = t.payee_id AND q.status IN ('open','skipped'))`,
    ),
    q(
      `UPDATE questions SET status = 'answered', answered_at = datetime('now')
       WHERE status IN ('open','skipped')
         AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.payee_id = questions.payee_id AND t.status = 'needs_review')`,
    ),
  ]);
}

export type AnswerBody = {
  category_id?: number;
  owner?: Owner;
  scope?: "always" | "above_amount" | "below_amount" | "just_these";
  amount_limit?: number;
  special?: "own_account" | "mixed" | "person" | "skip" | "unskip";
};

const CONFIRM =
  "UPDATE transactions SET category_id=?, owner=?, flow_type=?, confidence=1, status='confirmed', classified_by=?, reason=? WHERE id=?";

export async function answerQuestion(questionId: number, body: AnswerBody) {
  const d = db();
  const found = (await d.prepare("SELECT * FROM questions WHERE id = ?").get(questionId)) as { id: number; payee_id: number } | undefined;
  if (!found) throw new Error("Question not found");

  if (body.special === "skip" || body.special === "unskip") {
    await d.prepare("UPDATE questions SET status = ? WHERE id = ?").run(body.special === "skip" ? "skipped" : "open", found.id);
    return;
  }

  const cats = await categories();
  const catById = new Map(cats.map((c) => [c.id, c]));
  const catByName = new Map(cats.map((c) => [c.name, c]));
  const accounts = new Map(((await d.prepare("SELECT * FROM accounts").all()) as Account[]).map((a) => [a.id, a]));
  const pending = (await d.prepare("SELECT * FROM transactions WHERE payee_id = ? AND status != 'confirmed'").all(found.payee_id)) as Txn[];
  const payeeId = found.payee_id;
  const stmts: Q[] = [];
  const confirm = (catId: number, owner: Owner, flow: string, by: string, reason: string, id: number) =>
    stmts.push(q(CONFIRM, catId, owner, flow, by, reason, id));

  if (body.special === "own_account") {
    stmts.push(q("UPDATE payees SET kind = 'own_account', is_mixed = 0 WHERE id = ?", payeeId));
    const cat = catByName.get("Own-account transfer")!;
    for (const t of pending) confirm(cat.id, accounts.get(t.account_id)!.default_owner, "transfer_own", "user", "You marked this payee as your own account", t.id);
  } else {
    const cat = body.category_id ? catById.get(body.category_id) : undefined;
    if (!cat) throw new Error("Pick a category");

    if (body.special === "mixed" || body.special === "person") {
      const lim = body.special === "person" ? 0 : Math.max(0, Number(body.amount_limit) || 0);
      stmts.push(q("UPDATE payees SET is_mixed = 1, mixed_limit = ?, kind = CASE WHEN ? = 'person' THEN 'person' ELSE kind END WHERE id = ?", lim, body.special, payeeId));
      stmts.push(q("DELETE FROM rules WHERE payee_id = ?", payeeId));
      if (lim > 0) stmts.push(q("INSERT INTO rules (payee_id, category_id, owner, scope, amount_limit) VALUES (?,?,NULL,'below_amount',?)", payeeId, cat.id, lim));
      for (const t of pending) {
        if (body.special === "person" && body.owner) {
          confirm(cat.id, body.owner, deriveFlow(cat, t.direction), "user", "Your answer for these payments", t.id);
        } else if (t.amount < lim) {
          confirm(cat.id, accounts.get(t.account_id)!.default_owner, deriveFlow(cat, t.direction), "rule", "Mixed payee, below your limit, so it follows the account", t.id);
        } else {
          stmts.push(q("UPDATE transactions SET category_id=?, flow_type=?, status='needs_review', reason=? WHERE id=?",
            cat.id, deriveFlow(cat, t.direction), "Mixed payee: choose personal or business for this payment", t.id));
        }
      }
    } else {
      if (!body.owner) throw new Error("Pick personal or business");
      const rscope = body.scope || "always";
      const lim = Number(body.amount_limit) || 0;
      if (rscope !== "just_these") {
        if (rscope === "always") stmts.push(q("DELETE FROM rules WHERE payee_id = ?", payeeId));
        stmts.push(q("INSERT INTO rules (payee_id, category_id, owner, scope, amount_limit) VALUES (?,?,?,?,?)",
          payeeId, cat.id, body.owner, rscope, rscope === "always" ? null : lim));
        stmts.push(q("UPDATE payees SET is_mixed = 0 WHERE id = ? AND ? = 'always'", payeeId, rscope));
      }
      for (const t of pending) {
        const inScope =
          rscope === "always" || (rscope === "just_these" && t.status === "needs_review") ||
          (rscope === "above_amount" && t.amount >= lim) || (rscope === "below_amount" && t.amount < lim);
        if (!inScope) continue;
        confirm(cat.id, body.owner, deriveFlow(cat, t.direction), rscope === "just_these" ? "user" : "rule", rscope === "just_these" ? "Your answer for these payments" : "Your saved rule for this payee", t.id);
      }
    }
  }
  await d.batch(stmts);
  await syncQuestions();
}

/* ---------- manual edits ---------- */

export async function updateTransactions(ids: number[], patch: { category_id?: number; owner?: Owner; note?: string }) {
  const d = db();
  const cats = new Map((await categories()).map((c) => [c.id, c]));
  const found = new Map<number, Txn>();
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const rows = (await d.prepare(`SELECT * FROM transactions WHERE id IN (${chunk.map(() => "?").join(",")})`).all(...chunk)) as Txn[];
    rows.forEach((t) => found.set(t.id, t));
  }
  const stmts: Q[] = [];
  for (const id of ids) {
    const t = found.get(id);
    if (!t) continue;
    const categoryId = patch.category_id ?? t.category_id;
    const cat = categoryId ? cats.get(categoryId) : undefined;
    const owner = patch.owner ?? t.owner;
    const note = patch.note !== undefined ? patch.note : t.note;
    const touchedLabel = patch.category_id !== undefined || patch.owner !== undefined ? 1 : 0;
    stmts.push(q(
      `UPDATE transactions SET category_id=?, owner=?, note=?, flow_type=?,
         status = CASE WHEN ? THEN 'confirmed' ELSE status END,
         classified_by = CASE WHEN ? THEN 'user' ELSE classified_by END,
         confidence = CASE WHEN ? THEN 1 ELSE confidence END
       WHERE id=?`,
      categoryId, owner, note, cat ? deriveFlow(cat, t.direction) : t.flow_type, touchedLabel, touchedLabel, touchedLabel, id,
    ));
  }
  await d.batch(stmts);
  await syncQuestions();
}

export async function mergePayees(fromId: number, intoId: number) {
  if (fromId === intoId) return;
  await db().batch([
    q("UPDATE transactions SET payee_id = ? WHERE payee_id = ?", intoId, fromId),
    q("DELETE FROM rules WHERE payee_id = ?", fromId),
    q("DELETE FROM questions WHERE payee_id = ?", fromId),
    q("DELETE FROM payees WHERE id = ?", fromId),
  ]);
  await syncQuestions();
}
