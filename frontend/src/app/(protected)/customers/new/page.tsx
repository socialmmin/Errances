import { CustomerForm } from '@/components/customers/customer-form';

export default function NewCustomerPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-navy dark:text-white">New Customer</h1>
      <CustomerForm />
    </div>
  );
}
