'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import { tr, locale } from '@/i18n';

interface PublicQuotationItem {
  description: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
}

interface PublicQuotation {
  id: string;
  quotation_number: string;
  destination: string | null;
  travel_from: string | null;
  travel_to: string | null;
  adults: number;
  children: number;
  base_amount: number;
  discount_amount: number;
  gst_amount: number;
  final_amount: number;
  status: string;
  valid_until: string | null;
  notes: string | null;
  customer_name: string | null;
  lead_customer_name: string | null;
  items: PublicQuotationItem[];
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
}

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function PublicQuotationPage() {
  const params = useParams<{ token: string }>();
  const [quotation, setQuotation] = useState<PublicQuotation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!params.token) return;
    api
      .get<PublicQuotation>(`/quotations/public/${params.token}`)
      .then(setQuotation)
      .catch((err: ApiError) => setError(err.status === 404 ? 'This quotation link is invalid or has expired.' : 'Something went wrong loading this quotation.'))
      .finally(() => setLoading(false));
  }, [params.token]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">{tr("Loading your quotation…")}</p>
      </div>
    );
  }

  if (error || !quotation) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-sm text-center">
          <p className="text-lg font-semibold text-slate-800">{tr("Quotation not found")}</p>
          <p className="mt-2 text-sm text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  const customerName = quotation.customer_name || quotation.lead_customer_name || 'Traveller';

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="rounded-2xl bg-gradient-to-br from-[#0b2545] to-[#13355e] p-6 text-white shadow-sm">
          <p className="text-xs uppercase tracking-wide text-[#f0c96e]">{tr("Errances Voyages")}</p>
          <h1 className="mt-1 text-2xl font-semibold">{tr("Quotation")}{' '}{quotation.quotation_number}</h1>
          <p className="mt-1 text-sm text-white/80">{tr("Prepared for")}{' '}{customerName}</p>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-500">{tr("Trip Details")}</h2>
          <dl className="mt-3 grid grid-cols-2 gap-y-3 text-sm">
            <dt className="text-slate-500">{tr("Destination")}</dt>
            <dd className="text-right font-medium text-slate-800">{quotation.destination || '—'}</dd>
            <dt className="text-slate-500">{tr("Travel dates")}</dt>
            <dd className="text-right font-medium text-slate-800">{formatDate(quotation.travel_from)} – {formatDate(quotation.travel_to)}</dd>
            <dt className="text-slate-500">{tr("Travellers")}</dt>
            <dd className="text-right font-medium text-slate-800">{quotation.adults}{' '}{tr("Adult")}{quotation.adults !== 1 ? 's' : ''}{quotation.children ? tr(", {children} Child{value}", { children: quotation.children, value: quotation.children !== 1 ? 'ren' : '' }) : ''}</dd>
            {quotation.valid_until && (
              <>
                <dt className="text-slate-500">{tr("Valid until")}</dt>
                <dd className="text-right font-medium text-slate-800">{formatDate(quotation.valid_until)}</dd>
              </>
            )}
          </dl>
        </section>

        {quotation.items?.length > 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-500">{tr("Included")}</h2>
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {quotation.items.map((item, i) => (
                <li key={i} className="flex items-center justify-between py-2">
                  <span className="text-slate-700">{item.description || tr("Item")} {item.quantity > 1 ? `× ${item.quantity}` : ''}</span>
                  <span className="font-medium text-slate-800">{formatCurrency(item.total_price)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-500">{tr("Price Summary")}</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">{tr("Subtotal")}</dt><dd>{formatCurrency(quotation.base_amount)}</dd></div>
            {quotation.discount_amount > 0 && (
              <div className="flex justify-between text-emerald-600"><dt>{tr("Discount")}</dt><dd>-{formatCurrency(quotation.discount_amount)}</dd></div>
            )}
            <div className="flex justify-between"><dt className="text-slate-500">{tr("GST")}</dt><dd>+{formatCurrency(quotation.gst_amount)}</dd></div>
            <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-semibold text-slate-900">
              <dt>{tr("Total")}</dt><dd>{formatCurrency(quotation.final_amount)}</dd>
            </div>
          </dl>
        </section>

        {quotation.notes && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-500">{tr("Notes")}</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{quotation.notes}</p>
          </section>
        )}

        <p className="text-center text-xs text-slate-400">
          {tr("Questions about this quotation? Reply on WhatsApp to the number that sent you this link.")}
        </p>
      </div>
    </div>
  );
}
