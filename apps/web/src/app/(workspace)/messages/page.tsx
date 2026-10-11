import type { Metadata } from 'next';
import { MessagesWorkspace } from '@/features/collaboration/MessagesWorkspace';

export const metadata: Metadata = { title: 'Messages' };

export default function Page() {
  return <MessagesWorkspace />;
}
