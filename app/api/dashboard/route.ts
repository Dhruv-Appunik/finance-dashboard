import { db } from "@/lib/db";
import { handle, ok, txnFilter, TXN_FROM } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const d = db();
  const sp = new URL(req.url).searchParams;
  const f = txnFilter(sp);
  const and = f.sql ? `${f.sql} AND` : "WHERE";

  const totals = d.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN t.flow_type='spend' THEN t.amount END),0) spend,
       COALESCE(SUM(CASE WHEN t.flow_type='spend' AND t.owner='personal' THEN t.amount END),0) personal,
       COALESCE(SUM(CASE WHEN t.flow_type='spend' AND t.owner='business' THEN t.amount END),0) business,
       COALESCE(SUM(CASE WHEN t.flow_type='income' THEN t.amount END),0) income,
       COALESCE(SUM(CASE WHEN t.flow_type='refund' THEN t.amount END),0) refunds,
       COALESCE(SUM(CASE WHEN t.flow_type='spend' AND t.owner='business' AND a.default_owner='personal' THEN t.amount END),0) business_from_personal,
       COALESCE(SUM(CASE WHEN t.flow_type='spend' AND t.owner='personal' AND a.default_owner='business' THEN t.amount END),0) personal_from_business,
       COALESCE(SUM(CASE WHEN t.status='needs_review' THEN 1 END),0) needs_review,
       COUNT(*) txn_count
     ${TXN_FROM} ${f.sql}`,
  ).get(...f.args);

  const byCategory = d.prepare(
    `SELECT c.id, c.name,
       COALESCE(SUM(CASE WHEN t.owner='personal' THEN t.amount END),0) personal,
       COALESCE(SUM(CASE WHEN t.owner='business' THEN t.amount END),0) business,
       SUM(t.amount) total, COUNT(*) n
     ${TXN_FROM} ${and} t.flow_type='spend'
     GROUP BY c.id ORDER BY total DESC`,
  ).all(...f.args);

  // The trend ignores the month filter so the selected month can be read against the others.
  const trendParams = new URLSearchParams(sp);
  trendParams.delete("month");
  const tf = txnFilter(trendParams);
  const trend = d.prepare(
    `SELECT substr(t.txn_date,1,7) month,
       COALESCE(SUM(CASE WHEN t.owner='personal' THEN t.amount END),0) personal,
       COALESCE(SUM(CASE WHEN t.owner='business' THEN t.amount END),0) business
     ${TXN_FROM} ${tf.sql ? `${tf.sql} AND` : "WHERE"} t.flow_type='spend'
     GROUP BY month ORDER BY month`,
  ).all(...tf.args);

  const topPayees = d.prepare(
    `SELECT p.id, p.display_name name, SUM(t.amount) total, COUNT(*) n
     ${TXN_FROM} ${and} t.flow_type='spend'
     GROUP BY p.id ORDER BY total DESC LIMIT 8`,
  ).all(...f.args);

  return ok({ totals, byCategory, trend, topPayees });
});
