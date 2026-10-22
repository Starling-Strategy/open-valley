import { notFound } from "next/navigation";
import Link from "next/link";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";

// Only the retained public articles are routable.
export const dynamicParams = false;

interface PostPageProps {
  params: Promise<{
    slug: string;
  }>;
}

async function getPost(slug: string) {
  const postsDirectory = path.join(process.cwd(), "src/content/posts");
  const filePath = path.join(postsDirectory, `${slug}.mdx`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const fileContent = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(fileContent);

  return {
    meta: {
      title: data.title || "Untitled",
      description: data.description || "",
      date: data.date || "",
      author: data.author,
      tags: data.tags,
    },
    content,
  };
}

export async function generateStaticParams() {
  const postsDirectory = path.join(process.cwd(), "src/content/posts");

  if (!fs.existsSync(postsDirectory)) {
    return [];
  }

  const filenames = fs.readdirSync(postsDirectory);

  return filenames
    .filter((filename) => filename.endsWith(".mdx"))
    .map((filename) => ({
      slug: filename.replace(/\.mdx$/, ""),
    }));
}

export default async function PostPage({ params }: PostPageProps) {
  const { slug } = await params;
  const post = await getPost(slug);

  if (!post) {
    notFound();
  }

  return (
      <div className="site-container">
        <article>
          <header className="editorial-hero reading-copy">
          <nav aria-label="Article navigation">
            <Link href="/learn" className="text-link">
              &larr; Back to Articles
            </Link>
          </nav>

            <p className="eyebrow mt-8">Homes · Earlier research</p>
            <h1>{post.meta.title}</h1>
            {post.meta.description && (
              <p className="lede">{post.meta.description}</p>
            )}
            <div className="note flex flex-wrap items-center gap-x-4 mt-6">
              {post.meta.date && (
                <time dateTime={post.meta.date}>
                  {new Date(post.meta.date).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    timeZone: "UTC",
                  })}
                </time>
              )}
              {post.meta.author && <span>By {post.meta.author}</span>}
            </div>
            {post.meta.tags && post.meta.tags.length > 0 && (
              <div className="note flex flex-wrap gap-x-4 mt-4">
                {post.meta.tags.map((tag: string) => (
                  <span
                    key={tag}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <p className="note">Retained as originally written. Figures and policy descriptions reflect the article&apos;s date and have not been updated for this release.</p>
          </header>

          <div className="prose article-content">
            <MDXRemote source={post.content} options={{ mdxOptions: { remarkPlugins: [remarkGfm] } }} components={{
              table: (props) => <div className="table-scroll" role="region" aria-label="Article table, scroll horizontally for all columns" tabIndex={0}><table {...props} /></div>,
            }} />
          </div>
        </article>
      </div>
  );
}
