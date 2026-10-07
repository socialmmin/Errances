'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MapPinned, Megaphone } from 'lucide-react';
import { tr } from '@/i18n';
import { useMyAccess } from '@/hooks/use-access';

const TABS = [
  { href: '/packages', access: 'packages', label: 'Packages & Itinerary', icon: MapPinned },
  { href: '/bulk-whatsapp', access: 'whatsapp_broadcast', label: 'Bulk WhatsApp', icon: Megaphone },
];

// "Packages & Itinerary" and "Bulk WhatsApp" share one sidebar entry; this switches between the
// two pages. Each tab shows only to people allowed to open that page.
export function PackagesSectionTabs() {
  const pathname = usePathname();
  const { can } = useMyAccess();
  const tabs = TABS.filter((t) => can(t.access));
  if (tabs.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-1 border-b">
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link key={t.href} href={t.href} className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold ${active ? 'border-gold text-navy dark:text-gold' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            <t.icon className="h-4 w-4" />{tr(t.label)}
          </Link>
        );
      })}
    </div>
  );
}
