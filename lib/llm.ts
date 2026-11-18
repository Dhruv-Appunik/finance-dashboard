import { z } from "zod";
import type { Cell, ColumnMap } from "./parse/statement";

export type PayeeContext = {
  payee_name: string;
  upi_id: string | null;
  payee_kind: string;
  direction: "debit" | "credit";
  payment_modes: string[];
  transaction_count: number;
  amounts: number[];
  notes: string[];
  sample_narrations: string[];
  paid_from_accounts: { name: string; default_owner: string }[];
};

export type Verdict = { category: string; owner: "personal" | "business"; confidence: number; reason: string; by: "jev" | "sonnet" };

export const hasJev = () => !!process.env.TYPESAFE_API_KEY;
export const hasClaude = () => !!process.env.ANTHROPIC_API_KEY;

const JEV_URL = (process.env.TYPESAFE_BASE_URL || "https://api.typesafe.ai").replace(/\/+$/, "") + "/v1/systemone";
const JEV_MODEL = process.env.TYPESAFE_MODEL || "jev-latest";
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const NAMING_MODEL = process.env.ANTHROPIC_NAMING_MODEL || "claude-haiku-5-5";

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs = 45000) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1) ** 2));
      continue;
    }
    throw new Error(`${url} responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  throw new Error("unreachable");
}

const OWNER_CRITERIA = {
  personal: "A personal or household expense of the user, or personal income",
  business: "An expense or income of the user's business (a software and AI services company)",
};

const JevChoice = z.object({ type: z.literal("choice"), choice: z.string(), confidence: z.number() });
const JevResponse = z.object({ answers: z.record(z.string(), z.unknown()) });

/** One Jev request per payee: two closed-set questions, category and owner. */
export async function jevClassify(ctx: PayeeContext, categories: { name: string; hint: string }[]): Promise<Verdict> {
  const criteria: Record<string, string> = {};
  for (const c of categories) criteria[c.name] = c.hint;
  const json = await postJson(
    JEV_URL,
    { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}` },
    {
      model: JEV_MODEL,
      state: ctx,
      questions: {
        category: {
          type: "choice",
          instructions:
            "Which category best describes what these Indian bank or card transactions to this payee were for. The UPI handle suffix (@ybl, @okaxis) says nothing about the category.",
          criteria,
        },
        owner: {
          type: "choice",
          instructions:
            "Whose transaction this is. Do not use the UPI handle suffix. The paying account's default owner is only a weak hint, because this user often pays business costs from personal accounts and personal costs from business accounts.",
          criteria: OWNER_CRITERIA,
        },
      },
    },
  );
  const parsed = JevResponse.parse(json);
  const cat = JevChoice.parse(parsed.answers.category);
  const own = JevChoice.parse(parsed.answers.owner);
  if (!criteria[cat.choice]) throw new Error(`Jev returned a category that was not offered: ${cat.choice}`);
  if (own.choice !== "personal" && own.choice !== "business") throw new Error(`Jev returned an unknown owner: ${own.choice}`);
  return {
    category: cat.choice,
    owner: own.choice,
    confidence: Math.min(cat.confidence, own.confidence),
    reason: `Jev: category ${(cat.confidence * 100).toFixed(0)}%, owner ${(own.confidence * 100).toFixed(0)}%`,
    by: "jev",
  };
}

const CLASSIFY_SYSTEM = `You classify Indian bank and credit card transactions for one user who runs a business (software and AI services) and also has personal spending. Each item is one payee with a summary of the transactions to or from that payee.

For each payee return:
- category: one name from the category list provided
- owner: "personal" or "business"
- confidence: 0 to 1, your real certainty that BOTH category and owner are right
- reason: one short sentence

Rules:
1. Do not infer personal vs business from the UPI handle suffix. Individuals and businesses both use @ybl, @okaxis and similar.
2. The paying account's default owner is a weak hint. This user often pays business costs from savings and personal costs from the business account.
3. Use the payee name, narration notes, amounts and frequency.
4. Payments to a named individual with no merchant signal get confidence below 0.6.
5. If category is clear but owner is not, set confidence below 0.85 and say so in the reason.
6. Never invent a category. Use "Uncategorised" with low confidence when unsure.

Return only a JSON array, one object per input payee, in the same order, each with the input id.`;

