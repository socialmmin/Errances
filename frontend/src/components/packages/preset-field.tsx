'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ItineraryPreset } from '@/hooks/use-packages';

interface Actions {
  add: (value: string) => void;
  update: (id: string, value: string) => void;
  remove: (id: string) => void;
}

// Text input with a saved-values dropdown. Typing a new value offers to add it
// to the list; every saved value can be edited or deleted in place.
export function PresetField({ items, value, onChange, actions, placeholder, inputMode, maxLength, className }: {
  items: ItineraryPreset[]; value: string; onChange: (value: string) => void; actions: Actions;
  placeholder?: string; inputMode?: 'tel' | 'text'; maxLength?: number; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) { setOpen(false); setEditingId(null); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const typed = value.trim();
  const exists = items.some((item) => item.value.toLowerCase() === typed.toLowerCase());
  const shown = items.filter((item) => !typed || item.value.toLowerCase().includes(typed.toLowerCase()) || item.value === value);

  return (
    <div ref={ref} className={`relative ${className ?? 'mt-1.5'}`}>
      <Input value={value} inputMode={inputMode} maxLength={maxLength} placeholder={placeholder} onFocus={() => setOpen(true)} onChange={(e) => { onChange(e.target.value); setOpen(true); }} className="pr-9" />
      <button type="button" tabIndex={-1} onClick={() => setOpen((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Show saved list"><ChevronDown className="h-4 w-4" /></button>
      {open && (
        <div className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-border bg-white p-1 shadow-xl">
          {shown.map((item) => (
            <div key={item.id} className="group flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-gold/10">
              {editingId === item.id ? (
                <>
                  <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={maxLength} className="min-w-0 flex-1 rounded border border-gold px-2 py-1 text-sm outline-none" />
                  <button type="button" onClick={() => { const v = draft.trim(); if (v) { actions.update(item.id, v); if (value === item.value) onChange(v); } setEditingId(null); }} className="rounded p-1 text-green-600 hover:bg-green-50" aria-label="Save"><Check className="h-4 w-4" /></button>
                  <button type="button" onClick={() => setEditingId(null)} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Cancel"><X className="h-4 w-4" /></button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => { onChange(item.value); setOpen(false); }} className="min-w-0 flex-1 truncate text-left text-sm">{item.value}</button>
                  <button type="button" onClick={() => { setEditingId(item.id); setDraft(item.value); }} className="rounded p-1 text-muted-foreground hover:bg-white" aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => actions.remove(item.id)} className="rounded p-1 text-red-500 hover:bg-white" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                </>
              )}
            </div>
          ))}
          {typed && !exists && (
            <button type="button" onClick={() => { actions.add(typed); setOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-semibold text-gold hover:bg-gold/10"><Plus className="h-4 w-4" />Add “{typed}” to list</button>
          )}
          {!shown.length && !typed && <p className="px-2 py-2 text-xs text-muted-foreground">Nothing saved yet — type a value and add it.</p>}
        </div>
      )}
    </div>
  );
}

// Dropdown of saved message templates. {destination} in a template is replaced
// by the itinerary's destination when applied.
export function MessageTemplatePicker({ items, onPick, onSaveCurrent, actions }: {
  items: ItineraryPreset[]; onPick: (template: string) => void; onSaveCurrent: () => void; actions: Actions;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) { setOpen(false); setEditingId(null); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const filtered = items.filter((item) => !query.trim() || item.value.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div ref={ref} className="relative mt-1.5 flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 rounded-lg border border-input bg-white px-3 py-1.5 text-sm font-semibold text-navy hover:border-gold">Message templates <ChevronDown className="h-4 w-4" /></button>
      <button type="button" onClick={onSaveCurrent} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-gold hover:bg-gold/10"><Plus className="h-3.5 w-3.5" />Save current message as template</button>
      <span className="text-[11px] text-muted-foreground">{'{destination}'} is replaced by the place name automatically</span>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-border bg-white p-1 shadow-xl">
          <div className="sticky top-0 z-10 bg-white p-1"><div className="relative"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search templates…" className="w-full rounded-lg border border-input py-1.5 pl-8 pr-2 text-xs outline-none focus:border-gold" /></div></div>
          {filtered.map((item) => (
            <div key={item.id} className="flex items-start gap-1 rounded-lg px-2 py-1.5 hover:bg-gold/10">
              {editingId === item.id ? (
                <>
                  <textarea autoFocus rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} className="min-w-0 flex-1 whitespace-pre-wrap rounded border border-gold p-2 text-xs outline-none" />
                  <button type="button" onClick={() => { const v = draft.trim(); if (v) actions.update(item.id, v); setEditingId(null); }} className="rounded p-1 text-green-600 hover:bg-green-50" aria-label="Save"><Check className="h-4 w-4" /></button>
                  <button type="button" onClick={() => setEditingId(null)} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Cancel"><X className="h-4 w-4" /></button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => { onPick(item.value); setOpen(false); }} className="min-w-0 flex-1 whitespace-pre-line text-left text-xs leading-5">{item.value}</button>
                  <button type="button" onClick={() => { setEditingId(item.id); setDraft(item.value); }} className="rounded p-1 text-muted-foreground hover:bg-white" aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => actions.remove(item.id)} className="rounded p-1 text-red-500 hover:bg-white" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                </>
              )}
            </div>
          ))}
          {items.length > 0 && !filtered.length && <p className="px-2 py-2 text-xs text-muted-foreground">No template matches “{query}”.</p>}
          {!items.length && <p className="px-2 py-2 text-xs text-muted-foreground">No templates yet. Write a message, then “Save current message as template”.</p>}
        </div>
      )}
    </div>
  );
}

export interface ItinerarySetup {
  title: string; destination: string; name: string; message: string;
  contactName: string; contactNumber: string; buttonLabel: string;
  objectKey: string; fileName: string; fileSize?: number;
  buttons?: import('@/types/package').PackageButton[];
}

export function parseSetup(item: ItineraryPreset): ItinerarySetup | null {
  try { return JSON.parse(item.value) as ItinerarySetup; } catch { return null; }
}

// One-click saved setups: choosing one fills destination, message, consultant,
// call button and the PDF; anything can still be adjusted afterwards.
export function SetupPicker({ items, onApply, onSaveCurrent, actions }: {
  items: ItineraryPreset[]; onApply: (setup: ItinerarySetup) => void; onSaveCurrent: () => void;
  actions: { update: (id: string, value: string) => void; remove: (id: string) => void };
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const rows = items.map((item) => ({ item, setup: parseSetup(item) })).filter((row): row is { item: ItineraryPreset; setup: ItinerarySetup } => !!row.setup)
    .filter((row) => !query.trim() || `${row.setup.title} ${row.setup.destination} ${row.setup.fileName}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div ref={ref} className="relative flex flex-wrap items-center gap-2 rounded-xl border border-gold/30 bg-gold/5 px-4 py-3">
      <div className="min-w-0 flex-1"><p className="text-sm font-bold text-navy">Saved itineraries</p><p className="text-xs text-muted-foreground">Pick one to fill everything in one click, then change what you need.</p></div>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 rounded-lg border border-input bg-white px-3 py-1.5 text-sm font-semibold text-navy hover:border-gold">Use saved <ChevronDown className="h-4 w-4" /></button>
      <button type="button" onClick={onSaveCurrent} className="flex items-center gap-1 rounded-lg bg-gold px-3 py-1.5 text-sm font-semibold text-navy hover:opacity-90"><Plus className="h-4 w-4" />Save this itinerary</button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-border bg-white p-1 shadow-xl">
          <div className="sticky top-0 z-10 bg-white p-1"><div className="relative"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search saved itineraries…" className="w-full rounded-lg border border-input py-1.5 pl-8 pr-2 text-xs outline-none focus:border-gold" /></div></div>
          {rows.map(({ item, setup }) => (
            <div key={item.id} className="flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-gold/10">
              <button type="button" onClick={() => { onApply(setup); setOpen(false); }} className="min-w-0 flex-1 text-left"><p className="truncate text-sm font-semibold text-navy">{setup.title}</p><p className="truncate text-[11px] text-muted-foreground">{setup.destination} · {setup.fileName} · {setup.contactName || 'no name'} {setup.contactNumber}</p></button>
              <button type="button" onClick={() => { const title = window.prompt('Rename saved itinerary', setup.title); if (title && title.trim()) actions.update(item.id, JSON.stringify({ ...setup, title: title.trim() })); }} className="rounded p-1 text-muted-foreground hover:bg-white" aria-label="Rename"><Pencil className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => { if (window.confirm('Delete this saved itinerary?')) actions.remove(item.id); }} className="rounded p-1 text-red-500 hover:bg-white" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          {!rows.length && <p className="px-2 py-3 text-xs text-muted-foreground">{items.length ? 'No saved itinerary matches.' : 'Nothing saved yet. Fill the form and press “Save this itinerary”.'}</p>}
        </div>
      )}
    </div>
  );
}
