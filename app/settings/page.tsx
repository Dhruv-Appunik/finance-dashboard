"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Input, Label, Notice, Select } from "@/components/ui/form";
import { api, notifyChanged, useData, type AccountRow, type Meta } from "@/lib/client";
import { formatINR } from "@/lib/utils";

type Manage = {
  rules: { id: number; scope: string; amount_limit: number | null; owner: string | null; payee: string; upi_id: string | null; category: string }[];
  payees: { id: number; display_name: string; upi_id: string | null; kind: string; is_mixed: number; txn_count: number; total: number }[];
};

const SCOPE: Record<string, (n: number | null) => string> = {
  always: () => "Always",
  above_amount: (n) => `At or above ${formatINR(n || 0)}`,
  below_amount: (n) => `Below ${formatINR(n || 0)}`,
};

function AccountEditor({ account, onSaved }: { account?: AccountRow; onSaved: () => void }) {
  const blank = { name: "", bank: "", type: "savings", last4: "", default_owner: "personal" };
  const [f, setF] = useState(account ? { ...account, last4: account.last4 || "" } : blank);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const run = async (body: Record<string, unknown>) => {
    setError(null);
    try { await api("/api/manage", { json: body }); if (!account) setF(blank); onSaved(); } catch (e) { setError((e as Error).message); }
  };
  return (
    <li className="border-t py-3 first:border-t-0">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-[1.4fr_1fr_1fr_5rem_1fr_auto] md:items-end">
        <div className="col-span-2 md:col-span-1"><Label>Name</Label><Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={account ? "" : "New account name"} /></div>
        <div><Label>Bank</Label><Input value={f.bank} onChange={(e) => set("bank", e.target.value)} /></div>
        <div><Label>Type</Label><Select value={f.type} onChange={(e) => set("type", e.target.value)}><option value="savings">Savings</option><option value="current">Current</option><option value="credit_card">Credit card</option></Select></div>
        <div><Label>Last 4</Label><Input value={f.last4} maxLength={4} inputMode="numeric" onChange={(e) => set("last4", e.target.value)} /></div>
        <div><Label>Default owner</Label><Select value={f.default_owner} onChange={(e) => set("default_owner", e.target.value)}><option value="personal">Personal</option><option value="business">Business</option></Select></div>
        <div className="col-span-2 flex gap-2 md:col-span-1">
          <Button size="sm" variant={account ? "outline" : "default"} onClick={() => run({ action: "save_account", ...f, id: account?.id })}>{account ? "Save" : "Add"}</Button>
          {account && <Button size="sm" variant="ghost" onClick={() => run({ action: "delete_account", id: account.id })}>Delete</Button>}
        </div>
      </div>
      {error && <div className="mt-2"><Notice tone="error">{error}</Notice></div>}
    </li>
  );
}

