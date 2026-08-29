export interface GenerateLeanConfigOptions {
  algorithmLocation?: string;
  algorithmTypeName?: string;
  dataFolder?: string;
  resultsDestinationFolder?: string;
  parameters?: Record<string, string | number | boolean>;
  environment?: string;
  liveMode?: boolean;
}

export function generateLeanConfig(options: GenerateLeanConfigOptions = {}): Record<string, unknown> {
  const envName = options.environment ?? "backtesting";
  const algoLocation = options.algorithmLocation ?? "/Lean/Algorithm.Python/main.py";
  const algoTypeName = options.algorithmTypeName ?? "ForexStrategy";
  const dataFolder = options.dataFolder ?? "/Lean/Data";
  const resultsFolder = options.resultsDestinationFolder ?? "/Results";

  return {
    environment: envName,
    "algorithm-language": "Python",
    "algorithm-location": algoLocation,
    "algorithm-type-name": algoTypeName,
    "data-folder": dataFolder,
    "results-destination-folder": resultsFolder,

    "job-queue-handler": "QuantConnect.Queues.JobQueue",
    "messaging-handler": "QuantConnect.Messaging.Messaging",
    "api-handler": "QuantConnect.Api.Api",
    "map-file-provider": "QuantConnect.Data.Auxiliary.LocalDiskMapFileProvider",
    "factor-file-provider": "QuantConnect.Data.Auxiliary.LocalDiskFactorFileProvider",
    "data-provider": "QuantConnect.Lean.Engine.DataFeeds.DefaultDataProvider",
    "alpha-handler": "QuantConnect.Lean.Engine.Alphas.DefaultAlphaHandler",

    parameters: options.parameters ?? {},

    environments: {
      [envName]: {
        "live-mode": options.liveMode ?? false,
        "setup-handler": "QuantConnect.Lean.Engine.Setup.ConsoleSetupHandler",
        "result-handler": "QuantConnect.Lean.Engine.Results.BacktestingResultHandler",
        "data-feed-handler": "QuantConnect.Lean.Engine.DataFeeds.FileSystemDataFeed",
        "real-time-handler": "QuantConnect.Lean.Engine.RealTime.BacktestingRealTimeHandler",
        "history-provider": [
          "QuantConnect.Lean.Engine.HistoricalData.SubscriptionDataReaderHistoryProvider"
        ],
        "transaction-handler": "QuantConnect.Lean.Engine.TransactionHandlers.BacktestingTransactionHandler"
      }
    }
  };
}

export function serializeLeanConfig(options: GenerateLeanConfigOptions = {}): string {
  return JSON.stringify(generateLeanConfig(options), null, 2);
}
