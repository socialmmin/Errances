import { LeadForm } from '@/components/leads/lead-form';

export default function NewLeadPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-navy dark:text-white">New Lead</h1>
      <LeadForm />
    </div>
  );
}
