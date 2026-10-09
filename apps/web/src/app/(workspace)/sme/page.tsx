import type { Metadata } from 'next';
import { CoachWorkspace } from '@/features/dashboards/CoachWorkspace';

export const metadata: Metadata = { title: 'Quality coaching' };

export default function CoachPage() {
  return <CoachWorkspace />;
}
