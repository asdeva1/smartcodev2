import type { Metadata } from 'next';
import { CoderAllotmentWorkspace } from '@/features/projects/CoderAllotmentWorkspace';

export const metadata: Metadata = { title: 'My charts' };

export default function Page() {
  return <CoderAllotmentWorkspace />;
}
