// Table-driven, submission-free harness for the Task 6 demo-canary pure contracts.
#property strict
#property version "0.200"

#include "..\JmbGoldmineDemoCanary\JmbCanaryTypes.mqh"
#include "..\JmbGoldmineDemoCanary\JmbCanaryGates.mqh"
#include "..\JmbGoldmineDemoCanary\JmbCanaryState.mqh"

enum HarnessMutation
{
   HARNESS_READY=0,
   HARNESS_NON_DEMO,
   HARNESS_SERVER_MISMATCH,
   HARNESS_SYMBOL_MISMATCH,
   HARNESS_MAGIC_MISMATCH,
   HARNESS_EXECUTION_DISABLED,
   HARNESS_KILL_SWITCH,
   HARNESS_ROLLOUT_BLOCKED,
   HARNESS_VOLUME_INVALID,
   HARNESS_STOP_INVALID,
   HARNESS_RISK_EXCESSIVE,
   HARNESS_SPREAD_EXCESSIVE,
   HARNESS_SESSION_CLOSED,
   HARNESS_NEWS_BLOCKED,
   HARNESS_EXPOSURE_PRESENT,
   HARNESS_DUPLICATE_OBSERVATION,
   HARNESS_LOG_FAILURE,
   HARNESS_RECONCILIATION_MISSING
};

struct HarnessCase
{
   string name;
   HarnessMutation mutation;
   CanaryLifecycleState expectedState;
   string expectedGate;
};

void AddHarnessCase(HarnessCase &cases[],const string name,const HarnessMutation mutation,
                    const CanaryLifecycleState expected_state,const string expected_gate)
{
   int index=ArraySize(cases);
   ArrayResize(cases,index+1);
   cases[index].name=name;
   cases[index].mutation=mutation;
   cases[index].expectedState=expected_state;
   cases[index].expectedGate=expected_gate;
}

void BuildHarnessPolicy(CanaryPolicy &policy)
{
   policy.loaded=true;
   policy.schemaVersion=1;
   policy.policyVersion="harness-policy-v1";
   policy.broker="hfmarkets";
   policy.server="HFMarketsGlobal-Demo4";
   policy.symbol="XAUUSD";
   policy.strategyVersion="daily-trend-v1";
   policy.rolloutStage="hfm_canary";
   policy.candidateApproved=true;
   policy.completedObservationMaxAgeHours=72.0;
   policy.maxSpread=0.75;
   policy.maxDeviation=0.50;
   policy.maxRiskAmount=10.0;
   policy.maxDailyLoss=40.0;
   policy.maxDailyLosingTrades=4;
   policy.maxVolume=0.01;
   policy.magicNumber=880101;
}

void BuildHarnessDecision(CanaryDecision &decision)
{
   decision.loaded=true;
   decision.schemaVersion=1;
   decision.decisionId="decision-harness";
   decision.observationId="observation-harness";
   decision.observationAsOf="2026-07-12";
   decision.createdAt=1;
   decision.leaseIssuedAt=1;
   decision.leaseExpiresAt=2;
   decision.broker="hfmarkets";
   decision.server="HFMarketsGlobal-Demo4";
   decision.accountMode="demo";
   decision.symbol="XAUUSD";
   decision.strategyVersion="daily-trend-v1";
   decision.direction="buy";
   decision.entryReferencePrice=2400.0;
   decision.volume=0.01;
   decision.stopLoss=2399.0;
   decision.maxRiskAmount=10.0;
   decision.candidatePolicyVersion="harness-policy-v1";
   decision.costModelVersion="harness-cost-v1";
   decision.gateResultsJson="[]";
   decision.preDecisionGatesPassed=true;
}

