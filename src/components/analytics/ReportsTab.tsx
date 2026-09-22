import { useEffect, useMemo, useState } from 'react';
import { useFilteredLeads } from '@/hooks/useFilteredLeads';
import { useAppStore } from '@/store';
import { getLeadRevenue } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CalendarDateRangePicker } from '@/components/dashboard/DateRangePicker';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import type { DateRange } from 'react-day-picker';
import { isWithinInterval, parseISO, startOfDay, endOfDay } from 'date-fns';

const LEAD_SOURCE_COLORS = ['#E50914', '#a855f7', '#f59e0b', '#10b981', '#ef4444', '#6366f1'];

export function ReportsTab() {
    const leads = useFilteredLeads();
    const { tours, leadStatuses, fetchLeadStatuses } = useAppStore();
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

    useEffect(() => {
        if (leadStatuses.length <= 1) fetchLeadStatuses();
    }, [leadStatuses.length, fetchLeadStatuses]);

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

        return { leadSourcesData, monthlyRevenueData };
    }, [leads, dateRange, leadStatuses]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Analysis Period</span>
                <CalendarDateRangePicker
                    date={dateRange}
                    onDateChange={setDateRange}
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
            </div>
        </div>
    );
}

