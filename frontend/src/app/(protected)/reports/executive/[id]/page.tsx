'use client';

import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton, TableSkeleton } from '@/components/ui/skeleton';
import { useExecutiveReport } from '@/hooks/use-reports';
import { tr, locale } from '@/i18n';

function formatCurrency(n: number) {
  return new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
}

function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr(label)}</p>
      <p className={`mt-2 text-2xl font-bold ${tone ?? ''}`}>{value}</p>
    </div>
  );
}

export default function ExecutiveReportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading } = useExecutiveReport(id);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <TableSkeleton />
      </div>
    );
  }

  if (!data?.profile) {
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <p className="text-lg font-medium">{tr("Executive not found")}</p>
        <Button variant="outline" onClick={() => router.push('/reports')}>{tr("Back to Reports")}</Button>
      </div>
    );
  }

  const { profile, leads, stats } = data;
  const rateTone = stats.rate >= 30 ? 'text-green-600' : stats.rate >= 15 ? 'text-amber-600' : 'text-red-600';
  const statusCounts = leads.reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => router.push('/reports')}>{tr("← Back to Reports")}</Button>

      <Card className="bg-navy text-white">
        <CardContent className="p-5">
          <h1 className="text-2xl font-bold">{profile.full_name}</h1>
          <p className="text-sm capitalize text-white/80">
            {profile.role_name?.replace(/_/g, ' ') ?? tr("Sales Executive")}
            {profile.employee_code && ` · ${profile.employee_code}`}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={tr("Assigned Leads")} value={stats.assigned} />
        <StatCard label={tr("Converted")} value={stats.converted} tone="text-green-600" />
        <StatCard label={tr("Conversion Rate")} value={`${stats.rate}%`} tone={rateTone} />
        <StatCard label={tr("Revenue")} value={formatCurrency(stats.revenue)} />
      </div>

      {stats.assigned > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 text-sm font-semibold">{tr("Status Breakdown")}</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(statusCounts).map(([status, count]) => (
                <span key={status} className="rounded-full bg-muted px-3 py-1 text-xs font-medium capitalize">
                  {tr(status.replace(/_/g, ' '))} · {count}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4">
          <p className="mb-3 text-sm font-semibold">{tr("Assigned Leads")}</p>
          {!leads.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{tr("No leads assigned.")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-gold text-white">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">{tr("Lead #")}</th>
                    <th className="px-4 py-2 text-left font-medium">{tr("Customer")}</th>
                    <th className="px-4 py-2 text-left font-medium">{tr("Destination")}</th>
                    <th className="px-4 py-2 text-left font-medium">{tr("Status")}</th>
                    <th className="px-4 py-2 text-left font-medium">{tr("Expected Revenue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l.id} className="cursor-pointer border-t hover:bg-muted/30" onClick={() => router.push(`/leads/${l.id}`)}>
                      <td className="px-4 py-2 font-mono text-xs">{l.lead_number ?? '—'}</td>
                      <td className="px-4 py-2">{l.customer_name}</td>
                      <td className="px-4 py-2">{l.destination ?? '—'}</td>
                      <td className="px-4 py-2 capitalize">{tr(l.status.replace(/_/g, ' '))}</td>
                      <td className="px-4 py-2">{formatCurrency(l.expected_revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
