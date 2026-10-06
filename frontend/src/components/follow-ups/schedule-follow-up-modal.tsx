'use client';

import { useState } from 'react';
import { Phone, MessageCircle, MapPin, Package, CreditCard, FileText, ClipboardList, X } from 'lucide-react';

// Travel-CRM equivalents of the reference academy CRM's type grid (Counselling -> Site Visit,
// Document Collection carries over as-is).
const TYPES = [
  { value: 'call', label: 'Call', icon: Phone },
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { value: 'site_visit', label: 'Site Visit', icon: MapPin },
  { value: 'package', label: 'Package Follow-up', icon: Package },
  { value: 'payment', label: 'Payment Follow-up', icon: CreditCard },
  { value: 'documents', label: 'Document Collection', icon: FileText },
  { value: 'general', label: 'General Follow-up', icon: ClipboardList },
] as const;

const PRIORITIES = [
  { value: 'high', label: 'High', cls: 'border-red-300 bg-red-50 text-red-700' },
  { value: 'medium', label: 'Medium', cls: 'border-amber-300 bg-amber-50 text-amber-700' },
  { value: 'low', label: 'Low', cls: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
] as const;

function toLocalInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
}

export function ScheduleFollowUpModal({ customerName, defaultNote, onClose, onSave, saving }: {
  customerName: string;
  defaultNote?: string;
  onClose: () => void;
  onSave: (input: { dueAt: string; note?: string; followUpType: string; priority: string }) => void;
  saving: boolean;
}) {
  const initial = toLocalInputValue(new Date(Date.now() + 3 * 3600 * 1000));
  const [type, setType] = useState<string>('call');
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [priority, setPriority] = useState<string>('medium');
  const [note, setNote] = useState(defaultNote ?? '');

  function save() {
    if (!date || !time) return;
    onSave({ dueAt: new Date(`${date}T${time}`).toISOString(), note: note.trim() || undefined, followUpType: type, priority });
  }

  return (
    <div className="fixed inset-0 z-[500] grid place-items-center bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl dark:bg-navy-900">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-navy dark:text-white">Schedule Follow-up</h2>
            <p className="text-xs text-muted-foreground">{customerName}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-5">
          <p className="text-sm font-semibold text-foreground">Follow-up Type</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {TYPES.map(({ value, label, icon: Icon }) => (
              <button key={value} type="button" onClick={() => setType(value)} className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-center text-[11px] font-semibold ${type === value ? 'border-gold bg-gold/10 text-navy' : 'border-input text-slate-600 hover:border-gold dark:text-slate-300'}`}>
                <Icon className="h-4 w-4" />{label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div><p className="text-sm font-semibold text-foreground">Date</p><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-gold" /></div>
            <div><p className="text-sm font-semibold text-foreground">Time</p><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-gold" /></div>
          </div>

          <p className="mt-4 text-sm font-semibold text-foreground">Priority</p>
          <div className="mt-2 flex gap-2">
            {PRIORITIES.map((p) => (
              <button key={p.value} type="button" onClick={() => setPriority(p.value)} className={`flex-1 rounded-lg border px-3 py-2 text-xs font-bold ${priority === p.value ? p.cls : 'border-input text-slate-500'}`}>{p.label}</button>
            ))}
          </div>

          <p className="mt-4 text-sm font-semibold text-foreground">Notes</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What to follow up about" className="mt-1.5 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-input px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted">Cancel</button>
          <button type="button" disabled={!date || !time || saving} onClick={save} className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{saving ? 'Saving…' : 'Schedule Follow-up'}</button>
        </div>
      </div>
    </div>
  );
}
