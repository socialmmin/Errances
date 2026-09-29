// French translations keyed by the English source text used with tr('...'). Missing entries fall back to English.
// Split into parts only to keep files a manageable size; run `npm run i18n:check` to list strings that still lack a translation.
import { part1 } from './fr/part1';
import { part2 } from './fr/part2';
import { part3 } from './fr/part3';
import { part4 } from './fr/part4';
import { part5 } from './fr/part5';
import { part6 } from './fr/part6';

export const frText: Record<string, string> = { ...part1, ...part2, ...part3, ...part4, ...part5, ...part6 };
