import type { Metadata } from 'next';
import { ManagerDashboardWorkspace } from '@/features/dashboards/ManagerDashboardWorkspace';

export const metadata: Metadata = { title: 'Manager dashboard' };

export default function ManagerDashboardPage() {
  return <ManagerDashboardWorkspace />;
}
