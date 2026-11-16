import { db, getSetting } from "@/lib/db";
import { handle, ok } from "@/lib/http";
import { hasClaude, hasJev } from "@/lib/llm";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const d = db();
  const [accounts, categories, months, open, count, ownNames, bar] = await Promise.all([
    d.prepare("SELECT id, name, bank, type, last4, default_owner FROM accounts ORDER BY type = 'credit_card', id").all(),
    d.prepare("SELECT id, name, grp, is_spend FROM categories ORDER BY sort, id").all(),
    d.prepare("SELECT DISTINCT substr(txn_date,1,7) m FROM transactions ORDER BY m DESC").all<{ m: string }>(),
    d.prepare("SELECT COUNT(*) c FROM questions WHERE status = 'open'").get<{ c: number }>(),
    d.prepare("SELECT COUNT(*) c FROM transactions").get<{ c: number }>(),
    getSetting("own_names", ""),
    getSetting("confidence_threshold", "0.85"),
  ]);
  return ok({
    accounts,
    categories,
    months: months.map((r) => r.m),
    open_questions: open!.c,
    transaction_count: count!.c,
    keys: { jev: hasJev(), claude: hasClaude() },
    settings: { own_names: ownNames, confidence_threshold: bar },
  });
});
