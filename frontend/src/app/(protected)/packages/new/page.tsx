import { PackageForm } from '@/components/packages/package-form';

export default function NewPackagePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-navy dark:text-white">Add Destination Itinerary</h1>
      <PackageForm />
    </div>
  );
}
