import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Search, Plus, Mail, MoreHorizontal, Phone, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { StaffForm } from '@/components/staff/StaffForm';
import { useAppStore } from '@/store';
import { useFilteredLeads } from '@/hooks/useFilteredLeads';
import { getLeadRevenue } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import type { User, KPI } from '@/types';
import { useI18n } from '@/i18n';
import { KPICards } from '@/components/dashboard/KPICards';


export function Staff() {
    const { staff, addStaff, updateStaff, fetchStaff, fetchLeads, fetchTours, tours, leadStatuses, fetchLeadStatuses } = useAppStore();
    const leads = useFilteredLeads();
    const navigate = useNavigate();
    const [searchTerm, setSearchTerm] = useState('');
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [selectedStaff, setSelectedStaff] = useState<User | undefined>(undefined);
    const { t } = useI18n();

    useEffect(() => {
        fetchStaff();
        fetchLeads();
        fetchTours();
        fetchLeadStatuses();
    }, [fetchStaff, fetchLeads, fetchTours, fetchLeadStatuses]);

    // Calculate staff sales data & sort top performers SaaS style
    const staffSalesData = useMemo(() => {
        return staff.map(member => {
            const allAssigned = leads.filter(l => l.assigned_staff_id === member.id);
            const convertedLeads = allAssigned.filter(l => leadStatuses.find((s) => s.key === l.status)?.is_closed_won);
            const salesRevenue = convertedLeads.reduce((sum, l) => sum + getLeadRevenue(l, tours), 0);
            const conversionRate = allAssigned.length > 0
                ? Math.round((convertedLeads.length / allAssigned.length) * 100)
                : 0;

            return {
                id: member.id,
                name: member.full_name.split(' ')[0],
                fullName: member.full_name,
                avatar: member.avatar_url,
                totalLeads: allAssigned.length,
                convertedLeads: convertedLeads.length,
                unconvertedLeads: allAssigned.length - convertedLeads.length,
                conversionRate,
                salesRevenue,
            };
        }).sort((a, b) => {
            // Sort by revenue first, then conversion rate
            if (b.salesRevenue !== a.salesRevenue) return b.salesRevenue - a.salesRevenue;
            return b.conversionRate - a.conversionRate;
        }).map((staff) => {
            return {
                ...staff,
                colorRing: 'border-slate-200' // Simple neutral ring
            };
        });
    }, [staff, leads, leadStatuses, tours]);

    // Calculate aggregated KPIs for Summary Cards
    const summaryKPIs = useMemo(() => {
        const totalAssigned = staffSalesData.reduce((sum, s) => sum + s.totalLeads, 0);
        const totalConverted = staffSalesData.reduce((sum, s) => sum + s.convertedLeads, 0);
        const totalRevenue = staffSalesData.reduce((sum, s) => sum + s.salesRevenue, 0);
        const avgConversion = totalAssigned > 0 ? Math.round((totalConverted / totalAssigned) * 100) : 0;

        const kpis: KPI[] = [
            { label: t('totalLeads'), value: totalAssigned, icon: 'Users' },
            { label: t('convertedCol'), value: totalConverted, icon: 'UserCheck' },
            { label: t('conversionRate'), value: `${avgConversion}%`, icon: 'TrendingUp' },
            { label: t('revenue'), value: `€${totalRevenue.toLocaleString()}`, icon: 'Euro' },
        ];

        return { totalAssigned, totalConverted, avgConversion, totalRevenue, kpis };
    }, [staffSalesData, t]);


    const handleAddStaff = () => {
        setSelectedStaff(undefined);
        setIsDialogOpen(true);
    };

    const handleEditStaff = (staff: User) => {
        setSelectedStaff(staff);
        setIsDialogOpen(true);
    };

    const handleDeleteStaff = (id: string) => {
        if (confirm('Deactivate this account? Sign-in will be blocked and existing leads preserved.')) {
            void updateStaff(id, { status: 'inactive' }).catch(() => {});
        }
    };

    const handleViewProfile = (staff: User) => {
        navigate(`/staff/${staff.id}`);
    };

    const handleSaveStaff = async (data: any) => {
        const userData: User = {
            id: selectedStaff ? selectedStaff.id : uuidv4(),
            full_name: data.full_name,
            email: data.email,
            role: data.role,
            phone: data.phone,
            avatar_url: selectedStaff?.avatar_url,
            status: data.status,
            access_key: data.access_key,
        };

        if (selectedStaff) {
            await updateStaff(selectedStaff.id, { ...userData, ...(data.password ? { password: data.password } : {}) });
        } else {
            await addStaff(userData, data.password);
        }
        setIsDialogOpen(false);
    };

    const filteredStaffData = useMemo(() => {
        return staffSalesData.filter(member =>
            member.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            [member.id, staff.find(s => s.id === member.id)?.email, staff.find(s => s.id === member.id)?.access_key].some(value => value?.toLowerCase().includes(searchTerm.toLowerCase()))
        );
    }, [staffSalesData, searchTerm, staff]);

    const formatRole = (role: string) => {
        return role.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white/40 backdrop-blur-md p-6 rounded-3xl border border-white/60 shadow-sm shadow-indigo-900/5">
                <div>
                    <h2 className="text-2xl font-black tracking-tight text-slate-900 uppercase">{t('staffMgmt')}</h2>
                    <p className="text-slate-500 font-medium">{t('staffDesc')}</p>
                </div>
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                            placeholder={t('searchStaff')}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 h-11 bg-white/80 border-slate-200/60 rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all text-sm font-medium"
                        />
                    </div>
                    <Button
                        className="bg-[#33A894] hover:bg-[#2c9180] text-white h-11 px-6 rounded-xl shadow-md shadow-[#33A894]/20 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 font-bold"
                        onClick={handleAddStaff}
                    >
                        <Plus className="h-4 w-4" /> {t('addMember')}
                    </Button>
                </div>
            </div>

            <KPICards kpis={summaryKPIs.kpis} />



            <Card className="animate-in slide-in-from-bottom-8 duration-500 delay-300">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>{t('teamMembers')}</CardTitle>
                            <CardDescription>{t('teamDesc')}</CardDescription>
                        </div>
                        <div className="relative w-64">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                            <Input
                                placeholder={t('search')}
                                className="pl-9 bg-slate-50 border-slate-200"
                                value={searchTerm}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <Table className="border-separate border-spacing-y-2">
                        <TableHeader className="bg-slate-50/50">
                            <TableRow className="border-none hover:bg-transparent">
                                <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-400 pl-8">{t('staffCol')}</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-400">{t('roleCol')}</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-400">{t('contactCol')}</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-400">Leads & Conv</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-400 text-right pr-8">{t('actions')}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredStaffData.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-32 text-center">
                                        <div className="flex flex-col items-center justify-center gap-2 opacity-50">
                                            <Users className="h-8 w-8 text-slate-300" />
                                            <p className="font-bold text-slate-400">{t('noStaffFound')}</p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredStaffData.map((member) => (
                                    <TableRow
                                        key={member.id}
                                        className="group bg-white hover:bg-indigo-50/30 transition-all duration-200 border border-slate-100 rounded-xl overflow-hidden shadow-sm shadow-slate-200/50 mb-2 cursor-pointer"
                                        onClick={() => handleViewProfile(staff.find(s => s.id === member.id)!)}
                                    >
                                        <TableCell className="pl-8">
                                            <div className="flex items-center gap-3">
                                                <Avatar className={cn("h-10 w-10 border-2 shadow-sm transition-transform group-hover:scale-110 duration-300", member.colorRing)}>
                                                    <AvatarImage src={member.avatar} />
                                                    <AvatarFallback className="bg-slate-100 text-slate-700 font-bold">{member.name[0]}</AvatarFallback>
                                                </Avatar>
                                                <div className="flex flex-col">
                                                    <span className="font-extrabold text-slate-900 leading-tight group-hover:text-indigo-600 transition-colors">
                                                        {member.fullName}
                                                    </span>
                                                    <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-0.5">
                                                        Login: {staff.find(s => s.id === member.id)?.access_key || staff.find(s => s.id === member.id)?.email}
                                                        {staff.find(s => s.id === member.id)?.status === 'inactive' && ' · Inactive'}
                                                    </span>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                <span className="text-[13px] font-bold text-slate-700">
                                                    {formatRole(staff.find(s => s.id === member.id)?.role || 'Member')}
                                                </span>
                                                <span className="text-[10px] text-indigo-500 font-black uppercase tracking-widest">
                                                    {staff.find(s => s.id === member.id)?.department || 'Sales'}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-2 text-[12px] font-medium text-slate-500 group-hover:text-indigo-600 transition-colors">
                                                    <Mail className="h-3 w-3 opacity-50" />
                                                    {staff.find(s => s.id === member.id)?.email}
                                                </div>
                                                {staff.find(s => s.id === member.id)?.phone && (
                                                    <div className="flex items-center gap-2 text-[12px] font-medium text-slate-500 group-hover:text-indigo-600 transition-colors">
                                                        <Phone className="h-3 w-3 opacity-50" />
                                                        {staff.find(s => s.id === member.id)?.phone}
                                                    </div>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1.5">
                                                <div className="flex items-center justify-between gap-4 w-32">
                                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Revenue</span>
                                                    <span className="text-[13px] font-black text-blue-700">€{member.salesRevenue.toLocaleString()}</span>
                                                </div>
                                                <div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden flex">
                                                    <div
                                                        className="h-full bg-emerald-400 transition-all duration-1000"
                                                        style={{ width: `${member.conversionRate}%` }}
                                                    />
                                                    <div
                                                        className="h-full bg-slate-200 transition-all duration-1000"
                                                        style={{ width: `${100 - member.conversionRate}%` }}
                                                    />
                                                </div>
                                                <div className="flex items-center justify-between w-32">
                                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Conversion</span>
                                                    <span className="text-xs font-black text-emerald-600">{member.conversionRate}%</span>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right pr-8" onClick={event => event.stopPropagation()}>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" className="h-10 w-10 p-0 rounded-xl hover:bg-slate-100 group">
                                                        <MoreHorizontal className="h-5 w-5 text-slate-400 group-hover:text-slate-900 transition-colors" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="w-56 p-2 rounded-xl shadow-xl border-slate-200/60 font-medium">
                                                    <DropdownMenuLabel className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Manage Staff</DropdownMenuLabel>
                                                    <DropdownMenuItem
                                                        onClick={() => handleViewProfile(staff.find(s => s.id === member.id)!)}
                                                        className="rounded-lg px-3 py-2.5 focus:bg-indigo-50 focus:text-indigo-600 transition-colors flex items-center gap-2"
                                                    >
                                                        <div className="w-7 h-7 bg-indigo-50 rounded-lg flex items-center justify-center"><Users className="w-4 h-4" /></div>
                                                        {t('viewProfile')}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() => handleEditStaff(staff.find(s => s.id === member.id)!)}
                                                        className="rounded-lg px-3 py-2.5 focus:bg-amber-50 focus:text-amber-700 transition-colors flex items-center gap-2"
                                                    >
                                                        <div className="w-7 h-7 bg-amber-50 rounded-lg flex items-center justify-center"><Plus className="w-4 h-4" /></div>
                                                        {t('editDetails')}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator className="my-2" />
                                                    <DropdownMenuItem
                                                        className="rounded-lg px-3 py-2.5 focus:bg-rose-50 focus:text-rose-600 text-rose-600 transition-colors flex items-center gap-2"
                                                        onClick={() => handleDeleteStaff(member.id)}
                                                    >
                                                        <div className="w-7 h-7 bg-rose-50 rounded-lg flex items-center justify-center"><MoreHorizontal className="w-4 h-4" /></div>
                                                        {t('deactivateAccount')}
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{selectedStaff ? t('editStaffTitle') : t('addStaffTitle')}</DialogTitle>
                        <DialogDescription>
                            {selectedStaff ? t('editStaffDesc') : t('addStaffDesc')}
                        </DialogDescription>
                    </DialogHeader>
                    <StaffForm
                        initialData={selectedStaff}
                        onSubmit={handleSaveStaff}
                        onCancel={() => setIsDialogOpen(false)}
                    />
                </DialogContent>
            </Dialog>

        </div>
    );
}
