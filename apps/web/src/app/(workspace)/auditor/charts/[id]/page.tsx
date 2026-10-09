import type { Metadata } from 'next';
import { AuditChartWorkspace } from '@/features/audits/AuditChartWorkspace';

export const metadata: Metadata = { title: 'Audit chart' };

export default function Page() {
  return <AuditChartWorkspace />;
}
