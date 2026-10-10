import type { Metadata } from 'next';
import { ApprovalsWorkspace } from '@/features/approvals/ApprovalsWorkspace';

export const metadata: Metadata = { title: 'Approvals' };

export default function ApprovalsPage() {
  return <ApprovalsWorkspace />;
}
