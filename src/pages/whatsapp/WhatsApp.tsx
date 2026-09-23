import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  Bot,
  Check,
  CheckCheck,
  Clock3,
  FileText,
  Inbox,
  Loader2,
  MessageCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  UserRound,
  X,
  AlertCircle,
} from "lucide-react";
import { useAppStore } from "@/store";
import { supabase } from "@/lib/supabase";
import { whatsappRequest } from "@/lib/whatsappClient";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import type { WhatsAppConversation, WhatsAppTemplate } from "@/types";

type ChatMessage = {
  id: string;
  content: string;
  direction: string;
  sender: string;
  created_at: string;
  status: string;
  error_message?: string;
  error_code?: string;
  sent_by?: string;
  message_type?: string;
  media_url?: string;
  conversation_id?: string;
};
const steps = [
  ["name", "Full name"],
  ["destination", "Destination"],
  ["travel_date", "Travel date"],
  ["travellers", "Travellers"],
  ["city", "Departure city"],
  ["budget", "Trip budget"],
  ["email", "Email"],
  ["requirements", "Requirements"],
];
const digits = (phone: string) => phone.replace(/\D/g, "");
const initials = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
const timeLabel = (value: string) =>
  new Date(value).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

export function WhatsApp() {
  const {
    leads,
    conversations,
    fetchLeads,
    fetchConversations,
    fetchStaff,
    staff,
    markConversationRead,
    assignConversation,
    setConversationStatus,
  } = useAppStore();
  const location = useLocation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newLeadId, setNewLeadId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [picker, setPicker] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [newChat, setNewChat] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [details, setDetails] = useState(false);
  const [reload, setReload] = useState(0);
  const [windowState, setWindowState] = useState<{
    withinWindow: boolean;
    lastInboundAt: string | null;
  } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const selected = conversations.find((c) => c.id === selectedId) || null;
  const lead = leads.find(
    (l) => l.id === (selected?.contact_lead_id || newLeadId),
  );
  const phone = selected?.phone || lead?.whatsapp_number || lead?.phone || "";
  const name = lead?.name || phone || "Conversation";
  const answers = selected?.automation_data || {};
  const active = Boolean(selected || newLeadId);
  const lastInbound = selected?.last_inbound_at || windowState?.lastInboundAt;
  const openWindow = Boolean(
    lastInbound &&
      now - new Date(lastInbound).getTime() >= 0 &&
      now - new Date(lastInbound).getTime() < 86400000,
  );
  const remaining = lastInbound
    ? Math.max(
        0,
        Math.ceil((86400000 - (now - new Date(lastInbound).getTime())) / 60000),
      )
    : 0;
  const approved = templates.filter(
    (t) => t.is_active && t.status === "approved",
  );
  const template = approved.find((t) => t.id === templateId);
  const keys = [
    ...new Set(
      Array.from(
        (template?.body_preview || "").matchAll(/\{\{(\d+)\}\}/g),
        (m) => m[1],
      ),
    ),
  ];
  const preview = (template?.body_preview || "").replace(
    /\{\{(\d+)\}\}/g,
    (_, key) => variables[key] || "[" + key + "]",
  );
  const rows = useMemo(
    () =>
      conversations
        .filter((c) => c.last_message_at || c.last_inbound_at)
        .map((c) => ({
          c,
          lead: leads.find((l) => l.id === c.contact_lead_id),
        }))
        .filter(
          ({ c, lead: l }) =>
            (
              (l?.name || "") +
              " " +
              c.phone +
              " " +
              (c.last_message_preview || "")
            )
              .toLowerCase()
              .includes(search.toLowerCase()) &&
            (filter === "all" ||
              (filter === "unread" && c.unread_count > 0) ||
              (filter === "attention" &&
                (c.bot_paused ||
                  c.status === "pending" ||
                  c.automation_error)) ||
              (filter === "resolved" && c.status === "resolved")),
        )
        .sort(
          (a, b) =>
            new Date(b.c.last_message_at || 0).getTime() -
            new Date(a.c.last_message_at || 0).getTime(),
        ),
    [conversations, leads, search, filter],
  );

  useEffect(() => {
    fetchLeads();
    fetchConversations();
    fetchStaff();
  }, [fetchLeads, fetchConversations, fetchStaff]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    whatsappRequest("/templates")
      .then((r) => setTemplates(r.data))
      .catch((e) => toast.error(e.message));
  }, [picker]);
  useEffect(() => {
    const state = location.state as { leadId?: string; phone?: string } | null;
    if (state?.leadId) {
      const c = conversations
        .filter((c) => c.contact_lead_id === state.leadId)
        .sort(
          (a, b) =>
            Number(Boolean(b.last_inbound_at)) -
            Number(Boolean(a.last_inbound_at)),
        )[0];
      setSelectedId(c?.id || null);
      setNewLeadId(c ? null : state.leadId);
    }
  }, [location.state, conversations]);
  useEffect(() => {
    if (!phone) {
      setWindowState(null);
      return;
    }
    let cancelled = false;
    whatsappRequest("/window-status?phone=" + encodeURIComponent(phone))
      .then((r) => {
        if (!cancelled) setWindowState(r);
      })
      .catch(() => {
        if (!cancelled) setWindowState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [phone, selected?.last_inbound_at, reload]);
  useEffect(() => {
    if (selected?.unread_count) markConversationRead(selected.id);
  }, [selected?.id, selected?.unread_count, markConversationRead]);
  useEffect(() => {
    let cancelled = false;
    if (!active) {
      setMessages([]);
      return;
    }
    setLoading(true);
    setLoadError("");
    const load = async () => {
      try {
        const query = supabase
          .from("whatsapp_messages")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200);
        const { data, error } = selectedId
          ? await query.eq("conversation_id", selectedId)
          : await query.eq("lead_id", newLeadId);
        if (error) throw error;
        if (!cancelled) setMessages((data || []).reverse());
      } catch (e: any) {
        if (!cancelled) setLoadError(e.message || "Could not load messages");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const channel = supabase
      .channel("inbox:" + selectedId + ":" + newLeadId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_messages" },
        () => load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads" },
        () => fetchLeads(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [active, selectedId, newLeadId, reload, fetchLeads]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length]);
  const choose = (c: WhatsAppConversation) => {
    setSelectedId(c.id);
    setNewLeadId(null);
    setDraft("");
    setDetails(false);
    setMessages([]);
  };
  const refresh = () => {
    fetchConversations();
    fetchLeads();
    setReload((v) => v + 1);
  };
  const send = async (useTemplate = false) => {
    if (!phone || sending || (useTemplate ? !template : !draft.trim())) return;
    setSending(true);
    try {
      await whatsappRequest("/send", {
        to: phone,
        conversationId: selected?.id,
        leadId: lead?.id,
        message: useTemplate ? preview : draft,
        ...(useTemplate
          ? {
              contentSid: template?.twilio_content_sid,
              contentVariables: variables,
            }
          : {}),
      });
      setDraft("");
      setPicker(false);
      refresh();
      toast.success("Message accepted. Delivery status will update here.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSending(false);
    }
  };
  const toggleBot = async () => {
    if (!selected) return;
    try {
      await whatsappRequest(
        "/conversations/" + selected.id + "/automation",
        { paused: !selected.bot_paused },
        "PATCH",
      );
      fetchConversations();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-4">
      <header className="rounded-2xl bg-[#123c38] text-white px-6 py-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-200 text-[11px] font-semibold tracking-[.18em] uppercase">
            <MessageCircle size={14} /> Errances Voyages · Customer
            conversations
          </div>
          <h1 className="text-2xl font-semibold mt-1.5 tracking-tight">
            WhatsApp workspace
          </h1>
          <p className="text-sm text-white/65 mt-1">
            Every enquiry. One conversation. A clearer journey.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/whatsapp/templates"
            className="px-3 py-2 rounded-lg border border-white/20 text-xs hover:bg-white/10 flex items-center gap-2"
          >
            <FileText size={14} /> Templates
          </Link>
          <Link
            to="/settings/whatsapp"
            aria-label="WhatsApp settings"
            className="p-2 rounded-lg border border-white/20 hover:bg-white/10"
          >
            <Settings2 size={17} />
          </Link>
          <button
            onClick={refresh}
            aria-label="Refresh inbox"
            className="p-2 rounded-lg border border-white/20 hover:bg-white/10"
          >
            <RefreshCw size={17} />
          </button>
        </div>
      </header>
      <div className="flex rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm h-[calc(100dvh-235px)] min-h-[520px]">
        <aside
          className={cn(
            "w-full md:w-[290px] lg:w-[310px] shrink-0 border-r border-slate-200 flex flex-col",
            active ? "hidden md:flex" : "flex",
          )}
        >
          <div className="p-4 space-y-4 border-b border-slate-100">
            <div className="flex justify-between items-center">
              <h2 className="font-semibold text-slate-900">
                Inbox{" "}
                <span className="ml-1 text-xs text-slate-400">
                  {conversations.filter((c) => c.last_message_at).length}
                </span>
              </h2>
              <button
                onClick={() => setNewChat(true)}
                aria-label="New conversation"
                className="rounded-lg p-2 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
              >
                <Plus size={17} />
              </button>
            </div>
            <div className="relative">
              <Search
                className="absolute left-3 top-3 text-slate-400"
                size={15}
              />
              <input
                aria-label="Search conversations"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, number or message"
                className="w-full rounded-xl bg-slate-50 border border-slate-200 py-2.5 pl-9 pr-2 text-xs outline-none focus:border-emerald-500"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {[
                ["all", "All"],
                ["unread", "Unread"],
                ["attention", "Needs attention"],
                ["resolved", "Resolved"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    "px-2.5 py-1.5 rounded-lg text-[11px] font-medium",
                    filter === key
                      ? "bg-emerald-100 text-emerald-900"
                      : "text-slate-500 hover:bg-slate-50",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {rows.map(({ c, lead: l }) => (
              <button
                key={c.id}
                onClick={() => choose(c)}
                className={cn(
                  "w-full flex gap-3 px-4 py-4 text-left border-b border-slate-100 transition-colors",
                  selectedId === c.id
                    ? "bg-[#edf6f3] border-l-[3px] border-l-emerald-600"
                    : "hover:bg-slate-50 border-l-[3px] border-l-transparent",
                )}
              >
                <div className="w-10 h-10 shrink-0 rounded-xl bg-white border border-slate-200 text-emerald-900 grid place-items-center text-xs font-semibold">
                  {initials(l?.name || "WA")}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-800 truncate">
                      {l?.name || c.phone}
                    </span>
                    <span className="text-[10px] text-slate-400 whitespace-nowrap">
                      {c.last_message_at ? dateLabel(c.last_message_at) : ""}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 truncate mt-1">
                    {c.last_message_preview || "New enquiry"}
                  </p>
                  <div className="flex items-center justify-between mt-2">
                    <span
                      className={cn(
                        "text-[10px] flex items-center gap-1",
                        c.automation_error
                          ? "text-rose-600"
                          : c.bot_paused
                            ? "text-amber-700"
                            : "text-emerald-700",
                      )}
                    >
                      {c.bot_paused ? (
                        <UserRound size={10} />
                      ) : (
                        <Bot size={10} />
                      )}{" "}
                      {c.automation_error
                        ? "Action required"
                        : c.bot_paused
                          ? "Agent handling"
                          : c.automation_step === "completed"
                            ? "Enquiry captured"
                            : "Automated enquiry"}
                    </span>
                    {c.unread_count > 0 && (
                      <span className="bg-emerald-700 text-white rounded-full text-[10px] min-w-5 h-5 grid place-items-center">
                        {c.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
            {!rows.length && (
              <div className="p-8 text-center text-sm text-slate-400">
                <Inbox className="mx-auto mb-3" />
                No conversations match this view.
              </div>
            )}
          </div>
          <div className="p-3 border-t text-[10px] text-slate-400 flex gap-2 items-center">
            <ShieldCheck size={13} /> Replies use the customer's full WhatsApp
            number
          </div>
        </aside>
        {!active ? (
          <div className="flex-1 hidden md:flex flex-col items-center justify-center bg-[#f7faf8] text-center p-8">
            <div className="p-6 rounded-3xl bg-emerald-100 text-emerald-800 mb-5">
              <MessageCircle size={36} />
            </div>
            <h2 className="text-xl font-semibold text-slate-800">
              Good conversations start here
            </h2>
            <p className="text-sm text-slate-500 max-w-sm mt-3">
              Choose an enquiry to see its messages, collected travel details
              and next step.
            </p>
            <Button
              onClick={() => setNewChat(true)}
              className="mt-6 bg-emerald-800 hover:bg-emerald-900"
            >
              <Plus size={16} className="mr-2" />
              Start a conversation
            </Button>
          </div>
        ) : (
          <>
            <section
              className={cn(
                "flex-1 min-w-0 flex flex-col",
                details ? "hidden lg:flex" : "flex",
              )}
            >
              <div className="h-[77px] shrink-0 px-4 lg:px-5 flex gap-3 items-center border-b border-slate-200">
                <button
                  aria-label="Back to inbox"
                  className="md:hidden"
                  onClick={() => {
                    setSelectedId(null);
                    setNewLeadId(null);
                  }}
                >
                  <ArrowLeft size={20} />
                </button>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-slate-900 truncate">
                    {name}
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">{phone}</p>
                </div>
                <span
                  className={cn(
                    "hidden sm:inline-flex items-center gap-1.5 text-[10px] rounded-full px-2.5 py-1.5",
                    openWindow
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700",
                  )}
                >
                  <Clock3 size={12} />
                  {openWindow
                    ? Math.floor(remaining / 60) +
                      "h " +
                      (remaining % 60) +
                      "m left"
                    : "Template required"}
                </span>
                <button
                  className="p-2 rounded-lg hover:bg-slate-100 xl:hidden"
                  aria-label="Show enquiry details"
                  onClick={() => setDetails(true)}
                >
                  <UserRound size={18} />
                </button>
              </div>
              <div className="px-5 py-2.5 border-b bg-slate-50/70 text-[11px] text-slate-500 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Bot size={14} className="text-emerald-700" />
                  {selected?.opted_out
                    ? "Contact opted out"
                    : selected?.bot_paused
                      ? "Automation paused · You are in control"
                      : selected?.automation_step === "completed"
                        ? "Enquiry complete · Ready for a consultant"
                        : "Utility template workflow · One question at a time"}
                </span>
                {selected && !selected.opted_out && (
                  <button
                    onClick={toggleBot}
                    className="font-semibold text-emerald-800 flex gap-1 items-center"
                  >
                    {selected.bot_paused ? (
                      <Play size={12} />
                    ) : (
                      <Pause size={12} />
                    )}{" "}
                    {selected.bot_paused ? "Resume" : "Take over"}
                  </button>
                )}
              </div>
              {selected?.automation_error && (
                <div
                  role="alert"
                  className="px-5 py-3 bg-rose-50 text-rose-700 text-xs border-b border-rose-100"
                >
                  {selected.automation_error}
                </div>
              )}
              <div
                className="flex-1 overflow-y-auto px-4 lg:px-7 py-5 bg-[#f4f7f5]"
                aria-label="Messages"
                aria-live="polite"
              >
                {loading && messages.length === 0 ? (
                  <Loader2 className="mx-auto animate-spin text-emerald-700" />
                ) : loadError ? (
                  <div className="text-center text-rose-600 text-sm">
                    {loadError}
                    <button
                      className="block mx-auto underline mt-2"
                      onClick={refresh}
                    >
                      Retry
                    </button>
                  </div>
                ) : !messages.length ? (
                  <div className="text-center text-slate-400 text-xs py-16">
                    <MessageCircle className="mx-auto mb-3" />
                    Start with an approved template. The customer must reply
                    before free-form messages can be sent.
                  </div>
                ) : null}
                {messages.length === 200 && (
                  <p className="text-center text-xs text-slate-400 mb-4">
                    Showing the latest 200 messages
                  </p>
                )}
                {messages.map((m, index) => {
                  const outbound =
                    m.direction === "outbound" || m.sender === "user";
                  const failed = ["failed", "undelivered"].includes(m.status);
                  return (
                    <div key={m.id}>
                      {(index === 0 ||
                        dateLabel(messages[index - 1].created_at) !==
                          dateLabel(m.created_at)) && (
                        <div className="text-center my-5">
                          <span className="bg-white border border-slate-200 rounded-full px-3 py-1 text-[10px] text-slate-400">
                            {dateLabel(m.created_at)}
                          </span>
                        </div>
                      )}
                      <div
                        className={cn(
                          "flex mb-3",
                          outbound ? "justify-end" : "justify-start",
                        )}
                      >
                        <div
                          className={cn(
                            "max-w-[88%] sm:max-w-[78%] rounded-2xl px-4 py-3 shadow-sm",
                            outbound
                              ? "bg-[#deeee5] rounded-tr-sm"
                              : "bg-white rounded-tl-sm border border-slate-100",
                            failed && "ring-1 ring-rose-300",
                          )}
                        >
                          <div className="text-[9px] uppercase tracking-wider mb-1.5 text-slate-500 flex gap-1 items-center">
                            {outbound ? (
                              m.sent_by ? (
                                "Team reply"
                              ) : (
                                <>
                                  <Bot size={10} />
                                  Automation
                                </>
                              )
                            ) : (
                              "Customer"
                            )}
                            {m.message_type === "template" && (
                              <span className="ml-1 border border-emerald-700/20 rounded px-1 text-emerald-800">
                                Template
                              </span>
                            )}
                          </div>
                          <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words text-slate-800">
                            {m.content.startsWith("data:")
                              ? "[Attachment]"
                              : m.content ||
                                "[" + (m.message_type || "Media") + "]"}
                          </p>
                          <div className="flex justify-end items-center gap-1.5 mt-2 text-[10px] text-slate-400">
                            <span>{timeLabel(m.created_at)}</span>
                            {outbound && (
                              <span
                                className={cn(
                                  "flex items-center gap-1",
                                  m.status === "read"
                                    ? "text-sky-600"
                                    : failed
                                      ? "text-rose-600"
                                      : "text-slate-500",
                                )}
                              >
                                {failed ? (
                                  <AlertCircle size={12} />
                                ) : ["read", "delivered"].includes(m.status) ? (
                                  <CheckCheck size={13} />
                                ) : ["queued", "sending"].includes(m.status) ? (
                                  <Clock3 size={12} />
                                ) : (
                                  <Check size={13} />
                                )}{" "}
                                {m.status}
                              </span>
                            )}
                          </div>
                          {failed && (
                            <p className="text-xs text-rose-700 mt-2 max-w-sm">
                              {m.error_message ||
                                "Delivery failed. Check the recipient and try again."}
                              {m.error_code ? " (" + m.error_code + ")" : ""}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottom} />
              </div>
              <div className="p-4 border-t border-slate-200 bg-white">
                {!openWindow && (
                  <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 rounded-xl px-3 py-2.5 mb-3">
                    <Clock3 size={15} className="shrink-0 mt-0.5" />
                    <span>
                      {lastInbound
                        ? "The 24-hour reply window has closed."
                        : "The customer has not replied yet."}{" "}
                      Send an approved template, then wait for their reply to
                      unlock chat.
                    </span>
                  </div>
                )}
                <div className="border border-slate-200 rounded-xl focus-within:border-emerald-500 overflow-hidden">
                  <textarea
                    aria-label="Message"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    maxLength={4096}
                    disabled={!openWindow || sending || selected?.opted_out}
                    placeholder={
                      openWindow
                        ? "Write a reply…"
                        : "Choose an approved template to continue"
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    className="resize-none w-full min-h-[62px] p-3 text-sm outline-none disabled:bg-slate-50"
                  />
                  <div className="flex justify-between items-center px-3 pb-3">
                    <button
                      disabled={sending || selected?.opted_out}
                      onClick={() => {
                        setPicker(true);
                        setTemplateId("");
                        setVariables({});
                      }}
                      className="text-xs font-medium text-emerald-800 flex gap-1.5 items-center disabled:opacity-50"
                    >
                      <FileText size={15} />
                      Use template
                    </button>
                    <button
                      onClick={() => send()}
                      disabled={
                        !openWindow ||
                        !draft.trim() ||
                        sending ||
                        selected?.opted_out
                      }
                      className="px-4 py-2 rounded-lg bg-emerald-800 text-white text-xs font-semibold flex gap-2 items-center disabled:opacity-40"
                    >
                      {sending ? (
                        <Loader2 className="animate-spin" size={14} />
                      ) : (
                        <Send size={14} />
                      )}
                      Send
                    </button>
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 mt-2">
                  Enter to send · Shift + Enter for a new line · Sending a reply
                  pauses automation
                </p>
              </div>
            </section>
            <aside
              className={cn(
                "w-full lg:w-[260px] xl:w-[280px] shrink-0 border-l border-slate-200 overflow-y-auto",
                details ? "block" : "hidden xl:block",
              )}
            >
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-semibold text-sm text-slate-800">
                  Enquiry details
                </h3>
                <button
                  className="xl:hidden"
                  aria-label="Close enquiry details"
                  onClick={() => setDetails(false)}
                >
                  <X size={17} />
                </button>
              </div>
              <div className="p-5 border-b border-slate-100">
                <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-2">
                  Linked lead
                </div>
                <p className="font-semibold text-sm text-slate-800">{name}</p>
                {lead && (
                  <Link
                    to={"/leads/" + lead.id}
                    className="inline-flex gap-1 items-center text-xs text-emerald-800 mt-2"
                  >
                    Open lead record
                    <ArrowUpRight size={13} />
                  </Link>
                )}
                {selected && (
                  <>
                    <label className="text-[10px] text-slate-400 block mt-4 mb-1">
                      Conversation status
                    </label>
                    <select
                      aria-label="Conversation status"
                      value={selected.status}
                      onChange={(e) =>
                        setConversationStatus(
                          selected.id,
                          e.target.value as "open" | "pending" | "resolved",
                        )
                      }
                      className="w-full p-2 border rounded-lg text-xs"
                    >
                      <option value="open">Open</option>
                      <option value="pending">Needs attention</option>
                      <option value="resolved">Resolved</option>
                    </select>
                    <label className="text-[10px] text-slate-400 block mt-3 mb-1">
                      Assigned consultant
                    </label>
                    <select
                      aria-label="Assigned consultant"
                      value={selected.assigned_staff_id || ""}
                      onChange={(e) =>
                        assignConversation(
                          selected.id,
                          e.target.value || null,
                          staff.find((s) => s.id === e.target.value)?.full_name,
                        )
                      }
                      className="w-full p-2 border rounded-lg text-xs"
                    >
                      <option value="">Unassigned</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.full_name}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
              <div className="p-5">
                <div className="flex justify-between text-[10px] uppercase tracking-widest text-slate-400">
                  <span>Travel brief</span>
                  <span>{Object.keys(answers).length}/8</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 mt-3 mb-5">
                  <div
                    className="h-full rounded-full bg-emerald-600 transition-all"
                    style={{
                      width:
                        Math.min((Object.keys(answers).length / 8) * 100, 100) +
                        "%",
                    }}
                  />
                </div>
                <div className="space-y-4">
                  {steps.map(([key, label]) => (
                    <div key={key} className="flex gap-2.5">
                      <div
                        className={cn(
                          "w-5 h-5 rounded-full grid place-items-center shrink-0",
                          answers[key]
                            ? "bg-emerald-100 text-emerald-700"
                            : selected?.automation_step === key
                              ? "bg-amber-100 text-amber-700"
                              : "bg-slate-100 text-slate-300",
                        )}
                      >
                        {answers[key] ? (
                          <Check size={12} />
                        ) : (
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] text-slate-400">{label}</p>
                        <p className="text-xs text-slate-700 mt-0.5 break-words">
                          {answers[key] ||
                            (selected?.automation_step === key
                              ? "Waiting for customer…"
                              : "Not collected yet")}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                {selected?.automation_step === "completed" && (
                  <p className="mt-5 p-3 bg-emerald-50 rounded-xl text-xs text-emerald-800 flex gap-2">
                    <ShieldCheck size={17} />
                    Confirmed and saved to lead
                  </p>
                )}
              </div>
            </aside>
          </>
        )}
      </div>
      <Dialog open={picker} onOpenChange={setPicker}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Send an approved template</DialogTitle>
            <DialogDescription>
              Templates do not open the reply window until the customer
              responds.
            </DialogDescription>
          </DialogHeader>
          <label className="text-xs font-medium">Template</label>
          <select
            aria-label="Template"
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              setVariables({});
            }}
            className="border rounded-xl p-3 text-sm"
          >
            <option value="">Choose a template</option>
            {approved.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.category}
              </option>
            ))}
          </select>
          {!approved.length && (
            <p className="text-xs text-amber-700">
              No active approved templates. Open Templates to sync approvals.
            </p>
          )}
          {keys.map((key) => (
            <label key={key} className="text-xs font-medium">
              Field {key}
              <input
                aria-label={"Template field " + key}
                value={variables[key] || ""}
                onChange={(e) =>
                  setVariables((v) => ({ ...v, [key]: e.target.value }))
                }
                placeholder={template?.sample_values?.[key] || "Enter value"}
                className="w-full mt-1 border rounded-lg p-2.5 text-sm"
              />
            </label>
          ))}
          {template && (
            <div className="p-4 rounded-xl bg-emerald-50 text-sm whitespace-pre-wrap leading-relaxed">
              {preview}
            </div>
          )}
          <Button
            className="bg-emerald-800 hover:bg-emerald-900"
            disabled={
              !template ||
              sending ||
              keys.some((key) => !variables[key]?.trim())
            }
            onClick={() => send(true)}
          >
            {sending ? "Sending…" : "Send template"}
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={newChat} onOpenChange={setNewChat}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Start a conversation</DialogTitle>
            <DialogDescription>
              Choose a lead. New conversations start with an approved template.
            </DialogDescription>
          </DialogHeader>
          <input
            aria-label="Search leads"
            placeholder="Search leads by name or number"
            value={contactSearch}
            onChange={(e) => setContactSearch(e.target.value)}
            className="border rounded-xl p-3 text-sm"
          />
          <div className="max-h-80 overflow-y-auto">
            {leads
              .filter(
                (l) =>
                  l.phone &&
                  l.source !== "WhatsApp Group" &&
                  l.notes !== "[DELETED]" &&
                  (l.name + " " + l.phone)
                    .toLowerCase()
                    .includes(contactSearch.toLowerCase()),
              )
              .slice(0, 50)
              .map((l) => (
                <button
                  key={l.id}
                  className="w-full text-left px-3 py-3 border-b hover:bg-emerald-50"
                  onClick={() => {
                    const c = conversations
                      .filter(
                        (c) =>
                          c.contact_lead_id === l.id ||
                          digits(c.phone) === digits(l.phone),
                      )
                      .sort(
                        (a, b) =>
                          Number(Boolean(b.last_inbound_at)) -
                          Number(Boolean(a.last_inbound_at)),
                      )[0];
                    if (c) choose(c);
                    else {
                      setSelectedId(null);
                      setNewLeadId(l.id);
                      setDraft("");
                    }
                    setNewChat(false);
                  }}
                >
                  <div className="text-sm font-semibold">{l.name}</div>
                  <div className="text-xs text-slate-400 mt-1">{l.phone}</div>
                </button>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
