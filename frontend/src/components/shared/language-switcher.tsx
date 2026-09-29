'use client';

import { Languages } from 'lucide-react';
import { LANGS, useI18n, type Lang } from '@/i18n/provider';
import { cn } from '@/lib/utils';

const CODES: Record<Lang, string> = { en: 'EN', fr: 'FR' };

export function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div role="group" aria-label={t('common.language')} title={t('common.language')} className={cn('flex h-9 items-center gap-1 rounded-full border border-border bg-white px-2 shadow-sm', className)}>
      <Languages className="h-4 w-4 text-slate-500" aria-hidden />
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={cn('rounded-full px-2 py-0.5 text-xs font-bold transition-colors', lang === code ? 'bg-gold text-white' : 'text-slate-600 hover:bg-muted')}
        >
          {CODES[code]}
        </button>
      ))}
    </div>
  );
}
