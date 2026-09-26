import { useEffect, useMemo, useState } from 'react';
import { useFilteredLeads } from '@/hooks/useFilteredLeads';
import { useAppStore } from '@/store';
import { getLeadRevenue } from '@/lib/utils';
import { downloadCSV } from '@/lib/csvExport';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { CalendarDateRangePicker } from '@/components/dashboard/DateRangePicker';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import type { DateRange } from 'react-day-picker';
import { isWithinInterval, parseISO, startOfDay, endOfDay } from 'date-fns';

const LEAD_SOURCE_COLORS = ['#E50914', '#a855f7', '#f59e0b', '#10b981', '#ef4444', '#6366f1'];

function ExportButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={onClick}>
            <Download className="h-3.5 w-3.5" /> {label}
        </Button>
    );
}

export function ReportsTab() {
    const leads = useFilteredLeads();
    const { tours, staff, leadStatuses, conversations, fetchLeadStatuses, fetchStaff, fetchConversations } = useAppStore();
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

    useEffect(() => {
        if (leadStatuses.length <= 1) fetchLeadStatuses();
        if (staff.length === 0) fetchStaff();
        if (conversations.length === 0) fetchConversations();
    }, [leadStatuses.length, fetchLeadStatuses, staff.length, fetchStaff, conversations.length, fetchConversations]);

    const analytics = useMemo(() => {
        // Filter leads by date range
        const filteredLeads = leads.filter(lead => {
            if (!lead.created_at || !dateRange?.from || !dateRange?.to) return true;
            try {
                const leadDate = parseISO(lead.created_at);
                return isWithinInterval(leadDate, {
                    start: startOfDay(dateRange.from),
                    end: endOfDay(dateRange.to)
                });
            } catch (e) {
                return true;
            }
        });

        // Calculate Lead Sources
        const sourcesMap = filteredLeads.reduce((acc, lead) => {
            const source = lead.source || 'Unknown';
            acc[source] = (acc[source] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const leadSourcesData = Object.entries(sourcesMap).map(([name, value], index) => ({
            name,
            value,
            color: LEAD_SOURCE_COLORS[index % LEAD_SOURCE_COLORS.length]
        }));

        // Calculate Monthly Revenue (from converted leads)
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        // Initialize all 12 months with 0 revenue
        const monthlyRevenueData = months.map(name => ({ name, revenue: 0 }));

        filteredLeads.forEach(lead => {
            if (leadStatuses.find((s) => s.key === lead.status)?.is_closed_won && lead.created_at) {
                const date = new Date(lead.created_at);
                const monthIndex = date.getMonth();
                if (monthIndex >= 0 && monthIndex < 12) {
                    monthlyRevenueData[monthIndex].revenue += getLeadRevenue(lead, tours);
                }
            }
        });

        // Destination report — from the free-text tour_interest field (set by manual entry and
        // the WhatsApp automation alike) since not every lead is tied to a catalogue package.
        const destinationMap = filteredLeads.reduce((acc, lead) => {
            const dest = (lead.tour_interest || 'Unspecified').trim() || 'Unspecified';
            acc[dest] = (acc[dest] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        const destinationData = Object.entries(destinationMap)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 10);

        // Package interest report — only leads matched to an actual catalogue package.
        const packageMap = filteredLeads.reduce((acc, lead) => {
            if (!lead.selected_package) return acc;
            acc[lead.selected_package] = (acc[lead.selected_package] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        const packageInterestData = Object.entries(packageMap)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 10);

        // Consultant performance — leads assigned vs. won, per staff member.
        const consultantPerformance = staff
            .filter((s) => s.role !== 'admin')
            .map((member) => {
                const assigned = filteredLeads.filter((l) => l.assigned_staff_id === member.id);
                const won = assigned.filter((l) => leadStatuses.find((s) => s.key === l.status)?.is_closed_won);
                return {
                    name: member.full_name,
                    assigned: assigned.length,
                    won: won.length,
                    conversionRate: assigned.length ? Math.round((won.length / assigned.length) * 100) : 0,
                    revenue: won.reduce((sum, l) => sum + getLeadRevenue(l, tours), 0),
                };
            })
            .filter((c) => c.assigned > 0)
            .sort((a, b) => b.assigned - a.assigned);

        // AI automation report — sourced from live WhatsApp conversation state, not leads.
        const aiAutomation = {
            total: conversations.length,
            aiActive: conversations.filter((c) => !c.bot_paused && !c.opted_out).length,
            humanAssigned: conversations.filter((c) => c.bot_paused && !c.opted_out).length,
            optedOut: conversations.filter((c) => c.opted_out).length,
            failed: conversations.filter((c) => c.automation_error).length,
            completed: conversations.filter((c) => c.automation_step === 'completed').length,
        };

        return { leadSourcesData, monthlyRevenueData, destinationData, packageInterestData, consultantPerformance, aiAutomation };
    }, [leads, dateRange, leadStatuses, staff, tours, conversations]);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-col gap-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Analysis Period</span>
                    <CalendarDateRangePicker
                        date={dateRange}
                        onDateChange={setDateRange}
                    />
                </div>
                <ExportButton
                    label="Export leads (CSV)"
                    onClick={() => downloadCSV('leads-report', leads.map((l) => ({
                        lead_number: l.lead_number ?? '',
                        name: l.name,
                        phone: l.phone || '',
                        email: l.email || '',
                        source: l.source || '',
                        destination: l.tour_interest || '',
                        selected_package: l.selected_package || '',
                        status: l.status,
                        budget: l.budget ?? '',
                        assigned_staff_id: l.assigned_staff_id || '',
                        created_at: l.created_at,
                    })))}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Lead Sources Chart */}
                <Card>
                    <CardHeader>
                        <CardTitle>Lead Sources</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={analytics.leadSourcesData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={100}
                                        paddingAngle={0}
                                        dataKey="value"
                                    >
                                        {analytics.leadSourcesData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        formatter={(value: any) => `${value}`}
                                        contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                                    />
                                    <Legend
                                        verticalAlign="middle"
                                        align="right"
                                        layout="vertical"
                                        iconType="circle"
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Monthly Revenue Chart */}
                <Card>
                    <CardHeader>
                        <CardTitle>Monthly Revenue</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={analytics.monthlyRevenueData} barSize={40}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis
                                        dataKey="name"
                                        stroke="#64748b"
                                        fontSize={12}
                                        tickLine={false}
                                        axisLine={false}
                                    />
                                    <YAxis
                                        stroke="#64748b"
                                        fontSize={12}
                                        tickLine={false}
                                        axisLine={false}
                                        tickFormatter={(value) => `${value}`}
                                    />
                                    <Tooltip
                                        cursor={{ fill: '#f1f5f9' }}
                                        contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                                        formatter={(value: any) => [`€${value}`, 'Revenue']}
                                    />
                                    <Bar dataKey="revenue" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Destination Report */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle>Destination Report</CardTitle>
                        <ExportButton label="Export" onClick={() => downloadCSV('destination-report', analytics.destinationData)} />
                    </CardHeader>
                    <CardContent>
                        {analytics.destinationData.length ? (
                            <div className="h-[280px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={analytics.destinationData} layout="vertical" margin={{ left: 24 }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                                        <XAxis type="number" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                                        <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} width={110} />
                                        <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                                        <Bar dataKey="value" fill="#0ea5e9" radius={[0, 4, 4, 0]} name="Enquiries" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        ) : <p className="text-sm text-slate-500 py-8 text-center">No destination data for this period.</p>}
                    </CardContent>
                </Card>

                {/* Package Interest Report */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle>Package Interest Report</CardTitle>
                        <ExportButton label="Export" onClick={() => downloadCSV('package-interest-report', analytics.packageInterestData)} />
                    </CardHeader>
                    <CardContent>
                        {analytics.packageInterestData.length ? (
                            <div className="h-[280px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={analytics.packageInterestData} layout="vertical" margin={{ left: 24 }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                                        <XAxis type="number" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                                        <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} width={110} />
                                        <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                                        <Bar dataKey="value" fill="#22c55e" radius={[0, 4, 4, 0]} name="Enquiries" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        ) : <p className="text-sm text-slate-500 py-8 text-center">No package selections for this period.</p>}
                    </CardContent>
                </Card>

                {/* Consultant Performance Report */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle>Consultant Performance</CardTitle>
                        <ExportButton label="Export" onClick={() => downloadCSV('consultant-performance-report', analytics.consultantPerformance.map((c) => ({
                            consultant: c.name, assigned: c.assigned, won: c.won, conversion_rate_pct: c.conversionRate, revenue_eur: c.revenue,
                        })))} />
                    </CardHeader>
                    <CardContent>
                        {analytics.consultantPerformance.length ? (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-slate-500 border-b border-slate-100">
                                            <th className="py-2 font-medium">Consultant</th>
                                            <th className="py-2 font-medium text-right">Assigned</th>
                                            <th className="py-2 font-medium text-right">Won</th>
                                            <th className="py-2 font-medium text-right">Conversion</th>
                                            <th className="py-2 font-medium text-right">Revenue</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {analytics.consultantPerformance.map((c) => (
                                            <tr key={c.name} className="border-b border-slate-50 last:border-0">
                                                <td className="py-2 font-medium text-slate-800">{c.name}</td>
                                                <td className="py-2 text-right">{c.assigned}</td>
                                                <td className="py-2 text-right">{c.won}</td>
                                                <td className="py-2 text-right">{c.conversionRate}%</td>
                                                <td className="py-2 text-right">€{c.revenue.toLocaleString()}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : <p className="text-sm text-slate-500 py-8 text-center">No leads assigned to consultants in this period.</p>}
                    </CardContent>
                </Card>

                {/* AI Automation Report */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle>AI Automation Report</CardTitle>
                        <ExportButton label="Export" onClick={() => downloadCSV('ai-automation-report', [{
                            total_conversations: analytics.aiAutomation.total,
                            ai_active: analytics.aiAutomation.aiActive,
                            human_assigned: analytics.aiAutomation.humanAssigned,
                            opted_out: analytics.aiAutomation.optedOut,
                            delivery_failed: analytics.aiAutomation.failed,
                            enquiry_completed: analytics.aiAutomation.completed,
                        }])} />
                    </CardHeader>
                    <CardContent>
                        <p className="text-xs text-slate-500 mb-4">Live snapshot of the WhatsApp bot across all conversations (not limited to the analysis period above).</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                            {[
                                ['Total conversations', analytics.aiAutomation.total, 'text-slate-800'],
                                ['AI active', analytics.aiAutomation.aiActive, 'text-emerald-600'],
                                ['Human assigned', analytics.aiAutomation.humanAssigned, 'text-amber-600'],
                                ['Opted out', analytics.aiAutomation.optedOut, 'text-slate-500'],
                                ['Delivery failed', analytics.aiAutomation.failed, 'text-red-600'],
                                ['Enquiries completed', analytics.aiAutomation.completed, 'text-indigo-600'],
                            ].map(([label, value, color]) => (
                                <div key={label as string}>
                                    <p className={`text-2xl font-bold ${color}`}>{value}</p>
                                    <p className="text-xs text-slate-500">{label}</p>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

