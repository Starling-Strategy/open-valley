import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";

export const metadata = {
  title: "Explore Warren property records | Open Valley",
  description: "Search the retained public Warren assessment records and follow links to the town's property cards.",
};

// This is the public NEMRC assessment export, not the legacy housing database.
// Select only these fields; owner/mailing blocks and assessor notes stay server-side.
async function getProperties() {
  try {
    const raw = await readFile(
      path.join(process.cwd(), "../warren/outputs/warren_properties.json"),
      "utf8",
    );
    const records: Record<string, string>[] = JSON.parse(raw);
    return records.map((record) => ({
      parcelId: record.parcel_id,
      location: record["Owner Information / Location"] || "Not recorded",
      span: record["Parcel Information / SPAN"] || "Not recorded",
      assessedTotal: record["Parcel Value Information / Total"] || "Not recorded",
    }));
  } catch {
    return null;
  }
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const query = (typeof params.q === "string" ? params.q : "").trim();
  const properties = await getProperties();
  const matches = properties?.filter((property) =>
    [property.location, property.parcelId, property.span].some((value) =>
      value.toLowerCase().includes(query.toLowerCase()),
    ),
  );

  return (
    <div className="site-container">
      <header className="editorial-hero">
        <p className="eyebrow"><Link href="/homes">Homes</Link> · Public records</p>
        <h1>Explore Warren properties.</h1>
        <p className="lede">Look up a location, parcel ID, or SPAN in the retained town assessment records.</p>
        <p className="note reading-copy">
          Source: Warren&apos;s public NEMRC property cards. Source update: May 15,
          2026; export built May 31, 2026. These are historical assessment records,
          not current sale prices or a count of occupied homes. Follow a property
          card link to check the town&apos;s record.
        </p>
      </header>

      <aside className="availability" aria-labelledby="explore-availability">
        <h2 id="explore-availability">Map and live housing counts unavailable</h2>
        <p>
          The property map, dwelling classifications, and rental-listing matches
          are not connected in this release. The assessment records below do not
          establish whether a home is occupied or used as a short-term rental.
        </p>
        <p>Read the <Link href="/story">housing story</Link>, <Link href="/learn/methodology">research method</Link>, or <Link href="/data">data sources</Link>.</p>
      </aside>

      <section className="editorial-section" aria-labelledby="records-heading">
        <h2 id="records-heading">Assessment records</h2>
        {matches ? (
          <>
            <form className="property-search" action="/explore" method="get" role="search">
              <label htmlFor="property-query">Location, parcel ID, or SPAN</label>
              <div className="search-controls">
                <input id="property-query" name="q" type="search" defaultValue={query} />
                <button type="submit">Search records</button>
                {query && <Link className="text-link" href="/explore">Clear search</Link>}
              </div>
            </form>
            <p>{matches.length.toLocaleString("en-US")} assessment records{query ? ` matching “${query}”` : " in this export"}.</p>
            {matches.length > 0 ? (
              <div className="table-scroll" role="region" aria-label="Warren assessment records, scroll horizontally for all columns" tabIndex={0}>
                <table className="public-table">
                  <caption>May 2026 export · assessment amounts in USD as recorded by the source</caption>
                  <thead><tr><th scope="col">Location</th><th scope="col">Parcel / public card</th><th scope="col">SPAN</th><th scope="col">Assessed total</th></tr></thead>
                  <tbody>
                    {matches.map((property) => (
                      <tr key={property.parcelId}>
                        <th scope="row">{property.location}</th>
                        <td><a href={`https://nemrc.info/web_data/vtwarr/camadetailT.php?prop=${encodeURIComponent(property.parcelId)}`}>{property.parcelId}</a></td>
                        <td>{property.span}</td>
                        <td>{property.assessedTotal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="note">Try a street name or a different parcel identifier.</p>}
          </>
        ) : (
          <div className="availability">
            <p>The retained assessment file is unavailable. You can still use the <a href="https://www.axisgis.com/WarrenVT">town&apos;s public property viewer</a> or read our <Link href="/learn">housing research</Link>.</p>
          </div>
        )}
      </section>
    </div>
  );
}
