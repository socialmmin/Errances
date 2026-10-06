'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ExternalLink, MessageCircle } from 'lucide-react';

// Two very different jobs share the same "WhatsApp" button: replying to whatever
// the customer just sent (that's the CRM Inbox, backed by the Cloud API number),
// and manually sending an itinerary from a personal WhatsApp number when the Cloud
// API can't (that's WhatsApp Web). Asking each time avoids guessing wrong.
export function WhatsAppChoice({ leadId, phone, className, title, children }: { leadId: string; phone: string; className?: string; title?: string; children: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { const t = event.target as Node; if (ref.current && !ref.current.contains(t) && !menuRef.current?.contains(t)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const digits = phone.replace(/\D/g, '');

  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" title={title || 'WhatsApp'} disabled={!digits} className={className} onClick={(event) => { event.stopPropagation(); if (!open && ref.current) { const b = ref.current.getBoundingClientRect(); setPos({ top: b.bottom + 4, left: Math.max(8, Math.min(b.left, window.innerWidth - 248)) }); } setOpen((v) => !v); }}>
        {children}
      </button>
      {open && createPortal(
        <div ref={menuRef} style={{ position: 'fixed', top: pos.top, left: pos.left }} className="z-[300] w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-left shadow-xl dark:border-white/10 dark:bg-navy-950" onClick={(event) => event.stopPropagation()}>
          <button
            onClick={() => { setOpen(false); router.push(`/whatsapp?lead=${leadId}`); }}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
          >
            <MessageCircle className="h-4 w-4 text-emerald-600" />
            <span><span className="block font-medium">Open in CRM Inbox</span><span className="block text-xs text-slate-400">See what they last sent, reply from our number</span></span>
          </button>
          <button
            onClick={() => { setOpen(false); window.open(`https://wa.me/${digits}`, '_blank', 'noopener,noreferrer'); }}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
          >
            <ExternalLink className="h-4 w-4 text-slate-500" />
            <span><span className="block font-medium">Open WhatsApp Web</span><span className="block text-xs text-slate-400">Send manually from your personal number</span></span>
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
