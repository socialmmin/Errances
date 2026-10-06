'use client';

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { TranslationKey } from './en';
import { LOCALES, setCurrentLang, tr, type Lang } from './index';

export type { Lang };
export const LANGS: Lang[] = ['en', 'fr'];
const STORAGE_KEY = 'errance-lang';

type Vars = Record<string, string | number>;

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Translate a typed key or an English source string; `{name}` placeholders are filled from `vars`. */
  t: (key: TranslationKey | (string & {}), vars?: Vars) => string;
  formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  /** Money is stored as minor units (paise) -- pass the already-converted major amount. */
  formatCurrency: (value: number, currency?: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Always start in English so the server render and first client render match; the saved choice is applied right after mount.
  const [lang, setLangState] = useState<Lang>('en');

  const apply = useCallback((next: Lang) => {
    setCurrentLang(next); // module state first, so the remounted tree renders in the new language
    setLangState(next);
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === 'en' || saved === 'fr') apply(saved);
    } catch { /* storage unavailable -- stay on the default */ }
  }, [apply]);

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const setLang = useCallback((next: Lang) => {
    apply(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  }, [apply]);

  const value = useMemo<I18nValue>(() => {
    const locale = LOCALES[lang];
    return {
      lang,
      setLang,
      t: (key, vars) => tr(key, vars),
      formatDate: (v, options) => new Intl.DateTimeFormat(locale, options ?? { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(v)),
      formatNumber: (v, options) => new Intl.NumberFormat(locale, options).format(v),
      formatCurrency: (v, currency = 'INR') => new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(v),
    };
  }, [lang, setLang]);

  // Keyed Fragment: switching language remounts the page tree (no browser reload, data stays in the query cache),
  // which is what lets plain tr() calls pick up the new language everywhere.
  return <I18nContext.Provider value={value}><Fragment key={lang}>{children}</Fragment></I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <LanguageProvider>');
  return ctx;
}

export const useT = () => useI18n().t;
