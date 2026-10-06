'use client';

import { useParams } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuotation } from '@/hooks/use-quotations';
import { QuotationBuilder } from '@/components/quotations/quotation-builder';

export default function EditQuotationPage() {
  const { id } = useParams<{ id: string }>();
  const { data: quotation, isLoading } = useQuotation(id);

  if (isLoading) return <Skeleton className="h-64 w-full max-w-3xl" />;
  if (!quotation) return <p>Quotation not found.</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-navy dark:text-white">Edit Quotation</h1>
      <QuotationBuilder quotation={quotation} />
    </div>
  );
}
