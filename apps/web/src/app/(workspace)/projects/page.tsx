import type { Metadata } from 'next';
import { ProjectsWorkspace } from '@/features/projects/ProjectsWorkspace';

export const metadata: Metadata = { title: 'Projects' };

export default function Page() {
  return <ProjectsWorkspace />;
}
