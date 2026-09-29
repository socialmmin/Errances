'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useBookings } from '@/hooks/use-bookings';
import { BOOKING_STATUS_LABELS } from '@/types/booking';
import { tr } from '@/i18n';

// Port of hala-audit/frontend/src/pages/operations/index.tsx. The reference
// queries Supabase directly with per-KPI filters (arrivals/departures/active
// tours by date, urgent tasks); here it's derived client-side from the
// existing GET /bookings list (tasks/urgent-tasks KPI is deferred — TODO,
// pending a tasks-by-due-date endpoint) to avoid adding new backend routes
// for a straightforward filter of already-fetched data.
export default function OperationsDashboardPage() {
  const router = useRouter();
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const { data, isLoading } = useBookings({});

  const { arrivals, departures, activeTours } = useMemo(() => {
    const all = data?.data ?? [];
    return {
      arrivals: all.filter((b) => b.travel_from === date),
      departures: all.filter((b) => b.travel_to === date),
      activeTours: all.filter((b) => b.status === 'in_progress' && b.travel_from && b.travel_to && b.travel_from <= date && b.travel_to >= date),
    };
  }, [data, date]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-navy dark:text-white">{tr("Operations Dashboard")}</h1>
          <p className="text-sm text-muted-foreground">{tr("Daily operations overview")}</p>
        </div>
        <Input type="date" className="h-9 w-44" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-2xl font-bold">{isLoading ? '—' : arrivals.length}</p><p className="text-xs text-muted-foreground">{tr("Arrivals")}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-2xl font-bold">{isLoading ? '—' : departures.length}</p><p className="text-xs text-muted-foreground">{tr("Departures")}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-2xl font-bold">{isLoading ? '—' : activeTours.length}</p><p className="text-xs text-muted-foreground">{tr("Active Tours")}</p></CardContent></Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">{tr("Arrivals")}</CardTitle></CardHeader>
          <CardContent>
            {!arrivals.length ? <p className="py-6 text-center text-sm text-muted-foreground">{tr("No arrivals on this date.")}</p> : (
              <div className="space-y-2">
                {arrivals.map((b) => (
                  <div key={b.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div><p className="text-sm font-medium">{b.booking_number}</p><p className="text-xs text-muted-foreground">{b.customer_name}</p></div>
                    <Button variant="ghost" size="sm" onClick={() => router.push(`/bookings/${b.id}`)}>{tr("View")}</Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">{tr("Departures")}</CardTitle></CardHeader>
          <CardContent>
            {!departures.length ? <p className="py-6 text-center text-sm text-muted-foreground">{tr("No departures on this date.")}</p> : (
              <div className="space-y-2">
                {departures.map((b) => (
                  <div key={b.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div><p className="text-sm font-medium">{b.booking_number}</p><p className="text-xs text-muted-foreground">{b.customer_name}</p></div>
                    <Button variant="ghost" size="sm" onClick={() => router.push(`/bookings/${b.id}`)}>{tr("View")}</Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{tr("Active Tours")}</CardTitle></CardHeader>
        <CardContent>
          {!activeTours.length ? <p className="py-6 text-center text-sm text-muted-foreground">{tr("No active tours.")}</p> : (
            <div className="space-y-2">
              {activeTours.map((b) => (
                <div key={b.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{b.booking_number} — {b.customer_name}</p>
                    <p className="text-xs text-muted-foreground">{tr(BOOKING_STATUS_LABELS[b.status]) ?? tr(b.status)}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => router.push(`/bookings/${b.id}`)}>{tr("View")}</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
