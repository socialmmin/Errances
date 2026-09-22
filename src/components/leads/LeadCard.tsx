
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Lead } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Phone, Mail, Euro, Calendar, Globe, Map } from 'lucide-react';
import { cn, getLeadRevenue } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store';

interface LeadCardProps {
    lead: Lead;
}

export function LeadCard({ lead }: LeadCardProps) {
    const navigate = useNavigate();
    const { tours, leadStatuses } = useAppStore();
    const isWon = leadStatuses.find((s) => s.key === lead.status)?.is_closed_won ?? false;
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: lead.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 10 : 1,
    };

    const handleClick = (e: React.MouseEvent) => {
        if (isDragging) return;
        const target = e.target as HTMLElement;
        if (target.closest('button') || target.closest('a')) {
            return;
        }
        navigate(`/leads/${lead.id}`);
    };

    return (
        <Card
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            onClick={handleClick}
            className={cn(
                "cursor-grab active:cursor-grabbing group border-slate-200/60 shadow-md bg-white/80 backdrop-blur-sm overflow-hidden relative",
                "transition-all duration-300 hover:shadow-xl hover:-translate-y-1.5 hover:border-indigo-200/50 hover:bg-white",
                isDragging ? "shadow-2xl ring-2 ring-indigo-500/30 rotate-1 scale-105" : ""
            )}
        >
            {/* Top accent line */}
            <div className={cn(
                "absolute top-0 left-0 w-full h-1 bg-gradient-to-r transition-opacity duration-300",
                lead.status === 'new' ? "from-indigo-400 to-cyan-400" :
                    isWon ? "from-emerald-400 to-teal-400" :
                        "from-slate-300 to-slate-400",
                "opacity-0 group-hover:opacity-100"
            )} />

            <CardContent className="p-2.5 space-y-2.5">
                {/* Header: Avatar, Name & Role/Source */}
                <div className="flex items-start gap-2">
                    <Avatar className="h-7 w-7 border-[1.5px] border-white shadow-sm ring-1 ring-slate-100 transition-transform group-hover:scale-105 duration-300">
                        <AvatarFallback className={cn(
                            "text-[9px] font-bold",
                            lead.status === 'new' ? 'bg-indigo-50 text-indigo-700' :
                                isWon ? 'bg-emerald-50 text-emerald-700' :
                                    'bg-slate-50 text-slate-700'
                        )}>
                            {lead.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-bold text-indigo-950 truncate leading-tight group-hover:text-indigo-600 transition-colors">
                            {lead.name}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                            <Badge variant="outline" className="text-[8px] h-3.5 px-1 py-0 bg-slate-50/50 border-slate-200 text-slate-500 font-medium">
                                <Globe className="w-2 h-2 mr-1" />
                                {lead.source || 'Website'}
                            </Badge>
                        </div>
                    </div>
                </div>

                {/* Main Content Area: Budget & Tour */}
                <div className="grid grid-cols-1 gap-1.5 bg-indigo-50/30 p-2 rounded-lg border border-indigo-100/50 transition-colors group-hover:bg-indigo-50/40">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 ">
                            <div className="bg-white p-1 rounded shadow-xs">
                                <Euro className="w-3 h-3 text-emerald-600" />
                            </div>
                            <span className="text-[13px] font-extrabold text-slate-900 tracking-tight">
                                {(() => {
                                    const revenue = getLeadRevenue(lead, tours);
                                    return revenue ? revenue.toLocaleString() : '0';
                                })()}
                            </span>
                        </div>
                        <span className="text-[8px] uppercase tracking-tighter font-bold text-slate-400/80">Budget</span>
                    </div>

                    <div className="h-px bg-indigo-100/40 w-full" />

                    <div className="flex items-center gap-1.5">
                        <div className="bg-white p-1 rounded shadow-xs">
                            <Map className="w-3 h-3 text-indigo-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-[10px] font-bold text-slate-700 truncate leading-tight">
                                {lead.tour_interest || 'Custom Package'}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Contact Section */}
                <div className="space-y-1 pt-0.5">
                    <div className="flex items-center text-[10px] font-medium text-slate-500 hover:text-indigo-600 transition-colors cursor-pointer group/item">
                        <div className="w-4 h-4 flex items-center justify-center rounded mr-1.5 group-hover/item:bg-indigo-50">
                            <Mail className="w-2.5 h-2.5 text-slate-400 group-hover/item:text-indigo-500" />
                        </div>
                        <span className="truncate">{lead.email}</span>
                    </div>
                    <div className="flex items-center text-[10px] font-medium text-slate-500 hover:text-indigo-600 transition-colors cursor-pointer group/item">
                        <div className="w-4 h-4 flex items-center justify-center rounded mr-1.5 group-hover/item:bg-indigo-50">
                            <Phone className="w-2.5 h-2.5 text-slate-400 group-hover/item:text-indigo-500" />
                        </div>
                        <span>{lead.phone}</span>
                    </div>
                </div>

                {/* Footer: Date */}
                <div className="flex justify-between items-center pt-2 border-t border-slate-100/60 mt-0.5">
                    <div className="flex items-center text-[8px] font-bold text-slate-400/80 uppercase">
                        <Calendar className="w-2.5 h-2.5 mr-1.5 opacity-60" />
                        {new Date(lead.created_at).toLocaleDateString(undefined, {
                            month: 'short', day: 'numeric'
                        })}
                    </div>

                    <div className={cn(
                        "w-1 h-1 rounded-full",
                        lead.status === 'new' ? "bg-indigo-400 animate-pulse" :
                            isWon ? "bg-emerald-400" :
                                "bg-slate-300"
                    )} />
                </div>
            </CardContent>
        </Card>
    );
}
