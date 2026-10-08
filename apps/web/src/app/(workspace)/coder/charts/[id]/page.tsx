import type { Metadata } from 'next';
import { CoderChartWorkspace } from '@/features/projects/CoderChartWorkspace';

export const metadata: Metadata = { title: 'Chart workspace' };

export default function Page() {
  return <CoderChartWorkspace />;
}
