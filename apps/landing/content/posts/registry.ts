/**
 * Static post registry — add new posts here.
 *
 * Why: Vercel serverless functions can't reliably `fs.readdirSync` at runtime
 * (output file tracing doesn't always include content directories in monorepos).
 * Static imports let the bundler resolve everything at build time.
 */
import { metadata as tradingAsGitIntro } from './trading-as-git-intro/index.mdx';
import { metadata as cursorForVibeTrading } from './traderalice-cursor-for-vibe-trading/index.mdx';
import { metadata as openaliceOpenSource } from './openalice-we-open-source-traderalice/index.mdx';
import { metadata as whatIsUta } from './openalice-what-is-uta-unified-trading-account/index.mdx';

export interface PostMetadata {
  title: string;
  description: string;
  date: string;
  author: string;
  slug: string;
}

export const posts: PostMetadata[] = [
  { slug: 'trading-as-git-intro', ...tradingAsGitIntro },
  { slug: 'traderalice-cursor-for-vibe-trading', ...cursorForVibeTrading },
  { slug: 'openalice-we-open-source-traderalice', ...openaliceOpenSource },
  { slug: 'openalice-what-is-uta-unified-trading-account', ...whatIsUta },
];
