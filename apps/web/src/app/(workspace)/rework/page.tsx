import type { Metadata } from 'next';
import { ReworkWorkspace } from '@/features/audits/ReworkWorkspace';

export const metadata: Metadata = { title: 'Rework' };

export default function Page() {
  return <ReworkWorkspace />;
}
