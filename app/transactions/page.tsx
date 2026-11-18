"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { PageHeader } from "@/components/shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, Input, Label, Notice, Select } from "@/components/ui/form";
import { api, notifyChanged, useData, type Meta, type Owner } from "@/lib/client";
import { cn, dateLabel, formatINR, monthLabel } from "@/lib/utils";

type Row = {
  id: number; txn_date: string; amount: number; direction: "debit" | "credit"; narration_raw: string; mode: string | null;
  note: string | null; category_id: number | null; category: string | null; owner: Owner | null; flow_type: string | null;
  status: "classified" | "needs_review" | "confirmed"; classified_by: string | null; reason: string | null;
  account: string; default_owner: Owner; payee: string | null; payee_original: string | null; display_name: string | null; upi_id: string | null;
};
type List = { rows: Row[]; total: number; amount: number; page: number; pages: number };

const FILTERS = ["q", "month", "account", "category", "owner", "status", "flow", "cross", "payee"] as const;
const SOURCE: Record<string, string> = {
  rule: "Your rule", user: "You", merchant_list: "Known merchant", structural: "Automatic", jev: "Jev", llm: "Sonnet", pending: "Unsorted",
};
const FLOW: Record<string, string> = {
  spend: "Spend", income: "Money in", transfer_own: "Own transfer", card_bill_payment: "Card bill", refund: "Refund", cash_withdrawal: "Cash", investment: "Investment",
};

