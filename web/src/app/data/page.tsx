import Link from "next/link";
import DataModelDiagram from "@/components/DataModelDiagram";

export const metadata = {
  title: "Housing sources & methods | Open Valley",
  description: "Sources and relationships behind Open Valley's Warren housing research.",
};

const dataSources = [
  { name: "Warren assessment records", description: "The town's public NEMRC property cards provide locations, parcel identifiers, and assessed values. Our property lookup uses the retained May 2026 export.", url: "https://www.axisgis.com/WarrenVT", label: "Warren property viewer" },
  { name: "Vermont Geodata Portal", description: "State parcel boundaries and identifiers used in the original maps and to connect assessment records with geography.", url: "https://geodata.vermont.gov/", label: "Vermont Geodata Portal" },
  { name: "Vermont Grand List & property transfers", description: "Property-tax records and Property Transfer Tax Returns (PTTR) underlie the earlier homestead and transfer research.", url: "https://tax.vermont.gov/", label: "Vermont Department of Taxes" },
  { name: "AirROI short-term rental data", description: "The earlier rental research used commercial listing data from AirROI. This release retains the research articles; it does not offer a live listing feed.", url: "https://www.airroi.com/", label: "AirROI" },
];

export default function DataPage() {
  return (
    <div className="site-container">
      <header className="editorial-hero">
        <p className="eyebrow"><Link href="/homes">Homes</Link> · Sources &amp; methods</p>
        <h1>How the housing research fits together.</h1>
        <p className="lede">A parcel is land. A dwelling is a home. A listing is an offer to rent. They are related records, not interchangeable counts.</p>
      </header>
      <section className="editorial-section" aria-labelledby="model-heading">
        <h2 id="model-heading">The research data model</h2>
        <p className="note reading-copy">This diagram explains the original research structure. Live entity counts are unavailable in this release. No cached counts are substituted.</p>
        <DataModelDiagram />
        <Link className="text-link" href="/learn/methodology">Read the dwelling methodology <span aria-hidden="true">→</span></Link>
      </section>
      <section className="editorial-section" aria-labelledby="sources-heading">
        <h2 id="sources-heading">Sources</h2>
        <div className="research-list">
          {dataSources.map((source) => (
            <section className="research-row" key={source.name}>
              <h3>{source.name}</h3>
              <div className="reading-copy"><p>{source.description}</p><a className="text-link" href={source.url}>{source.label} <span aria-hidden="true">↗</span></a></div>
            </section>
          ))}
        </div>
        <p className="reading-copy">For definitions and the original policy context, see the <Link className="text-link" href="/learn/glossary">glossary</Link>. Article dates describe when the research was written, not when a live dataset was last updated.</p>
      </section>
    </div>
  );
}
