import { db, q } from "@/lib/db";
import { fail, handle, ok } from "@/lib/http";
import { ingestStatement } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
// Classifying a large statement calls the models; give the function room on hosts that cap run time.
export const maxDuration = 300;

export const GET = handle(async () => {
  const d = db();
  const [coverage, uploads] = await Promise.all([
    d.prepare("SELECT account_id, substr(txn_date,1,7) month, COUNT(*) n FROM transactions GROUP BY account_id, month").all(),
    d.prepare(
      `SELECT u.id, u.file_name, u.period_start, u.period_end, u.row_count, u.added_count, u.duplicate_count, u.created_at, a.name account
       FROM uploads u JOIN accounts a ON a.id = u.account_id ORDER BY u.id DESC LIMIT 30`,
    ).all(),
  ]);
  return ok({ coverage, uploads });
});

/** Removes an uploaded statement and every transaction that came in with it. */
export const DELETE = handle(async (req: Request) => {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return fail("Missing upload id.");
  const d = db();
  const upload = await d.prepare("SELECT id FROM uploads WHERE id = ?").get(id);
  if (!upload) return fail("Upload not found.", 404);
  const { c: removed } = (await d.prepare("SELECT COUNT(*) c FROM transactions WHERE upload_id = ?").get<{ c: number }>(id))!;
  const mine = "(SELECT id FROM transactions WHERE upload_id = ?)";
  await d.batch([
    // A transfer paired with a row from this upload loses its other half: send it back for review.
    q(`UPDATE transactions SET status = 'needs_review', category_id = NULL, flow_type = NULL, confidence = NULL, classified_by = NULL, reason = NULL
       WHERE upload_id IS NOT ? AND linked_txn_id IN ${mine} AND status = 'classified' AND flow_type = 'transfer_own'`, id, id),
    q(`UPDATE transactions SET linked_txn_id = NULL WHERE upload_id IS NOT ? AND linked_txn_id IN ${mine}`, id, id),
    q("DELETE FROM transactions WHERE upload_id = ?", id),
    q("DELETE FROM uploads WHERE id = ?", id),
    // Questions about payees that no longer have any transaction have nothing left to ask about.
    q(`DELETE FROM questions WHERE status IN ('open','skipped')
       AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.payee_id = questions.payee_id)`),
  ]);
  return ok({ deleted: removed });
});

export const POST = handle(async (req: Request) => {
  const form = await req.formData();
  const accountId = Number(form.get("account_id"));
  const file = form.get("file");
  if (!accountId) return fail("Choose the account this statement belongs to.");
  if (!(file instanceof File)) return fail("Attach a statement file.");
  if (file.size > 25 * 1024 * 1024) return fail("The file is larger than 25 MB.");
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await ingestStatement(accountId, file.name, buffer);
  return ok(result);
});
