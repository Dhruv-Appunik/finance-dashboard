import Papa from "papaparse";
import { db } from "@/lib/db";
import { handle, txnFilter, TXN_FROM } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const f = txnFilter(new URL(req.url).searchParams);
  const rows = await db().prepare(
    `SELECT t.txn_date date, a.name account, t.direction, t.amount, p.display_name payee, p.upi_id, c.name category, t.owner,
       t.flow_type, t.mode, t.reference_no reference, t.status, t.classified_by, t.note, t.narration_raw narration
     ${TXN_FROM} ${f.sql} ORDER BY t.txn_date, t.id`,
  ).all(...f.args);
  return new Response(Papa.unparse(rows as object[]), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="transactions.csv"' },
  });
});
