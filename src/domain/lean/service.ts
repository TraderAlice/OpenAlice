import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { generateLeanConfig } from "./config-gen.js";
import { convertForexQuotesToLeanFormat, ensureMarketHoursDatabase, ensureSymbolPropertiesDatabase } from "./data-converter.js";
import { parseLeanResults } from "./results.js";
import type {
  BacktestRequest,
  BacktestResult,
  BacktestSummary,
  ConversionResult,
  ForexQuote,
  LeanConfig
} from "./types.js";

export const DEFAULT_LEAN_CONFIG: LeanConfig = {
  enabled: false,
  dockerImage: "quantconnect/lean:latest",
  dataDir: "data/lean/data",
  algorithmsDir: "data/lean/algorithms",
  runsDir: "data/lean/runs",
  experimentsDir: "data/lean/experiments",
  journalDir: "data/lean/journal",
  algorithmLanguage: "Python",
  maxConcurrentBacktests: 2,
  defaultCash: 100000,
  defaultBrokerage: "oanda",
  defaultTimeoutSeconds: 300,
  memoryLimit: "4g",
  cpuLimit: "2.0"
};

export interface LeanServiceOptions {
  config?: Partial<LeanConfig>;
  projectRoot?: string;
  force?: boolean;
}

export class LeanService {
  private readonly config: LeanConfig;
  private readonly root: string;

  constructor(config: LeanConfig, projectRoot: string = process.cwd()) {
    this.config = config;
    this.root = projectRoot;
  }

