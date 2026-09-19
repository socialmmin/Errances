import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useAppStore } from '@/store';
import { triggerBirthdayWishesCheck } from '@/lib/api';

export function Layout() {
    const { fetchLeads, fetchTours, fetchLeadStatuses, fetchFollowups } = useAppStore();

    useEffect(() => {
        fetchLeads();
        fetchTours();
        fetchLeadStatuses();
        fetchFollowups();
    }, [fetchLeads, fetchTours, fetchLeadStatuses, fetchFollowups]);

    useEffect(() => {
        triggerBirthdayWishesCheck().catch(err => console.error('Failed to trigger birthday wishes check:', err));
    }, []);

    return (
        <div className="h-screen bg-slate-50 flex flex-col overflow-hidden">
            <Sidebar />
            <main className="md:ml-64 flex-1 overflow-y-auto transition-all duration-300">
                <div className="min-h-full w-full max-w-[1920px] mx-auto p-2 md:p-4 pt-14 md:pt-4 animate-in fade-in duration-500 flex flex-col">
                    <Outlet />
                </div>
            </main>
        </div>
    );
}
