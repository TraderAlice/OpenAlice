import { crc32, deflateRawSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ConversionResult, ForexDataConversionOptions, ForexQuote } from "./types.js";

export function createZipArchive(files: Array<{ name: string; content: string | Buffer }>): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuffer = Buffer.from(file.name, "utf8");
    const contentBuffer = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, "utf8");
    const uncompressedSize = contentBuffer.length;
    const crc = crc32(contentBuffer);
    const compressedData = deflateRawSync(contentBuffer);
    const compressedSize = compressedData.length;

    const dosTime = 0;
    const dosDate = 0x5821; // 2024-01-01

    // Local Header (30 bytes + name length)
    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuffer.copy(localHeader, 30);

    localHeaders.push(localHeader, compressedData);

    // Central Directory Header (46 bytes + name length)
    const centralHeader = Buffer.alloc(46 + nameBuffer.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuffer.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);
    offset += localHeader.length + compressedSize;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const h of centralHeaders) centralDirSize += h.length;

  // End of Central Directory (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

export async function ensureMarketHoursDatabase(dataDir: string): Promise<string> {
  const dir = join(dataDir, "market-hours");
  await mkdir(dir, { recursive: true });
  const target = join(dir, "market-hours-database.json");

  if (!existsSync(target)) {
    const marketHours = {
      entries: {
        "Forex-oanda": {
          dataTimeZone: "UTC",
          exchangeTimeZone: "America/New_York",
          sunday: [{ start: "17:00:00", end: "24:00:00", state: "open" }],
          monday: [{ start: "00:00:00", end: "24:00:00", state: "open" }],
          tuesday: [{ start: "00:00:00", end: "24:00:00", state: "open" }],
          wednesday: [{ start: "00:00:00", end: "24:00:00", state: "open" }],
          thursday: [{ start: "00:00:00", end: "24:00:00", state: "open" }],
          friday: [{ start: "00:00:00", end: "17:00:00", state: "open" }],
          saturday: [],
          holidays: []
        },
        "Forex-fxcm": {
          dataTimeZone: "UTC",
          exchangeTimeZone: "America/New_York",
          sunday: [{ start: "17:00:00", end: "24:00:00", state: "open" }],
          monday: [{ start: "00:00:00", end: "24:00:00", state: "open" }],
          tuesday: [{ start: "00:00:00", end: "24:00:00", state: "open" }],
          wednesday: [{ start: "00:00:00", end: "24:00:00", state: "open" }],
          thursday: [{ start: "00:00:00", end: "24:00:00", state: "open" }],
          friday: [{ start: "00:00:00", end: "17:00:00", state: "open" }],
          saturday: [],
          holidays: []
        }
      }
    };
    await writeFile(target, JSON.stringify(marketHours, null, 2), "utf8");
  }
  return target;
}

export async function ensureSymbolPropertiesDatabase(dataDir: string): Promise<string> {
  const dir = join(dataDir, "symbol-properties");
  await mkdir(dir, { recursive: true });
  const target = join(dir, "symbol-properties-database.csv");

  if (!existsSync(target)) {
    const lines = [
      "market,symbol,securitytype,description,quote_currency,contract_multiplier,minimum_price_variation,lot_size,market_ticker,minimum_order_size,price_magnifier,strike_multiplier",
      "oanda,eurusd,forex,EUR/USD,USD,1,0.0001,1,EUR_USD,1,1,1",
      "oanda,gbpusd,forex,GBP/USD,USD,1,0.0001,1,GBP_USD,1,1,1",
      "oanda,usdjpy,forex,USD/JPY,JPY,1,0.01,1,USD_JPY,1,1,1",
      "oanda,audusd,forex,AUD/USD,USD,1,0.0001,1,AUD_USD,1,1,1",
      "oanda,usdcad,forex,USD/CAD,CAD,1,0.0001,1,USD_CAD,1,1,1",
      "oanda,usdchf,forex,USD/CHF,CHF,1,0.0001,1,USD_CHF,1,1,1",
      "oanda,nzdusd,forex,NZD/USD,USD,1,0.0001,1,NZD_USD,1,1,1",
      "fxcm,eurusd,forex,EUR/USD,USD,1,0.0001,1000,EUR/USD,1000,1,1",
      "fxcm,gbpusd,forex,GBP/USD,USD,1,0.0001,1000,GBP/USD,1000,1,1",
      "fxcm,usdjpy,forex,USD/JPY,JPY,1,0.01,1000,USD/JPY,1000,1,1"
    ];
    await writeFile(target, lines.join("\n") + "\n", "utf8");
  }
  return target;
}

export async function convertForexQuotesToLeanFormat(
  quotes: ForexQuote[],
  options: ForexDataConversionOptions
): Promise<ConversionResult> {
  const market = (options.market ?? "oanda").toLowerCase();
  const symbol = options.symbol.toLowerCase();
  const resolution = options.resolution ?? "minute";

  await ensureMarketHoursDatabase(options.dataDir);
  await ensureSymbolPropertiesDatabase(options.dataDir);

  const targetDir = join(options.dataDir, "forex", market, resolution, symbol);
  await mkdir(targetDir, { recursive: true });

  // Group quotes by UTC date YYYYMMDD
  const grouped = new Map<string, Array<{ ms: number; quote: ForexQuote }>>();

  for (const q of quotes) {
    const d = new Date(q.timestamp);
    if (isNaN(d.getTime())) continue;

    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const dateKey = `${yyyy}${mm}${dd}`;

    const ms = d.getUTCHours() * 3600000 + d.getUTCMinutes() * 60000 + d.getUTCSeconds() * 1000 + d.getUTCMilliseconds();

    let askOpen = q.askOpen;
    let askHigh = q.askHigh;
    let askLow = q.askLow;
    let askClose = q.askClose;

    if (options.sanitizeInvertedSpreads) {
      if (askOpen < q.bidOpen) askOpen = q.bidOpen;
      if (askHigh < q.bidHigh) askHigh = q.bidHigh;
      if (askLow < q.bidLow) askLow = q.bidLow;
      if (askClose < q.bidClose) askClose = q.bidClose;
    }

    const sanitizedQuote: ForexQuote = {
      ...q,
      askOpen,
      askHigh,
      askLow,
      askClose
    };

    if (!grouped.has(dateKey)) {
      grouped.set(dateKey, []);
    }
    grouped.get(dateKey)!.push({ ms, quote: sanitizedQuote });
  }

  const filesWritten: string[] = [];

  for (const [dateKey, dayEntries] of grouped.entries()) {
    dayEntries.sort((a, b) => a.ms - b.ms);

    const lines = dayEntries.map(({ ms, quote }) => {
      return [
        ms,
        quote.bidOpen.toFixed(5),
        quote.bidHigh.toFixed(5),
        quote.bidLow.toFixed(5),
        quote.bidClose.toFixed(5),
        quote.bidSize ?? 0,
        quote.askOpen.toFixed(5),
        quote.askHigh.toFixed(5),
        quote.askLow.toFixed(5),
        quote.askClose.toFixed(5),
        quote.askSize ?? 0
      ].join(",");
    });

    const csvContent = lines.join("\n") + "\n";
    const zipName = `${dateKey}_quote.zip`;
    const csvName = `${dateKey}_quote.csv`;

    const zipBuffer = createZipArchive([{ name: csvName, content: csvContent }]);
    const zipPath = join(targetDir, zipName);
    await writeFile(zipPath, zipBuffer);
    filesWritten.push(zipPath);
  }

  return {
    symbol,
    market,
    resolution,
    totalQuotes: quotes.length,
    daysProcessed: grouped.size,
    filesWritten
  };
}
