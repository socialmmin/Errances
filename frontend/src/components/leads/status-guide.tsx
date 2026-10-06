'use client';

import { useState } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';

interface Row { status: string; when: string; example: string }
const GOOD: Row[] = [
  { status: 'Qualified', when: 'Travel dates, budget, destination and group size are confirmed as genuine — a real requirement, not just a click.', example: 'Customer replied with "Family of 4, December, ₹80k budget, want Kashmir."' },
  { status: 'Quotation Sent', when: 'An actual itinerary + price quotation was sent to them.', example: 'You emailed/WhatsApped a PDF quotation with the final price.' },
  { status: 'Advance Paid', when: 'They paid an advance amount to hold the booking.', example: '₹10,000 advance received via UPI/bank transfer.' },
  { status: 'Booking Confirmed / Completed', when: 'The tour is fully booked and confirmed.', example: 'Full payment done, booking finalized in the system.' },
];
const NEUTRAL: Row[] = [
  { status: 'New', when: 'Lead just arrived, nobody has worked it yet.', example: 'Fresh Meta Ads lead, 5 minutes old.' },
  { status: 'Contacted', when: 'You called/messaged them at least once.', example: 'You WhatsApped the welcome message.' },
  { status: 'Interested', when: 'They show real interest but nothing is confirmed yet (no dates/budget).', example: '"Yes I want to go to Vietnam" but no dates given yet.' },
  { status: 'Message Sent', when: 'Itinerary/info sent, no reply yet.', example: 'Auto WhatsApp itinerary delivered.' },
  { status: 'Follow-up', when: 'A follow-up call/message is scheduled.', example: 'You said "I will call back Tuesday."' },
  { status: 'Negotiation', when: 'Discussing price/package details, not yet paid.', example: '"Can you do ₹5000 less per person?"' },
];
const BAD: Row[] = [
  { status: 'Invalid Number', when: 'The phone number does not exist / is not a real 10-digit mobile.', example: '"1234567890" or a number with wrong digit count.' },
  { status: 'Wrong Number', when: 'The number is valid but belongs to someone else / picked up by a stranger.', example: 'You called and a random person answered saying "wrong number."' },
  { status: 'Duplicate', when: 'This same phone number already exists as another lead.', example: 'Same person filled the Meta form twice.' },
  { status: 'No Response', when: '3+ calls/messages attempted over a week, no reply at all.', example: 'Called 3 times across 7 days, no answer, no WhatsApp reply.' },
  { status: 'Just Checking', when: 'They admit they are only browsing, not planning to book.', example: '"Just checking prices for future reference."' },
  { status: 'Not Interested', when: 'They explicitly said no / not interested.', example: '"Not interested, please remove my number."' },
  { status: 'Lost', when: 'Was a real conversation but it fell through — wrong budget, chose another company, changed plans, wrong destination.', example: '"We booked with another agency" / "Trip is cancelled."' },
];

function Table({ rows, tone }: { rows: Row[]; tone: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-left text-xs">
        <thead className={`${tone} text-[11px] uppercase tracking-wide`}><tr><th className="px-3 py-1.5">Status</th><th className="px-3 py-1.5">When to use it</th><th className="px-3 py-1.5">Example</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.status} className="border-t border-border align-top"><td className="whitespace-nowrap px-3 py-2 font-semibold">{r.status}</td><td className="px-3 py-2 text-muted-foreground">{r.when}</td><td className="px-3 py-2 italic text-muted-foreground">{r.example}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

// The team's cheat-sheet: what each status means, when to use it, and what CRM does with it
// automatically (quality tag, exclusion, sent to Meta). Collapsible so it doesn't clutter the page.
export function StatusGuide({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 px-5 py-3.5 text-left">
        <span className="flex items-center gap-2 font-bold text-navy dark:text-white"><HelpCircle className="h-4 w-4 text-gold" />Status guide — what each one means, and what it does</span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-border px-5 pb-5 pt-4 text-sm">
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase text-emerald-700"><span className="h-2 w-2 rounded-full bg-emerald-500" />Good — sent to Meta, tells it "find more people like this"</p>
            <Table rows={GOOD} tone="bg-emerald-50 text-emerald-800" />
          </div>
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase text-slate-600"><span className="h-2 w-2 rounded-full bg-slate-400" />Neutral — normal in-progress work, not reported to Meta yet</p>
            <Table rows={NEUTRAL} tone="bg-slate-100 text-slate-700" />
          </div>
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase text-red-700"><span className="h-2 w-2 rounded-full bg-red-500" />Bad — never sent to Meta as a success; feeds the exclusion list</p>
            <Table rows={BAD} tone="bg-red-50 text-red-800" />
          </div>
          <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">Automatic (you never need to set these by hand):</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>No phone / an invalid-looking number → tagged <b>Bad</b> automatically.</li>
              <li>Same phone number as an earlier lead → tagged <b>Bad</b> (duplicate) automatically.</li>
              <li>3 unanswered follow-up attempts over 7 days with no reply → tagged <b>Bad</b> automatically.</li>
              <li>You can always override the automatic tag on a lead's own page if it got it wrong.</li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
