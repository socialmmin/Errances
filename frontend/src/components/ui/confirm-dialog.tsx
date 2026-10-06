'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './button';
import { cn } from '@/lib/utils';

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
}

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = React.createContext<ConfirmContextValue | null>(null);

export function useConfirm() {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmDialogProvider');
  return ctx.confirm;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
  closing?: boolean;
}

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<PendingConfirm | null>(null);

  const confirm = React.useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  function close(result: boolean) {
    if (!pending) return;
    pending.resolve(result);
    setPending((p) => (p ? { ...p, closing: true } : p));
    setTimeout(() => setPending(null), 160);
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <style jsx global>{`
            @keyframes confirm-backdrop-in {
              from {
                opacity: 0;
              }
              to {
                opacity: 1;
              }
            }
            @keyframes confirm-card-in {
              from {
                opacity: 0;
                transform: translateY(10px) scale(0.96);
              }
              to {
                opacity: 1;
                transform: translateY(0) scale(1);
              }
            }
          `}</style>
          <div
            className="absolute inset-0 bg-navy-950/60 backdrop-blur-sm"
            style={{
              animation: `confirm-backdrop-in 0.18s ease ${pending.closing ? 'reverse' : 'normal'} both`,
            }}
            onClick={() => close(false)}
          />
          <div
            className="relative w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl"
            style={{
              animation: `confirm-card-in 0.2s cubic-bezier(0.16,1,0.3,1) ${pending.closing ? 'reverse' : 'normal'} both`,
            }}
          >
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                  pending.variant === 'destructive' ? 'bg-red-500/10 text-red-500' : 'bg-gold-500/15 text-gold-500',
                )}
              >
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-foreground">{pending.title}</h3>
                {pending.description && (
                  <p className="mt-1.5 text-sm text-muted-foreground">{pending.description}</p>
                )}
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => close(false)}>
                {pending.cancelLabel ?? 'Cancel'}
              </Button>
              <Button
                size="sm"
                variant={pending.variant === 'destructive' ? 'destructive' : 'gold'}
                onClick={() => close(true)}
              >
                {pending.confirmLabel ?? 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
