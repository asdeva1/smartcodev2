'use client';

import Button, { type ButtonProps } from '@mui/material/Button';
import NextLink from 'next/link';

/** MUI button that navigates with Next.js client-side routing (usable from server components). */
export function LinkButton({ href, ...props }: Omit<ButtonProps<'a'>, 'component'> & { href: string }) {
  return <Button component={NextLink} href={href} {...props} />;
}
