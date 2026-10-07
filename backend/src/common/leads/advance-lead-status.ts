import { Pool } from 'pg';

// The funnel stages status can auto-advance THROUGH, in order. Deliberately excludes every
// negative/terminal/off-funnel status (lost, not_interested, invalid_number, wrong_number,
// duplicate, no_response, just_checking, advance_paid) -- a lead sitting in one of those never
// gets silently moved by this, only by a human choosing to. A lead already further along the
// funnel than the candidate status also never moves backward.
const FUNNEL = ['new', 'contacted', 'follow_up', 'qualified', 'quotation_sent', 'negotiation', 'booking_confirmed', 'won'];

// Called wherever real pipeline activity happens for a lead (a follow-up gets scheduled, a
// callback is requested, a quotation is created, an invoice is raised) so Status reflects what's
// actually happening without someone having to remember to click it -- per the business owner's
// own words, "based on activity it should get changed and even manually if they need they can do"
// (staff can always still edit it directly afterward; this never fights that, it only ever moves
// forward one notch along the funnel above, and only if the lead is still sitting in one of those
// in-funnel stages to begin with).
export async function advanceLeadStatus(pool: Pool, leadId: string | null | undefined, candidate: string) {
  if (!leadId) return;
  const candidateIndex = FUNNEL.indexOf(candidate);
  if (candidateIndex < 0) return;
  // status::text: the column is a typed list (lead_status) here, which array_position cannot
  // compare with text -- without the cast the query failed and nothing ever advanced.
  // array_position counts from 1 and is NULL for a status outside the funnel, so: only a lead in
  // the funnel, and only one that sits before the candidate stage.
  await pool.query(
    `UPDATE leads SET status = $2, updated_at = now()
     WHERE id = $1 AND is_deleted = false
       AND array_position($3::text[], status::text) - 1 < $4`,
    [leadId, candidate, FUNNEL, candidateIndex],
  ).catch(() => undefined);
}
