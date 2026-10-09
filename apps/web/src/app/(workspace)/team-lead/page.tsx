import type { Metadata } from 'next';
import { TeamLeadWorkspace } from '@/features/dashboards/TeamLeadWorkspace';

export const metadata: Metadata = { title: 'My team' };

export default function TeamLeadPage() {
  return <TeamLeadWorkspace />;
}
