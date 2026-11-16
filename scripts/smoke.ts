// Loads the sample statements into a scratch database and prints what the pipeline decided.
import fs from "fs";
import path from "path";
process.env.DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".smoke-data");
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });

async function main() {
  const { db, setSetting } = await import("../lib/db");
  const { ingestStatement, answerQuestion } = await import("../lib/pipeline");
  const d = db();
  setSetting("own_names", "Demo Owner");
  const acc = (name: string) => (d.prepare("SELECT id FROM accounts WHERE name = ?").get(name) as { id: number }).id;
  const files: [string, string][] = [
    ["HDFC Savings", "hdfc-savings-sample.csv"],
    ["ICICI Current", "icici-current-sample.csv"],
    ["HDFC Credit Card 1", "hdfc-card-sample.csv"],
  ];
  for (const [a, f] of files) {
    const r = await ingestStatement(acc(a), f, fs.readFileSync(path.join("samples", f)));
    console.log(a, JSON.stringify(r));
  }
  const again = await ingestStatement(acc("HDFC Savings"), "hdfc-savings-sample.csv", fs.readFileSync("samples/hdfc-savings-sample.csv"));
  console.log("re-upload", JSON.stringify(again));
  const rows = d.prepare(
    `SELECT t.txn_date d, a.name acc, t.direction dir, t.amount amt, t.mode, p.display_name payee, p.upi_id upi, t.note, c.name cat, t.owner, t.flow_type flow, t.status, t.classified_by by
     FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN payees p ON p.id=t.payee_id LEFT JOIN categories c ON c.id=t.category_id ORDER BY a.id, t.txn_date, t.id`,
  ).all();
  console.table(rows);
  console.log("open questions", d.prepare("SELECT q.id, p.display_name FROM questions q JOIN payees p ON p.id=q.payee_id WHERE q.status='open'").all());
  if (process.argv.includes("--answer")) {
    const q = d.prepare("SELECT q.id FROM questions q JOIN payees p ON p.id=q.payee_id WHERE p.display_name LIKE 'PIXEL%'").get() as { id: number };
    const cat = d.prepare("SELECT id FROM categories WHERE name='Marketing and ads'").get() as { id: number };
    answerQuestion(q.id, { category_id: cat.id, owner: "business", scope: "always" });
    console.table(d.prepare("SELECT t.amount, c.name cat, t.owner, t.status, t.classified_by FROM transactions t JOIN payees p ON p.id=t.payee_id JOIN categories c ON c.id=t.category_id WHERE p.display_name LIKE 'PIXEL%'").all());
    console.log("rules", d.prepare("SELECT * FROM rules").all());
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
