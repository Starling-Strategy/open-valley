import Link from "next/link";

export const metadata = {
  title: "Open Valley | Homes and schools in Vermont",
  description:
    "Independent civic research from Open Valley. Start with schools across Harwood Unified Union School District in Vermont, or explore our housing research.",
};

export default function HomePage() {
  return (
    <div className="site-container">
      <section className="editorial-hero" aria-labelledby="home-title">
        <p className="eyebrow">Open Valley · Vermont</p>
        <h1 id="home-title">A shared place.<br />A clearer picture.</h1>
        <p className="lede">
          Our homes and schools shape everyday life. Open Valley brings local
          research together so you can understand the questions and follow the evidence.
        </p>
        <Link className="primary-link" href="/schools">Start with our schools <span aria-hidden="true">→</span></Link>
      </section>

      <section className="editorial-section section-grid" aria-labelledby="schools-heading">
        <div>
          <p className="eyebrow">Schools</p>
          <h2 id="schools-heading">Understand the district we have today.</h2>
        </div>
        <div className="reading-copy">
          <p>
            Our Schools coverage is about the whole Harwood Unified Union School
            District (HUUSD) in Vermont, from elementary through middle and high school.
          </p>
          <p>
            Begin with current schools and how they fit together. Then look at
            enrollment over time, the available outlook, and the sources behind it.
            A shared understanding comes before weighing changes.
          </p>
          <Link className="text-link" href="/schools">Explore Schools <span aria-hidden="true">→</span></Link>
        </div>
      </section>

      <section className="editorial-section section-grid" aria-labelledby="homes-heading">
        <div>
          <p className="eyebrow">Homes</p>
          <h2 id="homes-heading">Keep the housing questions in view.</h2>
        </div>
        <div className="reading-copy">
          <p>
            Open Valley began with Warren&apos;s parcels, dwellings, homesteads,
            and property taxes. That research has a home here, with its articles,
            methods, and public sources kept together.
          </p>
          <Link className="text-link" href="/homes">Read the Homes research <span aria-hidden="true">→</span></Link>
        </div>
      </section>

      <section className="editorial-section reading-copy" aria-labelledby="publisher-heading">
        <p className="eyebrow">About this work</p>
        <h2 id="publisher-heading">Evidence you can return to.</h2>
        <p>
          Open Valley is the publisher of this independent civic resource, not
          the school district. We explain what a source can tell us, when it was
          recorded, and where questions remain.
        </p>
      </section>
    </div>
  );
}
