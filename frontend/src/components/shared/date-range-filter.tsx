'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const show = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString('en-IN');
const PRESETS: [string, string][] = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7', 'Last 7 days'], ['14', 'Last 14 days'], ['30', 'Last 30 days'], ['month', 'This month']];

// One compact date filter, the same as on the Leads page: a single "All dates" button that opens
// quick choices (today, yesterday, last 7/14/30 days, this month) and a custom range with
// Clear / Update -- instead of two separate date boxes.
export function DateRangeFilter({ from, to, onChange, title = 'Select date' }: { from: string; to: string; onChange: (from: string, to: string) => void; title?: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ from, to });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) setDraft({ from, to }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  function preset(key: string) {
    const end = new Date(); const start = new Date();
    if (key === 'yesterday') { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); }
    if (key === '7' || key === '14' || key === '30') start.setDate(start.getDate() - Number(key) + 1);
    if (key === 'month') start.setDate(1);
    onChange(ymd(start), ymd(end)); setOpen(false);
  }
  const text = from || to ? `${from ? show(from) : 'Start'} – ${to ? show(to) : 'Today'}` : 'All dates';

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className={`flex h-10 min-w-[12rem] items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium ${from || to ? 'border-gold text-navy' : 'border-input text-foreground'}`}>
        <CalendarDays className="h-4 w-4 shrink-0" /><span className="truncate">{text}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-[21rem] max-w-[90vw] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
          <p className="text-sm font-semibold text-navy">{title}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {PRESETS.map(([key, name]) => <button key={key} type="button" onClick={() => preset(key)} className="rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:border-gold hover:bg-gold/10">{name}</button>)}
          </div>
          <p className="mb-2 mt-4 border-t border-slate-100 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Custom range</p>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" aria-label="From" value={draft.from} max={draft.to || undefined} onChange={(e) => setDraft({ ...draft, from: e.target.value })} className="h-10 rounded-md border border-input px-2 text-sm" />
            <input type="date" aria-label="To" value={draft.to} min={draft.from || undefined} onChange={(e) => setDraft({ ...draft, to: e.target.value })} className="h-10 rounded-md border border-input px-2 text-sm" />
          </div>
          <div className="mt-4 flex items-center justify-between">
            <button type="button" onClick={() => { onChange('', ''); setOpen(false); }} className="px-2 py-1 text-sm font-semibold text-slate-600 hover:text-navy">Clear</button>
            <button type="button" onClick={() => { onChange(draft.from, draft.to || draft.from); setOpen(false); }} className="rounded-lg bg-gold px-4 py-2 text-sm font-bold text-navy hover:brightness-95">Update</button>
          </div>
        </div>
      )}
    </div>
  );
}