export default function SettingsPage() {
  const { data: meta, reload: reloadMeta } = useData<Meta>("/api/meta");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t); }, [search]);
  const { data, reload } = useData<Manage>(`/api/manage?q=${encodeURIComponent(debounced)}`);
  const [ownNames, setOwnNames] = useState("");
  const [threshold, setThreshold] = useState("0.85");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mergeFrom, setMergeFrom] = useState<number | null>(null);

  useEffect(() => {
    if (meta) { setOwnNames(meta.settings.own_names); setThreshold(meta.settings.confidence_threshold); }
  }, [meta]);

  const act = async (body: Record<string, unknown>, done?: string) => {
    setBusy(true); setMessage(null);
    try {
      const res = await api<{ classified?: number; needs_review?: number; warnings?: string[] }>("/api/manage", { json: body });
      const text = body.action === "reclassify"
        ? `Re-sorted: ${res.classified} automatic, ${res.needs_review} need your answer.${res.warnings?.length ? ` ${res.warnings.join(" ")}` : ""}`
        : done || "Saved.";
      setMessage({ tone: "success", text });
      reload(); reloadMeta(); notifyChanged();
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Rules and settings" description="What the app has learned, and how it decides." />
      <div className="flex flex-col gap-4">
        {message && <Notice tone={message.tone}>{message.text}</Notice>}

        <Card>
          <CardHeader><CardTitle>Sorting</CardTitle><CardDescription>Keys are read from the .env.local file on the computer running the app.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone={meta?.keys.jev ? "good" : "warn"}>TypeSafe Jev: {meta?.keys.jev ? "key found" : "no key"}</Badge>
              <Badge tone={meta?.keys.claude ? "good" : "warn"}>Claude Sonnet: {meta?.keys.claude ? "key found" : "no key"}</Badge>
            </div>
            {meta && !meta.keys.jev && !meta.keys.claude && <p className="text-sm text-muted-foreground">With no key, the app still applies your rules, the known-merchant list and the automatic checks. Everything else is sent to Questions.</p>}
            <div className="grid gap-3 md:grid-cols-[1fr_10rem_auto] md:items-end">
              <div><Label htmlFor="own">Your own names, comma separated</Label><Input id="own" value={ownNames} onChange={(e) => setOwnNames(e.target.value)} placeholder="Your name, your business name" /></div>
              <div><Label htmlFor="thr">Confidence bar (0 to 1)</Label><Input id="thr" type="number" step="0.05" min="0.5" max="1" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></div>
              <Button disabled={busy} onClick={() => act({ action: "save_settings", own_names: ownNames, confidence_threshold: threshold })}>Save</Button>
            </div>
            <p className="text-xs text-muted-foreground">Transfers to or from these names are treated as movement between your own accounts. Below the confidence bar, a model&apos;s answer becomes a question.</p>
            <div><Button variant="outline" disabled={busy} onClick={() => act({ action: "reclassify" })}>{busy ? "Working…" : "Re-sort everything not confirmed by you"}</Button></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Accounts and cards</CardTitle><CardDescription>The default owner is only a starting hint. Payee rules and your answers override it.</CardDescription></CardHeader>
          <CardContent>
            <ul>
              {meta?.accounts.map((a) => <AccountEditor key={a.id} account={a} onSaved={() => { reloadMeta(); }} />)}
              <AccountEditor onSaved={reloadMeta} />
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Learned rules</CardTitle><CardDescription>{data?.rules.length ? `${data.rules.length} rule${data.rules.length === 1 ? "" : "s"}. Deleting a rule does not change transactions already sorted.` : "Rules appear here as you answer questions."}</CardDescription></CardHeader>
          {data && data.rules.length > 0 && (
            <CardContent>
              <ul className="text-sm">
                {data.rules.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 first:border-t-0">
                    <span className="min-w-0"><span className="font-medium">{r.payee}</span>{r.upi_id && <span className="ml-2 break-all font-mono text-xs text-muted-foreground">{r.upi_id}</span>}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge>{r.category}</Badge>
                      {r.owner ? <Badge tone={r.owner === "personal" ? "personal" : "business"}>{r.owner === "personal" ? "Personal" : "Business"}</Badge> : <Badge>Follows account</Badge>}
                      <span className="text-xs text-muted-foreground">{SCOPE[r.scope]?.(r.amount_limit) || r.scope}</span>
                      <Button size="sm" variant="ghost" onClick={() => act({ action: "delete_rule", id: r.id }, "Rule deleted.")}>Delete</Button>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payees</CardTitle>
            <CardDescription>Rename a payee, or merge two that are the same. {mergeFrom ? "Now choose the payee to merge into." : ""}</CardDescription>
            <Input className="mt-2 max-w-sm" placeholder="Search payees" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search payees" />
          </CardHeader>
          <CardContent>
            <ul className="text-sm">
              {data?.payees.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 first:border-t-0">
                  <span className="min-w-0 flex-1">
                    <input
                      defaultValue={p.display_name} aria-label="Payee name"
                      className="w-full max-w-xs rounded border border-transparent bg-transparent px-1 py-0.5 font-medium hover:border-input focus:border-input focus:outline-none"
                      onBlur={(e) => { if (e.target.value.trim() && e.target.value !== p.display_name) act({ action: "rename_payee", id: p.id, name: e.target.value }, "Payee renamed."); }}
                    />
                    <span className="ml-1 text-xs text-muted-foreground">{p.upi_id ? <span className="break-all font-mono">{p.upi_id} · </span> : null}{p.txn_count} · {formatINR(p.total)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {p.kind === "own_account" && <Badge>Own account</Badge>}
                    {p.is_mixed ? <Badge>Mixed</Badge> : null}
                    {mergeFrom === null && <Button size="sm" variant="ghost" onClick={() => setMergeFrom(p.id)}>Merge…</Button>}
                    {mergeFrom !== null && mergeFrom !== p.id && <Button size="sm" variant="outline" onClick={() => { act({ action: "merge_payee", from: mergeFrom, into: p.id }, "Payees merged."); setMergeFrom(null); }}>Merge into this</Button>}
                    {mergeFrom === p.id && <Button size="sm" variant="secondary" onClick={() => setMergeFrom(null)}>Cancel</Button>}
                  </span>
                </li>
              ))}
              {data?.payees.length === 0 && <li className="py-4 text-center text-muted-foreground">No payees found.</li>}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
