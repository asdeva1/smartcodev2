import type { Metadata } from 'next';
import { AuditLogWorkspace } from '@/features/logs/LogsWorkspace';

export const metadata: Metadata = { title: 'Audit log' };

export default function AuditLogPage() {
  return <AuditLogWorkspace />;
}
