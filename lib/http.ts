import { NextResponse } from "next/server";

export const ok = (data: unknown) => NextResponse.json(data);
export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

/** Wraps a handler so thrown errors come back as JSON instead of an HTML error page. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response> | Response) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      console.error(e);
      return fail((e as Error).message || "Something went wrong", 500);
    }
  };
}

/** Builds the WHERE clause shared by the dashboard, the transaction list and the export. */
export function txnFilter(sp: URLSearchParams) {
  const where: string[] = [];
  const args: (string | number)[] = [];
  const month = sp.get("month");
  if (month && month !== "all") { where.push("substr(t.txn_date,1,7) = ?"); args.push(month); }
  const account = sp.get("account");
  if (account && account !== "all") { where.push("t.account_id = ?"); args.push(Number(account)); }
  const owner = sp.get("owner");
  if (owner && owner !== "all") { where.push("t.owner = ?"); args.push(owner); }
  const category = sp.get("category");
  if (category && category !== "all") { where.push("t.category_id = ?"); args.push(Number(category)); }
  const status = sp.get("status");
  if (status && status !== "all") { where.push("t.status = ?"); args.push(status); }
  const flow = sp.get("flow");
  if (flow && flow !== "all") { where.push("t.flow_type = ?"); args.push(flow); }
  const payee = sp.get("payee");
  if (payee) { where.push("t.payee_id = ?"); args.push(Number(payee)); }
  const cross = sp.get("cross");
  if (cross === "business_from_personal") where.push("t.flow_type = 'spend' AND t.owner = 'business' AND a.default_owner = 'personal'");
  if (cross === "personal_from_business") where.push("t.flow_type = 'spend' AND t.owner = 'personal' AND a.default_owner = 'business'");
  const q = sp.get("q");
  if (q) {
    where.push("(t.narration_raw LIKE ? OR p.display_name LIKE ? OR p.upi_id LIKE ? OR t.note LIKE ? OR t.display_name LIKE ?)");
    const like = `%${q}%`;
    args.push(like, like, like, like, like);
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", args };
}

export const TXN_FROM = `FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN payees p ON p.id = t.payee_id
  LEFT JOIN categories c ON c.id = t.category_id`;
