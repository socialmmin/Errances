'use client';

import { CheckCircle2, HelpCircle, Loader2, XCircle } from 'lucide-react';
import { useMetaLearning } from '@/hooks/use-meta-learning';

const STAGE_COPY: Record<string, { title: string; body: string; tone: string }> = {
  not_connected: { title: 'Not connected', body: 'The server could not reach Meta with the current token/dataset. Nothing can be sent until this is fixed.', tone: 'bg-red-50 border-red-200 text-red-800' },
  off: { title: 'Connected, sending is OFF', body: 'Meta confirms the connection is live, but the CRM is not sending anything yet. Outcomes queue up silently until you switch to Test or Live.', tone: 'bg-slate-50 border-slate-200 text-slate-700' },
  connected_no_events: { title: 'Connected, waiting for outcomes', body: 'No lead has reached Qualified, Quotation Sent, Advance Paid or Booked yet, so there is nothing to send. Move a real lead to Qualified to see this move forward.', tone: 'bg-amber-50 border-amber-200 text-amber-800' },
  sent_unconfirmed: { title: 'Events sent, not yet confirmed by Meta', body: "The CRM's own log shows events were sent and accepted (HTTP 200), but Meta's dataset has not reported them back yet in its own stats. This can take a few minutes — refresh in a bit.", tone: 'bg-amber-50 border-amber-200 text-amber-800' },
  meta_receiving: { title: 'Meta is receiving and counting these events', body: "This is confirmed by Meta's own dataset statistics, not just by our send log.", tone: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
};

function Node({ label, n, tone, active }: { label: string; n: number | string; tone: string; active?: boolean }) {
  return (
    <div className={`flex min-w-[7rem] flex-col items-center rounded-xl border px-3 py-2.5 text-center ${active ? tone : 'border-border bg-card text-muted-foreground opacity-60'}`}>
      <p className="text-xl font-bold">{n}</p>
      <p className="text-[11px] font-semibold">{label}</p>
    </div>
  );
}
function Arrow() { return <div className="flex-1 self-center border-t-2 border-dashed border-border" />; }

// The whole "does Meta actually know" question, answered honestly: a live connection check (not a
// cached flag), our own send counts, and what Meta's dataset itself confirms it received.
export function LearningLoop() {
  const { data, isLoading, dataUpdatedAt } = useMetaLearning();
  if (isLoading || !data) return <section className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Checking Meta right now…</section>;

  const { connection, mode, leadClassification, eventsByType, metaConfirmed, readiness, stage } = data;
  const copy = STAGE_COPY[stage];
  const totalLeads = leadClassification.GOOD + leadClassification.NEUTRAL + leadClassification.BAD;

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-navy dark:text-white">Is Meta actually connected and learning?</h2>
          <p className="text-xs text-muted-foreground">Checked live against Meta just now, not a saved status. Rechecks automatically every 25 seconds.</p>
        </div>
        <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${connection.connected ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-red-300 bg-red-50 text-red-700'}`}>
          {connection.connected ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {connection.connected ? `Connected to "${connection.datasetName}"` : 'Not connected'}
        </div>
      </div>

      {!connection.connected && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">Meta says: {connection.reason}</p>}
      {connection.connected && connection.lastFiredTime && <p className="text-[11px] text-muted-foreground">Meta's own record of this dataset's last activity: {new Date(connection.lastFiredTime).toLocaleString('en-IN')}. Checked at {new Date(connection.checkedAt!).toLocaleTimeString('en-IN')}.</p>}

      {/* the flow */}
      <div className="flex flex-wrap items-center gap-2 overflow-x-auto py-2">
        <Node label="All leads" n={totalLeads} tone="border-navy bg-navy/5 text-navy" active />
        <Arrow />
        <Node label="Good" n={leadClassification.GOOD} tone="border-emerald-300 bg-emerald-50 text-emerald-700" active />
        <Arrow />
        <Node label="Sent automatically" n={data.eventsSentTotal} tone="border-sky-300 bg-sky-50 text-sky-700" active={data.eventsSentTotal > 0} />
        <Arrow />
        <Node label="Meta confirms (the real proof)" n={metaConfirmed.available ? Object.values(metaConfirmed.totals).reduce((s, n) => s + n, 0) : '?'} tone="border-purple-300 bg-purple-50 text-purple-700" active={metaConfirmed.available} />
      </div>
      <p className="pl-2 text-[11px] text-muted-foreground">No manual step anywhere in this chain — a background job sends every event by itself, every 2 minutes, with zero human action. Meta has no way to reach into our database directly; "Meta confirms" is Meta's own record that it received and counted each one, which is the real answer to "does Meta know."</p>
      <div className="flex flex-wrap items-center gap-2 pl-2 text-[11px] text-muted-foreground">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">Neutral {leadClassification.NEUTRAL}</span>
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-600">Bad {leadClassification.BAD} (sent as Disqualified)</span>
        <span>· Sending mode: <b className="uppercase">{mode}</b></span>
      </div>

      <div className={`rounded-xl border p-3 text-sm ${copy.tone}`}>
        <p className="font-bold">{copy.title}</p>
        <p className="mt-0.5 text-xs">{copy.body}</p>
      </div>

      {/* per-event, CRM-sent vs Meta-confirmed, and whether there's enough volume to matter */}
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted/50 text-muted-foreground"><tr><th className="px-3 py-1.5">Outcome</th><th className="px-3 py-1.5 text-right">Meta confirms ({metaConfirmed.days ?? 30}d)</th><th className="px-3 py-1.5 text-right">Sent automatically</th><th className="px-3 py-1.5 text-right">Enough for Meta to use?</th></tr></thead>
          <tbody>
            {readiness.map((r) => (
              <tr key={r.event} className="border-t border-border">
                <td className="px-3 py-1.5 font-medium">{r.event}</td>
                <td className="px-3 py-1.5 text-right font-semibold text-navy dark:text-white">{metaConfirmed.available ? r.confirmedByMeta : <span title={metaConfirmed.reason}><HelpCircle className="ml-auto inline h-3.5 w-3.5 text-muted-foreground" /></span>}</td>
                <td className="px-3 py-1.5 text-right text-muted-foreground">{r.sentByCrm}</td>
                <td className="px-3 py-1.5 text-right">{r.readyToOptimize ? <span className="font-semibold text-emerald-600">Yes</span> : <span className="text-amber-600">Not yet ({r.confirmedByMeta}/15+)</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        "Meta confirms" comes from Meta's own dataset statistics (Events Manager), not from our send log — this is the real proof an event arrived and was counted.
        Meta generally needs roughly 15–25 real events of one type within about a week before an ad set can reliably learn to target for that outcome; below that it keeps optimizing on raw form fills.
      </p>

      <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs">
        <p className="font-bold text-navy dark:text-white">To see this yourself in Meta</p>
        <p className="mt-1 text-muted-foreground">Meta Events Manager → Data sources → "{connection.datasetName || 'your Meta dataset'}" → Test events (while in Test mode) or Overview / Diagnostics (once Live) → filter by event name (Qualified, QuotationSent, AdvancePaid, Booked). What "improves" as this fills up: the ad set's own Learning phase status in Ads Manager, and falling cost-per-Qualified / cost-per-Booking in the funnel report below, once you switch that ad set's optimization goal to one of these events.</p>
      </div>
    </section>
  );
}
