// Choosing a stage for a lead takes the employee straight to the work that stage means, so the
// stage is never just a label: Follow-up -> set the follow-up, Quotation Sent -> make the quotation,
// Advance Paid / Booking Confirmed / Won -> the customer's invoice. (Not Interested / Lost open the
// reason pop-up instead -- see components/leads/reason-dialog.)
export function stageDestination(status: string, lead: { id: string; customer_name?: string | null }): { href: string; label: string } | null {
  if (status === 'follow_up') return { href: `/leads/${lead.id}?tab=followup`, label: 'set the follow-up' };
  if (status === 'quotation_sent') return { href: `/quotations/new?lead_id=${lead.id}`, label: 'make the quotation' };
  if (['advance_paid', 'booking_confirmed', 'won'].includes(status)) return { href: `/finance/invoices?search=${encodeURIComponent(lead.customer_name ?? '')}`, label: 'open the invoice' };
  return null;
}
