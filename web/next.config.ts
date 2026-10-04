import type { NextConfig } from "next";
import createMDX from "@next/mdx";
import path from "node:path";

const nextConfig: NextConfig = {
  // Support MDX files as pages
  pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd(), ".."),
  outputFileTracingIncludes: {
    "/learn": ["./src/content/posts/*.mdx"],
    "/learn/*": ["./src/content/posts/*.mdx"],
    "/explore": ["../warren/outputs/warren_properties.json"],
  },
  outputFileTracingExcludes: {
    "/*": ["../data/school-board/**/*"],
  },
};

const withMDX = createMDX({
  // Add markdown plugins here if needed
  options: {
    remarkPlugins: [],
    rehypePlugins: [],
  },
});

export default withMDX(nextConfig);
