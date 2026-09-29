// Non-hook translation entry point for the whole UI.
//   tr('Save changes')            -- English source text is the key; French comes from fr-text.ts
//   tr('Hello {name}', { name })  -- {placeholders} are filled from vars
// The active language lives in module state (set by <LanguageProvider>), which remounts the page tree when it changes,
// so plain function calls in render code always see the current language.
import { en } from './en';
import { fr } from './fr';
import { frText } from './fr-text';

export type Lang = 'en' | 'fr';

let current: Lang = 'en';
export const getLang = (): Lang => current;
export const setCurrentLang = (lang: Lang) => { current = lang; };

const FR: Record<string, string> = { ...frText, ...fr };

export const LOCALES: Record<Lang, string> = { en: 'en-IN', fr: 'fr-FR' };
export const locale = () => LOCALES[current];

export function tr(input: string | number | null | undefined, vars?: Record<string, string | number | null | undefined>): string {
  if (input === null || input === undefined) return '';
  const text = String(input);
  let out = current === 'fr' ? (FR[text] ?? (en as Record<string, string>)[text] ?? text) : ((en as Record<string, string>)[text] ?? text);
  if (vars) for (const [name, v] of Object.entries(vars)) out = out.replaceAll(`{${name}}`, v == null ? '' : String(v));
  return out;
}
