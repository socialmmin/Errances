import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, PieChart, Pie, Cell } from 'recharts';
import { KPICards } from '@/components/dashboard/KPICards';
import { LeadsHeatmap } from './LeadsHeatmap';
import { PieChart as PieChartIcon, TrendingUp, Calendar as CalendarIcon } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { subDays, isAfter, parseISO, startOfDay } from 'date-fns';

const STATUS_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#a855f7', '#ef4444', '#3b82f6'];

const CustomBar = (props: any) => {
    const { x, y, width, height, fill } = props;
    return (
        <g>
            <rect x={x} y={y} width={width} height={height} fill={fill} rx={6} ry={6} />
            <path d={`M${x},${y} L${x + width},${y} L${x + width},${y + height} L${x},${y + height} Z`} fill="url(#funnelGradient)" opacity={0.3} />
        </g>
    );
};

import { useFilteredLeads } from '@/hooks/useFilteredLeads';
import { useAppStore } from '@/store';
import { getLeadRevenue } from '@/lib/utils';

export function LeadAnalyticsTab() {
    const { leads } = { leads: useFilteredLeads() };
    const { tours } = useAppStore();
    const [days, setDays] = useState('all');

    const analytics = useMemo(() => {
        // Filter leads by period
        const daysNum = days !== 'all' ? parseInt(days) : null;
        const periodStart = daysNum ? startOfDay(subDays(new Date(), daysNum)) : null;
        const prevPeriodStart = daysNum ? startOfDay(subDays(new Date(), daysNum * 2)) : null;

        const filteredLeads = leads.filter(lead => {
            if (days === 'all') return true;
            if (!lead.created_at) return true;
            if (!periodStart) return true;
            try {
                return isAfter(parseISO(lead.created_at), periodStart);
            } catch (e) {
                return true;
            }
        });

        const prevFilteredLeads = days !== 'all' && prevPeriodStart && periodStart
            ? leads.filter(lead => {
                if (!lead.created_at) return false;
                try {
                    const leadDate = parseISO(lead.created_at);
                    return isAfter(leadDate, prevPeriodStart) && !isAfter(leadDate, periodStart);
                } catch (e) {
                    return false;
                }
            })
            : [];

        const totalLeads = filteredLeads.length;
        const convertedLeads = filteredLeads.filter(l => l.status === 'converted').length;
        const conversionRate = totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : '0.0';
        const totalRevenue = filteredLeads
            .filter(l => l.status === 'converted')
            .reduce((sum, l) => sum + getLeadRevenue(l, tours), 0);

        const prevTotalLeads = prevFilteredLeads.length;
        const prevConvertedLeads = prevFilteredLeads.filter(l => l.status === 'converted').length;
        const prevConversionRate = prevTotalLeads > 0 ? (prevConvertedLeads / prevTotalLeads) * 100 : 0;
        const prevTotalRevenue = prevFilteredLeads
            .filter(l => l.status === 'converted')
            .reduce((sum, l) => sum + getLeadRevenue(l, tours), 0);

        const getChange = (curr: number, prev: number) => {
            if (days === 'all') return undefined;
            if (prev === 0) return curr > 0 ? 100 : 0;
            return Math.round(((curr - prev) / prev) * 100);
        };

        const getRateChange = (currRateStr: string, prevRate: number) => {
            if (days === 'all') return undefined;
            const currRate = parseFloat(currRateStr);
            if (prevRate === 0) return currRate > 0 ? 100 : 0;
            return Math.round(((currRate - prevRate) / prevRate) * 100);
        };

        const kpis = [
            { label: 'Total Leads', value: totalLeads.toString(), icon: 'Users', change: getChange(totalLeads, prevTotalLeads) },
            { label: 'Converted', value: convertedLeads.toString(), icon: 'UserCheck', change: getChange(convertedLeads, prevConvertedLeads) },
            { label: 'Conversion Rate', value: `${conversionRate}%`, icon: 'TrendingUp', change: getRateChange(conversionRate, prevConversionRate) },
            { label: 'Total Revenue', value: `€${totalRevenue.toLocaleString()}`, icon: 'Euro', change: getChange(totalRevenue, prevTotalRevenue) },
        ];

        const statusCounts = filteredLeads.reduce((acc, lead) => {
            acc[lead.status] = (acc[lead.status] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const funnelData = [
            { name: 'New', value: statusCounts['new'] || 0 },
            { name: 'Contacted', value: statusCounts['contacted'] || 0 },
            { name: 'Qualified', value: statusCounts['qualified'] || 0 },
            { name: 'Proposal', value: statusCounts['proposal_sent'] || 0 },
            { name: 'Converted', value: statusCounts['converted'] || 0 },
        ];

        const statusData = [
            { name: 'New', value: statusCounts['new'] || 0 },
            { name: 'Contacted', value: statusCounts['contacted'] || 0 },
            { name: 'Qualified', value: statusCounts['qualified'] || 0 },
            { name: 'Proposal Sent', value: statusCounts['proposal_sent'] || 0 },
            { name: 'Converted', value: statusCounts['converted'] || 0 },
            { name: 'Lost', value: statusCounts['lost'] || 0 },
        ].filter(item => item.value > 0);

        return { kpis, funnelData, statusData, totalLeads };
    }, [leads, days]);

    return (
        <div className="space-y-3 animate-in fade-in duration-500">
            {/* Control Panel */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 bg-white/40 backdrop-blur-md p-2 rounded-lg border border-white/20 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="bg-indigo-600 p-2 rounded-lg shadow-lg shadow-indigo-200">
                        <TrendingUp size={20} className="text-white" />
                    </div>
                    <div>
                        <h2 className="text-sm font-extrabold text-slate-900 tracking-tight leading-tight uppercase">Lead Performance</h2>
                        <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest leading-none">Conversion Intelligence</p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Select value={days} onValueChange={setDays}>
                        <SelectTrigger className="w-[140px] bg-white/50 border-white/30 text-[10px] font-bold uppercase h-9 rounded-xl shadow-inner active:scale-95 transition-transform">
                            <CalendarIcon className="mr-2 h-3.5 w-3.5 text-slate-500" />
                            <SelectValue placeholder="Range" />
                        </SelectTrigger>
                        <SelectContent className="bg-white/90 backdrop-blur-xl border-white/20">
                            <SelectItem value="7">Last 7 days</SelectItem>
                            <SelectItem value="30">Last 30 days</SelectItem>
                            <SelectItem value="90">Last 90 days</SelectItem>
                            <SelectItem value="all">All Time</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* LEVEL 1: Page Summary */}
            <div className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                    <div className="w-1.5 h-4 bg-indigo-500 rounded-full" />
                    <h3 className="text-[10px] font-black text-slate-700 uppercase tracking-[0.2em]">Level 1: Performance Summary</h3>
                </div>
                <KPICards kpis={analytics.kpis} />
            </div>

            {/* LEVEL 2: Core Insights */}
            <div className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                    <div className="w-1.5 h-4 bg-emerald-500 rounded-full" />
                    <h3 className="text-[10px] font-black text-slate-700 uppercase tracking-[0.2em]">Level 2: Market & Activity Dynamics</h3>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch">
                    {/* Status Distribution */}
                    <Card className="border-none shadow-sm bg-white/50 backdrop-blur-md overflow-hidden group flex flex-col hover:shadow-md transition-all duration-300 rounded-xl">
                        <CardHeader className="pb-1 pt-2 px-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="text-sm font-black text-slate-900 group-hover:text-indigo-600 transition-colors tracking-tight">Lead Velocity</CardTitle>
                                </div>
                                <div className="bg-indigo-50/50 p-1.5 rounded-lg">
                                    <PieChartIcon size={14} className="text-indigo-600" />
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="flex-1 flex flex-col justify-center pb-2">
                            <div className="h-[160px] w-full relative">
                                {/* Total badge in center */}
                                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none translate-y-0.5">
                                    <span className="text-[7px] font-black text-slate-400 uppercase tracking-[0.2em]">Total</span>
                                    <span className="text-xl font-black text-slate-900 tracking-tighter leading-none">{analytics.totalLeads}</span>
                                </div>

                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <defs>
                                            {STATUS_COLORS.map((color, i) => (
                                                <linearGradient key={i} id={`pieGradient-${i}`} x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor={color} stopOpacity={1} />
                                                    <stop offset="100%" stopColor={color} stopOpacity={0.6} />
                                                </linearGradient>
                                            ))}
                                        </defs>
                                        <Pie
                                            data={analytics.statusData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={50}
                                            outerRadius={75}
                                            paddingAngle={4}
                                            dataKey="value"
                                            animationBegin={0}
                                            animationDuration={1500}
                                            animationEasing="ease-out"
                                        >
                                            {analytics.statusData.map((_entry, index) => (
                                                <Cell
                                                    key={`cell-${index}`}
                                                    fill={`url(#pieGradient-${index % STATUS_COLORS.length})`}
                                                    stroke="rgba(255,255,255,1)"
                                                    strokeWidth={4}
                                                    className="hover:scale-105 transition-all duration-500 cursor-pointer focus:outline-none outline-none"
                                                />
                                            ))}
                                        </Pie>
                                        <RechartsTooltip
                                            content={({ active, payload }) => {
                                                if (active && payload && payload.length) {
                                                    return (
                                                        <div className="bg-white/95 backdrop-blur-xl p-4 rounded-3xl border border-white shadow-2xl animate-in zoom-in-50 duration-200">
                                                            <div className="flex flex-col gap-0.5">
                                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{payload[0].name}</p>
                                                                <div className="flex items-baseline gap-2">
                                                                    <span className="text-2xl font-black text-slate-900 leading-none">{payload[0].value}</span>
                                                                    <span className="text-xs font-bold text-slate-500">({Math.round((Number(payload[0].value) / (analytics?.totalLeads || 1)) * 100)}%)</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Visual Stats Row */}
                            <div className="grid grid-cols-3 gap-1.5 mt-1 px-1">
                                {analytics.statusData.slice(0, 3).map((item, idx) => (
                                    <div key={idx} className="flex flex-col gap-0 p-1.5 rounded-lg bg-white/40 border border-white/50 shadow-sm">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full shadow-sm" style={{ backgroundColor: STATUS_COLORS[idx % STATUS_COLORS.length] }} />
                                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-tighter truncate">{item.name}</span>
                                        </div>
                                        <span className="text-lg font-black text-slate-800 leading-none">{item.value}</span>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>

                    <LeadsHeatmap />
                </div>
            </div>

            {/* LEVEL 3: Deep Analysis */}
            <div className="space-y-1.5">
                <div className="flex items-center gap-2 px-1">
                    <div className="w-1.5 h-3.5 bg-purple-500 rounded-full" />
                    <h3 className="text-[10px] font-black text-slate-700 uppercase tracking-[0.2em]">Level 3: Deep Intelligence</h3>
                </div>

                <div className="grid grid-cols-1 gap-3">
                    {/* Pipeline Efficiency */}
                    <div className="space-y-2">
                        <Card className="border-none shadow-sm bg-white/50 backdrop-blur-md overflow-hidden group hover:shadow-md transition-all duration-300 rounded-xl">
                            <CardHeader className="pb-1 pt-2 px-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex flex-col">
                                        <CardTitle className="text-xs font-black text-slate-900 group-hover:text-purple-600 transition-colors tracking-tight">Pipeline Funnel</CardTitle>
                                    </div>
                                    <div className="bg-purple-50/50 p-1.5 rounded-lg">
                                        <TrendingUp size={12} className="text-purple-600" />
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="pb-2">
                                <div className="h-[200px] w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={analytics.funnelData} layout="vertical" barSize={24} margin={{ left: 10, right: 90, top: 5, bottom: 5 }}>
                                            <defs>
                                                <linearGradient id="funnelGradient" x1="0" y1="0" x2="1" y2="0">
                                                    <stop offset="0%" stopColor="#6366f1" />
                                                    <stop offset="100%" stopColor="#a855f7" />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="rgba(203, 213, 225, 0.4)" />
                                            <XAxis type="number" hide />
                                            <YAxis
                                                dataKey="name"
                                                type="category"
                                                width={80}
                                                stroke="#94a3b8"
                                                fontSize={10}
                                                fontWeight={900}
                                                tickLine={false}
                                                axisLine={false}
                                                tick={{ fill: '#64748b', fontSize: 9 }}
                                                className="uppercase tracking-widest"
                                            />
                                            <RechartsTooltip
                                                cursor={{ fill: 'rgba(241, 245, 249, 0.6)' }}
                                                contentStyle={{
                                                    backgroundColor: 'rgba(255, 255, 255, 0.98)',
                                                    borderRadius: '24px',
                                                    border: 'none',
                                                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.15)',
                                                    padding: '16px'
                                                }}
                                            />
                                            <Bar
                                                dataKey="value"
                                                fill="url(#funnelGradient)"
                                                shape={<CustomBar />}
                                                animationDuration={2000}
                                                label={({ x = 0, y = 0, width = 0, height = 0, value, index }: any) => {
                                                    const prevValue = analytics.funnelData[index - 1]?.value;
                                                    const convRate = prevValue ? Math.round((Number(value) / prevValue) * 100) : null;
                                                    return (
                                                        <g className="animate-in fade-in duration-1000">
                                                            <text x={Number(x) + Number(width) + 15} y={Number(y) + Number(height) / 2 + 5} fill="#0f172a" fontSize={14} fontWeight={900}>{value}</text>
                                                            {convRate && (
                                                                <text x={Number(x) + Number(width) + 45} y={Number(y) + Number(height) / 2 + 5} fill="#3b82f6" fontSize={11} fontWeight={900} className="italic">
                                                                    ↓ {convRate}%
                                                                </text>
                                                            )}
                                                        </g>
                                                    );
                                                }}
                                            />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    );
}
