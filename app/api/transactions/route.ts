import { db } from "@/lib/db";
import { fail, handle, ok, txnFilter, TXN_FROM } from "@/lib/http";
import { updateTransactions } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

const SELECT_TXN = `SELECT t.id, t.txn_date, t.amount, t.direction, t.narration_raw, t.mode, t.reference_no, t.note,
  t.category_id, c.name category, t.owner, t.flow_type, t.status, t.classified_by, t.confidence, t.reason,
  a.name account, a.default_owner, p.id payee_id, p.display_name payee, p.upi_id`;

export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const f = txnFilter(sp);
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const size = 50;
  const d = db();
  const summary = d.prepare(`SELECT COUNT(*) total, COALESCE(SUM(t.amount),0) amount ${TXN_FROM} ${f.sql}`).get(...f.args) as { total: number; amount: number };
  const rows = d.prepare(`${SELECT_TXN} ${TXN_FROM} ${f.sql} ORDER BY t.txn_date DESC, t.id DESC LIMIT ? OFFSET ?`).all(...f.args, size, (page - 1) * size);
  return ok({ rows, total: summary.total, amount: summary.amount, page, pages: Math.max(1, Math.ceil(summary.total / size)) });
});

export const PATCH = handle(async (req: Request) => {
  const body = await req.json();
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Boolean);
  if (!ids.length) return fail("No transactions selected");
  const patch: { category_id?: number; owner?: "personal" | "business"; note?: string } = {};
  if (body.category_id) patch.category_id = Number(body.category_id);
  if (body.owner === "personal" || body.owner === "business") patch.owner = body.owner;
  if (typeof body.note === "string") patch.note = body.note;
  updateTransactions(ids, patch);
  return ok({ updated: ids.length });
});
