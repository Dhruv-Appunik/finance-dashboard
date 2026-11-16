import { db } from "@/lib/db";
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
