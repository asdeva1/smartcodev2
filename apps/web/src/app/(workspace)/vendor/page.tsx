import type { Metadata } from 'next';
import { VendorDashboardWorkspace } from '@/features/dashboards/VendorDashboardWorkspace';

export const metadata: Metadata = { title: 'Vendor dashboard' };

export default function VendorDashboardPage() {
  return <VendorDashboardWorkspace />;
}
