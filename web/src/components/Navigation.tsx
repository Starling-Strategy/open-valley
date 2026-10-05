"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navigation() {
  const pathname = usePathname();
  const isHomes = ["/homes", "/story", "/explore", "/learn", "/data"].some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  return (
    <header className="site-header">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="site-container masthead">
        <Link className="site-name" href="/" aria-label="Open Valley home">Open Valley<span className="publisher-tag">Independent civic research · Vermont</span></Link>
        <nav aria-label="Primary navigation" className="primary-nav">
          <Link href="/schools" aria-current={pathname === "/schools" ? "page" : pathname.startsWith("/schools/") ? "location" : undefined}>Schools</Link>
          <Link href="/homes" aria-current={pathname === "/homes" ? "page" : isHomes ? "location" : undefined}>Homes</Link>
        </nav>
      </div>
    </header>
  );
}
