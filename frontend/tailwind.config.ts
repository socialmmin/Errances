import type { Config } from 'tailwindcss';

// ErranceVoyages_Tourism_2026 theme: premium red + white.
// `navy` is the charcoal text/neutral scale and `gold` is the red brand scale -- the token names are kept
// so every existing component picks the new palette up without per-file edits.
const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#1F2937',
          50: '#F9FAFB',
          100: '#F3F4F6',
          700: '#374151',
          800: '#1F2937',
          900: '#111827',
          950: '#0B0F19',
        },
        gold: {
          DEFAULT: '#D91E2A',
          50: '#FEF2F2',
          400: '#EF4444',
          500: '#D91E2A',
          600: '#B91C1C',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: '#D91E2A', foreground: '#FFFFFF' },
        secondary: { DEFAULT: '#F3F4F6', foreground: '#1F2937' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
      },
      borderRadius: {
        lg: '0.5rem',
        md: '0.375rem',
        sm: '0.25rem',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
export default config;
