import type { Metadata } from 'next';
import { ReworkDetailWorkspace } from '@/features/audits/ReworkWorkspace';

export const metadata: Metadata = { title: 'Rework chart' };

export default function Page() {
  return <ReworkDetailWorkspace />;
}
