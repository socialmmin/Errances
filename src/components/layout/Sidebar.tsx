import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
    LayoutDashboard,
    Users,
    Map,
    MessageSquare,
    BarChart3,
    LayoutGrid,
    LogOut,
    Menu,
    Contact,
    ChevronsLeft,
    ChevronsRight,
    Compass,
    Settings as SettingsIcon,
    LayoutList,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/components/AuthProvider';

import { useI18n } from '@/i18n';

type NavItem = { label: string; icon: typeof LayoutDashboard; href: string; exact?: boolean };
type NavGroup = { label: string; items: NavItem[] };

export function Sidebar({ collapsed = false, onToggleCollapse }: { collapsed?: boolean; onToggleCollapse?: () => void }) {
    const { t } = useI18n();
    const [mobileOpen, setMobileOpen] = useState(false);
    const { pathname } = useLocation();
    const { user, signOut } = useAuth();

    const GROUPS: NavGroup[] = [
        { label: 'Overview', items: [{ label: t('dashboard'), icon: LayoutDashboard, href: '/', exact: true }] },
        {
            label: 'Sales',
            items: [
                { label: t('pipeline'), icon: LayoutGrid, href: '/pipeline' },
                { label: t('leads'), icon: Users, href: '/leads' },
                { label: t('contacts'), icon: Contact, href: '/contacts' },
            ],
        },
        { label: 'Catalog', items: [{ label: t('tourPackages'), icon: Map, href: '/tours' }] },
        {
            label: 'Engage',
            items: [
                { label: t('whatsapp'), icon: MessageSquare, href: '/whatsapp' },
                { label: 'Templates', icon: LayoutList, href: '/whatsapp/templates' },
            ],
        },
        { label: 'Insights', items: [{ label: t('analytics'), icon: BarChart3, href: '/analytics' }] },
        ...(user?.role === 'admin' || user?.role === 'sales_manager' ? [{
            label: 'Admin',
            items: [
                ...(user?.role === 'admin' ? [{ label: t('staff'), icon: Users, href: '/staff' }] : []),
                { label: 'Settings', icon: SettingsIcon, href: '/settings' },
            ],
        }] : []),
    ];

    const isActive = (item: NavItem) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + '/'));

    const NavLink = ({ item }: { item: NavItem }) => {
        const active = isActive(item);
        const link = (
            <Link
                to={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                    'flex items-center gap-3 rounded-xl text-sm font-semibold transition-colors',
                    collapsed ? 'justify-center h-11 w-11 mx-auto' : 'px-3.5 py-2',
                    active ? 'bg-[#24B4A0] text-white shadow-sm shadow-[#24B4A0]/25' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                )}
            >
                <item.icon className="h-[18px] w-[18px] flex-shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
        );

        if (!collapsed) return link;
        return (
            <Tooltip delayDuration={200}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
        );
    };

    const NavContent = () => (
        <div className="flex flex-col h-full bg-white border-r border-slate-200/80">
            <div className={cn('flex items-center gap-2.5', collapsed ? 'justify-center px-2 py-5' : 'px-5 py-5')}>
                <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-red-500 to-rose-600 flex items-center justify-center flex-shrink-0 shadow-sm shadow-red-500/20">
                    <Compass className="h-4 w-4 text-white" />
                </div>
                {!collapsed && (
                    <div className="overflow-hidden">
                        <h1 className="text-base font-black tracking-tight text-slate-900 leading-none">ERRANCES<span className="text-red-600">.</span></h1>
                        <p className="text-[9px] text-slate-400 font-black tracking-[0.2em] mt-0.5">VOYAGES CRM</p>
                    </div>
                )}
            </div>

            <nav className={cn('flex-1 min-h-0 overflow-y-auto py-2 space-y-3', collapsed ? 'px-2' : 'px-3')}>
                {GROUPS.map((group) => (
                    <div key={group.label}>
                        {!collapsed && <p className="px-3 mb-1.5 text-[9px] font-black uppercase tracking-widest text-slate-500">{group.label}</p>}
                        <div className="space-y-1">
                            {group.items.map((item) => <NavLink key={item.href} item={item} />)}
                        </div>
                    </div>
                ))}
            </nav>

            {onToggleCollapse && (
                <button
                    onClick={onToggleCollapse}
                    className="hidden md:flex items-center justify-center gap-2 mx-3 mb-2 h-9 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors text-xs font-bold"
                >
                    {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Collapse</>}
                </button>
            )}

            <div className={cn('border-t border-slate-200/80 bg-white', collapsed ? 'p-2' : 'p-4')}>
                {!collapsed ? (
                    <>
                        <div className="flex items-center gap-3 mb-3 px-1">
                            <Avatar className="h-9 w-9 border border-slate-200 flex-shrink-0">
                                <AvatarImage src={user?.avatar_url} />
                                <AvatarFallback className="text-xs font-black">{user?.full_name?.[0] || 'A'}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 overflow-hidden">
                                <p className="text-sm font-bold truncate text-slate-900">{user?.full_name}</p>
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest truncate">{user?.role?.replace('_', ' ')}</p>
                            </div>
                        </div>
                        <Button variant="outline" className="w-full justify-start gap-2 text-slate-500 h-9 text-xs font-bold rounded-xl" onClick={() => signOut()}>
                            <LogOut className="h-3.5 w-3.5" />
                            {t('signout')}
                        </Button>
                    </>
                ) : (
                    <Tooltip delayDuration={200}>
                        <TooltipTrigger asChild>
                            <button onClick={() => signOut()} className="h-10 w-10 mx-auto flex items-center justify-center rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                                <LogOut className="h-4 w-4" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">{t('signout')}</TooltipContent>
                    </Tooltip>
                )}
            </div>
        </div>
    );

    return (
        <>
            {/* Desktop Sidebar */}
            <aside className={cn('hidden md:block fixed inset-y-0 left-0 z-40 transition-[width] duration-200', collapsed ? 'w-[76px]' : 'w-64')}>
                <NavContent />
            </aside>

            {/* Mobile Sidebar */}
            <div className="md:hidden">
                <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                    <SheetTrigger asChild>
                        <Button variant="ghost" size="icon" className="fixed top-3.5 left-3 z-50 h-9 w-9 bg-white/80 backdrop-blur-sm border border-slate-200 rounded-xl shadow-sm">
                            <Menu aria-label="Open navigation" className="h-5 w-5" />
                        </Button>
                    </SheetTrigger>
                    <SheetContent side="left" className="p-0 w-64">
                        <NavContent />
                    </SheetContent>
                </Sheet>
            </div>
        </>
    );
}
