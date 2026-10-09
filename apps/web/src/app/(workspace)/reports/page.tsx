import type { Metadata } from 'next';
import { ReportsWorkspace } from '@/features/reports/ReportsWorkspace';

export const metadata: Metadata = { title: 'Reports' };

export default function ReportsPage() {
  return <ReportsWorkspace />;
}
