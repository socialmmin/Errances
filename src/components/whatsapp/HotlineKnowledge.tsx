import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { whatsappRequest } from "@/lib/whatsappClient";
import { getStaff } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/Toast";

type Office = {
  id: string;
  name: string;
  country: string;
  city: string;
  timezone: string;
  open_days: number[];
  opens: string;
  closes: string;
  holidays: string[];
  holidays_verified_through: string | null;
  assigned_staff_id: string | null;
};
export function HotlineKnowledge({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<{
    enabled: boolean;
    offices: Office[];
  } | null>(null);
  const [rules, setRules] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const [staff, setStaff] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([whatsappRequest("/knowledge"), getStaff()])
      .then(([k, s]) => {
        setData(k.document);
        setRules(k.rules);
        setCount(k.catalogue.active);
        setStaff(s.filter((p: any) => p.status === "active"));
      })
      .catch((e) => setError(e.message));
  }, []);
  const update = (index: number, values: Partial<Office>) =>
    setData((d) =>
      d
        ? {
            ...d,
            offices: d.offices.map((o, i) =>
              i === index ? { ...o, ...values } : o,
            ),
          }
        : d,
    );
  if (!data)
    return (
      <p role="status" className="text-sm text-slate-500">
        {error || "Loading global hotline knowledge…"}
      </p>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Global hotline · knowledge & office routing</CardTitle>
        <p className="text-sm text-slate-500">
          One shared number, five offices. This structured information is stored
          in the CRM database. Customer replies remain template-only.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <label className="flex gap-2 items-center">
          <input
            type="checkbox"
            checked={data.enabled}
            disabled={!canManage}
            onChange={(e) => setData({ ...data, enabled: e.target.checked })}
          />
          Use French / English global front-desk workflow
        </label>
        <div className="rounded-lg bg-slate-50 p-4">
          <p className="font-medium">{count} active packages connected</p>
          <p className="text-sm text-slate-500">
            The bot searches the same catalogue as{" "}
            <Link className="underline" to="/tours">
              Tour Packages
            </Link>
            . If no matching package exists, the enquiry goes to an advisor.
            Prices and bookings are confirmed by your team.
          </p>
        </div>
        <details>
          <summary className="cursor-pointer font-medium">
            Automation rules
          </summary>
          <ul className="list-disc pl-5 space-y-2 mt-3 text-sm">
            {rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </details>
        <p className="text-sm text-amber-800 bg-amber-50 p-3 rounded-lg">
          Holiday dates must be verified by your team. Until a calendar is
          marked verified through the requested date, the assistant cannot claim
          the office is open. Templates shown below must be approved before
          replies can be delivered.
        </p>
        {data.offices.map((o, i) => (
          <fieldset
            disabled={!canManage || saving}
            key={o.id}
            className="border rounded-xl p-4 space-y-4"
          >
            <legend className="px-2 font-semibold">{o.name}</legend>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <label className="text-sm">
                Opening time
                <Input
                  type="time"
                  value={o.opens}
                  onChange={(e) => update(i, { opens: e.target.value })}
                />
              </label>
              <label className="text-sm">
                Closing time
                <Input
                  type="time"
                  value={o.closes}
                  onChange={(e) => update(i, { closes: e.target.value })}
                />
              </label>
              <div className="text-sm">
                Local time zone<p className="mt-2 font-medium">{o.timezone}</p>
              </div>
              <label className="text-sm sm:col-span-2">
                Assigned advisor
                <select
                  className="block w-full border rounded-md p-2 mt-1 bg-white"
                  value={o.assigned_staff_id || ""}
                  onChange={(e) =>
                    update(i, { assigned_staff_id: e.target.value || null })
                  }
                >
                  <option value="">Shared inbox — manual assignment</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Holiday calendar verified through
                <Input
                  type="date"
                  value={o.holidays_verified_through || ""}
                  onChange={(e) =>
                    update(i, {
                      holidays_verified_through: e.target.value || null,
                    })
                  }
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-3">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                (day, n) => (
                  <label key={day} className="text-sm flex gap-1 items-center">
                    <input
                      type="checkbox"
                      checked={o.open_days.includes(n)}
                      onChange={(e) =>
                        update(i, {
                          open_days: e.target.checked
                            ? [...o.open_days, n].sort()
                            : o.open_days.filter((d) => d !== n),
                        })
                      }
                    />
                    {day}
                  </label>
                ),
              )}
            </div>
            <label className="text-sm block">
              Public holidays / exceptional closures (one YYYY-MM-DD date per
              line)
              <textarea
                className="w-full block mt-1 border rounded-md p-2"
                rows={3}
                value={o.holidays.join("\n")}
                onChange={(e) =>
                  update(i, { holidays: e.target.value.split("\n") })
                }
              />
            </label>
          </fieldset>
        ))}
        <Button
          disabled={!canManage || saving}
          onClick={async () => {
            setSaving(true);
            try {
              const payload = {
                ...data,
                offices: data.offices.map((o) => ({
                  ...o,
                  holidays: o.holidays.map((d) => d.trim()).filter(Boolean),
                })),
              };
              const result = await whatsappRequest(
                "/knowledge",
                payload,
                "PUT",
              );
              setData(result.document);
              toast.success("Hotline knowledge saved");
            } catch (e: any) {
              toast.error(e.message);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save hotline knowledge"}
        </Button>
      </CardContent>
    </Card>
  );
}
