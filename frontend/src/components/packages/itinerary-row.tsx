'use client';

import Link from 'next/link';
import { ChevronDown, Eye, MessagesSquare, Pencil } from 'lucide-react';
import { usePackageDelivery } from '@/hooks/use-whatsapp';
import { ActiveSwitch } from '@/components/packages/active-switch';

// The columns of the Itinerary Library, shared by its header and every row.
export const ITIN_GRID = 'grid grid-cols-[minmax(11rem,1.6fr)_minmax(6rem,0.7fr)_9.5rem_minmax(10rem,1fr)_8.5rem_6.75rem] items-center gap-3';

const STATUS_CLS: Record<string, string> = { APPROVED: 'bg-emerald-100 text-emerald-700', PENDING: 'bg-amber-100 text-amber-700', REJECTED: 'bg-red-100 text-red-700' };
const STATUS_TEXT: Record<string, string> = { APPROVED: 'Approved', PENDING: 'With Meta', REJECTED: 'Rejected' };
const days = (d?: number | null, n?: number | null) => (d ? `${d}D/${n ?? 0}N` : null);
const icon = 'grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-navy hover:border-gold disabled:cursor-not-allowed disabled:opacity-40';

// One itinerary package: a single compact line. A package with several itineraries shows how
// many there are; "Explore" opens the full list underneath with each one's file, approval and
// delivery numbers.
export function ItineraryRow({ pkg, open, onToggle, onPreview }: { pkg: any; open: boolean; onToggle: () => void; onPreview: (objectKey: string) => void }) {
  const { data } = usePackageDelivery(pkg.id);
  const docs: { key: string; label: string; file: string; status: string | null; objectKey: string }[] = [
    ...(pkg.itinerary_pdf_object_key ? [{ key: 'primary', label: days(pkg.duration_days, pkg.duration_nights) ?? 'Itinerary 1', file: pkg.itinerary_pdf_file_name || 'Itinerary', status: pkg.whatsapp_template_status ?? null, objectKey: pkg.itinerary_pdf_object_key }] : []),
    ...(pkg.additional_documents ?? []).map((d: any, i: number) => ({ key: d.id, label: days(d.duration_days, d.duration_nights) ?? `Itinerary ${i + 2}`, file: d.file_name || 'Itinerary', status: d.whatsapp_template_status ?? null, objectKey: d.object_key })),
  ];
  const stats = data ? [{ sent: data.sent, total: data.total }, ...data.additionalDocuments.map((d) => ({ sent: d.sent, total: d.total }))] : [];
  const first = stats[0];
  const many = docs.length > 1;

  return (
    <div className={`border-b text-sm transition ${open ? 'bg-amber-50/50' : 'hover:bg-amber-50/40'}`}>
      <div className={`${ITIN_GRID} px-4 py-2.5`}>
        <Link href={`/packages/${pkg.id}/messages`} title={`${pkg.name} — see every message sent`} className="min-w-0 truncate font-semibold text-navy hover:underline">{pkg.name}</Link>
        <span className="min-w-0 truncate text-slate-600" title={pkg.destinations?.join(', ')}>{pkg.destinations?.join(', ') || '—'}</span>
        <span className="min-w-0">
          {many ? (
            <button type="button" onClick={onToggle} aria-expanded={open} className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold ${open ? 'border-navy bg-navy text-white' : 'border-slate-200 bg-white text-navy hover:border-gold'}`}>
              <span className={`rounded-full px-1.5 text-[11px] ${open ? 'bg-white/20' : 'bg-navy text-white'}`}>{docs.length}</span>itineraries<ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          ) : docs[0] ? (
            <span className="flex items-center gap-1.5"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_CLS[docs[0].status ?? ''] ?? 'bg-slate-100 text-slate-600'}`} title={STATUS_TEXT[docs[0].status ?? ''] ?? 'Not submitted'}>{docs[0].label}</span></span>
          ) : <span className="text-xs text-slate-400">Not uploaded</span>}
        </span>
        <span className="min-w-0 truncate text-xs">
          {first ? <><b className="text-navy">{first.sent}/{first.total}</b> <span className="text-slate-500">sent</span>{first.total - first.sent > 0 && <span className="font-semibold text-amber-700"> · {first.total - first.sent} not sent</span>}{(data?.noPhone ?? 0) > 0 && <span className="font-semibold text-red-600"> · {data!.noPhone} no number</span>}</> : <span className="text-slate-400">…</span>}
        </span>
        <ActiveSwitch pkg={pkg} />
        <span className="flex justify-end gap-1.5">
          <button type="button" className={icon} disabled={!pkg.itinerary_pdf_object_key} title="Preview the itinerary" aria-label="Preview the itinerary" onClick={() => onPreview(pkg.itinerary_pdf_object_key)}><Eye className="h-4 w-4" /></button>
          <Link href={`/packages/${pkg.id}/messages`} className="grid h-8 w-8 place-items-center rounded-lg bg-navy text-white hover:brightness-125" title="See every message sent" aria-label="Messages"><MessagesSquare className="h-4 w-4" /></Link>
          <Link href={`/packages/${pkg.id}`} className={icon} title="Edit this itinerary" aria-label="Edit"><Pencil className="h-4 w-4" /></Link>
        </span>
      </div>

      {open && many && (
        <div className="mx-4 mb-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="grid grid-cols-[6rem_minmax(10rem,1fr)_8rem_12rem_3rem] items-center gap-3 bg-slate-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500"><span>Duration</span><span>File</span><span>Template</span><span>Sent / not sent</span><span className="text-right">View</span></div>
          {docs.map((d, i) => (
            <div key={d.key} className="grid grid-cols-[6rem_minmax(10rem,1fr)_8rem_12rem_3rem] items-center gap-3 border-t border-slate-100 px-4 py-2 text-xs">
              <span><span className="whitespace-nowrap rounded-full bg-navy px-2 py-0.5 font-bold text-white">{d.label}</span></span>
              <span className="min-w-0 truncate text-slate-600" title={d.file}>{d.file}</span>
              <span><span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-bold ${STATUS_CLS[d.status ?? ''] ?? 'bg-slate-100 text-slate-600'}`}>{STATUS_TEXT[d.status ?? ''] ?? 'Not submitted'}</span></span>
              <span className="whitespace-nowrap">{stats[i] ? <><b className="text-navy">{stats[i].sent}/{stats[i].total}</b> <span className="text-slate-500">sent</span>{stats[i].total - stats[i].sent > 0 && <span className="font-semibold text-amber-700"> · {stats[i].total - stats[i].sent} not sent</span>}</> : <span className="text-slate-400">—</span>}</span>
              <span className="flex justify-end"><button type="button" className={icon} title="Preview this itinerary" aria-label="Preview this itinerary" onClick={() => onPreview(d.objectKey)}><Eye className="h-4 w-4" /></button></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
