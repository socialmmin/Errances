import { QuotationBuilder } from '@/components/quotations/quotation-builder';

export default function NewQuotationPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-navy dark:text-white">New Quotation</h1>
      <QuotationBuilder />
    </div>
  );
}
