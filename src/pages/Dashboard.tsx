import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { KPICards } from '@/components/dashboard/KPICards';
import { LeadsTrendChart } from '@/components/dashboard/LeadsTrendChart';
import { RevenueChart } from '@/components/dashboard/RevenueChart';
import { RecentActivity } from '@/components/dashboard/RecentActivity';
import { PipelineFunnel } from '@/components/dashboard/PipelineFunnel';
import { UpcomingFollowUps } from '@/components/dashboard/UpcomingFollowUps';
import { useAppStore } from '@/store';
import { useMemo, useState } from 'react';
import { format, subDays, parseISO } from 'date-fns';
import { useFilteredLeads } from '@/hooks/useFilteredLeads';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { LeadForm } from '@/components/leads/LeadForm';
import { v4 as uuidv4 } from 'uuid';
import { useI18n } from '@/i18n';
import { getLeadRevenue } from '@/lib/utils';
import { useAuth } from '@/components/AuthProvider';

const ROLE_LABELS: Record<string, string> = {
    admin: 'Super Admin',
    sales_manager: 'Sales Manager',
    sales_executive: 'Sales Executive',
    support: 'Support',
};

function useGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
}

export function Dashboard() {
    const { tours, addLead, leadStatuses, followups } = useAppStore();
    const { user } = useAuth();
    const greeting = useGreeting();
    const leads = useFilteredLeads();
    const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
    const { t, language, setLanguage } = useI18n();

    const handleSaveLead = (data: any) => {
        addLead({
            id: uuidv4(),
            created_at: new Date().toISOString(),
            ...data
        });
        setIsLeadModalOpen(false);
    };

    const dashboardData = useMemo(() => {
        const isWon = (status: string) => leadStatuses.find((s) => s.key === status)?.is_closed_won ?? status === 'converted';
        const isLost = (status: string) => leadStatuses.find((s) => s.key === status)?.is_closed_lost ?? status === 'lost';
        const isOpen = (status: string) => !isWon(status) && !isLost(status);

        // 1. KPIs
        const totalLeads = leads.length;
        const activeTours = tours.filter(t => t.status === 'active').length;

        const wonLeads = leads.filter(l => isWon(l.status)).length;
        const conversionRate = totalLeads > 0 ? ((wonLeads / totalLeads) * 100).toFixed(1) : '0.0';

        const totalRevenue = leads
            .filter(l => isWon(l.status))
            .reduce((sum, l) => sum + getLeadRevenue(l, tours), 0);

        const pendingFollowUps = followups.filter((f) => f.status === 'pending').length;

        const kpis = [
            { label: t('totalLeads'), value: totalLeads.toString(), icon: 'Users', link: '/leads' },
            { label: t('activeTours'), value: activeTours.toString(), icon: 'Map', link: '/tours' },
            { label: t('conversionRate'), value: `${conversionRate}%`, icon: 'TrendingUp', link: '/analytics' },
            { label: t('revenue'), value: `€${totalRevenue.toLocaleString()}`, icon: 'Euro', link: '/analytics' },
            { label: t('pendingFollowUps'), value: pendingFollowUps.toString(), icon: 'Calendar', link: '/pipeline' },
            { label: t('wonLeads'), value: wonLeads.toString(), icon: 'UserCheck', link: '/leads' },
            { label: t('avgBudget'), value: wonLeads > 0 ? `€${Math.round(totalRevenue / wonLeads).toLocaleString()}` : '€0', icon: 'Euro', link: '/analytics' },
            { label: t('lostLeads'), value: leads.filter(l => isLost(l.status)).length.toString(), icon: 'Users', link: '/leads' },
        ];

        // 2. Leads Trend Data (Last 30 Days)
        const last30Days = Array.from({ length: 30 }, (_, i) => {
            const date = subDays(new Date(), 29 - i);
            return format(date, 'MMM d');
        });

        const leadsTrendData = last30Days.map(dateStr => {
            const count = leads.filter(l => format(parseISO(l.created_at), 'MMM d') === dateStr).length;
            return { name: dateStr, leads: count };
        });

        // 3. Revenue by Package (won leads only)
        const revenueByPackageMap = leads
            .filter(l => isWon(l.status) && l.tour_interest)
            .reduce((acc, lead) => {
                const tourName = lead.tour_interest || 'Custom';
                acc[tourName] = (acc[tourName] || 0) + getLeadRevenue(lead, tours);
                return acc;
            }, {} as Record<string, number>);

        const revenueData = Object.entries(revenueByPackageMap).map(([name, revenue]) => ({
            name,
            revenue
        })).sort((a, b) => b.revenue - a.revenue);

        // 4. Pipeline funnel (open stages only, in configured order)
        const funnel = leadStatuses
            .filter((s) => isOpen(s.key))
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((s) => ({ key: s.key, label: s.label, color: s.color, count: leads.filter((l) => l.status === s.key).length }));

        // 5. Recent Activity
        const recentActivity = [
            ...leads.map(l => ({
                id: `lead-${l.id}`,
                user: t('system'),
                action: t('newLeadCreated'),
                target: l.name,
                time: l.created_at,
                avatar: ''
            })),
            ...tours.map(tour => ({
                id: `tour-${tour.id}`,
                user: t('system'),
                action: t('newTourAdded'),
                target: tour.title,
                time: new Date().toISOString(),
                avatar: ''
            }))
        ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
            .slice(0, 5)
            .map(activity => ({
                ...activity,
                time: format(parseISO(activity.time), 'MMM d, h:mm a')
            }));

        return { kpis, leadsTrendData, revenueData, recentActivity, funnel };
    }, [leads, tours, t, leadStatuses, followups]);

    return (
        <div className="flex flex-col min-h-full gap-4">
            <div className="flex-none flex flex-col md:flex-row items-center justify-between gap-4 bg-white/40 backdrop-blur-md p-6 rounded-3xl border border-white/60 shadow-sm shadow-indigo-900/5">
                <div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <h2 className="text-3xl font-black tracking-tight text-slate-900 uppercase">{t('dashboard')}</h2>
                        {user?.role && (
                            <span className="text-[9px] font-black uppercase tracking-widest text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-lg px-2.5 py-1">
                                {ROLE_LABELS[user.role] || user.role}
                            </span>
                        )}
                    </div>
                    <p className="text-slate-500 font-medium">
                        {greeting}{user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''} — {t('overview')}
                    </p>
                </div>
                <div className="flex items-center gap-3 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 scrollbar-hide">
                    <div
                        className="relative inline-flex h-11 min-w-[100px] items-center justify-between rounded-xl bg-white/80 backdrop-blur-sm p-1 cursor-pointer border border-slate-200/60 shadow-sm transition-all hover:border-slate-300 group mr-1 shrink-0"
                        onClick={() => setLanguage(language === 'EN' ? 'FR' : 'EN')}
                        title="Toggle Language"
                    >
                        <span className={`z-10 w-1/2 text-center text-[10px] font-black tracking-widest select-none transition-colors duration-300 ${language === 'EN' ? 'text-slate-900' : 'text-slate-400 group-hover:text-slate-600'}`}>EN</span>
                        <span className={`z-10 w-1/2 text-center text-[10px] font-black tracking-widest select-none transition-colors duration-300 ${language === 'FR' ? 'text-slate-900' : 'text-slate-400 group-hover:text-slate-600'}`}>FR</span>
                        <div className={`absolute top-1 h-9 w-[calc(50%-4px)] rounded-lg bg-white shadow-sm border border-slate-100 transition-all duration-300 ease-in-out ${language === 'FR' ? 'left-[calc(50%+2px)]' : 'left-1'}`} />
                    </div>

                    <Button
                        className="bg-[#33A894] hover:bg-[#2c9180] text-white h-11 px-6 rounded-xl shadow-md shadow-[#33A894]/20 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 font-bold shrink-0"
                        onClick={() => setIsLeadModalOpen(true)}
                    >
                        <Plus className="h-4 w-4" /> {t('newLead')}
                    </Button>
                </div>
            </div>

            <div className="flex-none">
                <KPICards kpis={dashboardData.kpis} />
            </div>

            <div className="flex-initial grid gap-4 lg:grid-cols-3">
                <PipelineFunnel stages={dashboardData.funnel} />
                <UpcomingFollowUps />
            </div>

            <div className="flex-initial grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <LeadsTrendChart data={dashboardData.leadsTrendData} />
                <RevenueChart data={dashboardData.revenueData} />
            </div>

            <div className="flex-1 min-h-[150px]">
                <RecentActivity activities={dashboardData.recentActivity} />
            </div>

            <Dialog open={isLeadModalOpen} onOpenChange={setIsLeadModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('addNewLeadTitle')}</DialogTitle>
                        <DialogDescription>
                            {t('addNewLeadDesc')}
                        </DialogDescription>
                    </DialogHeader>
                    <LeadForm
                        onSubmit={handleSaveLead}
                        onCancel={() => setIsLeadModalOpen(false)}
                    />
                </DialogContent>
            </Dialog>
        </div>
    );
}