const ClaudeItem = z.object({
  id: z.union([z.string(), z.number()]),
  category: z.string(),
  owner: z.enum(["personal", "business"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().default(""),
});

async function claude(system: string, user: string, maxTokens = 8000, model = CLAUDE_MODEL): Promise<string> {
  const json = await postJson(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    { model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] },
    120000,
  );
  const text = (json.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  return text;
}

function extractJson(text: string): unknown {
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
  if (start < 0 || end < start) throw new Error("No JSON in model response");
  return JSON.parse(text.slice(start, end + 1));
}

/** Sonnet handles the payees Jev was unsure about, in batches. */
export async function sonnetClassify(
  items: { id: number; ctx: PayeeContext }[],
  categories: { name: string; hint: string }[],
  exampleRules: string[],
): Promise<Map<number, Verdict>> {
  const out = new Map<number, Verdict>();
  const names = new Set(categories.map((c) => c.name));
  for (let i = 0; i < items.length; i += 40) {
    const batch = items.slice(i, i + 40);
    const user = [
      `Categories: ${categories.map((c) => `${c.name} (${c.hint})`).join("; ")}`,
      exampleRules.length ? `Examples of this user's confirmed rules: ${exampleRules.join("; ")}` : "",
      `Payees:\n${JSON.stringify(batch.map((b) => ({ id: b.id, ...b.ctx })))}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const parsed = z.array(ClaudeItem).parse(extractJson(await claude(CLASSIFY_SYSTEM, user)));
    for (const item of parsed) {
      if (!names.has(item.category)) continue;
      out.set(Number(item.id), { category: item.category, owner: item.owner, confidence: item.confidence, reason: item.reason, by: "sonnet" });
    }
  }
  return out;
}

const MapSchema = z.object({
  headerRow: z.number().int().min(0),
  date: z.number().int().min(0),
  narration: z.number().int().min(0),
  debit: z.number().int().nullable().default(null),
  credit: z.number().int().nullable().default(null),
  amount: z.number().int().nullable().default(null),
  drcr: z.number().int().nullable().default(null),
  balance: z.number().int().nullable().default(null),
  reference: z.number().int().nullable().default(null),
});

/** Fallback for statement layouts the built-in header detection cannot read. */
export async function sonnetColumnMap(rows: Cell[][]): Promise<ColumnMap> {
  const sample = rows.slice(0, 30).map((r) => (r || []).map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c)));
  const text = await claude(
    "You read bank and credit card statement exports. Reply with JSON only.",
    `Here are the first rows of a statement export as a JSON array of rows. Identify the 0-based index of the header row and the 0-based column index for: date (transaction date), narration, debit (withdrawal amount), credit (deposit amount), amount (only if there is a single amount column), drcr (a debit/credit indicator column), balance, reference. Use null for columns that do not exist.\n\nReply as {"headerRow":n,"date":n,"narration":n,"debit":n|null,"credit":n|null,"amount":n|null,"drcr":n|null,"balance":n|null,"reference":n|null}\n\n${JSON.stringify(sample)}`,
    1000,
  );
  return MapSchema.parse(extractJson(text));
}

const NAME_SYSTEM = `You write short, clean display names for Indian bank and credit card transactions, so a statement reads at a glance.

For each transaction return a name of at most 4 words (40 characters):
- A merchant or person name in normal Title Case, e.g. "Swiggy", "Ramesh Kumar", "HPCL Petrol Pump", "Airtel Broadband".
- Remove UPI IDs, handles, reference numbers, dates, bank codes and noise like "UPI-", "POS", "NEFT", "IMPS".
- Use the payee name given when it is already clean. Fix obvious truncation or casing.
- When there is no merchant, describe it plainly: "ATM Withdrawal", "Interest Credit", "Card Bill Payment", "Bank Charges", "Salary Credit".
- Never invent a business that the narration does not support. If unsure, use the cleaned payee or a plain description.

Return only a JSON array of {"id": <input id>, "name": "<name>"}, one per input, in the same order.`;

const NameItem = z.object({ id: z.union([z.string(), z.number()]), name: z.string() });

export type NameInput = { id: number; narration: string; payee: string | null; upi_id: string | null; mode: string | null; direction: string; amount: number };

/** Haiku writes a short display name for each transaction, in batches. */
export async function sonnetNames(items: NameInput[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (let i = 0; i < items.length; i += 40) {
    const batch = items.slice(i, i + 40);
    const parsed = z.array(NameItem).parse(extractJson(await claude(NAME_SYSTEM, `Transactions:\n${JSON.stringify(batch)}`, 4000, NAMING_MODEL)));
    for (const it of parsed) {
      const name = it.name.replace(/\s+/g, " ").trim().slice(0, 60);
      if (name) out.set(Number(it.id), name);
    }
  }
  return out;
}