function Transactions() {
  const router = useRouter();
  const sp = useSearchParams();
  const { data: meta } = useData<Meta>("/api/meta");
  const [search, setSearch] = useState(sp.get("q") || "");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkOwner, setBulkOwner] = useState("");
  const [bulkName, setBulkName] = useState("");
  const [editing, setEditing] = useState<{ id: number; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    FILTERS.forEach((k) => { const v = sp.get(k); if (v && v !== "all") p.set(k, v); });
    p.set("page", sp.get("page") || "1");
    return p.toString();
  }, [sp]);
  const { data, reload } = useData<List>(`/api/transactions?${query}`);

  const setFilter = (key: string, value: string) => {
    const p = new URLSearchParams(sp.toString());
    if (!value || value === "all") p.delete(key); else p.set(key, value);
    if (key !== "page") p.delete("page");
    router.replace(`/transactions?${p.toString()}`);
    setSelected(new Set());
  };
  useEffect(() => {
    const t = setTimeout(() => { if (search !== (sp.get("q") || "")) setFilter("q", search); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function patch(ids: number[], body: Record<string, unknown>) {
    setError(null);
    try {
      await api("/api/transactions", { method: "PATCH", json: { ids, ...body } });
      reload();
      notifyChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function saveName() {
    if (!editing) return;
    const { id, value } = editing;
    setEditing(null);
    await patch([id], { display_name: value });
  }
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const cross = sp.get("cross");
  const exportQuery = useMemo(() => { const p = new URLSearchParams(query); p.delete("page"); return p.toString(); }, [query]);
  const groups = meta ? [...new Set(meta.categories.map((c) => c.grp))] : [];
  const categoryOptions = meta && groups.map((g) => (
    <optgroup key={g} label={g}>{meta.categories.filter((c) => c.grp === g).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
  ));

  return (
    <>
      <PageHeader title="Transactions" description={data ? `${data.total} transactions · ${formatINR(data.amount)} in this view` : undefined}>
        <a href={`/api/transactions/export?${exportQuery}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Export CSV</a>
      </PageHeader>

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-6">
        <div className="col-span-2"><Label htmlFor="q">Search</Label><Input id="q" placeholder="Name, payee, UPI ID, narration, note" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div><Label htmlFor="m">Month</Label><Select id="m" value={sp.get("month") || "all"} onChange={(e) => setFilter("month", e.target.value)}><option value="all">All</option>{meta?.months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</Select></div>
        <div><Label htmlFor="a">Account</Label><Select id="a" value={sp.get("account") || "all"} onChange={(e) => setFilter("account", e.target.value)}><option value="all">All</option>{meta?.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></div>
        <div><Label htmlFor="c">Category</Label><Select id="c" value={sp.get("category") || "all"} onChange={(e) => setFilter("category", e.target.value)}><option value="all">All</option>{categoryOptions}</Select></div>
        <div><Label htmlFor="o">Owner</Label><Select id="o" value={sp.get("owner") || "all"} onChange={(e) => setFilter("owner", e.target.value)}><option value="all">Both</option><option value="personal">Personal</option><option value="business">Business</option></Select></div>
        <div><Label htmlFor="s">Status</Label><Select id="s" value={sp.get("status") || "all"} onChange={(e) => setFilter("status", e.target.value)}><option value="all">All</option><option value="needs_review">Needs review</option><option value="classified">Sorted automatically</option><option value="confirmed">Confirmed by you</option></Select></div>
        <div><Label htmlFor="f">Type</Label><Select id="f" value={sp.get("flow") || "all"} onChange={(e) => setFilter("flow", e.target.value)}><option value="all">All</option>{Object.entries(FLOW).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
      </div>

      {(cross || sp.get("payee")) && (
        <div className="mb-3 flex flex-wrap gap-2 text-sm">
          {cross && <Button size="sm" variant="secondary" onClick={() => setFilter("cross", "")}>{cross === "business_from_personal" ? "Business paid from personal accounts" : "Personal paid from business accounts"} ✕</Button>}
          {sp.get("payee") && <Button size="sm" variant="secondary" onClick={() => setFilter("payee", "")}>One payee ✕</Button>}
        </div>
      )}
      {error && <div className="mb-3"><Notice tone="error">{error}</Notice></div>}

      {selected.size > 0 && (
        <Card className="sticky top-2 z-10 mb-3 flex flex-wrap items-end gap-2 p-3">
          <span className="self-center text-sm font-medium">{selected.size} selected</span>
          <Select aria-label="Category for selected" className="w-48" value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)}><option value="">Category…</option>{categoryOptions}</Select>
          <Select aria-label="Owner for selected" className="w-36" value={bulkOwner} onChange={(e) => setBulkOwner(e.target.value)}><option value="">Owner…</option><option value="personal">Personal</option><option value="business">Business</option></Select>
          <Input aria-label="Name for selected" className="w-44" placeholder="Name…" value={bulkName} onChange={(e) => setBulkName(e.target.value)} />
          <Button size="sm" disabled={!bulkCategory && !bulkOwner && !bulkName.trim()} onClick={async () => {
            const body: Record<string, unknown> = { category_id: bulkCategory ? Number(bulkCategory) : undefined, owner: bulkOwner || undefined };
            if (bulkName.trim()) body.display_name = bulkName;
            await patch([...selected], body);
            setSelected(new Set()); setBulkName("");
          }}>Apply</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </Card>
      )}

      <Card>
        {data?.rows.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No transactions match these filters.</p>}
        <ul>
          {data?.rows.map((r) => {
            const crossPaid = r.flow_type === "spend" && r.owner && r.owner !== r.default_owner;
            return (
              <li key={r.id} className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-2 border-t p-3 first:border-t-0 md:grid-cols-[auto_minmax(0,1fr)_11rem_8rem_8.5rem] md:items-center">
                <input type="checkbox" className="mt-1 h-4 w-4 md:mt-0" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.payee || "transaction"} on ${dateLabel(r.txn_date)}`} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {editing?.id === r.id ? (
                      <Input autoFocus aria-label="Transaction name" className="h-8 max-w-64 text-sm" placeholder={r.payee_original || "Name"}
                        value={editing.value} onChange={(e) => setEditing({ id: r.id, value: e.target.value })} onBlur={saveName}
                        onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditing(null); }} />
                    ) : (
                      <button type="button" title="Rename this transaction" onClick={() => setEditing({ id: r.id, value: r.display_name || r.payee || "" })}
                        className="group inline-flex min-w-0 cursor-pointer items-center gap-1.5 text-left">
                        <span className="truncate text-sm font-medium">{r.payee || "Unknown"}</span>
                        <Pencil className="size-3 shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
                      </button>
                    )}
                    {r.status === "needs_review" && <Badge tone="warn">Needs review</Badge>}
                    {r.flow_type && r.flow_type !== "spend" && <Badge>{FLOW[r.flow_type] || r.flow_type}</Badge>}
                    {crossPaid && <Badge>Cross-paid</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {dateLabel(r.txn_date)} · {r.account}{r.mode ? ` · ${r.mode.replace("_", " ")}` : ""}{r.classified_by ? ` · ${SOURCE[r.classified_by] || r.classified_by}` : ""}
                  </div>
                  <details className="mt-0.5 text-xs text-muted-foreground">
                    <summary className="cursor-pointer truncate">{r.note ? `“${r.note}”` : "Details"}</summary>
                    <div className="mt-1 break-all">{r.narration_raw}</div>
                    {r.display_name && r.payee_original && <div>Payee: {r.payee_original}</div>}
                    {r.upi_id && <div className="break-all font-mono">{r.upi_id}</div>}
                    {r.reason && <div>{r.reason}</div>}
                  </details>
                </div>
                <div className={cn("text-right text-sm font-semibold tabular md:order-last", r.direction === "credit" && "text-good")}>
                  {r.direction === "credit" ? "+" : ""}{formatINR(r.amount, true)}
                </div>
                <div className="col-span-3 grid grid-cols-2 gap-2 md:col-span-2 md:grid-cols-[11rem_8rem] md:gap-3">
                  <Select aria-label="Category" className="h-9" value={r.category_id ?? ""} onChange={(e) => patch([r.id], { category_id: Number(e.target.value) })}>
                    <option value="" disabled>Category…</option>{categoryOptions}
                  </Select>
                  <Select aria-label="Owner" className="h-9" value={r.owner ?? ""} onChange={(e) => patch([r.id], { owner: e.target.value })}>
                    <option value="" disabled>Owner…</option><option value="personal">Personal</option><option value="business">Business</option>
                  </Select>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {data && data.pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => setFilter("page", String(data.page - 1))}>Previous</Button>
          <span className="tabular text-muted-foreground">Page {data.page} of {data.pages}</span>
          <Button variant="outline" size="sm" disabled={data.page >= data.pages} onClick={() => setFilter("page", String(data.page + 1))}>Next</Button>
        </div>
      )}
    </>
  );
}

export default function TransactionsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <Transactions />
    </Suspense>
  );
}
