import type { MetadataRoute } from 'next';
import { getAllPosts } from '@/app/lib/posts';
import { SITE_URL } from '@/app/lib/site';
import { getAllDocHrefs, getDocsNavTree } from '@/lib/docs/navigation';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Get all blog posts
  const posts = getAllPosts();
  const docs = getAllDocHrefs(getDocsNavTree());

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/blog`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/download`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
  ];

  const docsPages: MetadataRoute.Sitemap = ["/docs", ...docs].map((href) => ({
    url: `${SITE_URL}${href}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: href === "/docs" ? 0.8 : 0.65,
  }));

  // Dynamic blog posts
  const blogPages: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: new Date(post.date),
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }));

  return [...staticPages, ...docsPages, ...blogPages];
}
