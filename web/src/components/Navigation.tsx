"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navigation() {
  const pathname = usePathname();
  return (
    <header className="site-header">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="site-container masthead">
        <Link className="site-name" href="/" aria-label="Open Valley home"><span className="brand-line"><svg viewBox="0 0 60 35" fill="none" aria-hidden="true"><path d="M2 30 18 6l12 18L43 3l15 27" stroke="currentColor" strokeWidth="3"/><path d="m13 30 11-16 12 16" stroke="#ad854a" strokeWidth="3"/></svg>Open Valley</span><span className="publisher-tag">A clearer view of the place we call home.</span></Link>
        <nav aria-label="Primary navigation" className="primary-nav">
          {[['/district', 'Our district'], ['/library', 'Library'], ['/meetings', 'Meetings'], ['/updates', 'Updates'], ['/about', 'About'], ['/ask', 'Ask a question ↗']].map(([href, label]) => <Link key={href} href={href} prefetch={false} aria-current={pathname === href || pathname.startsWith(href+'/') ? 'page' : undefined}>{label}</Link>)}
        </nav>
      </div>
    </header>
  );
}
