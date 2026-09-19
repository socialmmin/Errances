import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '@/components/AuthProvider';
import {
    KeyRound,
    Lock,
    Compass,
    ArrowRight,
    Eye,
    EyeOff,
    AlertTriangle,
    ShieldCheck,
    Check,
    Loader2,
} from 'lucide-react';
import { toast } from '@/components/ui/Toast';

type PostLoginStage = 'idle' | 'success' | 'loading-workspace';

function useParticles(count: number) {
    return useMemo(
        () =>
            Array.from({ length: count }, (_, i) => ({
                id: i,
                size: 3 + Math.random() * 4,
                left: Math.random() * 100,
                top: Math.random() * 100,
                duration: 12 + Math.random() * 14,
                delay: Math.random() * 6,
            })),
        [count]
    );
}

function BrandPanel() {
    const particles = useParticles(24);
    return (
        <div className="relative hidden lg:flex flex-col justify-between w-[46%] overflow-hidden bg-gradient-to-br from-white via-slate-50 to-indigo-50/60 px-14 py-12 border-r border-slate-200/60">
            {/* Animated grid plane */}
            <div className="absolute inset-0 [perspective:800px] overflow-hidden opacity-[0.35]">
                <motion.div
                    className="absolute inset-x-[-50%] bottom-[-20%] h-[140%] [transform:rotateX(62deg)]"
                    style={{
                        backgroundImage:
                            'linear-gradient(to right, rgba(99,102,241,0.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(99,102,241,0.18) 1px, transparent 1px)',
                        backgroundSize: '48px 48px',
                    }}
                    animate={{ backgroundPositionY: ['0px', '480px'] }}
                    transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
                />
            </div>

            {/* Glow orbs */}
            <motion.div
                className="absolute -top-24 -left-24 w-[26rem] h-[26rem] rounded-full bg-red-200/40 blur-[110px]"
                animate={{ opacity: [0.5, 0.9, 0.5] }}
                transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
                className="absolute bottom-[-8rem] right-[-6rem] w-[24rem] h-[24rem] rounded-full bg-indigo-200/50 blur-[110px]"
                animate={{ opacity: [0.4, 0.8, 0.4] }}
                transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
            />

            {/* Particles */}
            {particles.map((p) => (
                <motion.span
                    key={p.id}
                    className="absolute rounded-full bg-indigo-400/40"
                    style={{ width: p.size, height: p.size, left: `${p.left}%`, top: `${p.top}%` }}
                    animate={{ y: [0, -18, 0], opacity: [0.2, 0.7, 0.2] }}
                    transition={{ duration: p.duration, repeat: Infinity, delay: p.delay, ease: 'easeInOut' }}
                />
            ))}

            {/* Content */}
            <div className="relative z-10 flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-red-500 to-rose-600 flex items-center justify-center shadow-lg shadow-red-500/20">
                    <Compass className="w-4.5 h-4.5 text-white" />
                </div>
                <span className="text-slate-900 font-black tracking-tight text-sm uppercase">Errances Voyages</span>
            </div>

            <div className="relative z-10">
                <p className="text-[11px] font-black tracking-[0.4em] text-indigo-500 uppercase mb-4">
                    Secure <span className="text-slate-300 mx-1">•</span> Manage <span className="text-slate-300 mx-1">•</span> Grow
                </p>
                <h1 className="text-4xl xl:text-[2.6rem] font-black text-slate-900 leading-[1.1] tracking-tight max-w-md">
                    The command center for your travel business.
                </h1>
                <p className="text-slate-500 font-medium mt-4 max-w-sm text-sm leading-relaxed">
                    Leads, itineraries, staff and every WhatsApp conversation —
                    unified in one enterprise-grade workspace.
                </p>
            </div>

            <div className="relative z-10 flex items-center gap-2 text-slate-500 text-[11px] font-bold uppercase tracking-widest">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                256-bit encrypted connection
            </div>
        </div>
    );
}

