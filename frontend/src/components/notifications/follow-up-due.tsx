'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlarmClock, MessageCircle, Phone, UserRound } from 'lucide-react';
import { useAllFollowUps, FollowUp } from '@/hooks/use-follow-ups';
import { useMyAccess } from '@/hooks/use-access';

const SEEN_KEY = 'follow-up-due-seen';
const WINDOW_MS = 30 * 60 * 1000; // a follow-up that came due in the last 30 minutes still pops up

function readSeen(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {}; } catch { return {}; }
}
function writeSeen(seen: Record<string, number>) {
  // keep a day's worth, so the list never grows forever
  const cutoff = Date.now() - 24 * 3600 * 1000;
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(Object.entries(seen).filter(([, at]) => at > cutoff)))); } catch { /* storage blocked */ }
}

// When a follow-up's time arrives, a pop-up says who to call -- on whatever page the person is.
// A salesperson only gets their own leads' follow-ups (the list itself is already limited to them).
export function FollowUpDuePopup() {
  const router = useRouter();
  const { can } = useMyAccess();
  const { data } = useAllFollowUps({ status: 'pending' }, { enabled: can('followups') });
  const [now, setNow] = useState(() => Date.now());
  const [snoozed, setSnoozed] = useState<Record<string, number>>({});
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);

  const seen = typeof window === 'undefined' ? {} : readSeen();
  void tick;
  const due = (data?.data ?? [])
    .filter((f) => { const at = new Date(f.due_at).getTime(); return at <= now && now - at < WINDOW_MS && !seen[f.id] && !(snoozed[f.id] > now); })
    .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
  const item: FollowUp | undefined = due[0];
  if (!item) return null;

  const phone = item.whatsapp_number || item.phone || '';
  const done = () => { writeSeen({ ...readSeen(), [item.id]: Date.now() }); setTick((n) => n + 1); };
  const later = () => setSnoozed((s) => ({ ...s, [item.id]: Date.now() + 10 * 60 * 1000 }));
  const go = (href: string) => { done(); router.push(href); };

  return (
    <div className="fixed inset-0 z-[9990] grid place-items-center bg-black/55 p-4">
      <div role="alertdialog" aria-label="Follow-up due now" className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-3 bg-gradient-to-br from-navy to-slate-900 px-5 py-4 text-white">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-gold text-navy"><AlarmClock className="h-6 w-6" /></span>
          <div><p className="text-xs font-bold uppercase tracking-widest text-gold">Follow-up due now</p><p className="text-lg font-bold">Call {item.customer_name || 'the customer'}</p></div>
        </div>
        <div className="space-y-2 px-5 py-4 text-sm text-slate-700">
          {phone && <p className="text-base font-bold tabular-nums text-navy">{phone}</p>}
          <p className="text-xs text-slate-500">Scheduled for {new Date(item.due_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}{due.length > 1 ? ` · ${due.length - 1} more due` : ''}</p>
          {item.note && <p className="rounded-lg bg-slate-50 p-2.5 text-sm">{item.note}</p>}
        </div>
        <div className="grid grid-cols-3 gap-2 px-5">
          {phone ? <a href={`tel:${phone}`} onClick={done} className="flex flex-col items-center gap-1 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white hover:bg-emerald-700"><Phone className="h-4 w-4" />Call</a> : <span />}
          <button type="button" onClick={() => go(`/whatsapp?lead=${item.lead_id}`)} className="flex flex-col items-center gap-1 rounded-xl border border-emerald-600 py-2.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50"><MessageCircle className="h-4 w-4" />WhatsApp</button>
          <button type="button" onClick={() => go(`/leads/${item.lead_id}`)} className="flex flex-col items-center gap-1 rounded-xl border border-slate-300 py-2.5 text-xs font-bold text-navy hover:bg-slate-50"><UserRound className="h-4 w-4" />Open lead</button>
        </div>
        <div className="flex gap-2 p-5">
          <button type="button" onClick={later} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Remind me in 10 min</button>
          <button type="button" onClick={() => go('/followups')} className="flex-1 rounded-lg bg-gold px-3 py-2 text-sm font-bold text-navy hover:brightness-95">Open follow-ups</button>
        </div>
      </div>
    </div>
  );
}
