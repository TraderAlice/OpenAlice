/**
 * Crypto Trading Engine Factory
 *
 * Instantiate the corresponding crypto trading engine provider based on config
 */

import type { ICryptoTradingEngine } from './interfaces';
import type { Config } from '../../core/config';
import { CcxtTradingEngine } from './providers/ccxt/index';

export interface CryptoTradingEngineResult {
  engine: ICryptoTradingEngine;
  close: () => Promise<void>;
}

const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 2_000; // 2s, 4s, 8s, 16s, 32s

/**
 * Create a crypto trading engine
 *
 * @returns engine instance, or null (provider = 'none')
 */
export async function createCryptoTradingEngine(
  config: Config,
): Promise<CryptoTradingEngineResult | null> {
  const providerConfig = config.crypto.provider;

  switch (providerConfig.type) {
    case 'none':
      return null;

    case 'ccxt': {
      const apiKey = providerConfig.apiKey;
      const apiSecret = providerConfig.apiSecret;
      const password = providerConfig.password;

      if (!apiKey || !apiSecret) {
        throw new Error(
          'apiKey and apiSecret must be configured for CCXT provider (Settings → Crypto Trading)',
        );
      }

      const engine = new CcxtTradingEngine({
        exchange: providerConfig.exchange,
        apiKey,
        apiSecret,
        password,
        sandbox: providerConfig.sandbox,
        demoTrading: providerConfig.demoTrading,
        defaultMarketType: providerConfig.defaultMarketType,
        allowedSymbols: config.crypto.allowedSymbols,
        options: providerConfig.options,
      });

      await initWithRetry(engine, providerConfig.exchange);

      return {
        engine,
        close: () => engine.close(),
      };
    }

    default:
      throw new Error(`Unknown crypto trading provider: ${(providerConfig as { type: string }).type}`);
  }
}

async function initWithRetry(engine: CcxtTradingEngine, exchangeName: string): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await engine.init();
      if (attempt > 1) {
        console.log(`ccxt(${exchangeName}): connected after ${attempt} attempts`);
      }
      return;
    } catch (err) {
      const isLast = attempt === MAX_RETRIES;
      const delayMs = BACKOFF_BASE_MS * 2 ** (attempt - 1);

      if (isLast) {
        console.error(`ccxt(${exchangeName}): init failed after ${MAX_RETRIES} attempts, giving up`);
        throw err;
      }

      console.warn(
        `ccxt(${exchangeName}): init attempt ${attempt}/${MAX_RETRIES} failed — ${err instanceof Error ? err.message : err}. Retrying in ${delayMs / 1000}s...`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
