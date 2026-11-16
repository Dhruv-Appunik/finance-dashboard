import { db, q, setSetting } from "@/lib/db";
import { fail, handle, ok } from "@/lib/http";
import { classify, mergePayees } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Rules and payees for the settings screen. */
export const GET = handle(async (req: Request) => {
  const d = db();
  const q = new URL(req.url).searchParams.get("q") || "";
  const [rules, payees] = await Promise.all([
    d.prepare(
      `SELECT r.id, r.scope, r.amount_limit, r.owner, r.created_at, p.display_name payee, p.upi_id, c.name category
       FROM rules r JOIN payees p ON p.id = r.payee_id JOIN categories c ON c.id = r.category_id ORDER BY r.id DESC`,
    ).all(),
    d.prepare(
      `SELECT p.id, p.display_name, p.upi_id, p.kind, p.is_mixed, p.mixed_limit, COUNT(t.id) txn_count, COALESCE(SUM(t.amount),0) total
       FROM payees p LEFT JOIN transactions t ON t.payee_id = p.id
       WHERE p.display_name LIKE ? OR p.upi_id LIKE ?
       GROUP BY p.id ORDER BY total DESC LIMIT 60`,
    ).all(`%${q}%`, `%${q}%`),
  ]);
  return ok({ rules, payees });
});

type Action =
  | { action: "save_settings"; own_names?: string; confidence_threshold?: string }
  | { action: "reclassify" }
  | { action: "delete_rule"; id: number }
  | { action: "rename_payee"; id: number; name: string }
  | { action: "merge_payee"; from: number; into: number }
  | { action: "set_payee_kind"; id: number; kind: string }
  | { action: "save_account"; id?: number; name: string; bank: string; type: string; last4?: string; default_owner: string }
  | { action: "delete_account"; id: number }
  | { action: "add_category"; name: string; grp?: string };

export const POST = handle(async (req: Request) => {
  const b = (await req.json()) as Action;
  const d = db();
  switch (b.action) {
    case "save_settings": {
      if (typeof b.own_names === "string") await setSetting("own_names", b.own_names);
      if (b.confidence_threshold) {
        const v = Number(b.confidence_threshold);
        if (!(v > 0 && v <= 1)) return fail("The confidence bar must be between 0 and 1.");
        await setSetting("confidence_threshold", String(v));
      }
      return ok({ done: true });
    }
    case "reclassify":
      return ok(await classify("unconfirmed"));
    case "delete_rule":
      await d.prepare("DELETE FROM rules WHERE id = ?").run(b.id);
      return ok({ done: true });
    case "rename_payee":
      if (!b.name?.trim()) return fail("Name cannot be empty");
      await d.prepare("UPDATE payees SET display_name = ? WHERE id = ?").run(b.name.trim(), b.id);
      return ok({ done: true });
    case "merge_payee":
      await mergePayees(Number(b.from), Number(b.into));
      return ok({ done: true });
    case "set_payee_kind":
      if (!["merchant", "person", "own_account", "unknown"].includes(b.kind)) return fail("Unknown kind");
      await d.prepare("UPDATE payees SET kind = ? WHERE id = ?").run(b.kind, b.id);
      return ok({ done: true });
    case "save_account": {
      if (!b.name?.trim() || !b.bank?.trim()) return fail("Name and bank are required");
      if (!["savings", "current", "credit_card"].includes(b.type)) return fail("Unknown account type");
      if (!["personal", "business"].includes(b.default_owner)) return fail("Unknown owner");
      const last4 = (b.last4 || "").replace(/\D/g, "").slice(-4) || null;
      if (b.id) await d.prepare("UPDATE accounts SET name=?, bank=?, type=?, last4=?, default_owner=? WHERE id=?").run(b.name.trim(), b.bank.trim(), b.type, last4, b.default_owner, b.id);
      else await d.prepare("INSERT INTO accounts (name, bank, type, last4, default_owner) VALUES (?,?,?,?,?)").run(b.name.trim(), b.bank.trim(), b.type, last4, b.default_owner);
      return ok({ done: true });
    }
    case "delete_account": {
      const n = (await d.prepare("SELECT COUNT(*) c FROM transactions WHERE account_id = ?").get<{ c: number }>(b.id))!.c;
      if (n > 0) return fail("This account has transactions, so it cannot be deleted.");
      await d.batch([q("DELETE FROM uploads WHERE account_id = ?", b.id), q("DELETE FROM accounts WHERE id = ?", b.id)]);
      return ok({ done: true });
    }
    case "add_category": {
      if (!b.name?.trim()) return fail("Name cannot be empty");
      await d.prepare("INSERT OR IGNORE INTO categories (name, grp, is_spend, sort) VALUES (?,?,1,999)").run(b.name.trim(), b.grp || "Custom");
      return ok({ done: true });
    }
  }
  return fail("Unknown action");
});
