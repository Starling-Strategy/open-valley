import type { ComponentPropsWithoutRef } from 'react';

/** Use a centered reading measure for prose, and the full site width for tools. */
export function PageLayout({
  width = 'wide',
  className = '',
  ...props
}: ComponentPropsWithoutRef<'div'> & { width?: 'reading' | 'wide' }) {
  return <div className={`site-container page-layout page-layout--${width} ${className}`} {...props} />;
}

export function PageHeader({ className = '', ...props }: ComponentPropsWithoutRef<'header'>) {
  return <header className={`page-header ${className}`} {...props} />;
}
