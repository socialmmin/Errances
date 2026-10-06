'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Plane, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthStore } from '@/store/auth-store';
import { takeReturnPath } from '@/lib/return-path';
import { useToast } from '@/components/ui/toast';
import { useBranding } from '@/components/branding-provider';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

const SLIDES = [
  { src: '/images/login-bg.jpg', caption: 'Taj Mahal, Agra' },
  { src: '/images/login-bg-2.jpg', caption: 'Gateway of India, Mumbai' },
  { src: '/images/login-bg-3.jpg', caption: 'Backwaters, Kerala' },
  { src: '/images/login-bg-4.jpg', caption: 'Temple Gopuram, Tamil Nadu' },
];

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const { toast } = useToast();
  const brand = useBranding();
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Login failed');
      }
      const data = await res.json();
      setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
      toast('Logged in successfully', 'success');
      router.push(takeReturnPath() || '/dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    login(email, password);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-navy-950 px-4 py-10">
      {/* Crossfading, slow-zooming background slideshow of iconic Indian landmarks */}
      <div className="absolute inset-0">
        {SLIDES.map((slide, i) => (
          <div key={slide.src} className="absolute inset-0 animate-login-slide" style={{ animationDelay: `${i * 6}s` }}>
            <div
              className="h-full w-full animate-login-zoom bg-cover bg-center"
              style={{ backgroundImage: `url('${slide.src}')`, animationDelay: `${i * 6}s` }}
            />
          </div>
        ))}
        <div className="absolute inset-0 bg-gradient-to-b from-navy-950/85 via-navy-950/70 to-navy-950/92" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(8,13,24,0.65)_100%)]" />
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

      <div className="animate-login-card relative z-10 flex w-full max-w-sm flex-col items-center">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <div className={brand.logo_url ? "relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-white p-1" : "relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-gold-400 to-gold-600 shadow-[0_0_35px_-5px_rgba(245,158,11,0.65)]"}>
            {brand.logo_url?<img src={brand.logo_url} alt="" className="h-full w-full object-contain"/>:<Plane className="h-7 w-7 -rotate-45 text-navy-900" strokeWidth={2.25} />}
          </div>
          <div>
            <h1 className="bg-gradient-to-r from-gold-400 via-gold-500 to-amber-300 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
              {brand.company_name}
            </h1>
            <p className="mt-1 text-sm text-slate-300">{brand.tagline} &middot; Sign in to continue</p>
          </div>
        </div>

        <div className="w-full rounded-3xl border border-white/10 bg-white/[0.08] p-7 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.6)] ring-1 ring-white/5 backdrop-blur-2xl">
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-slate-200">
                Mobile Number or Email
              </Label>
              <Input
                id="email"
                type="text"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Mobile number or email"
                className="h-11 border-white/15 bg-white/95 focus-visible:ring-gold-500"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-slate-200">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 border-white/15 bg-white/95 pr-10 focus-visible:ring-gold-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 transition-colors hover:text-slate-800"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {error && (
              <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300 ring-1 ring-red-500/30">
                {error}
              </p>
            )}
            <Button
              type="submit"
              variant="gold"
              className="group h-11 w-full text-base shadow-lg shadow-gold/25 transition-transform hover:scale-[1.01] active:scale-[0.99]"
              disabled={loading}
            >
              {loading ? (
                'Signing in…'
              ) : (
                <span className="flex items-center justify-center gap-2">
                  Sign in
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              )}
            </Button>
          </form>
        </div>

        <p className="mt-7 text-xs tracking-wide text-slate-500">
          ErranceVoyages_Tourism_2026 &middot; Powered by SocialMM
        </p>
      </div>
    </div>
  );
}
