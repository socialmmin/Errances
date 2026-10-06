'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';

interface PublicQuotationItem {
  category: string | null;
  description: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
}

interface PublicInvoice {
  invoice_number: string;
  total_amount: number;
}

interface Company {
  company_name: string | null; legal_name: string | null; logo_url: string | null;
  phone: string | null; email: string | null; website: string | null; address: string | null; gstin: string | null;
  bank_name: string | null; bank_account_name: string | null; bank_account_number: string | null; bank_ifsc: string | null; bank_branch: string | null; upi_id: string | null;
}

interface PublicQuotation {
  id: string;
  quotation_number: string;
  destination: string | null;
  travel_from: string | null;
  travel_to: string | null;
  adults: number;
  children: number;
  infants: number;
  base_amount: number;
  discount_amount: number;
  gst_amount: number;
  final_amount: number;
  status: string;
  payments?: { paid_at: string; amount: number; method: string | null; reference: string | null }[];
  valid_until: string | null;
  notes: string | null;
  created_at: string | null;
  signature_data: string | null;
  customer_name: string | null;
  lead_customer_name: string | null;
  customer_phone: string | null;
  invoice_number: string | null;
  invoice_total: number | null;
  invoice_date: string | null;
  invoice_cancelled_at?: string | null;
  refunded_amount?: number | null;
  paid_amount: number | null;
  items: PublicQuotationItem[];
  company: Company | null;
}

