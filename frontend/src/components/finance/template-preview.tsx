'use client';

const STATUS_CLS: Record<string, string> = { APPROVED: 'bg-emerald-100 text-emerald-700', PENDING: 'bg-amber-100 text-amber-800', REJECTED: 'bg-red-100 text-red-700' };
const STATUS_TEXT: Record<string, string> = { APPROVED: 'Approved by Meta', PENDING: 'With Meta for review', REJECTED: 'Rejected by Meta' };

// How a WhatsApp template will look on the customer's phone, with sample values filled in --
// shown before it is submitted to Meta, so the wording can be checked first.
export function TemplatePreview({ title, preview, button, status, note }: { title: string; preview?: string | null; button?: string | null; status?: string | null; note?: string }) {
  if (!preview) return null;
  const key = String(status || '');
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-slate-900">
      <p className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
        {title}
        <span className={`rounded-full px-2 py-0.5 normal-case tracking-normal ${STATUS_CLS[key] ?? 'bg-slate-100 text-slate-600'}`}>{STATUS_TEXT[key] ?? 'Not submitted yet'}</span>
      </p>
      <div className="mt-2 rounded-xl bg-[#efe7dd] p-3">
        <div className="ml-auto w-fit max-w-[95%] overflow-hidden rounded-lg rounded-tr-none bg-[#d9fdd3] shadow-sm">
          <p className="whitespace-pre-wrap break-words px-3 py-2 text-sm leading-snug">{preview}</p>
          {button && <p className="border-t border-black/10 px-3 py-2 text-center text-sm font-semibold text-sky-700">{button}</p>}
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">{note ?? 'Sample values shown. Each customer gets their own name, invoice number, dates and amounts.'}</p>
    </div>
  );
}
