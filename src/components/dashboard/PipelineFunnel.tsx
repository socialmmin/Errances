import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LayoutGrid, ArrowRight } from 'lucide-react';
import { statusDotClass } from '@/lib/leadUtils';
import { cn } from '@/lib/utils';

type FunnelStage = { key: string; label: string; color: string; count: number };

export function PipelineFunnel({ stages }: { stages: FunnelStage[] }) {
    const max = Math.max(1, ...stages.map((s) => s.count));

    return (
        <Card className="lg:col-span-2 border-none shadow-sm rounded-3xl bg-white/70 backdrop-blur-sm overflow-hidden">
            <CardHeader className="border-b border-slate-100/50 pb-4 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                    <LayoutGrid className="h-4 w-4 text-indigo-500" /> Lead Pipeline
                </CardTitle>
                <Link to="/pipeline" className="text-[11px] font-black text-indigo-600 hover:text-indigo-700 flex items-center gap-1 uppercase tracking-wide">
                    View Board <ArrowRight className="h-3 w-3" />
                </Link>
            </CardHeader>
            <CardContent className="pt-6">
                {stages.length === 0 || stages.every((s) => s.count === 0) ? (
                    <p className="text-sm text-slate-400 italic text-center py-8">No leads in the pipeline yet.</p>
                ) : (
                    <div className="space-y-3">
                        {stages.map((s) => (
                            <Link key={s.key} to="/pipeline" className="flex items-center gap-3 group">
                                <span className={cn('h-2 w-2 rounded-full flex-shrink-0', statusDotClass(s.color))} />
                                <span className="text-xs font-bold text-slate-600 w-28 flex-shrink-0 truncate group-hover:text-slate-900">{s.label}</span>
                                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                                    <div
                                        className={cn('h-full rounded-full transition-all duration-500', statusDotClass(s.color))}
                                        style={{ width: `${(s.count / max) * 100}%` }}
                                    />
                                </div>
                                <span className="text-xs font-black text-slate-700 w-6 text-right flex-shrink-0">{s.count}</span>
                            </Link>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
