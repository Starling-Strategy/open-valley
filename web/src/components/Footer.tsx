import Link from "next/link";

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-container footer-grid">
        <div>
          <p className="footer-name">Open Valley</p>
          <p className="note">Data and perspective for the Mad River Valley and beyond.<br />An independent project by Macon Phillips. Not an official HUUSD website.</p>
        </div>
        <nav aria-label="Research navigation" className="footer-links">
          <Link href="/about">How this works</Link>
          <Link href="/updates">Updates &amp; essays</Link>
          <Link href="/newsletter">The weekly letter</Link>
          <Link href="/homes">Earlier housing research</Link>
          <a href="https://huusd.org/">Official district website ↗</a>
        </nav>
      </div>
    </footer>
  );
}
