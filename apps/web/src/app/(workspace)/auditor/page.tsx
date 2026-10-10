import type { Metadata } from 'next';
import { AuditQueueWorkspace } from '@/features/audits/AuditQueueWorkspace';

export const metadata: Metadata = { title: 'Audit queue' };

export default function Page() {
  return <AuditQueueWorkspace />;
}
