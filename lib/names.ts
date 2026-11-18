import { db, q } from "./db";
import { hasClaude, sonnetNames, type NameInput } from "./llm";

const CHUNK = 120;

/**
 * Writes AI names for transactions that have no name or whose name came from the AI.
 * A name you typed (name_source = 'user') is never read here and never overwritten.
 * Works through ids in order, CHUNK at a time, and returns where to continue from.
 */
export async function generateNames(opts: { ids?: number[]; after?: number }) {
  if (!hasClaude()) throw new Error("Naming with AI needs ANTHROPIC_API_KEY. Add it to .env.local and restart.");
  const d = db();
  const where = ["t.id > ?", "(t.display_name IS NULL OR t.name_source = 'ai')"];
  const args: number[] = [opts.after || 0];
  if (opts.ids?.length) { where.push(`t.id IN (${opts.ids.map(() => "?").join(",")})`); args.push(...opts.ids); }
  const rows = await d.prepare(
    `SELECT t.id, t.narration_raw narration, t.mode, t.direction, t.amount, p.display_name payee, p.upi_id
     FROM transactions t LEFT JOIN payees p ON p.id = t.payee_id
     WHERE ${where.join(" AND ")} ORDER BY t.id LIMIT ${CHUNK + 1}`,
  ).all<NameInput>(...args);
  const more = rows.length > CHUNK;
  const batch = rows.slice(0, CHUNK);
  const names = batch.length ? await sonnetNames(batch) : new Map<number, string>();
  // The extra condition protects a name you typed while the AI was working.
  await d.batch(
    batch.filter((r) => names.has(r.id)).map((r) =>
      q("UPDATE transactions SET display_name = ?, name_source = 'ai' WHERE id = ? AND (name_source IS NULL OR name_source = 'ai')", names.get(r.id), r.id)),
  );
  return { done: batch.length, named: names.size, next: more ? batch[batch.length - 1].id : null };
}
