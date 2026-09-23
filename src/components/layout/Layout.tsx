import { useEffect, useState, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopNav } from './TopNav';
import { useAppStore } from '@/store';
import { triggerBirthdayWishesCheck } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

const COLLAPSE_KEY = 'sidebar_collapsed';

export function Layout() {
    const { fetchLeads, fetchTours, fetchLeadStatuses, fetchFollowups, fetchConversations } = useAppStore();
    const mainRef = useRef<HTMLElement>(null);
    const { pathname } = useLocation();
    useEffect(() => { mainRef.current?.scrollTo({ top: 0, left: 0 }); }, [pathname]);
    const [collapsed, setCollapsed] = useState(() => {
        try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
    });

    useEffect(() => {
        fetchLeads();
        fetchTours();
        fetchLeadStatuses();
        fetchFollowups();
        fetchConversations();
    }, [fetchLeads, fetchTours, fetchLeadStatuses, fetchFollowups, fetchConversations]);

    useEffect(() => {
        triggerBirthdayWishesCheck().catch(err => console.error('Failed to trigger birthday wishes check:', err));
    }, []);

    // App-wide realtime: keep the WhatsApp conversation list (unread counts, assignment,
    // status) live everywhere — the inbox itself, the notification bell, the sidebar — not
    // just while the WhatsApp page happens to be mounted.
    useEffect(() => {
        const channel = supabase
            .channel('global:whatsapp_conversations')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_conversations' }, (payload: any) => {
                useAppStore.setState((state) => {
                    if (payload.eventType === 'DELETE') {
                        return { conversations: state.conversations.filter((c) => c.id !== payload.old.id) };
                    }
                    const exists = state.conversations.some((c) => c.id === payload.new.id);
                    return {
                        conversations: exists
                            ? state.conversations.map((c) => (c.id === payload.new.id ? payload.new : c))
                            : [payload.new, ...state.conversations],
                    };
                });
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, []);

    const toggleCollapse = () => {
        setCollapsed((prev) => {
            const next = !prev;
            try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
            return next;
        });
    };

    return (
        <div className="h-dvh bg-slate-50 flex flex-col overflow-hidden">
            <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} />
            <div className={cn('flex-1 min-h-0 flex flex-col min-w-0 transition-[margin] duration-200', collapsed ? 'md:ml-[76px]' : 'md:ml-64')}>
                <TopNav />
                <main ref={mainRef} id="main-content" tabIndex={-1} className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                    <div className="min-h-full w-full max-w-[1920px] mx-auto p-3 md:p-5 animate-in fade-in duration-500 flex flex-col">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    );
}
