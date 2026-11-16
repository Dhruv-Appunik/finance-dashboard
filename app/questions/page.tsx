"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, Input, Label, Notice, Select } from "@/components/ui/form";
import { api, notifyChanged, useData, type CategoryRow, type Meta, type Owner } from "@/lib/client";
import { cn, dateLabel, formatINR } from "@/lib/utils";

type QTxn = {
  id: number; txn_date: string; amount: number; direction: "debit" | "credit"; narration_raw: string; note: string | null;
  category_id: number | null; owner: Owner | null; reason: string | null; account: string; default_owner: Owner;
};
type Question = {
  id: number; status: string; payee_id: number; display_name: string; upi_id: string | null; kind: string;
  is_mixed: number; mixed_limit: number | null; txn_count: number; total_amount: number; first_date: string; last_date: string;
  transactions: QTxn[];
};
type QData = { total: number; skipped: number; questions: Question[] };

function CategorySelect({ value, onChange, categories, id }: { value: string; onChange: (v: string) => void; categories: CategoryRow[]; id?: string }) {
  const groups = [...new Set(categories.map((c) => c.grp))];
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a category…</option>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {categories.filter((c) => c.grp === g).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      ))}
    </Select>
  );
}

function OwnerButtons({ value, onChange, size = "default" }: { value: Owner | ""; onChange: (o: Owner) => void; size?: "default" | "sm" }) {
  return (
    <div className="flex gap-2" role="group" aria-label="Owner">
      {(["personal", "business"] as const).map((o) => (
        <Button key={o} type="button" size={size} variant={value === o ? "default" : "outline"} aria-pressed={value === o} onClick={() => onChange(o)} className="flex-1">
          <span className={cn("h-2 w-2 rounded-full", o === "personal" ? "bg-personal" : "bg-business")} aria-hidden />
          {o === "personal" ? "Personal" : "Business"}
        </Button>
      ))}
    </div>
  );
}

