'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton, TableSkeleton } from '@/components/ui/skeleton';
import {
  useRevenueReport, useConversionReport, useLostReasonsReport, useDestinationsReport,
  useOutstandingReport, useSalesPerformanceReport,
} from '@/hooks/use-reports';
import { tr, locale } from '@/i18n';

function formatCurrency(n: number) {
  return new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
}

const TABS = [
  { id: 'revenue', label: 'Revenue' },
  { id: 'conversion', label: 'Lead Conversion' },
  { id: 'destination', label: 'Destination' },
  { id: 'outstanding', label: 'Outstanding' },
  { id: 'sales', label: 'Sales Performance' },
] as const;

function RateBar({ rate }: { rate: number }) {
  const color = rate >= 30 ? 'bg-green-500' : rate >= 15 ? 'bg-amber-500' : 'bg-red-500';
  const textColor = rate >= 30 ? 'text-green-600' : rate >= 15 ? 'text-amber-600' : 'text-red-600';
  return (
    <div className="flex w-32 items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, rate)}%` }} />
      </div>
      <span className={`shrink-0 text-xs font-bold ${textColor}`}>{rate}%</span>
    </div>
  );
}

export default function ReportsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]['id']>('revenue');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 6);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);

  const revenue = useRevenueReport(dateFrom, dateTo);
  const conversion = useConversionReport();
  const lostReasons = useLostReasonsReport();
  const destinations = useDestinationsReport();
  const outstanding = useOutstandingReport();
  const salesPerf = useSalesPerformanceReport();

  const totalRevenue = revenue.data?.reduce((s, r) => s + r.amount, 0) ?? 0;
  const totalLeads = conversion.data?.reduce((s, c) => s + c.total, 0) ?? 0;
  const totalBooked = conversion.data?.reduce((s, c) => s + c.booked, 0) ?? 0;
  const overallRate = totalLeads > 0 ? Math.round((totalBooked / totalLeads) * 100) : 0;
  const totalOutstanding = outstanding.data?.reduce((s, o) => s + o.balance_amount, 0) ?? 0;
  const maxRevenue = Math.max(1, ...(revenue.data?.map((r) => r.amount) ?? [0]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-navy dark:text-white">{tr("Reports & Analytics")}</h1>
          <p className="text-sm text-muted-foreground">{tr("Business insights across revenue, leads and sales performance")}</p>
        </div>
        <div className="flex gap-4 text-right">
          <div><p className="text-xs text-muted-foreground">{tr("Revenue (Period)")}</p><p className="font-semibold">{formatCurrency(totalRevenue)}</p></div>
          <div><p className="text-xs text-muted-foreground">{tr("Overall Conversion")}</p><p className="font-semibold">{overallRate}%</p></div>
          <div><p className="text-xs text-muted-foreground">{tr("Outstanding")}</p><p className="font-semibold text-red-600">{formatCurrency(totalOutstanding)}</p></div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              t.id === activeTab ? 'border-gold text-navy dark:text-gold' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tr(t.label)}
          </button>
        ))}
      </div>

      {activeTab === 'revenue' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-lg bg-muted/40 p-3">
            <div><Label className="text-xs">{tr("From")}</Label><Input type="date" className="mt-1 h-9 w-40" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
            <div><Label className="text-xs">{tr("To")}</Label><Input type="date" className="mt-1 h-9 w-40" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
          </div>
          <Card>
            <CardContent className="p-4">
              <p className="mb-3 text-sm font-semibold">{tr("Monthly Revenue")}</p>
              {revenue.isLoading ? <Skeleton className="h-64 w-full" /> : !revenue.data?.length ? (
                <p className="py-10 text-center text-sm text-muted-foreground">{tr("No revenue data for this period.")}</p>
              ) : (
                <div className="flex h-64 items-end gap-3 overflow-x-auto">
                  {revenue.data.map((r) => (
                    <div key={r.month} className="flex min-w-[48px] flex-1 flex-col items-center gap-1">
                      <span className="text-xs font-medium">{formatCurrency(r.amount)}</span>
                      <div className="w-8 rounded-t bg-gold" style={{ height: `${Math.max(4, (r.amount / maxRevenue) * 200)}px` }} />
                      <span className="text-[10px] text-muted-foreground">{r.month}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'conversion' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="p-4">
              <p className="mb-3 text-sm font-semibold">{tr("Source-wise Conversion")}</p>
              {conversion.isLoading ? <TableSkeleton /> : !conversion.data?.length ? (
                <p className="py-10 text-center text-sm text-muted-foreground">{tr("No lead data yet.")}</p>
              ) : (
                <div className="space-y-2">
                  {conversion.data.map((s, i) => (
                    <div key={s.source} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                      <div>
                        <p className="text-sm font-medium capitalize">{i + 1}. {s.source}</p>
                        <p className="text-xs text-muted-foreground">{s.total}{' '}{tr("leads ·")}{' '}{s.booked}{' '}{tr("booked")}</p>
                      </div>
                      <RateBar rate={s.rate} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="mb-3 text-sm font-semibold">{tr("Lost Leads — Reasons")}</p>
              {lostReasons.isLoading ? <TableSkeleton /> : !lostReasons.data?.length ? (
                <p className="py-10 text-center text-sm text-muted-foreground">{tr("No lost leads data.")}</p>
              ) : (
                <div className="space-y-2">
                  {lostReasons.data.map((r) => (
                    <div key={r.name} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                      <span>{r.name}</span>
                      <span className="font-semibold">{r.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'destination' && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 text-sm font-semibold">{tr("Leads by Destination")}</p>
            {destinations.isLoading ? <TableSkeleton /> : !destinations.data?.length ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{tr("No leads yet.")}</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {destinations.data.map((d, i) => (
                  <div key={d.destination} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">{i + 1}. {d.destination}</p>
                      <RateBar rate={d.rate} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {d.total}{' '}{tr("total ·")}{' '}{d.assigned}{' '}{tr("assigned")}{d.unassigned > 0 ? tr(" · {unassigned} unassigned", { unassigned: d.unassigned }) : ''} · {d.booked}{' '}{tr("booked")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'outstanding' && (
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">{tr("Outstanding Payments")}</p>
              {!!outstanding.data?.length && <span className="text-sm font-bold text-red-600">{formatCurrency(totalOutstanding)}{' '}{tr("total")}</span>}
            </div>
            {outstanding.isLoading ? <TableSkeleton /> : !outstanding.data?.length ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{tr("No outstanding balances.")}</p>
            ) : (
              <div className="space-y-2">
                {outstanding.data.map((b) => (
                  <div
                    key={b.id}
                    className="flex cursor-pointer items-center justify-between rounded-lg border-l-4 border-l-red-500 p-3 hover:bg-muted/30"
                    onClick={() => router.push(`/bookings/${b.id}`)}
                  >
                    <div>
                      <p className="text-sm font-medium">{b.customer_name ?? '—'}</p>
                      <p className="font-mono text-xs text-muted-foreground">{b.booking_number}</p>
                    </div>
                    <span className="text-sm font-bold text-red-600">{formatCurrency(b.balance_amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'sales' && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 text-sm font-semibold">{tr("Sales Executive Performance")}</p>
            {salesPerf.isLoading ? <TableSkeleton /> : !salesPerf.data?.length ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{tr("No sales data available.")}</p>
            ) : (
              <div className="space-y-2">
                {salesPerf.data.map((e, i) => (
                  <div
                    key={e.id}
                    className="flex cursor-pointer items-center justify-between rounded-lg border p-3 hover:bg-muted/30"
                    onClick={() => router.push(`/reports/executive/${e.id}`)}
                  >
                    <div>
                      <p className="text-sm font-medium">{i + 1}. {e.name}</p>
                      <p className="text-xs text-muted-foreground">{e.assigned}{' '}{tr("assigned ·")}{' '}{e.converted}{' '}{tr("converted ·")}{' '}{formatCurrency(e.revenue)}</p>
                    </div>
                    <RateBar rate={e.rate} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
