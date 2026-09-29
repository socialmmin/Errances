import { tr } from '@/i18n';

export const LEAD_STATUSES = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'interested', label: 'Interested' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'quotation_sent', label: 'Quotation Sent' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'advance_paid', label: 'Advance Paid' },
  { value: 'booking_confirmed', label: 'Booking Confirmed' },
  { value: 'won', label: 'Completed / Won' },
  { value: 'no_response', label: 'No Response' },
  { value: 'just_checking', label: 'Just Checking' },
  { value: 'invalid_number', label: 'Invalid Number' },
  { value: 'wrong_number', label: 'Wrong Number' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'not_interested', label: 'Not Interested' },
  { value: 'lost', label: 'Lost' },
] as const;

export function leadStatusLabel(value: string) {
  return tr(LEAD_STATUSES.find((status) => status.value === value)?.label
    ?? value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()));
}

// One status field, grouped by outcome, instead of a separate status + quality + lost-reason set of
// controls — the status itself already says everything (e.g. "Invalid Number" IS the bad reason).
const GOOD_VALUES = new Set(['qualified', 'quotation_sent', 'negotiation', 'advance_paid', 'booking_confirmed', 'won']);
const BAD_VALUES = new Set(['invalid_number', 'wrong_number', 'duplicate', 'no_response', 'just_checking', 'not_interested', 'lost']);

export const STATUS_GROUPS: { key: 'GOOD' | 'NEUTRAL' | 'BAD'; label: string; statuses: typeof LEAD_STATUSES[number][] }[] = [
  { key: 'GOOD', label: 'Positive — moving toward a booking', statuses: LEAD_STATUSES.filter((s) => GOOD_VALUES.has(s.value)) },
  { key: 'NEUTRAL', label: 'Neutral — still in progress', statuses: LEAD_STATUSES.filter((s) => !GOOD_VALUES.has(s.value) && !BAD_VALUES.has(s.value)) },
  { key: 'BAD', label: 'Negative — dead or bad data', statuses: LEAD_STATUSES.filter((s) => BAD_VALUES.has(s.value)) },
];

export const LOST_REASONS = [
  'No phone / invalid number', 'Wrong number', 'Duplicate', 'No response after follow-ups',
  'Just checking', 'Price enquiry only', 'Will decide later',
  'Budget too low', 'Chose another company', 'Dates changed / not travelling', 'Destination not offered', 'Not interested',
] as const;

export const QUALITY_STYLE: Record<string, { label: string; chip: string }> = {
  GOOD: { label: 'Good', chip: 'bg-emerald-100 text-emerald-700' },
  NEUTRAL: { label: 'Neutral', chip: 'bg-slate-100 text-slate-600' },
  BAD: { label: 'Bad', chip: 'bg-red-100 text-red-700' },
};
