import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

interface RevenueChartProps {
    data: { name: string; revenue: number }[];
}

export function RevenueChart({ data }: RevenueChartProps) {
    const totalRevenue = data.reduce((sum, item) => sum + item.revenue, 0);

    return (
        <Card className="col-span-3 border-none bg-white/70 backdrop-blur-sm shadow-sm hover:shadow-xl transition-all duration-300 rounded-3xl overflow-hidden ring-1 ring-slate-200/50">
            <CardHeader className="pb-2 pt-6 px-6">
                <CardTitle className="text-xs font-black text-slate-900 uppercase tracking-widest leading-none">Revenue Distribution</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                <div className="h-[180px] w-full relative">
                    {data.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                            No revenue data available.
                        </div>
                    ) : (
                        <>
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={data}
                                        cx="50%"
                                        cy="85%"
                                        startAngle={180}
                                        endAngle={0}
                                        innerRadius={70}
                                        outerRadius={100}
                                        paddingAngle={4}
                                        dataKey="revenue"
                                        stroke="none"
                                    >
                                        {data.map((_, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={COLORS[index % COLORS.length]}
                                                className="hover:opacity-80 transition-opacity duration-300"
                                            />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: 'rgba(255, 255, 255, 0.8)',
                                            backdropFilter: 'blur(8px)',
                                            borderRadius: '12px',
                                            border: '1px solid rgba(255, 255, 255, 0.4)',
                                            boxShadow: '0 4px 15px rgba(0, 0, 0, 0.05)',
                                            fontSize: '12px'
                                        }}
                                        formatter={(value: any) => [value ? `€${Number(value).toLocaleString()}` : '€0', 'Revenue']}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-x-0 bottom-[15%] flex flex-col items-center justify-center pointer-events-none">
                                <span className="text-lg font-bold text-slate-900 tracking-tight">€{totalRevenue.toLocaleString()}</span>
                                <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">Total Revenue</span>
                            </div>
                        </>
                    )}
                </div>
                {data.length > 0 && (
                    <div className="px-4 pb-4 flex flex-wrap justify-center gap-x-4 gap-y-2">
                        {data.map((item, index) => (
                            <div key={item.name} className="flex items-center gap-2">
                                <div
                                    className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm"
                                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                                />
                                <div className="flex flex-col min-w-0">
                                    <span className="text-[11px] font-bold text-slate-700 truncate leading-none">{item.name}</span>
                                    <span className="text-[10px] font-medium text-slate-400 mt-0.5">
                                        {((item.revenue / totalRevenue) * 100).toFixed(1)}%
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
