import type { Metadata } from 'next';
import { HrIntegrationWorkspace } from '@/features/hr-integration/HrIntegrationWorkspace';

export const metadata: Metadata = { title: 'Smart HRMS' };

export default function Page() {
  return <HrIntegrationWorkspace />;
}