void BuildHarnessEnvironment(CanaryEnvironment &environment)
{
   ZeroMemory(environment);
   environment.accountIsDemo=true;
   environment.loginMatches=true;
   environment.serverMatches=true;
   environment.brokerMatches=true;
   environment.chartSymbolMatches=true;
   environment.magicMatches=true;
   environment.executionEnabled=true;
   environment.killSwitch=false;
   environment.rolloutAuthorized=true;
   environment.candidateApproved=true;
   environment.allowlistsMatch=true;
   environment.decisionFresh=true;
   environment.bridgeFresh=true;
   environment.policyFresh=true;
   environment.costModelFresh=true;
   environment.observationFresh=true;
   environment.observationUnused=true;
   environment.volumeEvidenceAvailable=true;
   environment.volumeCompatible=true;
   environment.stopEvidenceAvailable=true;
   environment.stopBrokerValid=true;
   environment.riskCalculationAvailable=true;
   environment.calculatedStopRisk=5.0;
   environment.dailyStateAvailable=true;
   environment.dailyRealizedLoss=0.0;
   environment.dailyLossCount=0;
   environment.exposureStateAvailable=true;
   environment.hasEaPosition=false;
   environment.hasEaPendingOrder=false;
   environment.hasForeignGoldExposure=false;
   environment.marginCalculationAvailable=true;
   environment.estimatedMargin=10.0;
   environment.freeMargin=120.0;
   environment.spreadAvailable=true;
   environment.currentSpread=0.20;
   environment.deviationAvailable=true;
   environment.requestedDeviation=0.20;
   environment.sessionEvidenceAvailable=true;
   environment.sessionOpen=true;
   environment.newsEvidenceAvailable=true;
   environment.newsBlackout=false;
   environment.logPreflightReady=true;
   environment.reconciliationComplete=true;
}

void ApplyHarnessMutation(const HarnessMutation mutation,CanaryDecision &decision,CanaryEnvironment &environment)
{
   if(mutation==HARNESS_NON_DEMO) environment.accountIsDemo=false;
   else if(mutation==HARNESS_SERVER_MISMATCH) environment.serverMatches=false;
   else if(mutation==HARNESS_SYMBOL_MISMATCH) environment.chartSymbolMatches=false;
   else if(mutation==HARNESS_MAGIC_MISMATCH) environment.magicMatches=false;
   else if(mutation==HARNESS_EXECUTION_DISABLED) environment.executionEnabled=false;
   else if(mutation==HARNESS_KILL_SWITCH) environment.killSwitch=true;
   else if(mutation==HARNESS_ROLLOUT_BLOCKED) environment.rolloutAuthorized=false;
   else if(mutation==HARNESS_VOLUME_INVALID) decision.volume=0.02;
   else if(mutation==HARNESS_STOP_INVALID) environment.stopBrokerValid=false;
   else if(mutation==HARNESS_RISK_EXCESSIVE) environment.calculatedStopRisk=10.01;
   else if(mutation==HARNESS_SPREAD_EXCESSIVE) environment.currentSpread=0.76;
   else if(mutation==HARNESS_SESSION_CLOSED) environment.sessionOpen=false;
   else if(mutation==HARNESS_NEWS_BLOCKED) environment.newsBlackout=true;
   else if(mutation==HARNESS_EXPOSURE_PRESENT) environment.hasForeignGoldExposure=true;
   else if(mutation==HARNESS_DUPLICATE_OBSERVATION) environment.observationUnused=false;
   else if(mutation==HARNESS_LOG_FAILURE) environment.logPreflightReady=false;
   else if(mutation==HARNESS_RECONCILIATION_MISSING) environment.reconciliationComplete=false;
}

bool RunHarnessCase(const HarnessCase &test_case)
{
   CanaryPolicy policy;
   CanaryDecision decision;
   CanaryEnvironment environment;
   BuildHarnessPolicy(policy);
   BuildHarnessDecision(decision);
   BuildHarnessEnvironment(environment);
   ApplyHarnessMutation(test_case.mutation,decision,environment);
   CanaryEvaluation evaluation=EvaluateCanaryGates(decision,policy,environment);
   bool passed=evaluation.state==test_case.expectedState && evaluation.blockingGate==test_case.expectedGate;
   PrintFormat("%s %s state=%s gate=%s",passed ? "PASS" : "FAIL",test_case.name,
      CanaryLifecycleLabel(evaluation.state),evaluation.blockingGate);
   return passed;
}

bool RunDuplicateObservationStateCase()
{
   CanaryObservationState state;
   state.lastObservationId="observation-harness";
   bool passed=CanaryIsDuplicateObservation(state,"observation-harness")
      && !CanaryIsDuplicateObservation(state,"new-observation");
   PrintFormat("%s duplicate observation state",passed ? "PASS" : "FAIL");
   return passed;
}

