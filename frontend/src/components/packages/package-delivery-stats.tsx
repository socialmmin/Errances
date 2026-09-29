'use client';

import { usePackageDelivery } from '@/hooks/use-whatsapp';
import { tr } from '@/i18n';

// Sent / Seen / Not-sent counts for one itinerary, computed from real WhatsApp logs.
export function PackageDeliveryStats({ packageId }: { packageId: string }) {
  const { data } = usePackageDelivery(packageId);
  if (!data) return <span className="text-xs text-slate-400">…</span>;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
      <span className="font-bold text-navy">{data.sent}/{data.total}{' '}{tr("sent")}</span>
      <span className="font-semibold text-amber-700">{data.pending}{' '}{tr("not sent")}</span>
      {data.noPhone > 0 && <span className="font-semibold text-red-600">{data.noPhone}{' '}{tr("no number")}</span>}
    </div>
  );
}
