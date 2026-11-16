"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/shell";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Notice, Select } from "@/components/ui/form";
import { useData, type Meta } from "@/lib/client";
import { cn, compactINR, formatINR, monthLabel } from "@/lib/utils";

type Dashboard = {
  totals: {
    spend: number; personal: number; business: number; income: number; refunds: number;
    business_from_personal: number; personal_from_business: number; needs_review: number; txn_count: number;
  };
  byCategory: { id: number; name: string; personal: number; business: number; total: number; n: number }[];
  trend: { month: string; personal: number; business: number }[];
  topPayees: { id: number; name: string; total: number; n: number }[];
};

function Legend() {
  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-personal" aria-hidden />Personal</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-business" aria-hidden />Business</span>
    </div>
  );
}

function Stat({ label, value, hint, href }: { label: string; value: string; hint?: string; href?: string }) {
  const body = (
    <Card className={cn("h-full p-4", href && "transition-colors hover:bg-accent")}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: { personal: number; business: number } }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 font-medium">{label ? monthLabel(label) : ""}</div>
      <div className="flex items-center justify-between gap-6"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-personal" />Personal</span><span className="tabular">{formatINR(p.personal)}</span></div>
      <div className="flex items-center justify-between gap-6"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-business" />Business</span><span className="tabular">{formatINR(p.business)}</span></div>
      <div className="mt-1 flex items-center justify-between gap-6 border-t pt-1 font-medium"><span>Total</span><span className="tabular">{formatINR(p.personal + p.business)}</span></div>
    </div>
  );
}

