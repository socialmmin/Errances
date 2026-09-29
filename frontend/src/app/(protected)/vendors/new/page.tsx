'use client';

import { VendorForm } from '@/components/vendors/vendor-form';
import { tr } from '@/i18n';

export default function NewVendorPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-navy dark:text-white">{tr("New Vendor")}</h1>
      <VendorForm />
    </div>
  );
}
