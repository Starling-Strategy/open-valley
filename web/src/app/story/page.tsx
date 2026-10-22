import Link from "next/link";

export const metadata = {
  title: "De-Homesteading Warren | Open Valley",
  description: "Open Valley's January 2026 research on Warren property transfers and homestead status, with methods and availability notes.",
};

// Retained from the January 2026 article, not a fallback for live API results.
const historicalRows = [
  { year: 2019, losses: 30, gains: 11, net: -19 },
  { year: 2020, losses: 40, gains: 20, net: -20 },
  { year: 2021, losses: 34, gains: 10, net: -24 },
  { year: 2022, losses: 19, gains: 6, net: -13 },
  { year: 2023, losses: 21, gains: 3, net: -18 },
  { year: 2024, losses: 25, gains: 13, net: -12 },
  { year: 2025, losses: 15, gains: 12, net: -3 },
];

export default function StoryPage() {
  return (
    <div className="site-container">
      <header className="editorial-hero">
        <p className="eyebrow"><Link href="/homes">Homes</Link> · Earlier research</p>
        <h1>De-Homesteading Warren</h1>
        <p className="lede">How property transfers can help us investigate changes in the use of homes.</p>
        <p className="note">Open Valley · January 2026 · Retained research, not a live housing report</p>
      </header>

      <aside className="availability" aria-labelledby="story-availability">
        <h2 id="story-availability">Transfer animation unavailable</h2>
        <p>
          The original map used a live transfer dataset that is not connected in
          this release. The article and its historical table remain below. The
          separate assessment export does not contain the transfer history needed
          to recreate the animation.
        </p>
        <p>Use the <Link href="/explore">public assessment lookup</Link> or read the <Link href="/learn/methodology">housing methodology</Link>.</p>
      </aside>

      <section className="editorial-section reading-copy" aria-labelledby="reading-heading">
        <h2 id="reading-heading">Reading the original analysis</h2>
        <p>
          The earlier work examined geocoded Vermont Property Transfer Tax Returns
          (PTTR) from 2019–2025. It compared the seller&apos;s state with the buyer&apos;s
          stated intended use to group transfers as possible changes in homestead use.
        </p>
        <p>
          A homestead is an owner&apos;s primary residence declared for property-tax
          purposes. A seller&apos;s state and a buyer&apos;s intended use are signals;
          they do not, by themselves, verify a home&apos;s occupancy or a change in
          its filed homestead status.
        </p>
        <dl className="reading-copy">
          <div><dt><strong>“Lost homestead” (TRUE_LOSS)</strong></dt><dd>A Vermont seller and a buyer declaring secondary or non-primary use.</dd></div>
          <div><dt><strong>“Became homestead” (TRUE_GAIN)</strong></dt><dd>An out-of-state seller and a buyer declaring primary-residence use.</dd></div>
          <div><dt><strong>“Stayed homestead”</strong></dt><dd>A Vermont seller and a buyer declaring primary-residence use.</dd></div>
          <div><dt><strong>“Stayed non-homestead”</strong></dt><dd>An out-of-state seller and a buyer declaring non-primary use.</dd></div>
        </dl>
        <p>These are the original analysis categories. They should not be read as a current count of year-round homes, dwellings, or residents.</p>
      </section>

      <section className="editorial-section" aria-labelledby="historical-table-heading">
        <h2 id="historical-table-heading">The reported transfer counts</h2>
        <p className="note reading-copy">The January 2026 article reported the following geocoded transfers in its two change categories. The values are retained as published, not recalculated or independently reverified for this release. Transfers in the “stayed” categories are excluded from this table.</p>
        <div className="table-scroll" role="region" aria-label="Historical transfer counts, scroll horizontally for all columns" tabIndex={0}>
          <table className="public-table">
            <caption>Original source attribution: Vermont Property Transfer Tax Returns · geocoded transfers only</caption>
            <thead><tr><th scope="col">Year</th><th scope="col">“Lost homestead”</th><th scope="col">“Became homestead”</th><th scope="col">Net (gains − losses)</th></tr></thead>
            <tbody>{historicalRows.map((row) => (
              <tr key={row.year}><th scope="row">{row.year}</th><td>{row.losses}</td><td>{row.gains}</td><td>{row.net}</td></tr>
            ))}</tbody>
            <tfoot><tr><th scope="row">Reported total</th><td>184</td><td>75</td><td>−109</td></tr></tfoot>
          </table>
        </div>
        <p className="reading-copy">Read more about <Link className="text-link" href="/data">the housing data sources</Link> and <Link className="text-link" href="/learn/glossary">the terminology</Link>.</p>
      </section>
    </div>
  );
}
