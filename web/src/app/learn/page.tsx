import Link from "next/link";
import fs from "fs";
import path from "path";
import matter from "gray-matter";

interface PostMeta {
  slug: string;
  title: string;
  description: string;
  date: string;
  author?: string;
  tags?: string[];
}

async function getPosts(): Promise<PostMeta[]> {
  const postsDirectory = path.join(process.cwd(), "src/content/posts");

  if (!fs.existsSync(postsDirectory)) {
    return [];
  }

  const filenames = fs.readdirSync(postsDirectory);

  const posts = filenames
    .filter((filename) => filename.endsWith(".mdx"))
    .map((filename) => {
      const filePath = path.join(postsDirectory, filename);
      const fileContent = fs.readFileSync(filePath, "utf8");
      const { data } = matter(fileContent);

      return {
        slug: filename.replace(/\.mdx$/, ""),
        title: data.title || "Untitled",
        description: data.description || "",
        date: data.date || "",
        author: data.author,
        tags: data.tags,
      };
    })
    .sort((a, b) => {
      if (!a.date || !b.date) return 0;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

  return posts;
}

export const metadata = {
  title: "Learn - Open Valley",
  description: "Articles and guides about Warren, Vermont community data and local governance.",
};

export default async function LearnPage() {
  const posts = await getPosts();

  return (
      <div className="site-container">
          <header className="editorial-hero">
            <p className="eyebrow"><Link href="/homes">Homes</Link> · Research</p>
            <h1>
              Research &amp; Articles
            </h1>
            <p className="lede">
              Deep dives into Warren&apos;s housing data, Vermont policy, and our methodology.
            </p>
            <p className="note reading-copy">Retained articles from the original housing research. Dates and historical findings belong to each article; these are not live housing counts.</p>
          </header>

          {posts.length === 0 ? (
            <div className="availability">
              <p>The research articles are currently unavailable. You can still consult the <Link href="/data">public data sources</Link>.</p>
            </div>
          ) : (
            <div className="article-list">
              {posts.map((post) => (
                <article
                  key={post.slug}
                >
                  <Link href={`/learn/${post.slug}`}>
                    <h2>
                      {post.title}
                    </h2>
                  </Link>
                  {post.description && (
                    <p>{post.description}</p>
                  )}
                  <div className="note flex flex-wrap items-center gap-x-4">
                    {post.date && (
                      <time dateTime={post.date}>
                        {new Date(post.date).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                          timeZone: "UTC",
                        })}
                      </time>
                    )}
                    {post.author && <span>By {post.author}</span>}
                  </div>
                  {post.tags && post.tags.length > 0 && (
                    <div className="note flex flex-wrap gap-x-4 mt-3">
                      {post.tags.map((tag) => (
                        <span
                          key={tag}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
      </div>
  );
}
