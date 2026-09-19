import { useMemo, useState } from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
    Edit, Trash2, Mail, Phone, MessageSquare, ArrowUpDown, ChevronLeft, ChevronRight,
    Columns3, ChevronDown, User as UserIcon, ImageOff,
} from 'lucide-react';
import type { Lead, User } from '@/types';
import { format, parseISO } from 'date-fns';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store';
import { calculateAge, formatLeadNumber, getStatusConfig, statusBadgeClass, PRIORITY_CONFIG, initialsFromName } from '@/lib/leadUtils';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface LeadsTableProps {
    leads: Lead[];
    onEdit: (lead: Lead) => void;
    onDelete: (id: string) => void;
    onWhatsApp: (lead: Lead) => void;
    onBulkAssign?: (ids: string[], staffId: string | null) => void;
    onBulkStatus?: (ids: string[], status: string) => void;
    storageKey?: string;
}

type ColumnKey =
    | 'photo' | 'name' | 'mobile' | 'whatsapp' | 'email' | 'dob' | 'age' | 'gender'
    | 'source' | 'campaign' | 'assigned' | 'status' | 'priority' | 'followUp'
    | 'lastContacted' | 'nextAction' | 'created';

const ALL_COLUMNS: { key: ColumnKey; label: string; defaultOn: boolean }[] = [
    { key: 'photo', label: 'Photo', defaultOn: true },
    { key: 'name', label: 'Lead', defaultOn: true },
    { key: 'mobile', label: 'Mobile', defaultOn: true },
    { key: 'whatsapp', label: 'WhatsApp', defaultOn: false },
    { key: 'email', label: 'Email', defaultOn: true },
    { key: 'dob', label: 'Date of Birth', defaultOn: false },
    { key: 'age', label: 'Age', defaultOn: false },
    { key: 'gender', label: 'Gender', defaultOn: false },
    { key: 'source', label: 'Source', defaultOn: true },
    { key: 'campaign', label: 'Campaign', defaultOn: false },
    { key: 'assigned', label: 'Assigned Employee', defaultOn: true },
    { key: 'status', label: 'Status', defaultOn: true },
    { key: 'priority', label: 'Priority', defaultOn: true },
    { key: 'followUp', label: 'Follow-up Date', defaultOn: true },
    { key: 'lastContacted', label: 'Last Contacted', defaultOn: false },
    { key: 'nextAction', label: 'Next Action', defaultOn: false },
    { key: 'created', label: 'Created', defaultOn: true },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

function loadColumnPrefs(storageKey: string): Set<ColumnKey> {
    try {
        const raw = localStorage.getItem(`leads_columns_${storageKey}`);
        if (raw) return new Set(JSON.parse(raw));
    } catch { /* ignore */ }
    return new Set(ALL_COLUMNS.filter((c) => c.defaultOn).map((c) => c.key));
}

export function LeadsTable({ leads, onEdit, onDelete, onWhatsApp, onBulkAssign, onBulkStatus, storageKey = 'default' }: LeadsTableProps) {
    const navigate = useNavigate();
    const { staff, leadStatuses } = useAppStore();
    const [visibleCols, setVisibleCols] = useState<Set<ColumnKey>>(() => loadColumnPrefs(storageKey));
    const [sortKey, setSortKey] = useState<keyof Lead | 'age'>('created_at');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const toggleColumn = (key: ColumnKey) => {
        setVisibleCols((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            try { localStorage.setItem(`leads_columns_${storageKey}`, JSON.stringify([...next])); } catch { /* ignore */ }
            return next;
        });
    };

    const staffById = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s])), [staff]);

    const sorted = useMemo(() => {
        const arr = [...leads];
        arr.sort((a, b) => {
            let av: any; let bv: any;
            if (sortKey === 'age') {
                av = calculateAge(a.dob) ?? -1;
                bv = calculateAge(b.dob) ?? -1;
            } else {
                av = (a as any)[sortKey];
                bv = (b as any)[sortKey];
            }
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
            return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
        });
        return arr;
    }, [leads, sortKey, sortDir]);

    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const currentPage = Math.min(page, totalPages);
    const paginated = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    const toggleSort = (key: keyof Lead | 'age') => {
        if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else { setSortKey(key); setSortDir('desc'); }
    };

    const toggleSelectAll = () => {
        if (selected.size === paginated.length) setSelected(new Set());
        else setSelected(new Set(paginated.map((l) => l.id)));
    };

    const toggleSelect = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const col = (key: ColumnKey) => visibleCols.has(key);

    const SortableHead = ({ label, sortField }: { label: string; sortField?: keyof Lead | 'age' }) => (
        <TableHead
            className={cn('font-black text-[10px] uppercase tracking-widest text-slate-400 h-12 whitespace-nowrap', sortField && 'cursor-pointer select-none hover:text-slate-600')}
            onClick={() => sortField && toggleSort(sortField)}
        >
            <span className="flex items-center gap-1">
                {label}
                {sortField && <ArrowUpDown className={cn('h-2.5 w-2.5', sortKey === sortField ? 'opacity-100 text-indigo-500' : 'opacity-30')} />}
            </span>
        </TableHead>
    );

    return (
        <div className="bg-white/40 backdrop-blur-md rounded-3xl border border-white/60 shadow-xl shadow-indigo-900/5 overflow-hidden">
            {/* Toolbar: bulk actions + column picker */}
            <div className="flex items-center justify-between gap-3 px-6 py-3 border-b border-slate-100 bg-white/60">
                <div className="flex items-center gap-2 min-h-8">
                    {selected.size > 0 ? (
                        <>
                            <span className="text-xs font-black text-slate-600">{selected.size} selected</span>
                            {onBulkStatus && (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <button className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 px-2.5 py-1 rounded-lg hover:bg-indigo-50 flex items-center gap-1">
                                            Set Status <ChevronDown className="h-3 w-3" />
                                        </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent>
                                        {leadStatuses.map((s) => (
                                            <DropdownMenuCheckboxItem key={s.key} checked={false} onCheckedChange={() => onBulkStatus([...selected], s.key)}>
                                                {s.label}
                                            </DropdownMenuCheckboxItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            )}
                            {onBulkAssign && (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <button className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 px-2.5 py-1 rounded-lg hover:bg-indigo-50 flex items-center gap-1">
                                            Assign <ChevronDown className="h-3 w-3" />
                                        </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent>
                                        {staff.map((s) => (
                                            <DropdownMenuCheckboxItem key={s.id} checked={false} onCheckedChange={() => onBulkAssign([...selected], s.id)}>
                                                {s.full_name}
                                            </DropdownMenuCheckboxItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            )}
                            <button
                                className="text-[11px] font-bold text-slate-400 hover:text-slate-600 px-2.5 py-1"
                                onClick={() => setSelected(new Set())}
                            >
                                Clear
                            </button>
                        </>
                    ) : (
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{sorted.length} leads</span>
                    )}
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button className="text-[11px] font-bold text-slate-500 hover:text-slate-700 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 flex items-center gap-1.5 border border-slate-200">
                            <Columns3 className="h-3.5 w-3.5" /> Columns
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                        <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-slate-400">Visible Columns</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {ALL_COLUMNS.map((c) => (
                            <DropdownMenuCheckboxItem key={c.key} checked={visibleCols.has(c.key)} onCheckedChange={() => toggleColumn(c.key)}>
                                {c.label}
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <div className="overflow-x-auto">
                <Table className="border-separate border-spacing-y-2 px-4 pb-4">
                    <TableHeader className="bg-slate-50/50">
                        <TableRow className="border-none hover:bg-transparent">
                            <TableHead className="w-10 pl-6">
                                <input type="checkbox" className="rounded border-slate-300" checked={paginated.length > 0 && selected.size === paginated.length} onChange={toggleSelectAll} />
                            </TableHead>
                            {col('photo') && <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-400 h-12">Photo</TableHead>}
                            {col('name') && <SortableHead label="Lead" sortField="name" />}
                            {col('mobile') && <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-400 h-12">Mobile</TableHead>}
                            {col('whatsapp') && <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-400 h-12">WhatsApp</TableHead>}
                            {col('email') && <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-400 h-12">Email</TableHead>}
                            {col('dob') && <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-400 h-12">DOB</TableHead>}
                            {col('age') && <SortableHead label="Age" sortField="age" />}
                            {col('gender') && <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-400 h-12">Gender</TableHead>}
                            {col('source') && <SortableHead label="Source" sortField="source" />}
                            {col('campaign') && <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-400 h-12">Campaign</TableHead>}
                            {col('assigned') && <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-400 h-12">Assigned</TableHead>}
                            {col('status') && <SortableHead label="Status" sortField="status" />}
                            {col('priority') && <SortableHead label="Priority" sortField="priority" />}
                            {col('followUp') && <SortableHead label="Follow-up" sortField="follow_up_date" />}
                            {col('lastContacted') && <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-400 h-12">Last Contacted</TableHead>}
                            {col('nextAction') && <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-400 h-12">Next Action</TableHead>}
                            {col('created') && <SortableHead label="Created" sortField="created_at" />}
                            <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-400 h-12 text-right pr-8">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {paginated.length === 0 ? (
                            <TableRow className="border-none hover:bg-transparent">
                                <TableCell colSpan={ALL_COLUMNS.length + 2} className="h-40 text-center">
                                    <p className="text-slate-400 font-bold uppercase text-xs tracking-widest italic">No leads found.</p>
                                </TableCell>
                            </TableRow>
                        ) : (
                            paginated.map((lead) => {
                                const statusCfg = getStatusConfig(leadStatuses, lead.status);
                                const priority = PRIORITY_CONFIG[lead.priority || 'medium'];
                                const assignedStaff: User | undefined = lead.assigned_staff_id ? staffById[lead.assigned_staff_id] : undefined;
                                const age = calculateAge(lead.dob);
                                const isOverdueFollowup = lead.follow_up_date && new Date(lead.follow_up_date) < new Date(new Date().toDateString());

                                return (
                                    <TableRow
                                        key={lead.id}
                                        className="group bg-white hover:bg-indigo-50/30 transition-all duration-200 border border-slate-100 rounded-2xl overflow-hidden shadow-sm shadow-slate-200/50 mb-2 cursor-pointer"
                                        onClick={(e) => {
                                            const target = e.target as HTMLElement;
                                            if (target.closest('.actions-container') || target.closest('button') || target.closest('input')) return;
                                            navigate(`/leads/${lead.id}`);
                                        }}
                                    >
                                        <TableCell className="pl-6">
                                            <input type="checkbox" className="rounded border-slate-300" checked={selected.has(lead.id)} onChange={() => toggleSelect(lead.id)} />
                                        </TableCell>
                                        {col('photo') && (
                                            <TableCell>
                                                <Avatar className="h-10 w-10 border-2 border-white shadow-sm ring-1 ring-slate-100">
                                                    {lead.photo_url ? <AvatarImage src={lead.photo_url} className="object-cover" /> : <AvatarImage src="" />}
                                                    <AvatarFallback className="bg-gradient-to-br from-slate-100 to-slate-200 text-slate-600 font-black text-xs uppercase">
                                                        {lead.photo_url ? <ImageOff className="h-4 w-4" /> : initialsFromName(lead.name)}
                                                    </AvatarFallback>
                                                </Avatar>
                                            </TableCell>
                                        )}
                                        {col('name') && (
                                            <TableCell className="py-4">
                                                <div className="flex flex-col">
                                                    <span className="font-black text-slate-900 leading-tight group-hover:text-indigo-600 transition-colors text-sm">{lead.name}</span>
                                                    <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-0.5">{formatLeadNumber(lead)}</span>
                                                </div>
                                            </TableCell>
                                        )}
                                        {col('mobile') && (
                                            <TableCell>
                                                {lead.phone ? (
                                                    <span className="flex items-center gap-1.5 text-[12px] font-bold text-slate-600"><Phone className="h-3 w-3 opacity-50" />{lead.phone}</span>
                                                ) : <span className="text-slate-300">—</span>}
                                            </TableCell>
                                        )}
                                        {col('whatsapp') && (
                                            <TableCell>
                                                {lead.whatsapp_number || lead.phone ? (
                                                    <span className="text-[12px] font-bold text-emerald-600">{lead.whatsapp_number || lead.phone}</span>
                                                ) : <span className="text-slate-300">—</span>}
                                            </TableCell>
                                        )}
                                        {col('email') && (
                                            <TableCell>
                                                {lead.email ? (
                                                    <span className="flex items-center gap-1.5 text-[12px] font-bold text-slate-600"><Mail className="h-3 w-3 opacity-50" />{lead.email}</span>
                                                ) : <span className="text-slate-300">—</span>}
                                            </TableCell>
                                        )}
                                        {col('dob') && <TableCell className="text-[12px] font-semibold text-slate-600">{lead.dob ? format(new Date(lead.dob), 'dd MMM yyyy') : <span className="text-slate-300">—</span>}</TableCell>}
                                        {col('age') && <TableCell className="text-[12px] font-semibold text-slate-600">{age ?? <span className="text-slate-300">—</span>}</TableCell>}
                                        {col('gender') && <TableCell className="text-[12px] font-semibold text-slate-600 capitalize">{lead.gender || <span className="text-slate-300">—</span>}</TableCell>}
                                        {col('source') && <TableCell className="text-[12px] font-bold text-slate-500">{lead.source || '—'}</TableCell>}
                                        {col('campaign') && <TableCell className="text-[12px] font-semibold text-slate-500">{lead.campaign || <span className="text-slate-300">—</span>}</TableCell>}
                                        {col('assigned') && (
                                            <TableCell>
                                                {assignedStaff ? (
                                                    <span className="flex items-center gap-1.5 text-[12px] font-bold text-slate-700"><UserIcon className="h-3 w-3 opacity-50" />{assignedStaff.full_name}</span>
                                                ) : <span className="text-[11px] font-bold text-slate-300 uppercase">Unassigned</span>}
                                            </TableCell>
                                        )}
                                        {col('status') && (
                                            <TableCell>
                                                <Badge className={cn('border shadow-none font-black text-[10px] px-2.5 py-1 rounded-lg uppercase tracking-widest', statusBadgeClass(statusCfg.color))}>
                                                    {statusCfg.label}
                                                </Badge>
                                            </TableCell>
                                        )}
                                        {col('priority') && (
                                            <TableCell>
                                                <Badge className={cn('border shadow-none font-black text-[9px] px-2 py-0.5 rounded-lg uppercase tracking-widest', priority.className)}>
                                                    {priority.label}
                                                </Badge>
                                            </TableCell>
                                        )}
                                        {col('followUp') && (
                                            <TableCell>
                                                {lead.follow_up_date ? (
                                                    <span className={cn('text-[11px] font-black px-2 py-0.5 rounded-lg', isOverdueFollowup ? 'bg-red-50 text-red-600' : 'text-slate-600')}>
                                                        {isOverdueFollowup ? 'Overdue · ' : ''}{format(new Date(lead.follow_up_date), 'dd MMM')}
                                                    </span>
                                                ) : <span className="text-slate-300">—</span>}
                                            </TableCell>
                                        )}
                                        {col('lastContacted') && <TableCell className="text-[12px] font-semibold text-slate-500">{lead.last_contacted_at ? format(new Date(lead.last_contacted_at), 'dd MMM, h:mm a') : <span className="text-slate-300">—</span>}</TableCell>}
                                        {col('nextAction') && <TableCell className="text-[12px] font-semibold text-slate-500 max-w-[160px] truncate">{lead.next_action || <span className="text-slate-300">—</span>}</TableCell>}
                                        {col('created') && <TableCell className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{format(parseISO(lead.created_at || new Date().toISOString()), 'MMM d, yyyy')}</TableCell>}
                                        <TableCell className="text-right pr-8">
                                            <div className="actions-container flex justify-end gap-1">
                                                <button onClick={(e) => { e.stopPropagation(); onWhatsApp(lead); }} className="h-9 w-9 p-0 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg flex items-center justify-center transition-colors" title="Send WhatsApp">
                                                    <MessageSquare className="h-4 w-4" />
                                                </button>
                                                <button onClick={(e) => { e.stopPropagation(); onEdit(lead); }} className="h-9 w-9 p-0 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg flex items-center justify-center transition-colors" title="Edit Lead">
                                                    <Edit className="h-4 w-4" />
                                                </button>
                                                <button onClick={(e) => { e.stopPropagation(); onDelete(lead.id); }} className="h-9 w-9 p-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg flex items-center justify-center transition-colors" title="Delete Lead">
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-slate-100 bg-white/60">
                <div className="flex items-center gap-2 text-[11px] font-bold text-slate-400">
                    <span>Rows per page</span>
                    <select
                        value={pageSize}
                        onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                        className="border border-slate-200 rounded-lg h-7 px-1.5 text-slate-600 font-bold"
                    >
                        {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-[11px] font-bold text-slate-400">
                        Page {currentPage} of {totalPages}
                    </span>
                    <div className="flex gap-1">
                        <button disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="h-7 w-7 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 disabled:opacity-30 hover:bg-slate-50">
                            <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <button disabled={currentPage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="h-7 w-7 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 disabled:opacity-30 hover:bg-slate-50">
                            <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
