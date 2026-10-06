'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { TeamBoard } from '@/components/settings/work-board';

export default function TeamBoardPage() {
  const router = useRouter();
  return (
    <div className="space-y-4">
      <button type="button" onClick={() => router.push('/settings/users')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-navy"><ArrowLeft className="h-4 w-4" /> Back to User Management</button>
      <TeamBoard />
    </div>
  );
}
