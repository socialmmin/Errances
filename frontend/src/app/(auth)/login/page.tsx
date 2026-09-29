'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthStore } from '@/store/auth-store';
import { takeReturnPath } from '@/lib/return-path';
import { useToast } from '@/components/ui/toast';
import { useBranding } from '@/components/branding-provider';
import { useT } from '@/i18n/provider';
import { LanguageSwitcher } from '@/components/shared/language-switcher';
import { tr, getLang } from '@/i18n';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

const SLIDES = [
  { src: '/images/login-bg.jpg' },
  { src: '/images/login-bg-2.jpg' },
  { src: '/images/login-bg-3.jpg' },
  { src: '/images/login-bg-4.jpg' },
];

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const { toast } = useToast();
  const brand = useBranding();
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function login(loginEmail: string, loginPassword: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': getLang() },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || t('login.failed'));
      }
      const data = await res.json();
      setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
      toast(t('login.success'), 'success');
      router.push(takeReturnPath() || '/dashboard');
    } catch (err: any) {
      setError(err.message || t('login.failed'));
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    login(email, password);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white px-4 py-10">
      {/* Crossfading, slow-zooming background slideshow of iconic Indian landmarks, washed out to keep the page white */}
      <div className="absolute inset-0">
        {SLIDES.map((slide, i) => (
          <div key={slide.src} className="absolute inset-0 animate-login-slide" style={{ animationDelay: `${i * 6}s` }}>
            <div
              className="h-full w-full animate-login-zoom bg-cover bg-center"
              style={{ backgroundImage: `url('${slide.src}')`, animationDelay: `${i * 6}s` }}
            />
          </div>
        ))}
        <div className="absolute inset-0 bg-gradient-to-b from-white/90 via-white/80 to-white/95" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(217,30,42,0.10)_100%)]" />
      </div>

      <style jsx>{`
        @keyframes login-slide-fade {
          0%,
          21% {
            opacity: 1;
          }
          25%,
          96% {
            opacity: 0;
          }
          100% {
            opacity: 1;
          }
        }
        @keyframes login-zoom {
          0% {
            transform: scale(1);
          }
          100% {
            transform: scale(1.12);
          }
        }
        @keyframes login-card-in {
          from {
            opacity: 0;
            transform: translateY(14px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-login-slide {
          opacity: 0;
          animation: login-slide-fade 24s infinite ease-in-out;
        }
        .animate-login-zoom {
          animation: login-zoom 24s infinite alternate ease-in-out;
        }
        .animate-login-card {
          animation: login-card-in 0.6s ease-out;
        }
      `}</style>

      <div className="absolute right-4 top-4 z-20"><LanguageSwitcher /></div>

      <div className="animate-login-card relative z-10 flex w-full max-w-sm flex-col items-center">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <img src={brand.logo_url || '/brand/logo.png'} alt={brand.company_name} className="h-20 w-auto max-w-[18rem] object-contain" />
          <div>
            <h1 className="sr-only">
              {brand.company_name}
            </h1>
            <p className="mt-1 text-sm text-slate-600">{tr(brand.tagline)} &middot; {t('login.title')}</p>
          </div>
        </div>

        <div className="w-full rounded-3xl border border-border bg-white p-7 shadow-[0_20px_60px_-25px_rgba(17,24,39,0.35)]">
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-navy">
                {t('login.identifier')}
              </Label>
              <Input
                id="email"
                type="text"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="9944946955"
                className="h-11 border-border bg-white focus-visible:ring-gold-500"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-navy">
                {t('login.password')}
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 border-border bg-white pr-10 focus-visible:ring-gold-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 transition-colors hover:text-slate-800"
                  tabIndex={-1}
                  aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {error && (
              <p className="rounded-lg bg-gold-50 px-3 py-2 text-sm text-gold-600 ring-1 ring-gold-500/30">
                {error}
              </p>
            )}
            <Button
              type="submit"
              variant="gold"
              className="group h-11 w-full text-base shadow-lg shadow-gold/20 transition-transform hover:scale-[1.01] active:scale-[0.99]"
              disabled={loading}
            >
              {loading ? (
                t('login.signingIn')
              ) : (
                <span className="flex items-center justify-center gap-2">
                  {t('login.signIn')}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              )}
            </Button>
          </form>
        </div>

        <p className="mt-7 text-xs tracking-wide text-slate-500">
          {brand.company_name} &middot; {t('login.poweredBy')}
        </p>
      </div>
    </div>
  );
}
