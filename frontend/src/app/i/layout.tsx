import type { Metadata } from 'next';

// What WhatsApp shows as the link preview when an invoice link is shared with a customer.
export const metadata: Metadata = {
  title: 'Your invoice — Errances Voyages',
  description: 'View your invoice, the payments received and how to pay the balance.',
  openGraph: { title: 'Your invoice — Errances Voyages', description: 'View your invoice, the payments received and how to pay the balance.', siteName: 'Errances Voyages' },
};

export default function InvoiceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
