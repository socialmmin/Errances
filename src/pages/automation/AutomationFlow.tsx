import { useEffect, useState } from "react";
import { useAppStore } from "@/store";
import { getAutomationOverview } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  Search,
  Languages,
  ListChecks,
  MapPin,
  FileText,
  UserCheck,
  ArrowDown,
  ShieldAlert,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";

type Step = {
  icon: typeof MessageSquare;
  title: string;
  description: string;
  branch?: string[];
};

const STEPS: Step[] = [
  {
    icon: MessageSquare,
    title: "1. Inbound WhatsApp message",
    description:
      "A Twilio webhook delivers the message. It's deduplicated by MessageSid so a Twilio retry never advances the conversation twice.",
  },
  {
    icon: Search,
    title: "2. Find or create lead & conversation",
    description:
      "Matched by normalised phone number. No match creates a new lead immediately — before any questions are asked — so every WhatsApp sender is visible in Leads right away.",
  },
  {
    icon: Languages,
    title: "3. Detect language & check control commands",
    description:
      "French/English is detected from wording and stays sticky per conversation. STOP opts out, START/MENU restarts, and AGENT/complaint/visa/payment wording pauses automation for a human — checked before anything else.",
  },
  {
    icon: ListChecks,
    title: "4. Determine service & ask missing fields",
    description:
      "Flight, hotel, custom trip, package or office enquiry. Already-given details (from the very first message) are kept; only genuinely missing fields are asked, one at a time.",
    branch: [
      "Package enquiry → search the real active catalogue (draft/inactive packages are never offered)",
      "Match found → share name, destination, duration & published details",
      "Customer replies ITINERARY → share the real day-wise plan, inclusions, exclusions, price & PDF link",
      "Customer replies SELECT/QUOTE → continue to traveller details; NEXT → next catalogue match",
      "No match → routed straight to an advisor, never a fabricated package",
    ],
  },
  {
    icon: MapPin,
    title: "5. Office & schedule questions",
    description:
      "Office selection returns real configured hours, days and holiday-calendar verification status for that office — never a guessed answer.",
  },
  {
    icon: FileText,
    title: "6. Every reply is a pre-approved Utility template",
    description:
      "No automated reply is ever free text. If the ideal template isn't approved yet, a safe fallback (name question or handoff) is used instead — see live status on the right.",
  },
  {
    icon: UserCheck,
    title: "7. Advisor handoff",
    description:
      "End of the question flow, an explicit agent request, or a blocked template all pause automation and flag the lead for a consultant. Office-linked staff are auto-assigned when known. A consultant can resume automation from the WhatsApp Inbox.",
  },
];

const STATUS_META: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  approved: { icon: CheckCircle2, color: "text-emerald-600", label: "Approved" },
  pending: { icon: Clock, color: "text-amber-600", label: "Pending" },
  rejected: { icon: XCircle, color: "text-red-600", label: "Rejected" },
  draft: { icon: ShieldAlert, color: "text-slate-400", label: "Draft" },
};

export function AutomationFlow() {
  const { conversations, fetchConversations } = useAppStore();
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof getAutomationOverview>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (conversations.length === 0) fetchConversations();
    getAutomationOverview()
      .then(setOverview)
      .catch((err) => setError(err.message || "Failed to load automation status"))
      .finally(() => setLoading(false));
  }, [conversations.length, fetchConversations]);

  const blocked = (overview?.templates || []).filter(
    (t) => t.status !== "approved" || t.category?.toLowerCase() !== "utility" || t.is_active === false
  );

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">AI Automation</h2>
        <p className="text-slate-500 text-sm mt-1">
          A read-only view of Jennifer's actual conversation logic and live template approval status — not an editor.
          The bot's behaviour is defined in code and tested; this page explains and audits it.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3">
          {STEPS.map((step, i) => (
            <div key={step.title}>
              <Card>
                <CardContent className="pt-5 pb-5 flex gap-4">
                  <div className="h-10 w-10 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center flex-shrink-0">
                    <step.icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-900">{step.title}</h3>
                    <p className="text-sm text-slate-600 mt-1">{step.description}</p>
                    {step.branch && (
                      <ul className="mt-3 space-y-1.5 border-l-2 border-teal-100 pl-3">
                        {step.branch.map((b) => (
                          <li key={b} className="text-xs text-slate-500">
                            {b}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </CardContent>
              </Card>
              {i < STEPS.length - 1 && (
                <div className="flex justify-center py-1">
                  <ArrowDown className="h-4 w-4 text-slate-300" />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Live conversation status</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              {[
                ["AI active", conversations.filter((c) => !c.bot_paused && !c.opted_out).length, "text-emerald-600"],
                ["Human assigned", conversations.filter((c) => c.bot_paused && !c.opted_out).length, "text-amber-600"],
                ["Opted out", conversations.filter((c) => c.opted_out).length, "text-slate-500"],
                ["Blocked (template)", conversations.filter((c) => c.automation_error).length, "text-red-600"],
              ].map(([label, value, color]) => (
                <div key={label as string}>
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-slate-500">{label}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Template approval status</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-slate-500">Loading…</p>
              ) : error ? (
                <p className="text-sm text-red-600">{error}</p>
              ) : (
                <div className="space-y-2 max-h-[420px] overflow-y-auto">
                  {(overview?.templates || []).map((t) => {
                    const meta = STATUS_META[t.status || "draft"] || STATUS_META.draft;
                    const Icon = meta.icon;
                    const ready = t.status === "approved" && t.category?.toLowerCase() === "utility" && t.is_active !== false;
                    return (
                      <div key={t.key} className="flex items-center gap-2 text-sm py-1.5 border-b border-slate-50 last:border-0">
                        <Icon className={`h-4 w-4 flex-shrink-0 ${ready ? "text-emerald-600" : meta.color}`} />
                        <span className="flex-1 min-w-0 truncate text-slate-700">{t.name}</span>
                        <Badge variant={ready ? "secondary" : "destructive"} className="text-[10px]">
                          {ready ? "Ready" : meta.label}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
              {!loading && !error && blocked.length > 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2.5 mt-3">
                  {blocked.length} template{blocked.length === 1 ? "" : "s"} not ready — the affected automation step falls
                  back to a safe alternative or advisor handoff until Meta approves it as a Utility template.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
