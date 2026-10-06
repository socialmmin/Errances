'use client';

import { usePackageDelivery } from '@/hooks/use-whatsapp';

// Sent / not-sent counts for one itinerary, computed from real WhatsApp logs. `compact` shows a
// single line (the first itinerary's numbers) for a package whose list of itineraries is folded.
export function PackageDeliveryStats({ packageId, compact }: { packageId: string; compact?: boolean }) {
  const { data } = usePackageDelivery(packageId);
  if (!data) return <span className="text-xs text-slate-400">…</span>;
  const rows = [
    { label: data.primaryLabel, sent: data.sent, total: data.total },
    ...data.additionalDocuments.map((d) => ({ label: d.label, sent: d.sent, total: d.total })),
  ];
  const line = (r: { sent: number; total: number }) => (
    <span className="whitespace-nowrap"><b className="text-navy">{r.sent}/{r.total}</b> <span className="text-slate-500">sent</span>{r.total - r.sent > 0 && <span className="font-semibold text-amber-700"> · {r.total - r.sent} not sent</span>}</span>
  );
  if (compact || rows.length === 1) {
    return <div className="text-xs">{line(rows[0])}{data.noPhone > 0 && <span className="whitespace-nowrap font-semibold text-red-600"> · {data.noPhone} no number</span>}</div>;
  }
  return (
    <div className="space-y-1 text-xs">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 whitespace-nowrap">
          <span className="w-12 shrink-0 rounded bg-slate-100 px-1 py-0.5 text-center font-bold text-slate-500">{r.label}</span>{line(r)}
        </div>
      ))}
      {data.noPhone > 0 && <p className="font-semibold text-red-600">{data.noPhone} no number</p>}
    </div>
  );
}
