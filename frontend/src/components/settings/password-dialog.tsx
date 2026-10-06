'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff, KeyRound, X } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useUpdateSettingsUser } from '@/hooks/use-settings-users';

function genPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let pw = '';
  for (let i = 0; i < 10; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

// Super-admin pop-up for one employee: 1) login ID, 2) existing password -- both hidden until the
// eye is clicked -- and 3) set a new password. Each reveal is audit-logged on the server.
export function PasswordDialog({ user, onClose }: { user: { id: string; full_name: string }; onClose: () => void }) {
  const { toast } = useToast();
  const update = useUpdateSettingsUser();
  const [creds, setCreds] = useState<{ loginId: string; password: string | null } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showId, setShowId] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [next, setNext] = useState('');

  async function load() {
    if (creds) return creds;
    try {
      const c = await api.get<{ loginId: string; password: string | null }>(`/users/${user.id}/credentials`);
      setCreds(c);
      return c;
    } catch (e: any) {
      setLoadError(e.message || 'Could not load login details');
      return null;
    }
  }
  const toggle = async (which: 'id' | 'pw') => {
    if ((which === 'id' && showId) || (which === 'pw' && showPw)) return which === 'id' ? setShowId(false) : setShowPw(false);
    if (await load()) (which === 'id' ? setShowId : setShowPw)(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    try {
      await update.mutateAsync({ id: user.id, password: next });
      toast(`Password changed for ${user.full_name}`, 'success');
      setCreds((c) => (c ? { ...c, password: next } : c));
      setNext('');
      setShowPw(true);
    } catch (e: any) {
      toast(e.message || 'Could not change password', 'error');
    }
  }

  const hidden = <span className="font-mono tracking-widest text-slate-400">••••••••</span>;
  const eye = (on: boolean, which: 'id' | 'pw', label: string) => (
    <button onClick={() => toggle(which)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-navy" aria-label={on ? `Hide ${label}` : `Show ${label}`} title={on ? 'Hide' : 'Show'}>
      {on ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );

  // Portaled to <body> so the zoom wrapper / banner can never sit on top of it.
  return createPortal(
    <div className="fixed inset-0 z-[9990] grid place-items-center bg-black/45 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-navy-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-navy dark:text-white"><KeyRound className="h-5 w-5 text-gold" />Login &amp; password</h2>
            <p className="text-sm text-muted-foreground">{user.full_name}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b">
              <td className="w-8 py-3 pl-5 text-xs font-bold text-muted-foreground">1</td>
              <td className="py-3 pr-3 font-medium text-slate-600">Login ID</td>
              <td className="py-3 pr-2 text-right font-mono">{showId && creds ? creds.loginId : hidden}</td>
              <td className="w-10 py-3 pr-4 text-right">{eye(showId, 'id', 'login ID')}</td>
            </tr>
            <tr className="border-b">
              <td className="py-3 pl-5 text-xs font-bold text-muted-foreground">2</td>
              <td className="py-3 pr-3 font-medium text-slate-600">Existing password</td>
              <td className="py-3 pr-2 text-right font-mono">
                {showPw && creds ? (creds.password ?? <span className="font-sans text-xs text-amber-700">Not stored — set a new one below once</span>) : hidden}
              </td>
              <td className="py-3 pr-4 text-right">{eye(showPw, 'pw', 'password')}</td>
            </tr>
            <tr>
              <td className="py-3 pl-5 align-top text-xs font-bold text-muted-foreground"><span className="mt-2.5 block">3</span></td>
              <td colSpan={3} className="py-3 pr-4">
                <p className="mb-2 font-medium text-slate-600">Change password</p>
                <div className="flex gap-2">
                  <Input className="font-mono" placeholder="New password (min 5 characters)" value={next} onChange={(e) => setNext(e.target.value)} />
                  <Button type="button" variant="outline" onClick={() => setNext(genPassword())}>Generate</Button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        {loadError && <p className="px-5 pb-2 text-xs text-red-600">{loadError}</p>}
        <div className="flex justify-end gap-2 border-t bg-slate-50 px-5 py-3 dark:bg-white/5">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button disabled={next.length < 5 || update.isPending} onClick={save}>{update.isPending ? 'Saving…' : 'Save new password'}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Opens the pop-up from a table row; stopPropagation so it doesn't also open the access page.
export function PasswordButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-navy hover:border-gold hover:bg-gold/10">
      <KeyRound className="h-3.5 w-3.5 text-gold" />View / change
    </button>
  );
}