  static async create(options: LeanServiceOptions = {}): Promise<LeanService | null> {
    const root = options.projectRoot ?? process.cwd();
    const configPath = join(root, "data/config/lean.json");

    let loadedConfig: Partial<LeanConfig> = {};
    if (existsSync(configPath)) {
      try {
        const raw = await readFile(configPath, "utf8");
        loadedConfig = JSON.parse(raw);
      } catch {
        // Fallback to default
      }
    }

    const merged: LeanConfig = {
      ...DEFAULT_LEAN_CONFIG,
      ...loadedConfig,
      ...options.config
    };

    if (!merged.enabled && !options.force) {
      return null;
    }

    const service = new LeanService(merged, root);
    await service.ensureDataDirs();
    return service;
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  get dataPath(): string {
    return resolve(this.root, this.config.dataDir);
  }

  get runsPath(): string {
    return resolve(this.root, this.config.runsDir);
  }

  get algorithmsPath(): string {
    return resolve(this.root, this.config.algorithmsDir);
  }

  async ensureDataDirs(): Promise<void> {
    await mkdir(this.dataPath, { recursive: true });
    await mkdir(this.runsPath, { recursive: true });
    await mkdir(this.algorithmsPath, { recursive: true });
    await mkdir(resolve(this.root, this.config.experimentsDir), { recursive: true });
    await mkdir(resolve(this.root, this.config.journalDir), { recursive: true });

    await ensureMarketHoursDatabase(this.dataPath);
    await ensureSymbolPropertiesDatabase(this.dataPath);
  }

  async ingestForexQuotes(
    symbol: string,
    quotes: ForexQuote[],
    market = "oanda",
    resolution: "minute" | "daily" = "minute"
  ): Promise<ConversionResult> {
    return convertForexQuotesToLeanFormat(quotes, {
      market,
      symbol,
      resolution,
      dataDir: this.dataPath,
      sanitizeInvertedSpreads: true
    });
  }

  async checkDocker(): Promise<{ available: boolean; version?: string; error?: string }> {
    return new Promise((res) => {
      const p = spawn("docker", ["--version"]);
      let out = "";
      let err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("close", (code) => {
        if (code === 0) res({ available: true, version: out.trim() });
        else res({ available: false, error: err.trim() || `exit code ${code}` });
      });
      p.on("error", (e) => res({ available: false, error: e.message }));
    });
  }

  async runBacktest(request: BacktestRequest): Promise<BacktestResult> {
    const timestamp = Date.now();
    const shortId = Math.random().toString(36).substring(2, 8);
    const backtestId = `bt_${timestamp}_${shortId}`;

    const runDir = join(this.runsPath, backtestId);
    const resultsDir = join(runDir, "results");
    await mkdir(resultsDir, { recursive: true });

    const algoFile = join(runDir, "main.py");
    if (request.pythonCode) {
      await writeFile(algoFile, request.pythonCode, "utf8");
    } else if (request.strategyId) {
      const existing = join(this.algorithmsPath, `${request.strategyId}.py`);
      if (existsSync(existing)) {
        const code = await readFile(existing, "utf8");
        await writeFile(algoFile, code, "utf8");
      }
    }

    const configObj = generateLeanConfig({
      algorithmLocation: "/Lean/Algorithm.Python/main.py",
      algorithmTypeName: request.strategyName || "ForexStrategy",
      dataFolder: "/Lean/Data",
      resultsDestinationFolder: "/Results",
      parameters: request.parameters
    });

    const configFile = join(runDir, "config.json");
    await writeFile(configFile, JSON.stringify(configObj, null, 2), "utf8");

    const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
    const gid = typeof process.getgid === "function" ? process.getgid() : 1000;

    const dockerArgs = [
      "run",
      "--rm",
      "--name", `lean-${backtestId}`,
      "--user", `${uid}:${gid}`,
      "--memory", this.config.memoryLimit ?? "4g",
      "--cpus", this.config.cpuLimit ?? "2.0",
      "-v", `${this.dataPath}:/Lean/Data:ro`,
      "-v", `${runDir}:/Lean/Algorithm.Python:ro`,
      "-v", `${configFile}:/Lean/Launcher/bin/Debug/config.json:ro`,
      "-v", `${resultsDir}:/Results:rw`,
      this.config.dockerImage,
      "--data-folder", "/Lean/Data",
      "--results-destination-folder", "/Results",
      "--config", "/Lean/Launcher/bin/Debug/config.json"
    ];

    const startedAt = new Date().toISOString();
    const timeoutMs = (request.timeoutSeconds ?? this.config.defaultTimeoutSeconds) * 1000;

    const { exitCode, stdout, stderr, timedOut } = await this.executeSubprocess("docker", dockerArgs, timeoutMs, `lean-${backtestId}`);
    const completedAt = new Date().toISOString();
    const logs = `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`;

    if (timedOut) {
      const res: BacktestResult = {
        id: backtestId,
        request,
        status: "timeout",
        startedAt,
        completedAt,
        durationMs: timeoutMs,
        exitCode: -1,
        logs,
        error: `Backtest timed out after ${timeoutMs / 1000}s`,
        charts: {},
        orders: [],
        closedTrades: [],
        runDir
      };
      await writeFile(join(runDir, "summary.json"), JSON.stringify(res, null, 2), "utf8");
      return res;
    }

    // Discover result JSON in resultsDir
    let resultJsonContent = "";
    if (existsSync(resultsDir)) {
      const files = await readdir(resultsDir);
      const jsonFile = files.find((f) => f.endsWith(".json") && !f.includes("config"));
      if (jsonFile) {
        resultJsonContent = await readFile(join(resultsDir, jsonFile), "utf8");
      }
    }

    let parsed = parseLeanResults(
      resultJsonContent || "{}",
      backtestId,
      request,
      { startedAt, completedAt, exitCode, logs }
    );
    parsed.runDir = runDir;

    if (exitCode !== 0 && !parsed.error) {
      parsed.error = `LEAN engine exited with code ${exitCode}`;
      parsed.status = "failed";
    }

    await writeFile(join(runDir, "summary.json"), JSON.stringify(parsed, null, 2), "utf8");
    return parsed;
  }

  async getBacktest(backtestId: string): Promise<BacktestResult | null> {
    const summaryFile = join(this.runsPath, backtestId, "summary.json");
    if (!existsSync(summaryFile)) return null;
    try {
      const data = await readFile(summaryFile, "utf8");
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async listBacktests(): Promise<BacktestSummary[]> {
    if (!existsSync(this.runsPath)) return [];
    const entries = await readdir(this.runsPath, { withFileTypes: true });
    const summaries: BacktestSummary[] = [];

    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const summaryFile = join(this.runsPath, ent.name, "summary.json");
      if (existsSync(summaryFile)) {
        try {
          const res: BacktestResult = JSON.parse(await readFile(summaryFile, "utf8"));
          summaries.push({
            id: res.id,
            strategyName: res.request.strategyName,
            symbol: res.request.symbol,
            startDate: res.request.startDate,
            endDate: res.request.endDate,
            status: res.status,
            startedAt: res.startedAt,
            completedAt: res.completedAt,
            netProfit: res.statistics?.netProfit,
            sharpeRatio: res.statistics?.sharpeRatio,
            drawdown: res.statistics?.drawdown,
            totalTrades: res.statistics?.totalTrades
          });
        } catch {
          // ignore corrupted summary
        }
      }
    }

    return summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  private executeSubprocess(
    cmd: string,
    args: string[],
    timeoutMs: number,
    containerName: string
  ): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
    return new Promise((res) => {
      const child = spawn(cmd, args);
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        spawn("docker", ["kill", containerName]);
        child.kill("SIGKILL");
      }, timeoutMs);

      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));

      child.on("close", (code) => {
        clearTimeout(timer);
        res({ exitCode: code ?? (timedOut ? -1 : 0), stdout, stderr, timedOut });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        res({ exitCode: -1, stdout, stderr: `${stderr}\n${err.message}`, timedOut });
      });
    });
  }
}
