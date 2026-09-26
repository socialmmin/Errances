import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/store";
import { useFilteredLeads } from "@/hooks/useFilteredLeads";
import { getLeadRevenue } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Mail, Phone } from "lucide-react";

/** Read-only consultant directory + live performance, for staff (e.g. sales managers) who
 * shouldn't necessarily have full account-management rights on the Staff page. */
export function TravelConsultants() {
  const { staff, tours, leadStatuses, fetchStaff, fetchLeadStatuses } = useAppStore();
  const leads = useFilteredLeads();
  const navigate = useNavigate();

  useEffect(() => {
    if (staff.length === 0) fetchStaff();
    if (leadStatuses.length <= 1) fetchLeadStatuses();
  }, [staff.length, fetchStaff, leadStatuses.length, fetchLeadStatuses]);

  const consultants = useMemo(() => {
    return staff
      .filter((s) => s.role !== "admin")
      .map((member) => {
        const assigned = leads.filter((l) => l.assigned_staff_id === member.id);
        const won = assigned.filter((l) => leadStatuses.find((s) => s.key === l.status)?.is_closed_won);
        return {
          ...member,
          assignedCount: assigned.length,
          wonCount: won.length,
          conversionRate: assigned.length ? Math.round((won.length / assigned.length) * 100) : 0,
          revenue: won.reduce((sum, l) => sum + getLeadRevenue(l, tours), 0),
        };
      })
      .sort((a, b) => b.assignedCount - a.assignedCount);
  }, [staff, tours, leads, leadStatuses]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12">
      <div>
        <h2 className="text-3xl font-black tracking-tight text-slate-900 uppercase">Travel Consultants</h2>
        <p className="text-slate-500 font-medium">Who's handling what — assigned leads and conversion, at a glance.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {consultants.map((c) => (
          <Card key={c.id} className="hover:shadow-md transition-shadow">
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center gap-3">
                <Avatar className="h-11 w-11 border border-slate-200">
                  <AvatarImage src={c.avatar_url} />
                  <AvatarFallback className="font-black">{c.full_name?.[0]}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="font-bold text-slate-900 truncate">{c.full_name}</p>
                  <Badge variant="secondary" className="text-[10px] mt-0.5">
                    {c.role?.replace("_", " ")}
                  </Badge>
                </div>
              </div>
              <div className="space-y-1.5 text-sm text-slate-500">
                {c.email && (
                  <p className="flex items-center gap-2 truncate">
                    <Mail className="h-3.5 w-3.5 flex-shrink-0" /> {c.email}
                  </p>
                )}
                {c.phone && (
                  <p className="flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 flex-shrink-0" /> {c.phone}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                <div>
                  <p className="text-lg font-bold text-slate-800">{c.assignedCount}</p>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Assigned</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-emerald-600">{c.wonCount}</p>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Won</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-indigo-600">{c.conversionRate}%</p>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Conversion</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-slate-800">€{c.revenue.toLocaleString()}</p>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Revenue</p>
                </div>
              </div>
              <button
                className="text-xs font-bold text-teal-700 hover:underline"
                onClick={() => navigate("/leads", { state: { filterAssignedStaffId: c.id } })}
              >
                View assigned leads →
              </button>
            </CardContent>
          </Card>
        ))}
        {consultants.length === 0 && (
          <p className="text-sm text-slate-500 col-span-full text-center py-12">No consultants added yet.</p>
        )}
      </div>
    </div>
  );
}