function QuestionCard({ q, categories, onDone }: { q: Question; categories: CategoryRow[]; onDone: () => void }) {
  const first = q.transactions[0];
  const [category, setCategory] = useState(first?.category_id ? String(first.category_id) : "");
  const [owner, setOwner] = useState<Owner | "">(first?.owner || "");
  const [scope, setScope] = useState("always");
  const [limit, setLimit] = useState("2000");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uncategorised = categories.find((c) => c.name === "Uncategorised")?.id;
  const suggestionIsReal = first?.category_id && first.category_id !== uncategorised;

  async function send(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      await api("/api/questions", { json: { id: q.id, ...body } });
      notifyChanged();
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function setTxnOwner(id: number, o: Owner) {
    setBusy(true); setError(null);
    try {
      await api("/api/transactions", { method: "PATCH", json: { ids: [id], owner: o, category_id: category ? Number(category) : undefined } });
      notifyChanged();
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const needsLimit = scope === "above_amount" || scope === "below_amount" || scope === "mixed";
  const save = () => {
    if (scope === "mixed") return send({ special: "mixed", category_id: Number(category), amount_limit: Number(limit) });
    if (scope === "person") return send({ special: "person", category_id: Number(category), owner });
    return send({ category_id: Number(category), owner, scope, amount_limit: Number(limit) });
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{q.display_name}</h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {q.upi_id && <span className="break-all font-mono">{q.upi_id}</span>}
            {q.is_mixed ? <Badge>Mixed payee</Badge> : null}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tabular">{formatINR(q.total_amount)}</div>
          <div className="text-xs text-muted-foreground">
            {q.txn_count} payment{q.txn_count === 1 ? "" : "s"} · {q.first_date === q.last_date ? dateLabel(q.first_date) : `${dateLabel(q.first_date)} to ${dateLabel(q.last_date)}`}
          </div>
        </div>
      </div>

      <ul className="mt-3 flex flex-col rounded-md border text-sm">
        {q.transactions.map((t) => (
          <li key={t.id} className="border-t px-3 py-2 first:border-t-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-muted-foreground">{dateLabel(t.txn_date)} · {t.account}</span>
              <span className="font-medium tabular">{t.direction === "credit" ? "+" : ""}{formatINR(t.amount, true)}</span>
            </div>
            <div className="mt-0.5 break-all text-xs text-muted-foreground">{t.note ? <span className="text-foreground">“{t.note}” · </span> : null}{t.narration_raw}</div>
            {q.is_mixed ? (
              <div className="mt-2 max-w-xs"><OwnerButtons size="sm" value="" onChange={(o) => setTxnOwner(t.id, o)} /></div>
            ) : null}
          </li>
        ))}
        {q.txn_count > q.transactions.length && <li className="border-t px-3 py-1.5 text-xs text-muted-foreground">and {q.txn_count - q.transactions.length} more</li>}
      </ul>

      {first?.reason && <p className="mt-2 text-xs text-muted-foreground">{suggestionIsReal ? "Best guess is pre-selected. " : ""}{first.reason}</p>}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor={`cat-${q.id}`}>Category</Label><CategorySelect id={`cat-${q.id}`} value={category} onChange={setCategory} categories={categories} /></div>
        {!q.is_mixed && scope !== "mixed" && (
          <div><Label>Whose expense</Label><OwnerButtons value={owner} onChange={setOwner} /></div>
        )}
        {!q.is_mixed && (
          <>
            <div>
              <Label htmlFor={`scope-${q.id}`}>Apply this answer</Label>
              <Select id={`scope-${q.id}`} value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="always">Always for this payee</option>
                <option value="above_amount">Only at or above an amount</option>
                <option value="below_amount">Only below an amount</option>
                <option value="just_these">Just these payments</option>
                <option value="mixed">Mixed: ask me above an amount</option>
                <option value="person">A person: ask me every time</option>
              </Select>
            </div>
            {needsLimit && (
              <div><Label htmlFor={`lim-${q.id}`}>Amount (₹)</Label><Input id={`lim-${q.id}`} type="number" min="0" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} /></div>
            )}
          </>
        )}
      </div>
      {scope === "mixed" && !q.is_mixed && <p className="mt-2 text-xs text-muted-foreground">Payments below the amount follow the account they were paid from. Larger ones are asked one by one.</p>}

      {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}

      <div className="mt-4 flex flex-wrap gap-2">
        {!q.is_mixed && <Button onClick={save} disabled={busy || !category || (scope !== "mixed" && !owner)}>Save answer</Button>}
        {!q.is_mixed && <Button variant="outline" disabled={busy} onClick={() => send({ special: "own_account" })}>This is my own account</Button>}
        <Button variant="ghost" disabled={busy} onClick={() => send({ special: q.status === "skipped" ? "unskip" : "skip" })}>{q.status === "skipped" ? "Move back to open" : "Skip for now"}</Button>
      </div>
    </Card>
  );
}

export default function QuestionsPage() {
  const [showSkipped, setShowSkipped] = useState(false);
  const { data: meta } = useData<Meta>("/api/meta");
  const { data, error, reload } = useData<QData>(`/api/questions?status=${showSkipped ? "skipped" : "open"}`);

  return (
    <>
      <PageHeader title="Questions" description="One card per payee, largest amount first. Each answer is remembered for future uploads.">
        {data && (data.skipped > 0 || showSkipped) && (
          <Button variant="outline" size="sm" onClick={() => setShowSkipped((s) => !s)}>{showSkipped ? "Show open" : `Show skipped (${data.skipped})`}</Button>
        )}
      </PageHeader>
      {error && <Notice tone="error">{error}</Notice>}
      {data && meta && (
        <div className="flex flex-col gap-4">
          {data.questions.length === 0 && (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              {showSkipped ? "No skipped questions." : "Nothing to answer. Every transaction has a category and an owner."}
            </Card>
          )}
          {data.questions.map((q) => <QuestionCard key={`${q.id}-${q.txn_count}`} q={q} categories={meta.categories} onDone={reload} />)}
          {data.total > data.questions.length && <p className="text-center text-xs text-muted-foreground">Showing the first {data.questions.length} of {data.total}.</p>}
        </div>
      )}
    </>
  );
}
