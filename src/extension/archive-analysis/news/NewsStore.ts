import type {
  INewsProvider,
  NewsItem,
  GetNewsV2Options,
} from '../data/interfaces';

/**
 * News data store with time isolation.
 *
 * Wraps an INewsProvider and enforces that all queries
 * are bounded by playheadTime (cannot see future news).
 */
export class NewsStore {
  private playheadTime: Date;
  private newsProvider: INewsProvider;

  constructor(newsProvider: INewsProvider) {
    this.playheadTime = new Date();
    this.newsProvider = newsProvider;
  }

  // ==================== Time management ====================

  getPlayheadTime(): Date {
    return new Date(this.playheadTime);
  }

  setPlayheadTime(time: Date): void {
    this.playheadTime = new Date(time);
  }

  // ==================== News ====================

  async getNewsV2(options: Omit<GetNewsV2Options, 'endTime'>): Promise<NewsItem[]> {
    return await this.newsProvider.getNewsV2({
      ...options,
      endTime: this.playheadTime,
    });
  }
}
