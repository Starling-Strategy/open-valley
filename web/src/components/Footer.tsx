import Link from "next/link";

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-container footer-grid">
        <div>
          <p className="footer-name">Open Valley</p>
          <p className="note">Independent civic research on homes and schools in Vermont.<br />Published by Open Valley, not by HUUSD.</p>
        </div>
        <nav aria-label="Research navigation" className="footer-links">
          <Link href="/schools">Schools</Link>
          <Link href="/homes">Homes</Link>
          <Link href="/learn">Research &amp; articles</Link>
          <Link href="/data">Housing sources &amp; methods</Link>
        </nav>
      </div>
    </footer>
  );
}
