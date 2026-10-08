import type { Metadata } from 'next';
import { ProjectDetailWorkspace } from '@/features/projects/ProjectDetailWorkspace';

export const metadata: Metadata = { title: 'Project' };

export default function Page() {
  return <ProjectDetailWorkspace />;
}
