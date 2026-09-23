import { useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store';
import { useAuth } from '@/components/AuthProvider';
import { useNotifications } from '@/hooks/useNotifications';
import { formatLeadNumber } from '@/lib/leadUtils';
import { QuickFollowUpModal } from '@/components/shared/QuickFollowUpModal';
import {
    Search, Bell, Plus, ChevronDown, UserPlus, CalendarPlus, MessageSquareText,
    LogOut, X, AlertTriangle, Clock,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
    DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const PAGE_TITLES: Array<{ test: (path: string) => boolean; title: string }> = [
    { test: (p) => p === '/', title: 'Dashboard' },
    { test: (p) => p === '/pipeline', title: 'Pipeline' },
    { test: (p) => /^\/leads\/[^/]+$/.test(p), title: 'Lead Details' },
    { test: (p) => p === '/leads', title: 'Leads' },
    { test: (p) => p === '/contacts', title: 'Contacts' },
    { test: (p) => p.startsWith('/tours'), title: 'Tour Packages' },
    { test: (p) => p === '/whatsapp', title: 'WhatsApp Inbox' },
    { test: (p) => p === '/analytics', title: 'Analytics' },
    { test: (p) => /^\/staff\/[^/]+$/.test(p), title: 'Staff Profile' },
    { test: (p) => p === '/staff', title: 'Staff' },
];

function pageTitleFor(pathname: string) {
    return PAGE_TITLES.find((p) => p.test(pathname))?.title || 'Errances Voyages';
}

export function TopNav() {
    const location = useLocation();
    const navigate = useNavigate();
    const { leads } = useAppStore();
    const { user, signOut } = useAuth();
    const notifications = useNotifications();
    const [search, setSearch] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const [quickFollowUpOpen, setQuickFollowUpOpen] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);

    const title = pageTitleFor(location.pathname);

    const results = useMemo(() => {
        if (!search.trim()) return [];
        const q = search.trim().toLowerCase();
        return leads
            .filter((l) =>
                l.name?.toLowerCase().includes(q) ||
                l.phone?.toLowerCase().includes(q) ||
                l.whatsapp_number?.toLowerCase().includes(q) ||
                l.email?.toLowerCase().includes(q) ||
                String(l.lead_number || '').includes(q)
            )
            .slice(0, 8);
    }, [search, leads]);

    return (
        <>
            <header className="sticky top-0 z-30 flex items-center gap-3 h-16 px-4 md:px-6 bg-white/70 backdrop-blur-xl border-b border-slate-200/70">
                {/* mobile menu spacer handled by Sidebar's own trigger; leave gap for it */}
                <div className="md:hidden w-8 flex-shrink-0" />

                <h1 className="text-base md:text-lg font-black text-slate-900 tracking-tight whitespace-nowrap hidden sm:block">{title}</h1>

                {/* Global search */}
                <div className="relative flex-1 max-w-md ml-2" ref={searchRef}>
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <input
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setSearchOpen(true); }}
                        onFocus={() => setSearchOpen(true)}
                        onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                        placeholder="Search leads by name, mobile, email…"
                        className="w-full h-9 pl-9 pr-8 rounded-xl bg-slate-100/80 border border-transparent focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-500/15 text-sm font-medium outline-none transition-all"
                    />
                    {search && (
                        <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                    {searchOpen && results.length > 0 && (
                        <div className="absolute top-11 left-0 w-full bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden z-40">
                            {results.map((l) => (
                                <button
                                    key={l.id}
                                    onMouseDown={() => { navigate(`/leads/${l.id}`); setSearch(''); setSearchOpen(false); }}
                                    className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 flex items-center justify-between gap-2 border-b border-slate-50 last:border-0"
                                >
                                    <div>
                                        <p className="text-sm font-bold text-slate-800">{l.name}</p>
                                        <p className="text-[11px] text-slate-400">{l.phone || l.email || formatLeadNumber(l)}</p>
                                    </div>
                                    <span className="text-[10px] font-black uppercase text-slate-300">{formatLeadNumber(l)}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
                    {/* Quick Add */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button className="flex items-center gap-1.5 h-9 px-3 md:px-4 rounded-xl bg-[#33A894] hover:bg-[#2c9180] text-white text-xs font-black uppercase tracking-wide shadow-sm shadow-[#33A894]/25 transition-colors">
                                <Plus className="h-4 w-4" /> <span className="hidden md:inline">Quick Add</span>
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-slate-400">Create</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => navigate('/leads', { state: { openAdd: true } })} className="gap-2">
                                <UserPlus className="h-4 w-4 text-indigo-500" /> New Lead
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate('/leads', { state: { openAdd: true, presetSource: 'WhatsApp' } })} className="gap-2">
                                <MessageSquareText className="h-4 w-4 text-emerald-500" /> New WhatsApp Lead
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setQuickFollowUpOpen(true)} className="gap-2">
                                <CalendarPlus className="h-4 w-4 text-amber-500" /> New Follow-up
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Notifications */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button className="relative h-9 w-9 flex items-center justify-center rounded-xl text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
                                <Bell className="h-4.5 w-4.5" />
                                {notifications.length > 0 && (
                                    <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
                                )}
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-y-auto">
                            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-slate-400 flex items-center justify-between">
                                Notifications
                                {notifications.length > 0 && <span className="text-indigo-500">{notifications.length}</span>}
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {notifications.length === 0 ? (
                                <div className="px-3 py-8 text-center">
                                    <p className="text-xs font-bold text-slate-400">You're all caught up.</p>
                                </div>
                            ) : (
                                notifications.map((n) => (
                                    <DropdownMenuItem key={n.id} onClick={() => navigate(n.link)} className="flex items-start gap-2.5 py-2.5">
                                        <div className={cn(
                                            'h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5',
                                            n.type === 'followup_overdue' ? 'bg-red-50 text-red-600' : n.type === 'whatsapp_unread' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                                        )}>
                                            {n.type === 'followup_overdue' ? <AlertTriangle className="h-3.5 w-3.5" /> : n.type === 'whatsapp_unread' ? <MessageSquareText className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-xs font-bold text-slate-800 truncate">{n.title}</p>
                                            <p className="text-[10px] text-slate-400 truncate">{n.type === 'whatsapp_unread' ? n.subtitle : format(new Date(n.dueDate), 'dd MMM yyyy')}</p>
                                        </div>
                                    </DropdownMenuItem>
                                ))
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Profile */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button className="flex items-center gap-2 h-9 pl-1 pr-2 rounded-xl hover:bg-slate-100 transition-colors">
                                <Avatar className="h-7 w-7 border border-slate-200">
                                    <AvatarImage src={user?.avatar_url} />
                                    <AvatarFallback className="text-[10px] font-black">{user?.full_name?.[0] || 'A'}</AvatarFallback>
                                </Avatar>
                                <ChevronDown className="h-3.5 w-3.5 text-slate-400 hidden sm:block" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuLabel>
                                <p className="text-sm font-bold text-slate-800 truncate">{user?.full_name}</p>
                                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500 mt-0.5">{user?.role?.replace('_', ' ')}</p>
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => signOut()} className="gap-2 text-red-600 focus:text-red-700 focus:bg-red-50">
                                <LogOut className="h-4 w-4" /> Sign Out
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </header>

            <QuickFollowUpModal open={quickFollowUpOpen} onOpenChange={setQuickFollowUpOpen} />
        </>
    );
}
