import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getAllPostSlugs } from "@/app/lib/posts";
import { Nav } from "@/app/components/Nav";
import { Footer } from "@/app/components/Footer";
import { BlogCTA } from "@/app/components/BlogCTA";
import { blogMdxComponents } from "@/app/blog/blog-mdx-components";
import type { Metadata } from "next";
import { SITE_URL } from "@/app/lib/site";
import { mediaImage, mediaUrl } from "@/lib/media";

interface PageProps {
  params: Promise<{ slug: string }>;
}

// SSG: Generate all post pages at build time
export async function generateStaticParams() {
  const slugs = getAllPostSlugs();
  return slugs.map((slug) => ({ slug }));
}

// Dynamic metadata for each post
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  let metadata: PostMetadata;
  try {
    ({ metadata } = await import(`@/content/posts/${slug}/index.mdx`));
  } catch {
    return { title: "Post Not Found - OpenAlice Blog" };
  }
  const cover = mediaImage(`/blog/${slug}/cover.png`);
  const coverUrl = new URL(cover.src, SITE_URL).href;
  return {
    title: `${metadata.title} - OpenAlice Blog`,
    description: metadata.description,
    alternates: {
      canonical: `${SITE_URL}/blog/${slug}`,
    },
    openGraph: {
      title: metadata.title,
      description: metadata.description,
      type: "article",
      url: `${SITE_URL}/blog/${slug}`,
      images: [
        {
          url: coverUrl,
          width: cover.width,
          height: cover.height,
          alt: metadata.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: metadata.title,
      description: metadata.description,
      images: [coverUrl],
    },
  };
}

interface PostMetadata {
  title: string;
  description: string;
  date: string;
  author: string;
}

function generateJsonLd(metadata: PostMetadata, slug: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: metadata.title,
    description: metadata.description,
    datePublished: metadata.date,
    image: new URL(mediaUrl(`/blog/${slug}/cover.png`), SITE_URL).href,
    author: {
      "@type": "Person",
      name: metadata.author,
    },
    publisher: {
      "@type": "Organization",
      name: "OpenAlice",
      url: SITE_URL,
    },
    url: `${SITE_URL}/blog/${slug}`,
  };
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;

  let Post;
  let metadata: PostMetadata;

  try {
    const post = await import(`@/content/posts/${slug}/index.mdx`);
    Post = post.default;
    metadata = post.metadata;
  } catch {
    notFound();
  }

  const jsonLd = generateJsonLd(metadata, slug);

  return (
    <div className="min-h-screen bg-background">
      {/* JSON-LD Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Nav />

      {/* Article */}
      <article
        className="container mx-auto px-4 py-16 max-w-3xl"
        data-section="blog_post"
      >
        {/* Back link */}
        <Link
          href="/blog"
          data-evt="blog_post_back"
          data-target="blog"
          data-location="blog_article"
          className="text-muted-foreground hover:text-foreground transition-colors mb-8 inline-block"
        >
          ← Back to Blog
        </Link>

        {/* Header */}
        <header className="mb-8">
          <h1 className="text-4xl font-bold mb-4">{metadata.title}</h1>
          <div className="text-muted-foreground">
            <time>{new Date(metadata.date).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric"
            })}</time>
            <span className="mx-2">·</span>
            <span>{metadata.author}</span>
          </div>
        </header>

        {/* Cover Image */}
        <div className="relative aspect-1200/630 mb-12 rounded-lg overflow-hidden">
          <Image
            src={mediaUrl(`/blog/${slug}/cover.png`)}
            alt={metadata.title}
            fill
            priority
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 768px"
          />
        </div>

        {/* Content */}
        <div className="prose prose-lg max-w-none">
          <Post components={blogMdxComponents} />
        </div>

        {/* CTA */}
        <BlogCTA />
      </article>

      <Footer />
    </div>
  );
}
