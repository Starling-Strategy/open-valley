import Navigation from "./Navigation";
import Footer from "./Footer";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="site-shell">
      <Navigation />
      {process.env.NEXT_PUBLIC_OPENVALLEY_STAGING === "true" && <aside className="staging-banner" aria-label="Staging environment">
        <strong>Staging</strong><span>Review copy · build {process.env.NEXT_PUBLIC_OPENVALLEY_REVISION?.slice(0, 7)}</span>
        <a href="https://github.com/Starling-Strategy/open-valley/issues/10">Leave feedback</a>
      </aside>}
      <main id="main-content" tabIndex={-1}>{children}</main>
      <Footer />
    </div>
  );
}
