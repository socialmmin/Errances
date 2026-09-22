
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { LeadCard } from './LeadCard';
import type { Lead } from '@/types';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store';
import { getStatusConfig, statusBadgeClass } from '@/lib/leadUtils';

interface KanbanColumnProps {
    id: string;
    title: string;
    leads: Lead[];
}

export function KanbanColumn({ id, title, leads }: KanbanColumnProps) {
    const { setNodeRef } = useDroppable({
        id: id,
    });
    const { leadStatuses } = useAppStore();
    const colorClass = statusBadgeClass(getStatusConfig(leadStatuses, id).color);

    return (
        <div className={cn(
            "flex flex-col h-full w-full min-w-0 bg-slate-50/50 rounded-xl border border-slate-200/60 shadow-sm",
            "transition-colors duration-200 hover:bg-slate-50/80"
        )}>
            <div className={`p-3 font-medium text-sm flex items-center justify-between sticky top-0 bg-slate-50/95 backdrop-blur-sm z-10 border-b border-slate-100 ${colorClass}`}>
                <div className="flex items-center gap-2">
                    <span className="uppercase tracking-wider text-xs font-bold">{title}</span>
                    <span className="bg-white/50 px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums border border-black/5 block min-w-[1.5rem] text-center">
                        {leads.length}
                    </span>
                </div>
            </div>

            <div ref={setNodeRef} className="flex-1 p-3 space-y-3 overflow-y-auto min-h-[150px] scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
                <SortableContext items={leads.map(l => l.id)} strategy={verticalListSortingStrategy}>
                    {leads.map((lead) => (
                        <LeadCard key={lead.id} lead={lead} />
                    ))}
                </SortableContext>
                {leads.length === 0 && (
                    <div className="h-32 flex flex-col items-center justify-center border-2 border-dashed border-slate-200/60 rounded-xl bg-slate-50/30 m-1">
                        <div className="text-slate-300 mb-2">
                            <LayoutGridIcon className="w-8 h-8 opacity-20" />
                        </div>
                        <p className="text-sm text-slate-400 font-medium">No leads in this stage</p>
                    </div>
                )}
            </div>
        </div>
    );
}

function LayoutGridIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <rect width="7" height="7" x="3" y="3" rx="1" />
            <rect width="7" height="7" x="14" y="3" rx="1" />
            <rect width="7" height="7" x="14" y="14" rx="1" />
            <rect width="7" height="7" x="3" y="14" rx="1" />
        </svg>
    )
}
