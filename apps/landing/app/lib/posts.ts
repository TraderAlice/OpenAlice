import { posts } from '@/content/posts/registry';

export type { PostMetadata } from '@/content/posts/registry';

export function getAllPosts() {
  return [...posts].sort((a, b) => (a.date > b.date ? -1 : 1));
}

export function getAllPostSlugs(): string[] {
  return posts.map((p) => p.slug);
}
