import type { Metadata } from 'next';
import { MyAccountWorkspace } from '@/features/account/MyAccountWorkspace';

export const metadata: Metadata = { title: 'My account' };

export default function Page() {
  return <MyAccountWorkspace />;
}