function money(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n) || 0);
}
function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// "Thirteen Thousand Seven Hundred Eighty Eight" -- Indian numbering (lakh, crore).
function inWords(amount: number): string {
  const n = Math.round(Number(amount) || 0);
  if (n === 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x: number) => (x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? ` ${ones[x % 10]}` : ''}`);
  const three = (x: number) => `${x >= 100 ? `${ones[Math.floor(x / 100)]} Hundred${x % 100 ? ' ' : ''}` : ''}${x % 100 ? two(x % 100) : ''}`;
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000), lakh = Math.floor((n % 10000000) / 100000), thousand = Math.floor((n % 100000) / 1000), rest = n % 1000;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (rest) parts.push(three(rest));
  return parts.join(' ');
}

// The signature without the empty space around it.
function trimmedSignature(canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas.toDataURL('image/png');
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 0) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) return canvas.toDataURL('image/png');
  const pad = 8;
  const sx = Math.max(0, minX - pad), sy = Math.max(0, minY - pad);
  const sw = Math.min(width, maxX + pad) - sx, sh = Math.min(height, maxY + pad) - sy;
  const out = document.createElement('canvas');
  out.width = sw; out.height = sh;
  out.getContext('2d')?.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return out.toDataURL('image/png');
}

// A plain canvas signature pad -- no library, just pointer events drawing a path. Confirm
// returns a base64 PNG; Clear wipes it so they can redo it before confirming.
function SignaturePad({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  // The canvas is drawn at 800x360 but shown at whatever width the pop-up has, so pointer
  // positions are scaled back to the drawing size.
  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) * e.currentTarget.width) / rect.width, y: ((e.clientY - rect.top) * e.currentTarget.height) / rect.height };
  }
  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const ctx = canvasRef.current?.getContext('2d');
    const { x, y } = pos(e);
    ctx?.beginPath();
    ctx?.moveTo(x, y);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0b2545';
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasDrawn) setHasDrawn(true);
  }
  function end() {
    drawing.current = false;
  }
  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <h3 className="text-base font-semibold text-slate-800">Sign to approve</h3>
        <p className="mt-1 text-xs text-slate-500">Draw your signature in the box below, then confirm.</p>
        <canvas
          ref={canvasRef}
          width={800}
          height={360}
          className="mt-3 w-full touch-none rounded-lg border-2 border-dashed border-slate-300 bg-slate-50"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
        <div className="mt-4 flex justify-between gap-2">
          <button type="button" onClick={clear} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            Clear
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { if (hasDrawn && canvasRef.current) onConfirm(trimmedSignature(canvasRef.current)); }}
              disabled={!hasDrawn}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Confirm Signature
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="flex items-center gap-2 text-right font-semibold text-slate-900">
        <span className="break-all">{value}</span>
        <button type="button" onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="shrink-0 rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:border-[#c9a13b] print:hidden">{copied ? 'Copied' : 'Copy'}</button>
      </span>
    </div>
  );
}

export default function PublicQuotationPage() {
  const params = useParams<{ token: string }>();
  const searchParams = useSearchParams();
  const [quotation, setQuotation] = useState<PublicQuotation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [showSignature, setShowSignature] = useState(false);
  const paymentRef = useRef<HTMLElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [making, setMaking] = useState(false);
  // Two separate links for the customer: /q/<token> is the quotation, /i/<token> is the invoice.
  const router = useRouter();
  const isInvoiceLink = (usePathname() || '').startsWith('/i/');

  // Builds the PDF file from the sheet exactly as shown, in full colour, and saves it -- no
  // browser print dialog, so no black-and-white setting, date stamp or web address on the page.
  async function downloadPdf() {
    const sheet = sheetRef.current;
    if (!sheet || making) return;
    setMaking(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const fix = document.createElement('style');
      fix.textContent = 'img { display: inline-block !important; }';
      document.head.appendChild(fix);
      let canvas: HTMLCanvasElement;
      try { canvas = await html2canvas(sheet, { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 1100 }); }
      finally { fix.remove(); }
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
      const pageW = 210, pageH = 297, margin = 8;
      const imgW = pageW - margin * 2;
      const pxPerMm = canvas.width / imgW;
      const pagePx = Math.floor((pageH - margin * 2) * pxPerMm);
      for (let y = 0, page = 0; y < canvas.height; y += pagePx, page++) {
        const h = Math.min(pagePx, canvas.height - y);
        const slice = document.createElement('canvas');
        slice.width = canvas.width; slice.height = h;
        slice.getContext('2d')?.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
        if (page > 0) pdf.addPage();
        pdf.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, imgW, h / pxPerMm);
      }
      const invoiceDoc = isInvoiceLink && !!quotation?.invoice_number;
      pdf.save(`${(invoiceDoc ? quotation?.invoice_number : quotation?.quotation_number) || 'document'}.pdf`);
    } catch {
      window.print();
    } finally {
      setMaking(false);
    }
  }

  async function load() {
    const q = await api.get<PublicQuotation>(`/quotations/public/${params.token}`);
    setQuotation(q);
  }
  useEffect(() => {
    if (!params.token) return;
    load()
      .catch((err: ApiError) => setError(err.status === 404 ? 'This quotation link is invalid or has expired.' : 'Something went wrong loading this quotation.'))
      .finally(() => setLoading(false));
  }, [params.token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Linked here with ?print=1 (the Download button in the CRM) -- opens the print dialog once
  // the data and the logo are in, so "Download" doesn't need a second click.
  useEffect(() => {
    if (quotation && searchParams.get('print') === '1') {
      const t = setTimeout(() => downloadPdf(), 900);
      return () => clearTimeout(t);
    }
  }, [!!quotation, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Signing approves the quotation, creates the invoice, and takes the customer straight to
  // the invoice and how to pay it.
  async function onConfirmApprove(signature: string) {
    if (!params.token) return;
    setShowSignature(false);
    setApproving(true);
    setApproveError(null);
    try {
      await api.post<{ quotation: PublicQuotation; invoice: PublicInvoice }>(`/quotations/public/${params.token}/approve`, { signature });
      // Signed: go straight to the invoice and how to pay it.
      router.replace(`/i/${params.token}`);
    } catch (e: any) {
      setApproveError(e?.message && e.status === 400 ? e.message : 'Could not approve this quotation right now — please try again or contact us.');
    } finally {
      setApproving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">Loading your quotation…</p>
      </div>
    );
  }

  if (error || !quotation) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-sm text-center">
          <p className="text-lg font-semibold text-slate-800">Quotation not found</p>
          <p className="mt-2 text-sm text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  const q = quotation;
  const co = q.company;
  const companyName = co?.company_name?.trim() || 'Errances Voyages';
  const logo = co?.logo_url || '/icon-512.jpg';
  const customerName = q.customer_name || q.lead_customer_name || 'Traveller';
  const isApproved = q.status === 'accepted' || q.status === 'converted' || !!q.invoice_number;
  const isClosed = q.status === 'rejected' || q.status === 'expired';
  const asInvoice = isInvoiceLink && !!q.invoice_number;
  const docWord = asInvoice ? 'Invoice' : 'Quotation';
  const taxable = q.base_amount - q.discount_amount;
  const gstPct = taxable > 0 ? Math.round((q.gst_amount / taxable) * 1000) / 10 : 0;
  const discountPct = q.base_amount > 0 ? Math.round((q.discount_amount / q.base_amount) * 1000) / 10 : 0;
  const nights = q.travel_from && q.travel_to ? Math.max(0, Math.round((new Date(q.travel_to).getTime() - new Date(q.travel_from).getTime()) / 86400000)) : null;
  const travellers = [q.adults ? plural(q.adults, 'Adult', 'Adults') : '', q.children ? plural(q.children, 'Child', 'Children') : '', q.infants ? plural(q.infants, 'Infant', 'Infants') : ''].filter(Boolean).join(', ') || '—';
  const payable = Number(q.invoice_total ?? q.final_amount) || 0;
  const paid = Number(q.paid_amount) || 0;
  const cancelled = !!q.invoice_cancelled_at;
  const refunded = Number(q.refunded_amount) || 0;
  const balance = cancelled ? 0 : Math.max(payable - paid, 0);
  const upiLink = co?.upi_id ? `upi://pay?pa=${encodeURIComponent(co.upi_id)}&pn=${encodeURIComponent(companyName)}&am=${balance}&cu=INR&tn=${encodeURIComponent(q.invoice_number || q.quotation_number)}` : null;
  const hasBank = !!(co?.bank_account_number && co?.bank_ifsc);
  const waDigits = (co?.phone || '').replace(/\D/g, '');
  const waNumber = waDigits.length === 10 ? `91${waDigits}` : waDigits;
  const contactLine = [co?.phone, co?.email, co?.website].filter(Boolean).join('  ·  ');
  const th = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider';
  const td = 'px-3 py-2 align-top text-sm';

  return (
    // The app shell locks html/body scrolling (its own pages manage scroll internally) -- this
    // page lives outside that shell, so it needs its own scrollable viewport.
    <div className="h-screen overflow-y-auto bg-[#e9edf3] px-3 py-6 sm:px-4 sm:py-10 print:h-auto print:overflow-visible print:bg-white print:p-0">
      <style>{`@media print { @page { size: A4; margin: 12mm 11mm; } html, body { height: auto !important; overflow: visible !important; background: #fff !important; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>

      <div className="mx-auto mb-4 flex max-w-4xl flex-wrap items-center justify-between gap-2 print:hidden">
        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600">{docWord} for <b className="text-[#0b2545]">{customerName}</b>
          {isInvoiceLink && !q.invoice_number && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">The invoice is created once this quotation is approved — showing the quotation.</span>}</p>
        <button type="button" onClick={downloadPdf} disabled={making} className="rounded-lg bg-[#0b2545] px-4 py-2 text-sm font-semibold text-white shadow hover:bg-[#132f57] disabled:opacity-60">{making ? 'Preparing PDF…' : 'Download PDF'}</button>
      </div>

      {/* One "sheet of paper". It is laid out as a table so the letterhead (thead) and the
          footer (tfoot) repeat on every printed page. */}
      <div ref={sheetRef} className="mx-auto max-w-4xl overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 print:max-w-none print:rounded-none print:shadow-none print:ring-0">
        <table className="w-full border-collapse">
          <thead>
            <tr><td className="p-0">
              <div className="h-2 bg-gradient-to-r from-[#0b2545] via-[#1b3a68] to-[#c9a13b]" />
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 sm:px-8">
                <div className="flex min-w-0 items-center gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <span className="block h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200"><img src={logo} alt={companyName} crossOrigin={co?.logo_url ? 'anonymous' : undefined} className={co?.logo_url ? 'h-full w-full object-contain' : 'h-full w-full scale-[4] object-cover'} /></span>
                  <div className="min-w-0">
                    <p className="text-xl font-extrabold tracking-tight text-[#0b2545]">{companyName}</p>
                    {co?.legal_name && co.legal_name !== companyName && <p className="text-xs text-slate-500">{co.legal_name}</p>}
                    {co?.address && <p className="mt-1 max-w-md whitespace-pre-line text-xs leading-relaxed text-slate-600">{co.address}</p>}
                    {contactLine && <p className="mt-0.5 text-xs text-slate-600">{contactLine}</p>}
                    {co?.gstin && <p className="mt-0.5 text-xs font-semibold text-slate-700">GSTIN: {co.gstin}</p>}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-black uppercase tracking-[0.18em] text-[#c9a13b]">{docWord}</p>
                  <p className="mt-1 text-sm font-bold text-[#0b2545]">{asInvoice ? q.invoice_number : q.quotation_number}</p>
                  <p className="text-xs text-slate-500">Date: {formatDate(asInvoice ? q.invoice_date : q.created_at)}</p>
                  {asInvoice ? <p className="text-xs text-slate-500">Against quotation: {q.quotation_number}</p> : q.valid_until && <p className="text-xs text-slate-500">Valid until: {formatDate(q.valid_until)}</p>}
                  <p className="mt-1.5"><span className={`inline-flex h-6 items-center rounded-full px-3 text-[11px] font-bold uppercase leading-none tracking-wide ${asInvoice ? (balance <= 0 ? 'bg-emerald-100 text-emerald-700' : paid > 0 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700') : isApproved ? 'bg-emerald-100 text-emerald-700' : isClosed ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-700'}`}>{asInvoice ? (cancelled ? 'Cancelled' : balance <= 0 ? 'Paid' : paid > 0 ? 'Part paid' : 'Payment due') : isApproved ? 'Approved' : isClosed ? q.status : 'Awaiting approval'}</span></p>
                </div>
              </div>
            </td></tr>
          </thead>

          <tbody>
            <tr><td className="px-6 py-4 sm:px-8">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[#c9a13b]">{asInvoice ? 'Billed to' : 'Prepared for'}</p>
                  <p className="mt-1.5 text-base font-bold text-[#0b2545]">{customerName}</p>
                  {q.customer_phone && <p className="text-sm text-slate-600">{q.customer_phone}</p>}
                </div>
                <div className="rounded-xl border border-slate-200 px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[#c9a13b]">Trip details</p>
                  <dl className="mt-1.5 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
                    <dt className="text-slate-500">Destination</dt><dd className="text-right font-semibold text-slate-900">{q.destination || '—'}</dd>
                    <dt className="text-slate-500">Travel dates</dt><dd className="text-right font-semibold text-slate-900">{formatDate(q.travel_from)} – {formatDate(q.travel_to)}</dd>
                    {nights !== null && <><dt className="text-slate-500">Duration</dt><dd className="text-right font-semibold text-slate-900">{nights > 0 ? `${plural(nights, 'Night', 'Nights')} / ${plural(nights + 1, 'Day', 'Days')}` : '1 Day'}</dd></>}
                    <dt className="text-slate-500">Travellers</dt><dd className="text-right font-semibold text-slate-900">{travellers}</dd>
                  </dl>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[34rem] border-collapse">
                  <thead>
                    <tr className="bg-[#0b2545] text-white">
                      <th className={`${th} w-10`}>#</th>
                      <th className={th}>Description</th>
                      <th className={th}>Category</th>
                      <th className={`${th} text-right`}>Qty</th>
                      <th className={`${th} text-right`}>Rate</th>
                      <th className={`${th} text-right`}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.items?.length ? q.items.map((item, i) => (
                      <tr key={i} className={`break-inside-avoid border-t border-slate-100 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                        <td className={`${td} tabular-nums text-slate-500`}>{i + 1}</td>
                        <td className={`${td} font-medium text-slate-900`}>{item.description || titleCase(item.category || 'Item')}</td>
                        <td className={`${td} text-slate-600`}>{item.category ? titleCase(item.category) : '—'}</td>
                        <td className={`${td} text-right tabular-nums text-slate-700`}>{item.quantity}</td>
                        <td className={`${td} text-right tabular-nums text-slate-700`}>{money(item.unit_price)}</td>
                        <td className={`${td} text-right font-semibold tabular-nums text-slate-900`}>{money(item.total_price)}</td>
                      </tr>
                    )) : <tr><td colSpan={6} className={`${td} text-center text-slate-500`}>No items added yet.</td></tr>}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-wrap items-start justify-between gap-4 break-inside-avoid">
                <div className="min-w-[14rem] flex-1 text-sm">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Amount in words</p>
                  <p className="mt-1 font-semibold text-slate-800">Rupees {inWords(q.final_amount)} Only</p>
                </div>
                <dl className="w-full max-w-xs overflow-hidden rounded-xl border border-slate-200 text-sm">
                  <div className="flex justify-between px-4 py-1.5"><dt className="text-slate-500">Subtotal</dt><dd className="tabular-nums text-slate-900">{money(q.base_amount)}</dd></div>
                  {q.discount_amount > 0 && <div className="flex justify-between px-4 py-2 text-emerald-700"><dt>Discount{discountPct ? ` (${discountPct}%)` : ''}</dt><dd className="tabular-nums">− {money(q.discount_amount)}</dd></div>}
                  <div className="flex justify-between border-t border-slate-100 px-4 py-1.5 font-semibold"><dt className="text-slate-700">Amount before tax</dt><dd className="tabular-nums text-slate-900">{money(taxable)}</dd></div>
                  <div className="flex justify-between px-4 py-1.5"><dt className="text-slate-500">GST{gstPct ? ` (${gstPct}%)` : ''}</dt><dd className="tabular-nums text-slate-900">+ {money(q.gst_amount)}</dd></div>
                  <div className="flex items-center justify-between bg-[#0b2545] px-4 py-2.5 text-white"><dt className="text-xs font-bold uppercase tracking-wider">{asInvoice ? 'Invoice total' : 'Total payable'}</dt><dd className="text-xl font-extrabold tabular-nums text-[#f0c96e]">{money(q.final_amount)}</dd></div>
                  {asInvoice && <div className="flex justify-between px-4 py-1.5"><dt className="text-slate-500">Paid{q.payments?.length ? ` (last on ${formatDate(q.payments[q.payments.length - 1].paid_at)})` : ''}</dt><dd className="tabular-nums text-emerald-700">{money(paid)}</dd></div>}
                  {asInvoice && refunded > 0 && <div className="flex justify-between px-4 py-1.5"><dt className="text-slate-500">Refunded</dt><dd className="tabular-nums text-amber-700">− {money(refunded)}</dd></div>}
                  {asInvoice && <div className="flex justify-between border-t border-slate-100 px-4 py-1.5 font-bold"><dt className="text-slate-800">{cancelled ? 'Balance due (cancelled)' : 'Balance due'}</dt><dd className={`tabular-nums ${balance > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{money(balance)}</dd></div>}
                </dl>
              </div>

              {asInvoice && (
                <div className="mt-4 break-inside-avoid overflow-hidden rounded-xl border border-slate-200">
                  <p className="bg-slate-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-[#c9a13b]">Payments received</p>
                  {q.payments?.length ? (
                    <table className="w-full border-collapse text-sm">
                      <thead><tr className="border-t border-slate-200 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500"><th className="px-4 py-2">#</th><th className="px-4 py-2">Paid on</th><th className="px-4 py-2">Method</th><th className="px-4 py-2">Reference</th><th className="px-4 py-2 text-right">Amount</th></tr></thead>
                      <tbody>
                        {q.payments.map((p, i) => (
                          <tr key={i} className="border-t border-slate-100"><td className="px-4 py-2 tabular-nums text-slate-500">{i + 1}</td><td className="px-4 py-2 font-medium text-slate-900">{new Date(p.paid_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</td><td className="px-4 py-2 capitalize text-slate-700">{String(p.method || '—').replace(/_/g, ' ')}</td><td className="px-4 py-2 text-slate-600">{p.reference || '—'}</td><td className="px-4 py-2 text-right font-semibold tabular-nums text-emerald-700">{money(p.amount)}</td></tr>
                        ))}
                        <tr className="border-t border-slate-200 bg-slate-50 font-bold"><td colSpan={4} className="px-4 py-2 text-right text-slate-700">Total received</td><td className="px-4 py-2 text-right tabular-nums text-emerald-700">{money(paid)}</td></tr>
                      </tbody>
                    </table>
                  ) : <p className="border-t border-slate-200 px-4 py-3 text-sm text-slate-500">No payment received yet.</p>}
                </div>
              )}

              {q.notes && (
                <div className="mt-6 break-inside-avoid rounded-xl border border-slate-200 p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[#c9a13b]">Notes</p>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700">{q.notes}</p>
                </div>
              )}

              <div className="mt-3 grid grid-cols-2 gap-6 break-inside-avoid text-sm">
                <div>
                  <div className="flex h-24 items-end justify-start pb-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {q.signature_data ? <img src={q.signature_data} alt="Customer signature" className="max-h-full max-w-[14rem] object-contain object-left-bottom" /> : null}
                  </div>
                  <div className="border-t border-slate-300 pt-1.5">
                    <p className="font-semibold text-slate-800">{customerName}</p>
                    <p className="text-xs text-slate-500">{isApproved ? 'Customer — approved & signed' : 'Customer signature'}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="h-24" />
                  <div className="border-t border-slate-300 pt-1.5">
                    <p className="font-semibold text-slate-800">For {companyName}</p>
                    <p className="text-xs text-slate-500">Authorised signatory</p>
                  </div>
                </div>
              </div>
            </td></tr>
          </tbody>

          <tfoot>
            <tr><td className="p-0">
              <div className="border-t border-slate-200 bg-slate-50 px-6 py-3 text-center text-[11px] leading-relaxed text-slate-500 sm:px-9">
                <p className="font-semibold text-slate-700">{companyName}{co?.gstin ? `  ·  GSTIN ${co.gstin}` : ''}</p>
                {(co?.address || contactLine) && <p>{[co?.address?.replace(/\s*\n\s*/g, ', '), contactLine].filter(Boolean).join('  ·  ')}</p>}
                <p>{asInvoice ? 'This is a computer-generated invoice.' : 'This is a computer-generated quotation. Prices are subject to availability at the time of booking.'}</p>
              </div>
              <div className="h-1.5 bg-gradient-to-r from-[#c9a13b] via-[#1b3a68] to-[#0b2545]" />
            </td></tr>
          </tfoot>
        </table>
      </div>

      {/* Approve, or -- once signed -- the invoice and how to pay it. Not part of the PDF. */}
      <section ref={paymentRef} className="mx-auto mt-5 max-w-4xl scroll-mt-4 print:hidden">
        {isApproved && !isInvoiceLink ? (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-emerald-600 p-6 text-white shadow-xl">
            <div><p className="text-lg font-bold">Quotation approved &amp; signed</p><p className="text-sm text-emerald-50">{q.invoice_number ? `Your invoice ${q.invoice_number} has its own page, with the payment details.` : 'Your invoice is being prepared.'}</p></div>
            {q.invoice_number && <a href={`/i/${params.token}`} className="rounded-xl bg-white px-6 py-3 text-sm font-extrabold text-emerald-700 shadow hover:brightness-95">Open invoice &amp; pay</a>}
          </div>
        ) : isApproved ? (
          <div className="overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-emerald-600 px-6 py-4 text-white">
              <div>
                <p className="text-lg font-bold">Invoice {q.invoice_number}</p>
                <p className="text-sm text-emerald-50">{q.invoice_date ? `Raised on ${formatDate(q.invoice_date)} · ` : ''}against quotation {q.quotation_number}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${balance <= 0 ? 'bg-white text-emerald-700' : paid > 0 ? 'bg-amber-300 text-amber-950' : 'bg-white/20 text-white'}`}>{balance <= 0 ? 'Paid in full' : paid > 0 ? 'Part paid' : 'Payment pending'}</span>
            </div>
            <div className="grid gap-3 p-6 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-4"><p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Invoice amount</p><p className="mt-1 text-xl font-extrabold tabular-nums text-[#0b2545]">{money(payable)}</p></div>
              <div className="rounded-xl bg-slate-50 p-4"><p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Paid</p><p className="mt-1 text-xl font-extrabold tabular-nums text-emerald-700">{money(paid)}</p></div>
              <div className="rounded-xl bg-[#0b2545] p-4"><p className="text-[11px] font-bold uppercase tracking-wider text-slate-300">Balance to pay</p><p className="mt-1 text-xl font-extrabold tabular-nums text-[#f0c96e]">{money(balance)}</p></div>
            </div>
            {balance > 0 && (
              <div className="border-t border-slate-100 p-6">
                <p className="text-base font-bold text-[#0b2545]">How to pay</p>
                {!upiLink && !hasBank && <p className="mt-2 text-sm text-slate-600">Our team will share the payment details with you on WhatsApp shortly.</p>}
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  {upiLink && (
                    <div className="rounded-xl border border-slate-200 p-4">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-[#c9a13b]">UPI</p>
                      <CopyRow label="UPI ID" value={co!.upi_id!} />
                      <CopyRow label="Amount" value={String(balance)} />
                      <a href={upiLink} className="mt-2 block rounded-lg bg-emerald-600 px-4 py-2.5 text-center text-sm font-bold text-white hover:bg-emerald-700 md:hidden">Pay {money(balance)} with a UPI app</a>
                      <p className="mt-2 hidden text-xs text-slate-500 md:block">Open this page on your phone to pay directly with a UPI app, or enter the UPI ID in any UPI app.</p>
                    </div>
                  )}
                  {hasBank && (
                    <div className="rounded-xl border border-slate-200 p-4">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-[#c9a13b]">Bank transfer</p>
                      {co?.bank_account_name && <CopyRow label="Account name" value={co.bank_account_name} />}
                      <CopyRow label="Account number" value={co!.bank_account_number!} />
                      <CopyRow label="IFSC" value={co!.bank_ifsc!} />
                      {(co?.bank_name || co?.bank_branch) && <div className="flex justify-between gap-3 py-1.5 text-sm"><span className="text-slate-500">Bank</span><span className="text-right font-semibold text-slate-900">{[co?.bank_name, co?.bank_branch].filter(Boolean).join(', ')}</span></div>}
                    </div>
                  )}
                </div>
                <p className="mt-4 text-sm text-slate-600">Please mention <b>{q.invoice_number || q.quotation_number}</b> while paying. Once paid, share the payment screenshot with us{waNumber ? '' : ' on WhatsApp'} and you will receive a confirmation.</p>
                {waNumber && <a href={`https://wa.me/${waNumber}?text=${encodeURIComponent(`Payment done for ${q.invoice_number || q.quotation_number}. Sharing the screenshot.`)}`} target="_blank" rel="noreferrer" className="mt-3 inline-block rounded-lg border border-emerald-600 px-4 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50">Share payment screenshot on WhatsApp</a>}
              </div>
            )}
          </div>
        ) : isClosed ? (
          <div className="rounded-2xl bg-white p-6 text-center shadow ring-1 ring-slate-200">
            <p className="text-sm font-semibold text-slate-600">This quotation is {q.status} and can no longer be approved. Please contact us for an updated one.</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[#0b2545] p-6 text-white shadow-xl">
            <div>
              <p className="text-lg font-bold">Happy with this quotation?</p>
              <p className="text-sm text-slate-300">Sign to approve it. Your invoice and the payment details open right after.</p>
              {approveError && <p className="mt-2 text-sm font-semibold text-rose-300">{approveError}</p>}
            </div>
            <button type="button" onClick={() => setShowSignature(true)} disabled={approving} className="rounded-xl bg-[#f0c96e] px-6 py-3 text-sm font-extrabold text-[#0b2545] shadow hover:brightness-95 disabled:opacity-60">
              {approving ? 'Approving…' : 'Approve & sign'}
            </button>
          </div>
        )}
      </section>

      <p className="mx-auto max-w-4xl pb-6 pt-4 text-center text-xs text-slate-500 print:hidden">
        Questions about this quotation? Reply on WhatsApp to the number that sent you this link.
      </p>

      {showSignature && <SignaturePad onCancel={() => setShowSignature(false)} onConfirm={onConfirmApprove} />}
    </div>
  );
}
