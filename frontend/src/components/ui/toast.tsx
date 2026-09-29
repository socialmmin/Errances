'use client';

import * as React from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { tr } from '@/i18n';

interface ToastItem {
  id: number;
  message: string;
  variant?: 'default' | 'success' | 'error';
  leaving?: boolean;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastItem['variant']) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const ICONS = { default: Info, success: CheckCircle2, error: XCircle } as const;

const DURATION = 3800;
const EXIT_MS = 220;

// Lightweight toast-after-mutation implementation (no external toast lib
// dependency) — call useToast().toast('Saved') from any mutation onSuccess.
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  const dismiss = React.useCallback((id: number) => {
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), EXIT_MS);
  }, []);

  const toast = React.useCallback(
    (message: string, variant: ToastItem['variant'] = 'default') => {
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => dismiss(id), DURATION);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <style jsx global>{`
        @keyframes toast-in {
          from {
            opacity: 0;
            transform: translateY(12px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes toast-out {
          from {
            opacity: 1;
            transform: translateY(0) scale(1);
            max-height: 80px;
            margin-top: 8px;
          }
          to {
            opacity: 0;
            transform: translateY(6px) scale(0.98);
            max-height: 0;
            margin-top: 0;
          }
        }
        @keyframes toast-shrink {
          from {
            width: 100%;
          }
          to {
            width: 0%;
          }
        }
        .toast-enter {
          animation: toast-in 0.28s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .toast-exit {
          animation: toast-out ${EXIT_MS}ms ease forwards;
          overflow: hidden;
        }
        .toast-bar {
          animation: toast-shrink ${DURATION}ms linear forwards;
        }
      `}</style>
      <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-full max-w-sm flex-col gap-2.5">
        {items.map((t) => {
          const Icon = ICONS[t.variant ?? 'default'];
          return (
            <div
              key={t.id}
              className={cn(
                'pointer-events-auto relative overflow-hidden rounded-xl border shadow-[0_10px_30px_-8px_rgba(0,0,0,0.35)] backdrop-blur-md',
                t.leaving ? 'toast-exit' : 'toast-enter',
                'bg-navy-900/95 border-white/10 text-white',
              )}
            >
              <div className="flex items-start gap-3 px-4 py-3.5">
                <div
                  className={cn(
                    'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                    t.variant === 'success' && 'bg-emerald-500/15 text-emerald-400',
                    t.variant === 'error' && 'bg-red-500/15 text-red-400',
                    (!t.variant || t.variant === 'default') && 'bg-gold-500/15 text-gold-400',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <p className="flex-1 pt-0.5 text-sm font-medium leading-snug text-slate-100">{tr(t.message)}</p>
                <button
                  onClick={() => dismiss(t.id)}
                  className="mt-0.5 shrink-0 text-slate-500 transition-colors hover:text-slate-200"
                  aria-label={tr("Dismiss")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {!t.leaving && (
                <div className="h-0.5 w-full bg-white/5">
                  <div
                    className={cn(
                      'toast-bar h-full',
                      t.variant === 'success' && 'bg-emerald-400',
                      t.variant === 'error' && 'bg-red-400',
                      (!t.variant || t.variant === 'default') && 'bg-gold-500',
                    )}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
