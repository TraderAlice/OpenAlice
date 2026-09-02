import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { generateLeanConfig } from "./config-gen.js";
import { convertForexQuotesToLeanFormat, ensureMarketHoursDatabase, ensureSymbolPropertiesDatabase } from "./data-converter.js";
import { writeLeanCliConfig } from "./lean-cli-template.js";
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

  /** The executor the service will prefer for engine runs: native LEAN CLI when
   * present, otherwise the internal Docker runner. */
  async resolveExecutor(): Promise<"lean-cli" | "docker"> {
    const cli = await this.checkLeanCli();
    return cli.available ? "lean-cli" : "docker";
  }

  get tmpPath(): string {
    return resolve(this.root, "data/lean/tmp");
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

  async checkLeanCli(): Promise<{ available: boolean; version?: string; error?: string }> {
    return new Promise((res) => {
      const p = spawn("lean", ["--version"]);
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

    const executor = await this.resolveExecutor();
    if (executor === "lean-cli") {
      return this.runBacktestViaCli(request, backtestId, runDir, resultsDir, algoFile);
    }
    return this.runBacktestViaDocker(request, backtestId, runDir, resultsDir, algoFile);
  }

  /**
   * Managed backtest executed through the native QuantConnect `lean` CLI.
   * A per-run project folder (lean.json + algorithm file) is scaffolded under
   * the run directory; the CLI launches the engine container, and the engine
   * output is written into `--output` (the run's results dir).
   */
  private async runBacktestViaCli(
    request: BacktestRequest,
    backtestId: string,
    runDir: string,
    resultsDir: string,
    algoFile: string
  ): Promise<BacktestResult> {
    const projectDir = join(runDir, "project");
    await mkdir(projectDir, { recursive: true });

    // The LEAN CLI resolves the algorithm of a directory project from
    // main.py / Main.cs; the engine derives the algorithm type name from the
    // file stem ("main"), while the user-facing name comes from the request.
    const algoName = "main.py";
    if (existsSync(algoFile)) {
      await copyFile(algoFile, join(projectDir, algoName));
    }

    const leanConfig = writeLeanCliConfig({
      algorithmFileName: algoName,
      dataFolder: this.dataPath,
      startDate: request.startDate,
      endDate: request.endDate,
      cashAmount: String(this.config.defaultCash ?? 100000),
      parameters: request.parameters
    });
    await writeFile(join(projectDir, "lean.json"), JSON.stringify(leanConfig, null, 2), "utf8");

    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const timeoutMs = (request.timeoutSeconds ?? this.config.defaultTimeoutSeconds) * 1000;
    const tmpDir = this.tmpPath;
    await mkdir(tmpDir, { recursive: true });

    const { exitCode, stdout, stderr, timedOut } = await this.executeSubprocess(
      "lean",
      ["backtest", ".", "--output", resultsDir, "--image", this.config.dockerImage, "--no-update"],
      timeoutMs,
      {
        cwd: projectDir,
        env: { ...process.env, TMPDIR: tmpDir },
        onTimeout: () => {
          void this.sweepEngineContainers(this.config.dockerImage, startedMs);
        }
      }
    );
    const completedAt = new Date().toISOString();

    const engineLogPath = join(resultsDir, "log.txt");
    let engineLog = "";
    if (existsSync(engineLogPath)) {
      try {
        engineLog = (await readFile(engineLogPath, "utf8")).slice(-100_000);
      } catch {
        // engine log is auxiliary; ignore read failures
      }
    }
    const logs = `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}${engineLog ? `\n\nENGINE LOG:\n${engineLog}` : ""}`;

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

    // Discover the engine result JSONs. The CLI writes both the full result
    // (`<id>.json`: orders, charts, closed trades, total performance) and a
    // `*-summary.json` (the display Statistics dictionary). The full result is
    // preferred; the summary's Statistics are merged over it because the full
    // result may ship an empty statistics dictionary.
    let resultJsonContent = "";
    if (existsSync(resultsDir)) {
      const files = await readdir(resultsDir);
      const jsonFiles = files.filter((f) => f.endsWith(".json") && !f.includes("config"));
      const summaryFiles = jsonFiles.filter((f) => f.toLowerCase().includes("summary"));
      const fullFiles = jsonFiles.filter(
        (f) => !f.toLowerCase().includes("summary") && !f.includes("order-events") && !f.includes("data-monitor")
      );
      const fullFile =
        fullFiles.find((f) => /^\d+\.json$/.test(f)) ?? fullFiles.sort()[0];
      const summaryFile = summaryFiles.sort()[0];
      if (fullFile) {
        resultJsonContent = await readFile(join(resultsDir, fullFile), "utf8");
      }
      if (summaryFile) {
        try {
          const fullParsed = JSON.parse(resultJsonContent || "{}");
          const summaryParsed = JSON.parse(await readFile(join(resultsDir, summaryFile), "utf8"));
          const fullStats = fullParsed?.statistics ?? fullParsed?.Statistics ?? {};
          const summaryStats = summaryParsed?.statistics ?? summaryParsed?.Statistics ?? {};
          const mergedStats = { ...summaryStats, ...fullStats };
          if (summaryParsed?.statistics && fullParsed?.statistics) {
            fullParsed.statistics = mergedStats;
          } else if (summaryParsed?.Statistics && fullParsed?.Statistics) {
            fullParsed.Statistics = mergedStats;
          }
          resultJsonContent = JSON.stringify(fullParsed);
        } catch {
          // merge is best-effort; keep the full result as parsed
        }
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
      const hasSubstance =
        Object.keys(parsed.statistics?.raw ?? {}).length > 0 ||
        parsed.orders.length > 0 ||
        parsed.closedTrades.length > 0 ||
        Object.values(parsed.charts).some((chart) => chart.values.length > 0);
      if (hasSubstance) {
        // The engine completed and produced results; a non-zero exit code
        // often signals data-quality warnings (e.g. failed data requests).
        parsed.status = "completed";
        parsed.error = `LEAN engine completed with exit code ${exitCode} (data-quality warnings may be present in the run logs)`;
      } else {
        parsed.error = `LEAN engine exited with code ${exitCode}`;
        parsed.status = "failed";
      }
    }

    await writeFile(join(runDir, "summary.json"), JSON.stringify(parsed, null, 2), "utf8");
    return parsed;
  }

  /**
   * Managed backtest executed through OpenAlice's internal Docker runner.
   * Used as a fallback when the native LEAN CLI is not installed.
   */
  private async runBacktestViaDocker(
    request: BacktestRequest,
    backtestId: string,
    runDir: string,
    resultsDir: string,
    algoFile: string
  ): Promise<BacktestResult> {
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

    const { exitCode, stdout, stderr, timedOut } = await this.executeSubprocess(
      "docker",
      dockerArgs,
      timeoutMs,
      {
        onTimeout: () => {
          spawn("docker", ["kill", `lean-${backtestId}`]);
        }
      }
    );
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
      const hasSubstance =
        Object.keys(parsed.statistics?.raw ?? {}).length > 0 ||
        parsed.orders.length > 0 ||
        parsed.closedTrades.length > 0 ||
        Object.values(parsed.charts).some((chart) => chart.values.length > 0);
      if (hasSubstance) {
        parsed.status = "completed";
        parsed.error = `LEAN engine completed with exit code ${exitCode} (data-quality warnings may be present in the run logs)`;
      } else {
        parsed.error = `LEAN engine exited with code ${exitCode}`;
        parsed.status = "failed";
      }
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

  /**
   * Kills engine containers created during the run window that match the
   * engine image. The LEAN CLI names its containers after a random uuid, so
   * the sweep identifies them by image ancestor + creation time.
   */
  private async sweepEngineContainers(image: string, sinceMs: number): Promise<void> {
    try {
      const listing = await this.executeSubprocess(
        "docker",
        ["ps", "-a", "-q", "--filter", `ancestor=${image}`],
        15000
      );
      const ids = listing.stdout
        .trim()
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const id of ids) {
        const createdRaw = await this.executeSubprocess("docker", ["inspect", "-f", "{{.Created}}", id], 15000);
        const createdMs = Date.parse(createdRaw.stdout.trim());
        if (isNaN(createdMs) || createdMs >= sinceMs) {
          await this.executeSubprocess("docker", ["rm", "-f", id], 15000);
        }
      }
    } catch {
      // Best-effort cleanup; never surface sweep failures to the run result.
    }
  }

  private executeSubprocess(
    cmd: string,
    args: string[],
    timeoutMs: number,
    opts: { cwd?: string; env?: NodeJS.ProcessEnv; onTimeout?: () => void } = {}
  ): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
    return new Promise((res) => {
      const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let closed = false;
      let code: number | null = null;
      let stdoutEnded = child.stdout === null;
      let stderrEnded = child.stderr === null;
      let spawnError: string | null = null;
      let resolved = false;

      const timer = setTimeout(() => {
        timedOut = true;
        if (opts.onTimeout) {
          try {
            opts.onTimeout();
          } catch {
            // cleanup hook failure is logged by the hook itself
          }
        }
        child.kill("SIGKILL");
      }, timeoutMs);

      const maybeResolve = () => {
        if (resolved) return;
        if (!closed || !stdoutEnded || !stderrEnded) return;
        resolved = true;
        clearTimeout(timer);
        const errorText = spawnError ? `${stderr}\n${spawnError}`.trim() : stderr;
        res({ exitCode: spawnError ? -1 : code ?? (timedOut ? -1 : 0), stdout, stderr: errorText, timedOut });
      };

      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.stdout.on("end", () => {
        stdoutEnded = true;
        maybeResolve();
      });
      child.stderr.on("end", () => {
        stderrEnded = true;
        maybeResolve();
      });

      child.on("close", (exitCode) => {
        closed = true;
        code = exitCode;
        maybeResolve();
      });

      child.on("error", (err) => {
        closed = true;
        spawnError = err.message;
        maybeResolve();
      });
    });
  }
}
