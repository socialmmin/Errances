import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopNav } from './TopNav';
import { useAppStore } from '@/store';
import { triggerBirthdayWishesCheck } from '@/lib/api';
import { cn } from '@/lib/utils';

const COLLAPSE_KEY = 'sidebar_collapsed';

export function Layout() {
    const { fetchLeads, fetchTours, fetchLeadStatuses, fetchFollowups } = useAppStore();
    const [collapsed, setCollapsed] = useState(() => {
        try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
    });

    useEffect(() => {
        fetchLeads();
        fetchTours();
        fetchLeadStatuses();
        fetchFollowups();
    }, [fetchLeads, fetchTours, fetchLeadStatuses, fetchFollowups]);

    useEffect(() => {
        triggerBirthdayWishesCheck().catch(err => console.error('Failed to trigger birthday wishes check:', err));
    }, []);

    const toggleCollapse = () => {
        setCollapsed((prev) => {
            const next = !prev;
            try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
            return next;
        });
    };

    return (
        <div className="h-screen bg-slate-50 flex flex-col overflow-hidden">
            <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} />
            <div className={cn('flex-1 flex flex-col min-w-0 transition-[margin] duration-200', collapsed ? 'md:ml-[76px]' : 'md:ml-64')}>
                <TopNav />
                <main className="flex-1 overflow-y-auto">
                    <div className="min-h-full w-full max-w-[1920px] mx-auto p-3 md:p-5 animate-in fade-in duration-500 flex flex-col">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    );
}
