'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Clock3, FileText, MessageCircle, Phone, PhoneCall, RefreshCw, Search, ThumbsDown, X } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { CallbackOutcome, useCallbackRequests, useMarkCallbackCalled } from '@/hooks/use-callback-requests';

function defaultNextFollowUp() {
  const d = new Date(); d.setDate(d.getDate() + 3); d.setHours(11, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const OUTCOMES: { key: CallbackOutcome; label: string; hint: string; icon: typeof Check; tone: string }[] = [
  { key: 'quotation', label: 'Move to quotation', hint: 'Ready to price the trip', icon: FileText, tone: 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' },
  { key: 'itinerary', label: 'Send itinerary', hint: 'Wants the itinerary again', icon: MessageCircle, tone: 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' },
  { key: 'converted', label: 'Converted / paid', hint: 'Advance received', icon: Check, tone: 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' },
  { key: 'busy', label: 'Busy — follow up again', hint: 'Schedule another call', icon: RefreshCw, tone: 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100' },
  { key: 'not_interested', label: 'Not interested', hint: 'Close it out', icon: ThumbsDown, tone: 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100' },
];
const OUTCOME_LABEL: Record<string, string> = Object.fromEntries(OUTCOMES.map((o) => [o.key, o.label]));
const OUTCOME_CHIP: Record<string, string> = {
  quotation: 'bg-emerald-100 text-emerald-700', itinerary: 'bg-emerald-100 text-emerald-700', converted: 'bg-emerald-100 text-emerald-700',
  busy: 'bg-amber-100 text-amber-800', not_interested: 'bg-red-100 text-red-700',
};

// The whole "what happened on the call" decision, in one popup: a note (saved to the lead's
// Notes tab) and exactly one next move. Busy schedules the lead's one open follow-up right here;
// Quotation/Itinerary hand off to the right page; Converted/Not interested just update the lead.
function MarkCalledDialog({ requestId, leadId, customerName, onClose, onSaved }: { requestId: string; leadId: string | null; customerName: string; onClose: () => void; onSaved: (outcome: CallbackOutcome | null) => void }) {
  const mark = useMarkCallbackCalled();
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<CallbackOutcome | null>(null);
  const [when, setWhen] = useState(defaultNextFollowUp);
  const { toast } = useToast();

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-navy-950">
        <div className="flex items-start justify-between"><h2 className="text-lg font-bold text-navy dark:text-white">Call with {customerName}</h2><button type="button" onClick={onClose} className="rounded-full p-1 text-muted-foreground hover:bg-muted"><X className="h-5 w-5" /></button></div>
        <p className="mt-1 text-xs text-muted-foreground">What was said, and what happens next — saved straight to this lead's Notes.</p>

        <label className="mt-4 block text-xs font-semibold text-foreground">What did they say?{outcome === 'not_interested' && <span className="text-red-600"> * reason needed to mark Not interested</span>}</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="e.g. Wants Vietnam in December for 4 people, budget around 1.5L…" className={`mt-1 w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-gold ${outcome === 'not_interested' && note.trim().length < 10 ? 'border-red-500' : 'border-input'}`} />
        {outcome === 'not_interested' && note.trim().length < 10 && <p className="mt-1 text-xs font-medium text-red-600">Type why they are not interested (at least 10 characters). It is saved on the lead.</p>}

        <p className="mt-4 text-xs font-semibold text-foreground">Next move</p>
        <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
          {OUTCOMES.map((o) => {
            const Icon = o.icon;
            return (
              <button key={o.key} type="button" onClick={() => setOutcome(o.key)} className={`flex items-center gap-2 rounded-lg border p-2.5 text-left text-xs font-semibold transition ${outcome === o.key ? o.tone.replace('hover:bg-', 'bg-').split(' hover:')[0] + ' ring-2 ring-offset-1 ring-current' : 'border-border text-slate-600 hover:bg-muted dark:text-slate-300'}`}>
                <Icon className="h-4 w-4 shrink-0" /><span><span className="block">{o.label}</span><span className="block text-[10px] font-normal text-muted-foreground">{o.hint}</span></span>
              </button>
            );
          })}
        </div>

        {outcome === 'busy' && (
          <div className="mt-3"><label className="block text-xs font-semibold text-foreground">When to follow up</label><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="mt-1 h-9 w-full max-w-64 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-gold" /></div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted">Cancel</button>
          <button
            type="button"
            disabled={!outcome || mark.isPending || (outcome === 'not_interested' && note.trim().length < 10)}
            onClick={async () => {
              try {
                await mark.mutateAsync({ id: requestId, note: note.trim() || undefined, outcome: outcome!, nextFollowUpAt: outcome === 'busy' ? when : undefined });
                toast('Saved — note added to the lead', 'success');
                onSaved(outcome);
              } catch (error: any) { toast(error.message || 'Could not save', 'error'); }
            }}
            className="rounded-lg bg-gold px-4 py-2 text-sm font-bold text-navy disabled:opacity-40"
          >
            {mark.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

type View = 'pending' | 'done' | 'all';

// Every "Call our experts" tap and every typed "call me" lands here, pending, until someone
// actually calls and records what happened. Kept off the Follow-ups page on purpose — this is
// the inbound queue; Follow-ups is the outbound schedule.
export default function CallbackRequestsPage() {
  const { data, isLoading } = useCallbackRequests();
  const router = useRouter();
  const { toast } = useToast();
  const items = data?.data ?? [];
  const pending = items.filter((c) => !c.called_at);
  const done = items.filter((c) => c.called_at);

  const [view, setView] = useState<View>('pending');
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [dialogFor, setDialogFor] = useState<{ id: string; name: string; leadId: string | null } | null>(null);

  const outcomeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const o of OUTCOMES) c[o.key] = done.filter((d) => d.outcome === o.key).length;
    return c;
  }, [done]);
  const pct = items.length ? Math.round((done.length / items.length) * 100) : 0;

  const rows = (view === 'pending' ? pending : view === 'done' ? done : items)
    .filter((i) => outcomeFilter === 'all' || i.outcome === outcomeFilter)
    .filter((i) => {
      const q = search.trim().toLowerCase();
      return !q || i.customer_name.toLowerCase().includes(q) || i.phone.includes(q) || (i.destination || '').toLowerCase().includes(q);
    });

  function handleSaved(outcome: CallbackOutcome | null) {
    const leadId = dialogFor?.leadId;
    setDialogFor(null);
    if (!leadId || !outcome) return;
    if (outcome === 'quotation') router.push(`/quotations/new?lead_id=${leadId}`);
    else if (outcome === 'itinerary') router.push(`/whatsapp?lead=${leadId}`);
    else if (outcome === 'busy') toast('Follow-up scheduled', 'success');
  }

  const selectClass = 'h-10 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-gold';

  return (
    <div className="space-y-5 pb-8">
      {/* hero */}
      <section className="overflow-hidden rounded-2xl bg-gradient-to-r from-navy via-navy-900 to-navy-800 p-6 text-white shadow-lg">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.2em] text-gold">Inbound — customer asked us to call</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">Callback Requests</h1>
            <p className="mt-1 max-w-xl text-sm text-slate-300">Every "Call our experts" tap or "call me" message lands here. Call them, then mark it called with what happens next.</p>
          </div>
          <div className="text-right"><p className="text-4xl font-bold text-gold">{pct}%</p><p className="text-xs text-slate-300">called</p></div>
        </div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} /></div>
        <p className="mt-1.5 text-xs text-slate-300">{done.length} of {items.length} called · {pending.length} still to call</p>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
          <button type="button" onClick={() => { setView('pending'); setOutcomeFilter('all'); }} className={`rounded-xl border p-3 text-left transition ${view === 'pending' ? 'border-gold bg-white/15' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}><p className="text-2xl font-bold text-amber-300">{pending.length}</p><p className="text-xs text-white">Still to call</p></button>
          {OUTCOMES.map((o) => (
            <button key={o.key} type="button" onClick={() => { setView('done'); setOutcomeFilter(o.key); }} className={`rounded-xl border p-3 text-left transition ${view === 'done' && outcomeFilter === o.key ? 'border-gold bg-white/15' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}><p className="text-2xl font-bold text-gold">{outcomeCounts[o.key]}</p><p className="text-xs text-white">{o.label}</p></button>
          ))}
        </div>
      </section>

      {/* filters */}
      <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm">
        <div className="flex overflow-hidden rounded-lg border border-border text-sm font-semibold">
          {([['pending', `To call (${pending.length})`], ['done', `Called (${done.length})`], ['all', `All (${items.length})`]] as [View, string][]).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setView(v)} className={`px-3.5 py-2 ${view === v ? 'bg-navy text-white' : 'text-muted-foreground hover:bg-muted'}`}>{label}</button>
          ))}
        </div>
        <select value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value)} className={selectClass}>
          <option value="all">All outcomes</option>
          {OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <div className="relative ml-auto min-w-[13rem] flex-1 sm:max-w-xs"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, number or destination…" className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-gold" /></div>
      </section>

      {/* list */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {isLoading && <p className="p-6 text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && !rows.length && <p className="px-5 py-10 text-center text-sm text-muted-foreground">{items.length ? 'Nothing matches these filters.' : 'No callback requests yet. When a customer taps "Call our experts" or types "call me", it appears here.'}</p>}
        <div className="max-h-[65vh] divide-y divide-border overflow-y-auto">
          {rows.map((item) => (
            <div key={item.id} className={`flex flex-wrap items-center gap-3 px-5 py-3.5 ${item.called_at ? '' : 'bg-red-50/40 dark:bg-red-950/10'}`}>
              <div className="min-w-0 flex-1">
                {item.lead_id ? <Link href={`/leads/${item.lead_id}`} className="font-semibold text-navy hover:underline dark:text-white">{item.customer_name}</Link> : <span className="font-semibold text-navy dark:text-white">{item.customer_name}</span>}
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground"><span className="flex items-center gap-1"><Phone className="h-3 w-3" />{item.phone}</span>{item.destination && <span>{item.destination}</span>}<span className="flex items-center gap-1"><Clock3 className="h-3 w-3" />{new Date(item.requested_at).toLocaleString('en-IN')}</span></p>
                {item.note && <p className="mt-1 max-w-xl truncate text-xs text-slate-600 dark:text-slate-300" title={item.note}>{item.note}</p>}
              </div>
              {item.called_at ? (
                <div className="text-right text-xs">
                  {item.outcome && <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${OUTCOME_CHIP[item.outcome] || 'bg-slate-100 text-slate-600'}`}>{OUTCOME_LABEL[item.outcome] || item.outcome}</span>}
                  <p className="mt-1 text-muted-foreground">called {new Date(item.called_at).toLocaleString('en-IN')}{item.called_by_name ? ` · ${item.called_by_name}` : ''}</p>
                </div>
              ) : (
                <>
                  <a href={`tel:${item.phone}`} className="flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white"><PhoneCall className="h-3.5 w-3.5" />Call</a>
                  <button type="button" onClick={() => setDialogFor({ id: item.id, name: item.customer_name, leadId: item.lead_id })} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"><Check className="h-3.5 w-3.5" />Mark called</button>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="border-t border-border bg-muted/30 px-5 py-2.5 text-xs text-muted-foreground">Showing {rows.length} of {items.length}</div>
      </section>

      {dialogFor && <MarkCalledDialog requestId={dialogFor.id} leadId={dialogFor.leadId} customerName={dialogFor.name} onClose={() => setDialogFor(null)} onSaved={handleSaved} />}
    </div>
  );
}
