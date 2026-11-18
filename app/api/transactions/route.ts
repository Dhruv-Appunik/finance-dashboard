import { db, q } from "@/lib/db";
import { fail, handle, ok, txnFilter, TXN_FROM } from "@/lib/http";
import { updateTransactions } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

const SELECT_TXN = `SELECT t.id, t.txn_date, t.amount, t.direction, t.narration_raw, t.mode, t.reference_no, t.note, t.display_name, t.name_source,
  t.category_id, c.name category, t.owner, t.flow_type, t.status, t.classified_by, t.confidence, t.reason,
  a.name account, a.default_owner, p.id payee_id, COALESCE(t.display_name, p.display_name) payee, p.display_name payee_original, p.upi_id`;

export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const f = txnFilter(sp);
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const size = 50;
  const d = db();
  const [summaryRow, rows] = await Promise.all([
    d.prepare(`SELECT COUNT(*) total, COALESCE(SUM(t.amount),0) amount ${TXN_FROM} ${f.sql}`).get<{ total: number; amount: number }>(...f.args),
    d.prepare(`${SELECT_TXN} ${TXN_FROM} ${f.sql} ORDER BY t.txn_date DESC, t.id DESC LIMIT ? OFFSET ?`).all(...f.args, size, (page - 1) * size),
  ]);
  const summary = summaryRow!;
  return ok({ rows, total: summary.total, amount: summary.amount, page, pages: Math.max(1, Math.ceil(summary.total / size)) });
});

export const PATCH = handle(async (req: Request) => {
  const body = await req.json();
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Boolean);
  if (!ids.length) return fail("No transactions selected");
  if (typeof body.display_name === "string") {
    // An empty name clears the override and goes back to the payee's own name.
    const name = body.display_name.trim().slice(0, 120) || null;
    // A name you type is locked against AI; clearing it hands the row back to the AI button.
    await db().batch(ids.map((id: number) => q("UPDATE transactions SET display_name = ?, name_source = ? WHERE id = ?", name, name ? "user" : null, id)));
    if (body.category_id === undefined && body.owner === undefined && typeof body.note !== "string") return ok({ updated: ids.length });
  }
  const patch: { category_id?: number; owner?: "personal" | "business"; note?: string } = {};
  if (body.category_id) patch.category_id = Number(body.category_id);
  if (body.owner === "personal" || body.owner === "business") patch.owner = body.owner;
  if (typeof body.note === "string") patch.note = body.note;
  await updateTransactions(ids, patch);
  return ok({ updated: ids.length });
});