export default function DashboardPage() {
  const [month, setMonth] = useState("all");
  const [owner, setOwner] = useState("all");
  const [account, setAccount] = useState("all");
  const { data: meta } = useData<Meta>("/api/meta");
  const qs = useMemo(() => new URLSearchParams({ month, owner, account }).toString(), [month, owner, account]);
  const { data, error } = useData<Dashboard>(`/api/dashboard?${qs}`);
  const [hover, setHover] = useState<number | null>(null);

  const t = data?.totals;
  const net = t ? t.business_from_personal - t.personal_from_business : 0;
  const maxCat = Math.max(1, ...(data?.byCategory.map((c) => c.total) || [1]));
  const link = (extra: Record<string, string>) => `/transactions?${new URLSearchParams({ month, account, ...extra }).toString()}`;

  return (
    <>
      <PageHeader title="Dashboard" description="Where the money went, split by personal and business.">
        <div className="flex flex-wrap gap-2">
          <div><Label htmlFor="f-month">Month</Label>
            <Select id="f-month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-36">
              <option value="all">All months</option>
              {meta?.months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </Select></div>
          <div><Label htmlFor="f-owner">Owner</Label>
            <Select id="f-owner" value={owner} onChange={(e) => setOwner(e.target.value)} className="w-32">
              <option value="all">Both</option><option value="personal">Personal</option><option value="business">Business</option>
            </Select></div>
          <div><Label htmlFor="f-account">Account</Label>
            <Select id="f-account" value={account} onChange={(e) => setAccount(e.target.value)} className="w-44">
              <option value="all">All accounts</option>
              {meta?.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select></div>
        </div>
      </PageHeader>

      {error && <Notice tone="error">{error}</Notice>}

      {meta && meta.transaction_count === 0 ? (
        <Card className="p-8 text-center">
          <h2 className="text-lg font-semibold">No statements yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Upload an Excel or CSV statement for any account or card. Sample files are in the project&apos;s samples folder if you want to try it first.</p>
          <Link href="/upload" className={cn(buttonVariants(), "mt-4")}>Upload a statement</Link>
        </Card>
      ) : (
        t && data && (
          <div className="flex flex-col gap-4">
            {t.needs_review > 0 && (
              <Notice>
                {t.needs_review} transaction{t.needs_review === 1 ? "" : "s"} still need your answer, so these numbers are provisional.{" "}
                <Link href="/questions" className="font-medium underline underline-offset-2">Answer questions</Link>
              </Notice>
            )}

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Total spend" value={formatINR(t.spend)} hint={`${t.txn_count} transactions in view`} href={link({ flow: "spend", owner })} />
              <Stat label="Personal spend" value={formatINR(t.personal)} href={link({ flow: "spend", owner: "personal" })} />
              <Stat label="Business spend" value={formatINR(t.business)} href={link({ flow: "spend", owner: "business" })} />
              <Stat label="Money in" value={formatINR(t.income)} hint={t.refunds > 0 ? `plus ${formatINR(t.refunds)} in refunds` : undefined} href={link({ flow: "income", owner })} />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Cross-paid between you and the business</CardTitle>
                <CardDescription>
                  {net === 0
                    ? "Nothing is owed either way in this view."
                    : net > 0
                      ? `The business owes you ${formatINR(net)}.`
                      : `You owe the business ${formatINR(-net)}.`}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <Link href={link({ cross: "business_from_personal" })} className="rounded-md border p-3 transition-colors hover:bg-accent">
                  <div className="text-xs text-muted-foreground">Business expenses paid from personal accounts</div>
                  <div className="mt-1 text-xl font-semibold tabular">{formatINR(t.business_from_personal)}</div>
                </Link>
                <Link href={link({ cross: "personal_from_business" })} className="rounded-md border p-3 transition-colors hover:bg-accent">
                  <div className="text-xs text-muted-foreground">Personal expenses paid from business accounts</div>
                  <div className="mt-1 text-xl font-semibold tabular">{formatINR(t.personal_from_business)}</div>
                </Link>
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="flex-row items-start justify-between gap-2">
                  <div><CardTitle>Spend by category</CardTitle><CardDescription>Tap a row to see its transactions.</CardDescription></div>
                  <Legend />
                </CardHeader>
                <CardContent>
                  {data.byCategory.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No spend in this view.</p>}
                  <ul className="flex flex-col">
                    {data.byCategory.map((c) => (
                      <li key={c.id} className="relative">
                        <Link
                          href={link({ category: String(c.id), flow: "spend", owner })}
                          onMouseEnter={() => setHover(c.id)} onMouseLeave={() => setHover(null)}
                          onFocus={() => setHover(c.id)} onBlur={() => setHover(null)}
                          className="grid grid-cols-[minmax(0,9.5rem)_1fr_auto] items-center gap-3 rounded-md px-1 py-1.5 hover:bg-accent"
                        >
                          <span className="truncate text-sm">{c.name}</span>
                          <span className="flex h-3 items-center gap-[2px]" aria-hidden>
                            {c.personal > 0 && <span className="h-full rounded-r-[4px] bg-personal first:rounded-l-none" style={{ width: `${(c.personal / maxCat) * 100}%`, borderRadius: c.business > 0 ? 0 : "0 4px 4px 0" }} />}
                            {c.business > 0 && <span className="h-full bg-business" style={{ width: `${(c.business / maxCat) * 100}%`, borderRadius: "0 4px 4px 0" }} />}
                          </span>
                          <span className="text-sm font-medium tabular">{formatINR(c.total)}</span>
                        </Link>
                        {hover === c.id && (
                          <div className="pointer-events-none absolute right-0 top-full z-10 -mt-1 rounded-md border bg-card px-3 py-2 text-xs shadow-sm" role="tooltip">
                            <div className="mb-1 font-medium">{c.name} · {c.n} transaction{c.n === 1 ? "" : "s"}</div>
                            <div className="flex justify-between gap-6"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-personal" />Personal</span><span className="tabular">{formatINR(c.personal)}</span></div>
                            <div className="flex justify-between gap-6"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-business" />Business</span><span className="tabular">{formatINR(c.business)}</span></div>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              <div className="flex flex-col gap-4">
                <Card>
                  <CardHeader className="flex-row items-start justify-between gap-2">
                    <div><CardTitle>Monthly spend</CardTitle><CardDescription>All months, for the selected owner and account.</CardDescription></div>
                    <Legend />
                  </CardHeader>
                  <CardContent>
                    <div className="h-56 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data.trend} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
                          <CartesianGrid vertical={false} stroke="var(--grid)" />
                          <XAxis dataKey="month" tickFormatter={(m: string) => monthLabel(m).slice(0, 3)} tickLine={false} axisLine={{ stroke: "var(--input)" }} tick={{ fill: "var(--subtle)", fontSize: 12 }} />
                          <YAxis tickFormatter={(v: number) => compactINR(v)} tickLine={false} axisLine={false} width={52} tick={{ fill: "var(--subtle)", fontSize: 12 }} />
                          <Tooltip content={<TrendTooltip />} cursor={{ fill: "var(--muted)" }} />
                          <Bar dataKey="personal" stackId="s" fill="var(--series-personal)" stroke="var(--card)" strokeWidth={2} maxBarSize={36} isAnimationActive={false} />
                          <Bar dataKey="business" stackId="s" fill="var(--series-business)" stroke="var(--card)" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <details className="mt-2 text-xs text-muted-foreground">
                      <summary className="cursor-pointer">Show as a table</summary>
                      <table className="mt-2 w-full tabular">
                        <thead><tr className="text-left"><th className="py-1 font-medium">Month</th><th className="text-right font-medium">Personal</th><th className="text-right font-medium">Business</th></tr></thead>
                        <tbody>{data.trend.map((r) => <tr key={r.month} className="border-t"><td className="py-1">{monthLabel(r.month)}</td><td className="text-right">{formatINR(r.personal)}</td><td className="text-right">{formatINR(r.business)}</td></tr>)}</tbody>
                      </table>
                    </details>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle>Top payees</CardTitle></CardHeader>
                  <CardContent>
                    <ul className="flex flex-col text-sm">
                      {data.topPayees.map((p) => (
                        <li key={p.id}>
                          <Link href={link({ payee: String(p.id) })} className="flex items-center justify-between gap-3 rounded-md px-1 py-1.5 hover:bg-accent">
                            <span className="min-w-0 truncate">{p.name} <span className="text-xs text-muted-foreground">· {p.n}</span></span>
                            <span className="font-medium tabular">{formatINR(p.total)}</span>
                          </Link>
                        </li>
                      ))}
                      {data.topPayees.length === 0 && <li className="py-4 text-center text-muted-foreground">No spend in this view.</li>}
                    </ul>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        )
      )}
    </>
  );
}
