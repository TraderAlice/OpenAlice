import type { NewsItem } from '../data/interfaces';

/**
 * Context for News tools
 */
export interface NewsToolContext {
  getNews: () => Promise<NewsItem[]>;
}

/**
 * globNews return result
 */
export interface GlobNewsResult {
  index: number;
  title: string;
  contentLength: number;
  metadata: string; // Truncated to 40 characters
}

/**
 * grepNews return result
 */
export interface GrepNewsResult {
  index: number;
  title: string;
  matchedText: string; // Matched context
  contentLength: number;
  metadata: string; // Truncated to 40 characters
}

/**
 * Truncate metadata to a specified length
 */
function truncateMetadata(
  metadata: Record<string, string | null>,
  maxLength: number = 40,
): string {
  const str = JSON.stringify(metadata);
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Check if metadata contains the specified key-value pairs
 */
function matchesMetadataFilter(
  metadata: Record<string, string | null>,
  filter: Record<string, string>,
): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (metadata[key] !== value) return false;
  }
  return true;
}

/**
 * globNews - Match news by title regex
 *
 * Similar to glob/ls, returns a list of matching news indices
 */
export async function globNews(
  context: NewsToolContext,
  options: {
    pattern: string; // Regular expression
    metadataFilter?: Record<string, string>; // Metadata filter criteria
    limit?: number; // Maximum number of results
  },
): Promise<GlobNewsResult[]> {
  const news = await context.getNews();
  const regex = new RegExp(options.pattern, 'i'); // Case-insensitive by default

  const results: GlobNewsResult[] = [];

  for (let i = 0; i < news.length; i++) {
    const item = news[i];

    // Metadata filtering
    if (
      options.metadataFilter &&
      !matchesMetadataFilter(item.metadata, options.metadataFilter)
    ) {
      continue;
    }

    // Title regex matching
    if (!regex.test(item.title)) {
      continue;
    }

    results.push({
      index: i,
      title: item.title,
      contentLength: item.content.length,
      metadata: truncateMetadata(item.metadata),
    });

    if (options.limit && results.length >= options.limit) {
      break;
    }
  }

  return results;
}

/**
 * grepNews - Search news by content/title regex
 *
 * Similar to grep -C, returns matched context
 */
export async function grepNews(
  context: NewsToolContext,
  options: {
    pattern: string; // Regular expression
    contextChars?: number; // Number of context characters around match (before and after), default 50
    metadataFilter?: Record<string, string>; // Metadata filter criteria
    limit?: number; // Maximum number of results
  },
): Promise<GrepNewsResult[]> {
  const news = await context.getNews();
  const regex = new RegExp(options.pattern, 'gi'); // Global + case-insensitive
  const contextChars = options.contextChars ?? 50;

  const results: GrepNewsResult[] = [];

  for (let i = 0; i < news.length; i++) {
    const item = news[i];

    // Metadata filtering
    if (
      options.metadataFilter &&
      !matchesMetadataFilter(item.metadata, options.metadataFilter)
    ) {
      continue;
    }

    // Search in title and content
    const searchText = `${item.title}\n${item.content}`;
    const match = regex.exec(searchText);

    if (!match) {
      continue;
    }

    // Extract matched context
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    const contextStart = Math.max(0, matchStart - contextChars);
    const contextEnd = Math.min(searchText.length, matchEnd + contextChars);

    let matchedText = '';
    if (contextStart > 0) matchedText += '...';
    matchedText += searchText.slice(contextStart, contextEnd);
    if (contextEnd < searchText.length) matchedText += '...';

    results.push({
      index: i,
      title: item.title,
      matchedText,
      contentLength: item.content.length,
      metadata: truncateMetadata(item.metadata),
    });

    // Reset regex lastIndex (because g flag is used)
    regex.lastIndex = 0;

    if (options.limit && results.length >= options.limit) {
      break;
    }
  }

  return results;
}

/**
 * readNews - Read full news content by index
 *
 * Similar to cat, reads the complete content
 */
export async function readNews(
  context: NewsToolContext,
  options: {
    index: number; // News index
  },
): Promise<NewsItem | null> {
  const news = await context.getNews();

  if (options.index < 0 || options.index >= news.length) {
    return null;
  }

  return news[options.index];
}
