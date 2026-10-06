'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';

// The ⋮ menu on a table row. It is drawn on top of the whole page (not inside the table), so a
// short or scrolling table can never cut it off; it opens upward when there is no room below.
export function RowMenu({ children, label = 'More actions' }: { children: (close: () => void) => React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const place = () => {
      const r = btn.current!.getBoundingClientRect();
      const h = menu.current?.offsetHeight ?? 200;
      const w = menu.current?.offsetWidth ?? 220;
      const below = r.bottom + 6 + h <= window.innerHeight - 8;
      setPos({ top: below ? r.bottom + 6 : Math.max(8, r.top - 6 - h), left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) });
    };
    place();
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', away);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [open]);

  return (
    <>
      <button ref={btn} type="button" aria-label={label} title={label} onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-gold"><MoreVertical className="h-4 w-4" /></button>
      {open && typeof document !== 'undefined' && createPortal(
        <div ref={menu} onClick={(e) => e.stopPropagation()} style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999 }} className="z-[400] w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-left shadow-2xl">
          {children(() => setOpen(false))}
        </div>,
        document.body,
      )}
    </>
  );
}

export const rowMenuItem = 'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50';
