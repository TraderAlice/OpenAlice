import Link from "next/link";
import Image from "next/image";
import { mediaUrl } from "@/lib/media";
import { getAllPosts } from "@/app/lib/posts";
import { Nav } from "@/app/components/Nav";
import { Footer } from "@/app/components/Footer";
import type { Metadata } from "next";
import { SOCIAL_IMAGE } from "@/app/lib/site";

const title = "Blog - OpenAlice";
const description =
  "Updates, insights, and thoughts on AI-powered trading from the OpenAlice team.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/blog" },
  openGraph: {
    title,
    description,
    url: "/blog",
    type: "website",
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [SOCIAL_IMAGE.url],
  },
};

export default async function BlogPage() {
  const posts = getAllPosts();

  return (
    <div className="min-h-screen bg-background">
      <Nav />

      {/* Blog Header */}
      <div
        className="container mx-auto px-4 py-16 max-w-3xl"
        data-section="blog_index"
      >
        <h1 className="text-4xl font-bold mb-4">Blog</h1>
        <p className="text-muted-foreground text-lg mb-12">
          Updates, insights, and thoughts on AI-powered trading.
        </p>

        {/* Posts List */}
        <div className="space-y-8">
          {posts.map((post) => (
            <article key={post.slug} className="border-b pb-8">
              <Link
                href={`/blog/${post.slug}`}
                data-evt={`blog_index_post_${post.slug}`}
                data-target="blog"
                data-location="section"
                className="block group"
              >
                {/* Cover Image */}
                <div className="relative aspect-1200/630 mb-4 rounded-lg overflow-hidden bg-muted">
                  <Image
                    src={mediaUrl(`/blog/${post.slug}/cover.png`)}
                    alt={post.title}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                    sizes="(max-width: 768px) 100vw, 768px"
                  />
                </div>
                <h2 className="text-2xl font-semibold mb-2 group-hover:text-primary transition-colors">
                  {post.title}
                </h2>
                <p className="text-muted-foreground mb-3">{post.description}</p>
                <div className="text-sm text-muted-foreground">
                  <time>{new Date(post.date).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric"
                  })}</time>
                  <span className="mx-2">·</span>
                  <span>{post.author}</span>
                </div>
              </Link>
            </article>
          ))}
        </div>

        {posts.length === 0 && (
          <p className="text-muted-foreground">No posts yet. Check back soon!</p>
        )}
      </div>

      <Footer />
    </div>
  );
}
