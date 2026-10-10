import type { Metadata } from 'next';
import { ActivityWorkspace } from '@/features/logs/LogsWorkspace';

export const metadata: Metadata = { title: 'Activity' };

export default function ActivityPage() {
  return <ActivityWorkspace />;
}
