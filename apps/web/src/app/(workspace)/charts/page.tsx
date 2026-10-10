import type { Metadata } from 'next';
import { ChartRepositoryWorkspace } from '@/features/charts/ChartRepositoryWorkspace';

export const metadata: Metadata = { title: 'Chart repository' };

export default function ChartRepositoryPage() {
  return <ChartRepositoryWorkspace />;
}
