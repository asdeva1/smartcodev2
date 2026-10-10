import type { Metadata } from 'next';
import { ReviewsWorkspace } from '@/features/audits/ReviewsWorkspace';

export const metadata: Metadata = { title: 'Audit reviews' };

export default function Page() {
  return <ReviewsWorkspace />;
}