bool RunFourLossResetCase()
{
   CanaryDailyState state;
   state.brokerDay="2026-07-12";
   state.lossCount=4;
   state.realizedLoss=40.0;
   ResetCanaryDailyStateForDay(state,"2026-07-12");
   bool retained=state.lossCount==4 && CanaryNearlyEqual(state.realizedLoss,40.0);
   ResetCanaryDailyStateForDay(state,"2026-07-13");
   bool reset=state.brokerDay=="2026-07-13" && state.lossCount==0
      && CanaryNearlyEqual(state.realizedLoss,0.0);
   bool passed=retained && reset;
   PrintFormat("%s four-loss broker-day reset",passed ? "PASS" : "FAIL");
   return passed;
}

int OnInit()
{
   HarnessCase cases[];
   AddHarnessCase(cases,"all gates ready",HARNESS_READY,CANARY_LIFECYCLE_READY,"");
   AddHarnessCase(cases,"demo binding",HARNESS_NON_DEMO,CANARY_LIFECYCLE_BLOCKED,"demo_identity");
   AddHarnessCase(cases,"server binding",HARNESS_SERVER_MISMATCH,CANARY_LIFECYCLE_BLOCKED,"demo_identity");
   AddHarnessCase(cases,"symbol binding",HARNESS_SYMBOL_MISMATCH,CANARY_LIFECYCLE_BLOCKED,"demo_identity");
   AddHarnessCase(cases,"magic binding",HARNESS_MAGIC_MISMATCH,CANARY_LIFECYCLE_BLOCKED,"demo_identity");
   AddHarnessCase(cases,"execution switch",HARNESS_EXECUTION_DISABLED,CANARY_LIFECYCLE_DISABLED,"switches");
   AddHarnessCase(cases,"kill switch",HARNESS_KILL_SWITCH,CANARY_LIFECYCLE_PAUSED,"switches");
   AddHarnessCase(cases,"rollout",HARNESS_ROLLOUT_BLOCKED,CANARY_LIFECYCLE_BLOCKED,"rollout");
   AddHarnessCase(cases,"volume",HARNESS_VOLUME_INVALID,CANARY_LIFECYCLE_BLOCKED,"volume");
   AddHarnessCase(cases,"stop",HARNESS_STOP_INVALID,CANARY_LIFECYCLE_BLOCKED,"stop_risk");
   AddHarnessCase(cases,"risk",HARNESS_RISK_EXCESSIVE,CANARY_LIFECYCLE_BLOCKED,"stop_risk");
   AddHarnessCase(cases,"spread",HARNESS_SPREAD_EXCESSIVE,CANARY_LIFECYCLE_BLOCKED,"spread_deviation");
   AddHarnessCase(cases,"session",HARNESS_SESSION_CLOSED,CANARY_LIFECYCLE_BLOCKED,"session");
   AddHarnessCase(cases,"news",HARNESS_NEWS_BLOCKED,CANARY_LIFECYCLE_BLOCKED,"news");
   AddHarnessCase(cases,"exposure",HARNESS_EXPOSURE_PRESENT,CANARY_LIFECYCLE_BLOCKED,"exposure");
   AddHarnessCase(cases,"duplicate observation",HARNESS_DUPLICATE_OBSERVATION,CANARY_LIFECYCLE_BLOCKED,"freshness");
   AddHarnessCase(cases,"log failure",HARNESS_LOG_FAILURE,CANARY_LIFECYCLE_BLOCKED,"log_preflight");
   AddHarnessCase(cases,"reconciliation",HARNESS_RECONCILIATION_MISSING,CANARY_LIFECYCLE_BLOCKED,"reconciliation");

   int failures=0;
   for(int index=0;index<ArraySize(cases);index++)
      if(!RunHarnessCase(cases[index])) failures++;
   if(!RunDuplicateObservationStateCase()) failures++;
   if(!RunFourLossResetCase()) failures++;

   PrintFormat("JMB demo canary harness completed with %d failure(s).",failures);
   return failures==0 ? INIT_SUCCEEDED : INIT_FAILED;
}

void OnDeinit(const int reason) {}
