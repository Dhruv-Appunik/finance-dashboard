import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/http";
import { answerQuestion, type AnswerBody } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const d = db();
  const status = new URL(req.url).searchParams.get("status") === "skipped" ? "skipped" : "open";
  const questions = (await d.prepare(
    `SELECT q.id, q.status, p.id payee_id, p.display_name, p.upi_id, p.kind, p.is_mixed, p.mixed_limit,
       COUNT(t.id) txn_count, COALESCE(SUM(t.amount),0) total_amount, MIN(t.txn_date) first_date, MAX(t.txn_date) last_date
     FROM questions q JOIN payees p ON p.id = q.payee_id
     JOIN transactions t ON t.payee_id = p.id AND t.status = 'needs_review'
     WHERE q.status = ?
     GROUP BY q.id ORDER BY total_amount DESC LIMIT 100`,
  ).all(status)) as { id: number; payee_id: number }[];

  const recent = d.prepare(
    `SELECT t.id, t.txn_date, t.amount, t.direction, t.narration_raw, t.note, t.category_id, t.owner, t.reason, t.confidence, a.name account, a.default_owner
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE t.payee_id = ? AND t.status = 'needs_review' ORDER BY t.txn_date DESC, t.id DESC LIMIT 6`,
  );
  const [total, skipped, withTxns] = await Promise.all([
    d.prepare("SELECT COUNT(*) c FROM questions WHERE status = ?").get<{ c: number }>(status),
    d.prepare("SELECT COUNT(*) c FROM questions WHERE status = 'skipped'").get<{ c: number }>(),
    Promise.all(questions.map(async (q) => ({ ...q, transactions: await recent.all(q.payee_id) }))),
  ]);
  return ok({ total: total!.c, skipped: skipped!.c, questions: withTxns });
});

export const POST = handle(async (req: Request) => {
  const body = (await req.json()) as AnswerBody & { id?: number };
  if (!body.id) return fail("Missing question id");
  await answerQuestion(Number(body.id), body);
  return ok({ done: true });
});
