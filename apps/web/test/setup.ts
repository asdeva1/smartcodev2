import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { createElement, type ImgHTMLAttributes } from 'react';
import { afterEach, vi } from 'vitest';

// Slow shared CI runners need longer than the 1 s default to find elements that appear after a fetch.
configure({ asyncUtilTimeout: 10_000 });

afterEach(() => cleanup());

// next/image needs the Next.js runtime; render a plain <img> with the same props in unit tests.
vi.mock('next/image', () => ({
  default: ({
    priority: _priority,
    ...props
  }: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => createElement('img', props),
}));

export const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ id: 'p1' }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
