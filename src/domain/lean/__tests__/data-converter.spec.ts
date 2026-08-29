import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import {
  convertForexQuotesToLeanFormat,
  createZipArchive,
  ensureMarketHoursDatabase,
  ensureSymbolPropertiesDatabase
} from "../data-converter.js";

describe("createZipArchive", () => {
  it("creates valid PKZIP buffer with deflate compression", () => {
    const csvContent = "0,1.08500,1.08520,1.08495,1.08510,0,1.08515,1.08535,1.08510,1.08525,0\n";
    const buf = createZipArchive([
      { name: "20240102_quote.csv", content: csvContent }
    ]);
    expect(buf.length).toBeGreaterThan(30);

    // Check PKZIP local file header signature 0x04034b50
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);

    // Read filename length from local header
    const nameLen = buf.readUInt16LE(26);
    const compSize = buf.readUInt32LE(18);
    const fileName = buf.subarray(30, 30 + nameLen).toString("utf8");
    expect(fileName).toBe("20240102_quote.csv");

    // Decompress the payload to verify deflation integrity
    const compressedData = buf.subarray(30 + nameLen, 30 + nameLen + compSize);
    const decompressed = inflateRawSync(compressedData).toString("utf8");
    expect(decompressed).toBe(csvContent);
  });

  it("handles multiple files in a single archive", () => {
    const buf = createZipArchive([
      { name: "file1.txt", content: "Hello" },
      { name: "file2.txt", content: "World" }
    ]);
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
  });
});

describe("ensureMarketHoursDatabase & ensureSymbolPropertiesDatabase", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lean-db-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("seeds market hours and does not overwrite existing file", async () => {
    const path = await ensureMarketHoursDatabase(tempDir);
    expect(existsSync(path)).toBe(true);

    const initialContent = await readFile(path, "utf8");
    const parsed = JSON.parse(initialContent);
    expect(parsed.entries["Forex-oanda"]).toBeDefined();

    // Modify file and re-run to verify non-destructive behavior
    await writeFile(path, '{"custom": true}', "utf8");
    await ensureMarketHoursDatabase(tempDir);
    const contentAfter = await readFile(path, "utf8");
    expect(contentAfter).toBe('{"custom": true}');
  });

  it("seeds symbol properties and does not overwrite existing file", async () => {
    const path = await ensureSymbolPropertiesDatabase(tempDir);
    expect(existsSync(path)).toBe(true);

    const initialContent = await readFile(path, "utf8");
    expect(initialContent).toContain("oanda,eurusd,forex");

    // Modify file and re-run
    await writeFile(path, "custom,data\n", "utf8");
    await ensureSymbolPropertiesDatabase(tempDir);
    const contentAfter = await readFile(path, "utf8");
    expect(contentAfter).toBe("custom,data\n");
  });
});

describe("convertForexQuotesToLeanFormat", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lean-data-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("converts minute quotes to {YYYYMMDD}_quote.zip across multiple days", async () => {
    const quotes = [
      {
        timestamp: "2024-01-02T00:00:00.000Z",
        bidOpen: 1.08500, bidHigh: 1.08520, bidLow: 1.08495, bidClose: 1.08510,
        askOpen: 1.08515, askHigh: 1.08535, askLow: 1.08510, askClose: 1.08525
      },
      {
        timestamp: "2024-01-02T00:01:00.000Z",
        bidOpen: 1.08510, bidHigh: 1.08530, bidLow: 1.08505, bidClose: 1.08520,
        askOpen: 1.08525, askHigh: 1.08545, askLow: 1.08520, askClose: 1.08535
      },
      {
        timestamp: "2024-01-03T00:00:00.000Z",
        bidOpen: 1.08600, bidHigh: 1.08620, bidLow: 1.08595, bidClose: 1.08610,
        askOpen: 1.08615, askHigh: 1.08635, askLow: 1.08610, askClose: 1.08625
      },
      {
        timestamp: "invalid-date",
        bidOpen: 1.0, bidHigh: 1.0, bidLow: 1.0, bidClose: 1.0,
        askOpen: 1.0, askHigh: 1.0, askLow: 1.0, askClose: 1.0
      }
    ];

    const result = await convertForexQuotesToLeanFormat(quotes, {
      market: "oanda",
      symbol: "EURUSD",
      resolution: "minute",
      dataDir: tempDir
    });

    expect(result.symbol).toBe("eurusd");
    expect(result.market).toBe("oanda");
    expect(result.resolution).toBe("minute");
    expect(result.totalQuotes).toBe(4);
    expect(result.daysProcessed).toBe(2);
    expect(result.filesWritten).toHaveLength(2);

    expect(existsSync(result.filesWritten[0])).toBe(true);
    expect(existsSync(result.filesWritten[1])).toBe(true);

    // Verify zip buffer contains valid CSV content
    const zipBuf = await readFile(result.filesWritten[0]);
    const nameLen = zipBuf.readUInt16LE(26);
    const compSize = zipBuf.readUInt32LE(18);
    const rawCompressed = zipBuf.subarray(30 + nameLen, 30 + nameLen + compSize);
    const csvStr = inflateRawSync(rawCompressed).toString("utf8");
    const lines = csvStr.trim().split("\n");

    expect(lines).toHaveLength(2);
    // Line 1 should start with 0 ms
    expect(lines[0].startsWith("0,1.08500,1.08520,1.08495,1.08510,0,1.08515,1.08535,1.08510,1.08525,0")).toBe(true);
    // Line 2 should start with 60000 ms
    expect(lines[1].startsWith("60000,1.08510,1.08530,1.08505,1.08520,0,1.08525,1.08545,1.08520,1.08535,0")).toBe(true);
  });

  it("sanitizes inverted spreads when sanitizeInvertedSpreads: true", async () => {
    const quotes = [
      {
        timestamp: "2024-01-02T00:00:00.000Z",
        bidOpen: 1.08550, bidHigh: 1.08560, bidLow: 1.08540, bidClose: 1.08550,
        askOpen: 1.08500, askHigh: 1.08510, askLow: 1.08490, askClose: 1.08500 // Inverted (ask < bid)
      }
    ];

    const result = await convertForexQuotesToLeanFormat(quotes, {
      market: "oanda",
      symbol: "EURUSD",
      dataDir: tempDir,
      sanitizeInvertedSpreads: true
    });

    expect(result.daysProcessed).toBe(1);
    const zipBuf = await readFile(result.filesWritten[0]);
    const nameLen = zipBuf.readUInt16LE(26);
    const compSize = zipBuf.readUInt32LE(18);
    const rawCompressed = zipBuf.subarray(30 + nameLen, 30 + nameLen + compSize);
    const csvStr = inflateRawSync(rawCompressed).toString("utf8");
    const line = csvStr.trim();

    // Ask prices should have been raised to equal bid prices
    expect(line).toBe("0,1.08550,1.08560,1.08540,1.08550,0,1.08550,1.08560,1.08540,1.08550,0");
  });
});
