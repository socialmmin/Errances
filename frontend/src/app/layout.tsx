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
    // "Failed to execute 'removeChild' on 'Node'" crashes (reported on Settings > Users, and
    // matching an error class that can show up anywhere in the app) are the signature of a
    // browser feature -- most commonly Google Translate, sometimes a password manager -- rewriting
    // DOM nodes that React still thinks it owns, out from under it. When React later tries to
    // remove/update a node the extension already replaced, it throws exactly this error. The
    // standard, well-documented mitigation is telling the browser not to touch this subtree at
    // all: translate="no" stops Chrome's Translate feature specifically; notranslate is the same
    // signal Google's own translate.js checks for.
    <html lang="en" translate="no">
      <body className="notranslate min-h-screen font-sans antialiased">
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
