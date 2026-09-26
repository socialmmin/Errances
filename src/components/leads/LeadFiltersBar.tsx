import { useEffect, useMemo, useState } from 'react';
import { Search, X, Bookmark, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { Lead } from '@/types';
import { useAppStore } from '@/store';
import { isFollowupOverdue, isSameDay } from '@/lib/leadUtils';
import { cn } from '@/lib/utils';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

type SmartFilterKey =
    | 'all' | 'today' | 'new' | 'mine' | 'unassigned'
    | 'followup_today' | 'followup_tomorrow' | 'overdue' | 'high_priority' | 'won' | 'lost';

const SMART_FILTERS: { key: SmartFilterKey; label: string }[] = [
    { key: 'all', label: 'All Leads' },
    { key: 'today', label: 'Today Leads' },
    { key: 'new', label: 'New Leads' },
    { key: 'mine', label: 'My Leads' },
    { key: 'unassigned', label: 'Unassigned' },
    { key: 'followup_today', label: 'Follow-up Today' },
    { key: 'followup_tomorrow', label: 'Follow-up Tomorrow' },
    { key: 'overdue', label: 'Overdue' },
    { key: 'high_priority', label: 'High Priority' },
    { key: 'won', label: 'Won' },
    { key: 'lost', label: 'Lost' },
];

type SavedView = { name: string; smart: SmartFilterKey; source: string; employee: string; statusKey: string };

const SAVED_VIEWS_KEY = 'leads_saved_views';

export function useLeadFilters(leads: Lead[], storageKey = 'default', initialEmployeeFilter = 'all') {
    const { staff, user, leadStatuses, followups } = useAppStore();
    const [search, setSearch] = useState('');
    const [smart, setSmart] = useState<SmartFilterKey>('all');
    const [sourceFilter, setSourceFilter] = useState('all');
    const [employeeFilter, setEmployeeFilter] = useState(initialEmployeeFilter);
    const [statusFilter, setStatusFilter] = useState('all');
    const [savedViews, setSavedViews] = useState<SavedView[]>([]);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(`${SAVED_VIEWS_KEY}_${storageKey}`);
            if (raw) setSavedViews(JSON.parse(raw));
        } catch { /* ignore */ }
    }, [storageKey]);

    const persistViews = (views: SavedView[]) => {
        setSavedViews(views);
        try { localStorage.setItem(`${SAVED_VIEWS_KEY}_${storageKey}`, JSON.stringify(views)); } catch { /* ignore */ }
    };

    const saveCurrentView = (name: string) => {
        const view: SavedView = { name, smart, source: sourceFilter, employee: employeeFilter, statusKey: statusFilter };
        persistViews([...savedViews.filter((v) => v.name !== name), view]);
    };

    const applyView = (view: SavedView) => {
        setSmart(view.smart);
        setSourceFilter(view.source);
        setEmployeeFilter(view.employee);
        setStatusFilter(view.statusKey);
    };

    const deleteView = (name: string) => persistViews(savedViews.filter((v) => v.name !== name));

    const sources = useMemo(() => Array.from(new Set(leads.map((l) => l.source).filter(Boolean))), [leads]);

    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    const followupByLead = useMemo(() => {
        const map: Record<string, typeof followups> = {};
        followups.forEach((f) => {
            if (f.status !== 'pending') return;
            if (!map[f.lead_id]) map[f.lead_id] = [];
            map[f.lead_id].push(f);
        });
        return map;
    }, [followups]);

    const filtered = useMemo(() => {
        let result = leads;

        if (search.trim()) {
            const q = search.trim().toLowerCase();
            result = result.filter((l) =>
                l.name?.toLowerCase().includes(q) ||
                l.phone?.toLowerCase().includes(q) ||
                l.whatsapp_number?.toLowerCase().includes(q) ||
                l.email?.toLowerCase().includes(q) ||
                String(l.lead_number || '').includes(q) ||
                l.id.toLowerCase().includes(q)
            );
        }

        if (sourceFilter !== 'all') result = result.filter((l) => l.source === sourceFilter);
        if (employeeFilter !== 'all') {
            result = employeeFilter === 'unassigned'
                ? result.filter((l) => !l.assigned_staff_id)
                : result.filter((l) => l.assigned_staff_id === employeeFilter);
        }
        if (statusFilter !== 'all') result = result.filter((l) => l.status === statusFilter);

        switch (smart) {
            case 'today':
                result = result.filter((l) => isSameDay(l.created_at, today));
                break;
            case 'new':
                result = result.filter((l) => l.status === 'new');
                break;
            case 'mine':
                result = result.filter((l) => l.assigned_staff_id === user?.id);
                break;
            case 'unassigned':
                result = result.filter((l) => !l.assigned_staff_id);
                break;
            case 'followup_today':
                result = result.filter((l) => (followupByLead[l.id] || []).some((f) => isSameDay(f.due_date, today)));
                break;
            case 'followup_tomorrow':
                result = result.filter((l) => (followupByLead[l.id] || []).some((f) => isSameDay(f.due_date, tomorrow)));
                break;
            case 'overdue':
                result = result.filter((l) => (followupByLead[l.id] || []).some((f) => isFollowupOverdue(f.due_date, f.due_time)));
                break;
            case 'high_priority':
                result = result.filter((l) => l.priority === 'high' || l.priority === 'urgent');
                break;
            case 'won':
                result = result.filter((l) => leadStatuses.find((s) => s.key === l.status)?.is_closed_won);
                break;
            case 'lost':
                result = result.filter((l) => leadStatuses.find((s) => s.key === l.status)?.is_closed_lost);
                break;
        }

        return result;
    }, [leads, search, sourceFilter, employeeFilter, statusFilter, smart, followupByLead, user, leadStatuses]);

    const FilterBar = (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[220px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                        placeholder="Search by name, mobile, WhatsApp, email or Lead ID…"
                        className="pl-9 h-10 bg-white/80 border-slate-200/60 rounded-xl text-sm font-medium"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                        <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
                <Select value={sourceFilter} onValueChange={setSourceFilter}>
                    <SelectTrigger className="h-10 w-40 bg-white/80 rounded-xl text-xs font-bold"><SelectValue placeholder="Source" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Sources</SelectItem>
                        {sources.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                    <SelectTrigger className="h-10 w-44 bg-white/80 rounded-xl text-xs font-bold"><SelectValue placeholder="Employee" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Employees</SelectItem>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-10 w-40 bg-white/80 rounded-xl text-xs font-bold"><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        {leadStatuses.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                    </SelectContent>
                </Select>
                <button
                    className="h-10 px-3 rounded-xl border border-slate-200 bg-white/80 text-slate-500 hover:text-indigo-600 hover:border-indigo-200 flex items-center gap-1.5 text-xs font-bold"
                    onClick={() => {
                        const name = window.prompt('Name this saved view:');
                        if (name) saveCurrentView(name);
                    }}
                    title="Save current filters as a view"
                >
                    <Plus className="h-3.5 w-3.5" /> Save View
                </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
                {SMART_FILTERS.map((f) => (
                    <button
                        key={f.key}
                        onClick={() => setSmart(f.key)}
                        className={cn(
                            'px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors',
                            smart === f.key
                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-500/20'
                                : 'bg-white/70 text-slate-500 border-slate-200 hover:border-indigo-200 hover:text-indigo-600'
                        )}
                    >
                        {f.label}
                    </button>
                ))}
                {savedViews.map((v) => (
                    <span key={v.name} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold border border-dashed border-slate-300 text-slate-500 bg-white/50">
                        <button onClick={() => applyView(v)} className="flex items-center gap-1 hover:text-indigo-600">
                            <Bookmark className="h-3 w-3" /> {v.name}
                        </button>
                        <button onClick={() => deleteView(v.name)} className="text-slate-300 hover:text-red-500"><X className="h-3 w-3" /></button>
                    </span>
                ))}
            </div>
        </div>
    );

    return { filtered, FilterBar };
}
