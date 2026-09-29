'use client';

import { useEffect } from 'react';
import { tr } from '@/i18n';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

// Previously there was no error boundary anywhere, so any render crash fell through to
// Next.js's own blank "Application error" page -- unrecoverable, and the real cause only
// ever existed in the browser's console, invisible to us. This catches it, reports the
// actual message/stack to the backend so it shows up in server logs, and offers a way
// back in instead of a dead end.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    fetch(`${API_URL}/health/client-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      }),
    }).catch(() => undefined);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center">
      <h1 className="text-lg font-bold text-navy">{tr("Something went wrong on this page")}</h1>
      <p className="max-w-md text-sm text-slate-500">{tr("This has been reported. You can try again, or go back to the dashboard.")}</p>
      <div className="flex gap-3">
        <button type="button" onClick={reset} className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-navy">{tr("Try again")}</button>
        <a href="/dashboard" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">{tr("Go to Dashboard")}</a>
      </div>
    </div>
  );
}
