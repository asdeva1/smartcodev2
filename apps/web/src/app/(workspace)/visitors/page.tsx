import type { Metadata } from 'next';
import { VisitorsWorkspace } from '@/features/visitors/VisitorsWorkspace';

export const metadata: Metadata = { title: 'Visitors' };

export default function Page() {
  return <VisitorsWorkspace />;
}