function FieldError({ message }: { message?: string | null }) {
    if (!message) return null;
    return (
        <motion.p
            initial={{ opacity: 0, y: -4, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-red-600 pl-1 pt-1"
        >
            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
            {message}
        </motion.p>
    );
}

export function Login() {
    const [stage, setStage] = useState<PostLoginStage>('idle');
    const navigate = useNavigate();
    const { signIn } = useAuth();

    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [rememberMe, setRememberMe] = useState(true);
    const [capsLockOn, setCapsLockOn] = useState(false);
    const [loginError, setLoginError] = useState<string | null>(null);
    const [isSigningIn, setIsSigningIn] = useState(false);

    const passwordRef = useRef<HTMLInputElement>(null);

    const handleCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (typeof e.getModifierState === 'function') {
            setCapsLockOn(e.getModifierState('CapsLock'));
        }
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoginError(null);
        if (!identifier.trim() || !password) {
            setLoginError('Please enter your access key and password.');
            return;
        }
        setIsSigningIn(true);
        try {
            await signIn(identifier.trim(), password, rememberMe);
            setIsSigningIn(false);
            setStage('success');
            setTimeout(() => setStage('loading-workspace'), 900);
            setTimeout(() => navigate('/'), 1900);
        } catch (error: any) {
            setIsSigningIn(false);
            setLoginError(error?.message || 'Invalid access key or password.');
        }
    };

    const handleForgotPassword = () => {
        toast.info('Password resets are handled by your administrator — please reach out to them directly.');
    };

    return (
        <div className="min-h-screen w-full flex bg-slate-50 relative overflow-hidden">
            <BrandPanel />

            {/* Right auth column */}
            <div className="relative flex-1 flex items-center justify-center px-6 py-10 overflow-hidden bg-gradient-to-br from-slate-50 via-white to-indigo-50/40">
                {/* ambient blobs */}
                <motion.div
                    className="absolute top-[-10%] right-[-10%] w-[26rem] h-[26rem] rounded-full bg-indigo-200/40 blur-[120px] pointer-events-none"
                    animate={{ opacity: [0.4, 0.8, 0.4] }}
                    transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
                />
                <motion.div
                    className="absolute bottom-[-10%] left-[-10%] w-[22rem] h-[22rem] rounded-full bg-red-100/50 blur-[120px] pointer-events-none lg:hidden"
                    animate={{ opacity: [0.3, 0.7, 0.3] }}
                    transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
                />

                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                    className="relative z-10 w-full max-w-[440px]"
                >
                    <div className="relative bg-white/75 backdrop-blur-2xl border border-white/90 shadow-[0_30px_80px_rgba(30,41,59,0.12)] rounded-[2rem] p-8 md:p-9 overflow-hidden">

                        {/* Post-login success overlay */}
                        <AnimatePresence>
                            {stage !== 'idle' && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-white/95 backdrop-blur-xl rounded-[2rem]"
                                >
                                    <motion.div
                                        initial={{ scale: 0.6, opacity: 0 }}
                                        animate={{ scale: 1, opacity: 1 }}
                                        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                                        className="w-16 h-16 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/30"
                                    >
                                        <Check className="w-8 h-8 text-white" strokeWidth={3} />
                                    </motion.div>
                                    <div className="text-center">
                                        <p className="text-slate-900 font-black text-sm uppercase tracking-wide">
                                            {stage === 'success' ? 'Authentication Successful' : 'Loading Your Workspace'}
                                        </p>
                                        {stage === 'loading-workspace' && (
                                            <div className="flex items-center justify-center gap-1.5 mt-3">
                                                {[0, 1, 2].map((i) => (
                                                    <motion.span
                                                        key={i}
                                                        className="w-1.5 h-1.5 rounded-full bg-indigo-500"
                                                        animate={{ opacity: [0.2, 1, 0.2] }}
                                                        transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Header */}
                        <div className="flex flex-col items-center text-center mb-7">
                            <motion.div
                                className="w-14 h-14 bg-gradient-to-tr from-red-500 to-rose-600 rounded-2xl flex items-center justify-center shadow-lg shadow-red-500/20 mb-4"
                                whileHover={{ rotate: 0, scale: 1.04 }}
                                initial={{ rotate: -6 }}
                                animate={{ rotate: -6 }}
                            >
                                <Compass className="w-7 h-7 text-white" />
                            </motion.div>
                            <h2 className="text-lg font-black text-slate-900 tracking-tight">Errances Voyages CRM</h2>
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-500 mt-1.5 flex items-center gap-1.5">
                                <ShieldCheck className="w-3 h-3" /> Secure Access Portal
                            </p>
                        </div>

                        <div className="text-center mb-6">
                            <h3 className="text-2xl font-black text-slate-900 tracking-tight">Welcome Back</h3>
                            <p className="text-slate-500 text-sm font-medium mt-1">
                                Sign in to continue to your workspace.
                            </p>
                        </div>

                        <form onSubmit={handleLogin} className="space-y-4" noValidate>
                            <div>
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 pl-1">
                                    Access Key / User ID
                                </label>
                                <div className="relative mt-1.5">
                                    <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                    <input
                                        type="text"
                                        autoComplete="username"
                                        placeholder="EMP-001, email or mobile number"
                                        className="w-full h-11 pl-10 pr-4 bg-white/80 border border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 rounded-xl font-semibold text-slate-800 text-sm placeholder:text-slate-400 placeholder:font-medium transition-all outline-none shadow-sm"
                                        value={identifier}
                                        onChange={(e) => setIdentifier(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 pl-1">
                                    Password
                                </label>
                                <div className="relative mt-1.5">
                                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                    <input
                                        ref={passwordRef}
                                        type={showPassword ? 'text' : 'password'}
                                        autoComplete="current-password"
                                        placeholder="Enter your password"
                                        className="w-full h-11 pl-10 pr-11 bg-white/80 border border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 rounded-xl font-semibold text-slate-800 text-sm placeholder:text-slate-400 placeholder:font-medium transition-all outline-none shadow-sm"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        onKeyUp={handleCapsLock}
                                        onKeyDown={handleCapsLock}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword((v) => !v)}
                                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                                        tabIndex={-1}
                                    >
                                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                                <AnimatePresence>
                                    {capsLockOn && (
                                        <motion.p
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            exit={{ opacity: 0, height: 0 }}
                                            className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 pl-1 pt-1.5"
                                        >
                                            <AlertTriangle className="w-3 h-3" /> Caps Lock is on
                                        </motion.p>
                                    )}
                                </AnimatePresence>
                                <AnimatePresence>
                                    <FieldError key={loginError || 'none'} message={loginError} />
                                </AnimatePresence>
                            </div>

                            <div className="flex items-center justify-between pt-0.5">
                                <label className="flex items-center gap-2 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={rememberMe}
                                        onChange={(e) => setRememberMe(e.target.checked)}
                                        className="h-3.5 w-3.5 rounded border-slate-300 text-red-600 focus:ring-red-500/30 focus:ring-offset-0"
                                    />
                                    <span className="text-[11px] font-semibold text-slate-500">Remember Me</span>
                                </label>
                                <button
                                    type="button"
                                    onClick={handleForgotPassword}
                                    className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 transition-colors"
                                >
                                    Forgot Password?
                                </button>
                            </div>

                            <motion.button
                                type="submit"
                                disabled={isSigningIn}
                                whileTap={{ scale: 0.98 }}
                                className="w-full h-12 mt-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:opacity-80 text-white font-black text-xs uppercase tracking-widest rounded-xl shadow-lg shadow-red-500/25 transition-all flex items-center justify-center gap-2"
                            >
                                {isSigningIn ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Verifying credentials...
                                    </>
                                ) : (
                                    <>
                                        Sign In <ArrowRight className="h-4 w-4" />
                                    </>
                                )}
                            </motion.button>
                        </form>

                        <p className="text-center text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-6">
                            Accounts are created by your administrator
                        </p>
                    </div>

                    <p className="text-center text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-6">
                        © {new Date().getFullYear()} Errances Voyages · All rights reserved
                    </p>
                </motion.div>
            </div>
        </div>
    );
}
