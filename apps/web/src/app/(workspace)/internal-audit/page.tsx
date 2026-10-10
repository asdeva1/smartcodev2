import type { Metadata } from 'next';
import { InternalAuditWorkspace } from '@/features/internal-audit/InternalAuditWorkspace';

export const metadata: Metadata = { title: 'Internal audit' };

export default function Page() {
  return <InternalAuditWorkspace />;
}
