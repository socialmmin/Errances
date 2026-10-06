import type { Metadata } from 'next';

// What WhatsApp shows as the link preview when a quotation link is shared with a customer.
export const metadata: Metadata = {
  title: 'Your travel quotation — Errances Voyages',
  description: 'View your quotation, approve it and see the payment details.',
  openGraph: { title: 'Your travel quotation — Errances Voyages', description: 'View your quotation, approve it and see the payment details.', siteName: 'Errances Voyages' },
};

export default function QuotationLayout({ children }: { children: React.ReactNode }) {
  return children;
}
