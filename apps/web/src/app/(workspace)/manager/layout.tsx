import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: { template: '%s · Manager', default: 'Manager dashboard' } };

export default function ManagerLayout({ children }: { children: ReactNode }) {
  return children;
}
