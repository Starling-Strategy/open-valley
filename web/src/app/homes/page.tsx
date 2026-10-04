import Link from "next/link";

export const metadata = {
  title: "Homes | Open Valley",
  description: "Warren housing research, public assessment records, methods, and property-tax context from Open Valley.",
};

const research = [
  { href: "/story", title: "The housing story", description: "Read our earlier work on homestead status and property transfers in Warren." },
  { href: "/explore", title: "Explore property records", description: "Look up Warren assessment records and follow links to the public property cards." },
  { href: "/learn", title: "Research & articles", description: "Read the original articles on dwellings, short-term rentals, and Vermont property-tax policy." },
  { href: "/data", title: "Sources & methods", description: "See where the housing records come from and how the research connects them." },
];

export default function HomesPage() {
  return (
    <div className="site-container">
      <header className="editorial-hero">
        <p className="eyebrow">Homes · Warren, Vermont</p>
        <h1>The places we call home.</h1>
        <p className="lede">Parcels, dwellings, homesteads, and property taxes: a starting point for understanding Warren&apos;s housing.</p>
        <p className="note reading-copy">This section retains Open Valley&apos;s earlier housing research. Articles carry their original dates; historical findings are not live counts.</p>
      </header>
      <nav className="research-list" aria-label="Homes research">
        {research.map((item) => (
          <div className="research-row" key={item.href}>
            <h2><Link href={item.href}>{item.title} <span aria-hidden="true">→</span></Link></h2>
            <p>{item.description}</p>
          </div>
        ))}
      </nav>
    </div>
  );
}
