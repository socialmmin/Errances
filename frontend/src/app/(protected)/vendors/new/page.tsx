import { redirect } from 'next/navigation';

// Vendors are added from the pop-up on the Vendors page.
export default function NewVendorPage() {
  redirect('/vendors');
}
