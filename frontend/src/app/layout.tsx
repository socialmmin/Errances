import type { Metadata, Viewport } from 'next';
import './globals.css';
import { QueryProvider } from '@/components/query-provider';
import { ToastProvider } from '@/components/ui/toast';
import { ConfirmDialogProvider } from '@/components/ui/confirm-dialog';
import { BrandingProvider } from '@/components/branding-provider';
import { LanguageProvider } from '@/i18n/provider';

export const metadata: Metadata = {
  title: 'Errances Voyages — Tourism CRM',
  description: 'ErranceVoyages_Tourism_2026 — tourism ERP/CRM',
  icons: { icon: '/brand/favicon.png', apple: '/brand/favicon.png' },
};

export const viewport: Viewport = { themeColor: '#D91E2A' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white font-sans antialiased">
        <LanguageProvider>
          <QueryProvider>
            <ToastProvider>
              <ConfirmDialogProvider><BrandingProvider>{children}</BrandingProvider></ConfirmDialogProvider>
            </ToastProvider>
          </QueryProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
