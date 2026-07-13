#ifndef OPENALICE_JMB_CANARY_TYPES_MQH
#define OPENALICE_JMB_CANARY_TYPES_MQH

const double CANARY_HARD_MAX_RISK = 10.00;
const double CANARY_HARD_MAX_DAILY_LOSS = 40.00;
const int    CANARY_HARD_MAX_DAILY_LOSSES = 4;
const double CANARY_HARD_MAX_VOLUME = 0.01;
const int    CANARY_MARGIN_BUFFER_MULTIPLIER = 10;
const int    CANARY_NEWS_WINDOW_SECONDS = 30 * 60;

enum CanaryLifecycleState
{
   CANARY_LIFECYCLE_DISABLED = 0,
   CANARY_LIFECYCLE_PAUSED = 1,
   CANARY_LIFECYCLE_BLOCKED = 2,
   CANARY_LIFECYCLE_READY = 3
};

struct CanaryDecision
{
   bool loaded;
   int schemaVersion;
   string decisionId;
   string observationId;
   string observationAsOf;
   datetime createdAt;
   datetime leaseIssuedAt;
   datetime leaseExpiresAt;
   string broker;
   string server;
   string accountMode;
   string symbol;
   string strategyVersion;
   string direction;
   double entryReferencePrice;
   double volume;
   double stopLoss;
   double maxRiskAmount;
   string candidatePolicyVersion;
   string costModelVersion;
   string gateResultsJson;
   bool preDecisionGatesPassed;
};

struct CanaryPolicy
{
   bool loaded;
   int schemaVersion;
   string policyVersion;
   string broker;
   string server;
   string symbol;
   string strategyVersion;
   string rolloutStage;
   bool candidateApproved;
   double completedObservationMaxAgeHours;
   double maxSpread;
   double maxDeviation;
   double maxRiskAmount;
   double maxDailyLoss;
   int maxDailyLosingTrades;
   double maxVolume;
   long magicNumber;
};

struct CanaryEnvironment
{
   bool accountIsDemo;
   bool loginMatches;
   bool serverMatches;
   bool brokerMatches;
   bool chartSymbolMatches;
   bool magicMatches;

   bool executionEnabled;
   bool killSwitch;

   bool rolloutAuthorized;
   bool candidateApproved;
   bool allowlistsMatch;

   bool decisionFresh;
   bool bridgeFresh;
   bool policyFresh;
   bool costModelFresh;
   bool observationFresh;
   bool processedStateAvailable;
   bool observationUnused;

   bool volumeEvidenceAvailable;
   bool volumeCompatible;

   bool stopEvidenceAvailable;
   bool stopModeSupportsSl;
   bool stopTickSizeAvailable;
   bool stopTickAligned;
   bool stopBrokerValid;
   bool riskCalculationAvailable;
   double calculatedStopRisk;

   bool dailyStateAvailable;
   double dailyRealizedLoss;
   int dailyLossCount;

   bool exposureStateAvailable;
   bool hasEaPosition;
   bool hasEaPendingOrder;
   bool hasForeignGoldExposure;

   bool marginCalculationAvailable;
   double estimatedMargin;
   double freeMargin;

   bool spreadAvailable;
   double currentSpread;
   bool deviationAvailable;
   double requestedDeviation;

   bool sessionEvidenceAvailable;
   bool sessionOpen;

   bool newsEvidenceAvailable;
   bool newsBlackout;

   bool logPreflightReady;
   bool reconciliationComplete;
};

struct CanaryGateResult
{
   string name;
   bool passed;
   string detail;
};

struct CanaryEvaluation
{
   CanaryLifecycleState state;
   bool ready;
   string detail;
   string blockingGate;
   string nextSafeAction;
   CanaryGateResult gates[];
};

struct CanaryDailyState
{
   string brokerDay;
   int lossCount;
   double realizedLoss;
};

struct CanaryProcessedState
{
   bool valid;
   bool filePresent;
   string decisionIds[];
   string observationIds[];
   datetime attemptedAt[];
};

#endif
