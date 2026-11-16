import { db, getSetting } from "@/lib/db";
import { handle, ok } from "@/lib/http";
import { hasClaude, hasJev } from "@/lib/llm";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const d = db();
  return ok({
    accounts: d.prepare("SELECT id, name, bank, type, last4, default_owner FROM accounts ORDER BY type = 'credit_card', id").all(),
    categories: d.prepare("SELECT id, name, grp, is_spend FROM categories ORDER BY sort, id").all(),
    months: (d.prepare("SELECT DISTINCT substr(txn_date,1,7) m FROM transactions ORDER BY m DESC").all() as { m: string }[]).map((r) => r.m),
    open_questions: (d.prepare("SELECT COUNT(*) c FROM questions WHERE status = 'open'").get() as { c: number }).c,
    transaction_count: (d.prepare("SELECT COUNT(*) c FROM transactions").get() as { c: number }).c,
    keys: { jev: hasJev(), claude: hasClaude() },
    settings: {
      own_names: getSetting("own_names", ""),
      confidence_threshold: getSetting("confidence_threshold", "0.85"),
    },
  });
});
