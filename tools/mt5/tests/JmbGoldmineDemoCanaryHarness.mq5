// Table-driven, submission-free harness for the Task 6 demo-canary pure contracts.
#property strict
#property version "0.200"

#include "..\JmbGoldmineDemoCanary\JmbCanaryTypes.mqh"
#include "..\JmbGoldmineDemoCanary\JmbCanaryGates.mqh"
#include "..\JmbGoldmineDemoCanary\JmbCanaryState.mqh"
#include "..\JmbGoldmineDemoCanary\JmbCanaryReconcile.mqh"
#include "..\JmbGoldmineDemoCanary\JmbCanaryTradeGateway.mqh"

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
   HARNESS_STOP_MODE_UNSUPPORTED,
   HARNESS_STOP_TICK_UNAVAILABLE,
   HARNESS_STOP_TICK_MISALIGNED,
   HARNESS_RISK_EXCESSIVE,
   HARNESS_TIGHT_DAILY_LOSS_EQUALITY,
   HARNESS_HARD_DAILY_LOSS_EQUALITY,
   HARNESS_SPREAD_EXCESSIVE,
   HARNESS_SESSION_CLOSED,
   HARNESS_NEWS_BLOCKED,
   HARNESS_EXPOSURE_PRESENT,
   HARNESS_DUPLICATE_OBSERVATION,
   HARNESS_MALFORMED_PROCESSED_STATE,
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

enum HarnessReconciliationMutation
{
   HARNESS_RECONCILE_REJECTED=0,
   HARNESS_RECONCILE_UNKNOWN,
   HARNESS_RECONCILE_PARTIAL,
   HARNESS_RECONCILE_FILLED_WITH_STOP,
   HARNESS_RECONCILE_FILLED_WITHOUT_STOP,
   HARNESS_RECONCILE_STOPPED,
   HARNESS_RECONCILE_SAME_DIRECTION,
   HARNESS_RECONCILE_OPPOSITE_DIRECTION,
   HARNESS_RECONCILE_FOUR_LOSSES,
   HARNESS_RECONCILE_SERVER_DAY_RESET,
   HARNESS_RECONCILE_RESTART_PROTECTED,
   HARNESS_RECONCILE_RESTART_FOREIGN,
   HARNESS_RECONCILE_MIXED_UNPROTECTED,
   HARNESS_RECONCILE_MULTIPLE_POSITIONS,
   HARNESS_RECONCILE_PROTECTION_PAUSE_AFTER_CLOSE
};

struct HarnessReconciliationCase
{
   string name;
   HarnessReconciliationMutation mutation;
   CanaryLifecycleState expectedState;
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
   environment.processedStateAvailable=true;
   environment.observationUnused=true;
   environment.volumeEvidenceAvailable=true;
   environment.volumeCompatible=true;
   environment.stopEvidenceAvailable=true;
   environment.stopModeSupportsSl=true;
   environment.stopTickSizeAvailable=true;
   environment.stopTickAligned=true;
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

void ApplyHarnessMutation(const HarnessMutation mutation,CanaryPolicy &policy,
                          CanaryDecision &decision,CanaryEnvironment &environment)
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
   else if(mutation==HARNESS_STOP_MODE_UNSUPPORTED) environment.stopModeSupportsSl=false;
   else if(mutation==HARNESS_STOP_TICK_UNAVAILABLE) environment.stopTickSizeAvailable=false;
   else if(mutation==HARNESS_STOP_TICK_MISALIGNED) environment.stopTickAligned=false;
   else if(mutation==HARNESS_RISK_EXCESSIVE) environment.calculatedStopRisk=10.01;
   else if(mutation==HARNESS_TIGHT_DAILY_LOSS_EQUALITY)
   {
      policy.maxDailyLoss=5.0;
      environment.dailyRealizedLoss=5.0;
   }
   else if(mutation==HARNESS_HARD_DAILY_LOSS_EQUALITY) environment.dailyRealizedLoss=40.0;
   else if(mutation==HARNESS_SPREAD_EXCESSIVE) environment.currentSpread=0.76;
   else if(mutation==HARNESS_SESSION_CLOSED) environment.sessionOpen=false;
   else if(mutation==HARNESS_NEWS_BLOCKED) environment.newsBlackout=true;
   else if(mutation==HARNESS_EXPOSURE_PRESENT) environment.hasForeignGoldExposure=true;
   else if(mutation==HARNESS_DUPLICATE_OBSERVATION) environment.observationUnused=false;
   else if(mutation==HARNESS_MALFORMED_PROCESSED_STATE)
   {
      environment.processedStateAvailable=false;
      environment.observationUnused=false;
   }
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
   ApplyHarnessMutation(test_case.mutation,policy,decision,environment);
   CanaryEvaluation evaluation=EvaluateCanaryGates(decision,policy,environment);
   bool passed=evaluation.state==test_case.expectedState && evaluation.blockingGate==test_case.expectedGate;
   PrintFormat("%s %s state=%s gate=%s",passed ? "PASS" : "FAIL",test_case.name,
      CanaryLifecycleLabel(evaluation.state),evaluation.blockingGate);
   return passed;
}

void AddHarnessReconciliationCase(HarnessReconciliationCase &cases[],const string name,
                                  const HarnessReconciliationMutation mutation,
                                  const CanaryLifecycleState expected_state)
{
   int index=ArraySize(cases);
   ArrayResize(cases,index+1);
   cases[index].name=name;
   cases[index].mutation=mutation;
   cases[index].expectedState=expected_state;
}

void BuildHarnessReconciliationFacts(CanaryReconciliationFacts &facts)
{
   ZeroMemory(facts);
   facts.brokerStateAvailable=true;
   facts.resultClass=CANARY_RESULT_NONE;
}

void ApplyHarnessReconciliationMutation(const HarnessReconciliationMutation mutation,
                                        CanaryReconciliationFacts &facts)
{
   if(mutation==HARNESS_RECONCILE_REJECTED) facts.resultClass=CANARY_RESULT_REJECTED;
   else if(mutation==HARNESS_RECONCILE_UNKNOWN) facts.resultClass=CANARY_RESULT_UNKNOWN;
   else if(mutation==HARNESS_RECONCILE_PARTIAL) facts.resultClass=CANARY_RESULT_PARTIAL;
   else if(mutation==HARNESS_RECONCILE_FILLED_WITH_STOP
      || mutation==HARNESS_RECONCILE_RESTART_PROTECTED)
   {
      facts.hasEaPosition=true;
      facts.eaPositionProtected=true;
   }
   else if(mutation==HARNESS_RECONCILE_FILLED_WITHOUT_STOP)
      facts.hasEaPosition=true;
   else if(mutation==HARNESS_RECONCILE_STOPPED) facts.stoppedObservation=true;
   else if(mutation==HARNESS_RECONCILE_SAME_DIRECTION)
   {
      facts.hasEaPosition=true;
      facts.eaPositionProtected=true;
      facts.sameDirection=true;
   }
   else if(mutation==HARNESS_RECONCILE_OPPOSITE_DIRECTION)
   {
      facts.hasEaPosition=true;
      facts.eaPositionProtected=true;
      facts.oppositeDirection=true;
   }
   else if(mutation==HARNESS_RECONCILE_FOUR_LOSSES) facts.dailyLimitReached=true;
   else if(mutation==HARNESS_RECONCILE_RESTART_FOREIGN) facts.hasForeignGoldExposure=true;
   else if(mutation==HARNESS_RECONCILE_MIXED_UNPROTECTED)
   {
      facts.hasEaPosition=true;
      facts.hasForeignGoldExposure=true;
   }
   else if(mutation==HARNESS_RECONCILE_MULTIPLE_POSITIONS)
   {
      facts.brokerStateAvailable=false;
      facts.hasEaPosition=true;
   }
   else if(mutation==HARNESS_RECONCILE_PROTECTION_PAUSE_AFTER_CLOSE)
   {
      facts.resultClass=CANARY_RESULT_NONE;
      facts.persistentSafetyPause=true;
   }
}

bool RunHarnessReconciliationCase(const HarnessReconciliationCase &test_case)
{
   CanaryReconciliationFacts facts;
   BuildHarnessReconciliationFacts(facts);
   ApplyHarnessReconciliationMutation(test_case.mutation,facts);
   CanaryLifecycleState actual=ReduceCanaryLifecycle(facts);
   bool passed=actual==test_case.expectedState;
   PrintFormat("%s %s state=%s",passed ? "PASS" : "FAIL",test_case.name,
      CanaryAuthoritativeLifecycleLabel(actual));
   return passed;
}

bool RunActionableOppositeCase()
{
   bool passed=!IsCanaryActionableOpposite("flat","buy")
      && !IsCanaryActionableOpposite("flat","sell")
      && !IsCanaryActionableOpposite("buy","buy")
      && IsCanaryActionableOpposite("buy","sell")
      && IsCanaryActionableOpposite("sell","buy");
   PrintFormat("%s flat decision cannot close",passed ? "PASS" : "FAIL");
   return passed;
}

bool RunClosedOwnershipCase()
{
   bool passed=ClassifyCanaryClosedPositionOwnership(true,false,true)==CANARY_CLOSED_OWNERSHIP_EA
      && ClassifyCanaryClosedPositionOwnership(false,false,true)==CANARY_CLOSED_OWNERSHIP_FOREIGN
      && ClassifyCanaryClosedPositionOwnership(true,true,true)==CANARY_CLOSED_OWNERSHIP_UNSAFE;
   PrintFormat("%s nonmagic final closure ownership",passed ? "PASS" : "FAIL");
   return passed;
}

bool RunLifecycleCorrelationCase()
{
   string decision_id="0123456789abcdef01234567";
   string correlation=CanaryEntryCorrelationComment(decision_id);
   bool correlated=IsCanaryCorrelatedLifecyclePosition(decision_id,4321,correlation,4321);
   bool unrelated=!IsCanaryCorrelatedLifecyclePosition(decision_id,4321,
      CanaryEntryCorrelationComment("89abcdef0123456701234567"),9876);
   CanaryReconciliationFacts facts;
   BuildHarnessReconciliationFacts(facts);
   facts.resultClass=CANARY_RESULT_UNKNOWN;
   facts.stoppedObservation=correlated;
   bool stopped=ReduceCanaryLifecycle(facts)==CANARY_LIFECYCLE_STOPPED;
   facts.stoppedObservation=!unrelated;
   bool blocked=ReduceCanaryLifecycle(facts)==CANARY_LIFECYCLE_RECONCILIATION_REQUIRED;
   PrintFormat("%s correlated stopped observation",stopped ? "PASS" : "FAIL");
   PrintFormat("%s unrelated stop remains unresolved",blocked ? "PASS" : "FAIL");
   PrintFormat("%s position-specific rollover recovery",correlated ? "PASS" : "FAIL");
   return correlated && unrelated && stopped && blocked;
}

bool RunProtectionPauseSemanticsCase()
{
   CanaryReconciliation reconciliation;
   InitializeCanaryReconciliation(reconciliation);
   reconciliation.state=CANARY_LIFECYCLE_PAUSED;
   reconciliation.reconciliationState="protection_error";
   bool passed=IsCanaryPersistentProtectionPause(reconciliation);
   PrintFormat("%s persistent protection status semantics",passed ? "PASS" : "FAIL");
   return passed;
}

bool RunDuplicateObservationStateCase()
{
   CanaryProcessedState state;
   InitializeCanaryProcessedState(state);
   state.valid=true;
   ArrayResize(state.decisionIds,1);
   ArrayResize(state.observationIds,1);
   ArrayResize(state.attemptedAt,1);
   state.decisionIds[0]="bc0bc128a9155065dda0b5bc";
   state.observationIds[0]="53f2bd057c1ee3608a02d1f2";
   state.attemptedAt[0]=1;
   bool passed=CanaryProcessedStateContains(state,"bc0bc128a9155065dda0b5bc","new-observation")
      && CanaryProcessedStateContains(state,"new-decision","53f2bd057c1ee3608a02d1f2")
      && !CanaryProcessedStateContains(state,"new-decision","new-observation");
   PrintFormat("%s loaded duplicate state",passed ? "PASS" : "FAIL");
   return passed;
}

bool RunTask3IdentityCase()
{
   CanaryDecision decision;
   BuildHarnessDecision(decision);
   string observation_id=CreateCanaryObservationId(decision);
   decision.observationId=observation_id;
   string decision_id=CreateCanaryDecisionId(decision);
   bool passed=observation_id=="53f2bd057c1ee3608a02d1f2"
      && decision_id=="bc0bc128a9155065dda0b5bc"
      && "arbitrary-observation"!=observation_id
      && "arbitrary-decision"!=decision_id;
   PrintFormat("%s arbitrary decision ids",passed ? "PASS" : "FAIL");
   return passed;
}

bool RunGateJsonContractCase()
{
   string valid="[{\"name\":\"bridge\",\"state\":\"pass\",\"detail\":\"ok\"},"
      +"{\"name\":\"completed_observation\",\"state\":\"pass\",\"detail\":\"ok\"},"
      +"{\"name\":\"candidate_policy\",\"state\":\"pass\",\"detail\":\"ok\"},"
      +"{\"name\":\"cost_model\",\"state\":\"pass\",\"detail\":\"ok\"},"
      +"{\"name\":\"learning\",\"state\":\"pass\",\"detail\":\"ok\"},"
      +"{\"name\":\"quote\",\"state\":\"pass\",\"detail\":\"ok\"},"
      +"{\"name\":\"spread\",\"state\":\"pass\",\"detail\":\"ok\"},"
      +"{\"name\":\"direction\",\"state\":\"pass\",\"detail\":\"ok\"},"
      +"{\"name\":\"stop_loss\",\"state\":\"pass\",\"detail\":\"ok\"}]";
   string malformed=valid+" trailing";
   string unknown_name=valid;
   StringReplace(unknown_name,"\"name\":\"bridge\"","\"name\":\"unknown\"");
   string unknown_state=valid;
   StringReplace(unknown_state,"\"state\":\"pass\"","\"state\":\"warn\"");
   string unknown_field=valid;
   StringReplace(unknown_field,"\"detail\":\"ok\"","\"extra\":\"x\",\"detail\":\"ok\"");
   string duplicate_field=valid;
   StringReplace(duplicate_field,"\"state\":\"pass\"","\"name\":\"bridge\",\"state\":\"pass\"");
   string missing_field=valid;
   StringReplace(missing_field,",\"detail\":\"ok\"","");
   string noncanonical=valid;
   StringReplace(noncanonical,"[{","[ {");
   bool all_passed=false;
   string detail="";
   bool passed=ParseCanaryGateResultsJson(valid,all_passed,detail) && all_passed
      && !ParseCanaryGateResultsJson(malformed,all_passed,detail)
      && !ParseCanaryGateResultsJson(unknown_name,all_passed,detail)
      && !ParseCanaryGateResultsJson(unknown_state,all_passed,detail)
      && !ParseCanaryGateResultsJson(unknown_field,all_passed,detail)
      && !ParseCanaryGateResultsJson(duplicate_field,all_passed,detail)
      && !ParseCanaryGateResultsJson(missing_field,all_passed,detail)
      && !ParseCanaryGateResultsJson(noncanonical,all_passed,detail);
   PrintFormat("%s malformed gate JSON: unknown gate name, unknown gate state, unknown gate field, duplicate gate field, missing gate field, noncanonical gate evidence",
      passed ? "PASS" : "FAIL");
   return passed;
}

bool RunJsonEscapeCase()
{
   string canonical="\"quote\\\" reverse\\\\ solidus\\/ backspace\\b formfeed\\f newline\\n return\\r tab\\t bmp\\u263A pair\\uD83D\\uDE00\"";
   string invalid_escape="\"bad\\x\"";
   string invalid_hex="\"bad\\uZZZZ\"";
   string lone_high="\"bad\\uD83D\"";
   string lone_low="\"bad\\uDE00\"";
   string invalid_pair="\"bad\\uD83D\\u263A\"";
   int cursor=0;
   string decoded="";
   string expected="quote\" reverse\\ solidus/ backspace"+ShortToString((ushort)8)
      +" formfeed"+ShortToString((ushort)12)+" newline"+ShortToString((ushort)10)
      +" return"+ShortToString((ushort)13)+" tab"+ShortToString((ushort)9)+" bmp"+ShortToString((ushort)0x263A)
      +" pair"+ShortToString((ushort)0xD83D)+ShortToString((ushort)0xDE00);
   bool canonical_passed=ParseCanonicalCanaryJsonString(canonical,cursor,decoded)
      && cursor==StringLen(canonical) && decoded==expected;
   PrintFormat("%s canonical JSON escapes",canonical_passed ? "PASS" : "FAIL");

   cursor=0;
   bool invalid_escape_blocked=!ParseCanonicalCanaryJsonString(invalid_escape,cursor,decoded);
   cursor=0;
   invalid_escape_blocked=invalid_escape_blocked
      && !ParseCanonicalCanaryJsonString(invalid_hex,cursor,decoded);
   PrintFormat("%s invalid JSON escapes",invalid_escape_blocked ? "PASS" : "FAIL");

   cursor=0;
   bool invalid_surrogates_blocked=!ParseCanonicalCanaryJsonString(lone_high,cursor,decoded);
   cursor=0;
   invalid_surrogates_blocked=invalid_surrogates_blocked
      && !ParseCanonicalCanaryJsonString(lone_low,cursor,decoded);
   cursor=0;
   invalid_surrogates_blocked=invalid_surrogates_blocked
      && !ParseCanonicalCanaryJsonString(invalid_pair,cursor,decoded);
   PrintFormat("%s invalid surrogate pairs",invalid_surrogates_blocked ? "PASS" : "FAIL");
   return canonical_passed && invalid_escape_blocked && invalid_surrogates_blocked;
}

bool RunQuotedPolicyCsvCase()
{
   string row="1,harness-policy-v1,hfmarkets,HFMarketsGlobal-Demo4,XAUUSD,daily-trend-v1,hfm_canary,1,72,0.75,0.50,10,40,4,0.01,880101";
   string valid=CANARY_POLICY_HEADER+"\n"+row+"\n";
   string fully_quoted=CANARY_POLICY_HEADER+"\n"
      +"\"1\",\"harness-policy-v1\",\"hfmarkets\",\"HFMarketsGlobal-Demo4\",\"XAUUSD\",\"daily-trend-v1\",\"hfm_canary\",\"1\",\"72\",\"0.75\",\"0.50\",\"10\",\"40\",\"4\",\"0.01\",\"880101\"\n";
   string partially_quoted=CANARY_POLICY_HEADER+"\n1,\"harness-policy-v1\",hfmarkets,HFMarketsGlobal-Demo4,XAUUSD,daily-trend-v1,hfm_canary,1,72,0.75,0.50,10,40,4,0.01,880101\n";
   CanaryPolicy policy;
   string detail="";
   bool valid_passed=ParseCanaryPolicyCsvText(valid,policy,detail);
   bool fully_blocked=!ParseCanaryPolicyCsvText(fully_quoted,policy,detail);
   bool partially_blocked=!ParseCanaryPolicyCsvText(partially_quoted,policy,detail);
   PrintFormat("%s fully quoted policy row",fully_blocked ? "PASS" : "FAIL");
   PrintFormat("%s partially quoted policy row",partially_blocked ? "PASS" : "FAIL");
   return valid_passed && fully_blocked && partially_blocked;
}

bool RunStatusExactComparisonCase()
{
   string intended_values[];
   string verified_values[];
   ArrayResize(intended_values,29);
   ArrayResize(verified_values,29);
   for(int index=0;index<29;index++)
   {
      intended_values[index]="value-"+IntegerToString(index);
      verified_values[index]=intended_values[index];
   }
   bool exact_passed=CanaryExactValuesMatch(intended_values,verified_values);
   verified_values[28]="truncated";
   bool truncation_blocked=!CanaryExactValuesMatch(intended_values,verified_values);
   PrintFormat("%s truncated next safe action",truncation_blocked ? "PASS" : "FAIL");
   return exact_passed && truncation_blocked;
}

bool RunPolicyVersionGrammarCase()
{
   bool passed=IsCanonicalCanaryPolicyVersion("operator-policy-v1")
      && !IsCanonicalCanaryPolicyVersion("")
      && !IsCanonicalCanaryPolicyVersion(" policy")
      && !IsCanonicalCanaryPolicyVersion("policy ")
      && !IsCanonicalCanaryPolicyVersion("policy,version")
      && !IsCanonicalCanaryPolicyVersion("policy\"version")
      && !IsCanonicalCanaryPolicyVersion("policy\nversion");
   PrintFormat("%s policy version grammar",passed ? "PASS" : "FAIL");
   return passed;
}

bool RunMalformedProcessedStateCase()
{
   CanaryProcessedState state;
   InitializeCanaryProcessedState(state);
   bool passed=!state.valid && CanaryProcessedStateContains(state,"new-decision","new-observation");
   PrintFormat("%s malformed processed state",passed ? "PASS" : "FAIL");
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
   PrintFormat("%s server day reset",passed ? "PASS" : "FAIL");
   return passed;
}

bool RunGatewayBindingCase()
{
   bool wrong_account_blocked=!CanaryGatewayBindingMatches("hfmarkets","HFMarketsGlobal-Demo4",
      123456,"XAUUSD",880101,ACCOUNT_TRADE_MODE_DEMO,"HFMarketsGlobal-Demo4",654321,"XAUUSD");
   bool account_switch_blocked=!CanaryGatewayBindingMatches("hfmarkets","HFMarketsGlobal-Demo4",
      123456,"XAUUSD",880101,ACCOUNT_TRADE_MODE_DEMO,"ICMarketsSC-Demo",123456,"XAUUSD");
   PrintFormat("%s wrong demo account blocks emergency close",wrong_account_blocked ? "PASS" : "FAIL");
   PrintFormat("%s account switch blocks reversal close",account_switch_blocked ? "PASS" : "FAIL");
   return wrong_account_blocked && account_switch_blocked;
}

bool RunActivePositionCorrelationCase()
{
   CanarySafetyLatch latch;
   InitializeCanarySafetyLatch(latch);
   latch.valid=true;
   latch.pendingEntryDecisionId="bc0bc128a9155065dda0b5bc";
   latch.pendingEntryObservationId="53f2bd057c1ee3608a02d1f2";
   latch.pendingEntryAttemptedAt=1;
   latch.pendingRequestedVolume=0.01;
   latch.pendingRequestedPrice=2400.0;
   latch.pendingRequestedStopLoss=2392.0;
   latch.pendingCalculatedRisk=7.5;
   latch.pendingEntryComment=CanaryEntryCorrelationComment(latch.pendingEntryDecisionId);
   bool activated=ActivateCanaryPositionCorrelation(latch,4321);
   ClearCanaryPendingEntryLatch(latch);
   CanaryExecutionEvent stopped;
   InitializeCanaryExecutionEvent(stopped);
   bool restart_stop_correlated=activated && ApplyCanaryPositionCorrelation(stopped,latch)
      && stopped.decisionId=="bc0bc128a9155065dda0b5bc"
      && stopped.observationId=="53f2bd057c1ee3608a02d1f2"
      && CanaryNearlyEqual(stopped.calculatedRisk,7.5);
   string reversal_decision="0123456789abcdef01234567";
   bool decisions_separate=restart_stop_correlated && stopped.decisionId!=reversal_decision;
   PrintFormat("%s protected fill then later stop after restart",restart_stop_correlated ? "PASS" : "FAIL");
   PrintFormat("%s opening decision differs from reversal decision",decisions_separate ? "PASS" : "FAIL");
   return restart_stop_correlated && decisions_separate;
}

bool RunEmergencyTerminalCorrelationCase()
{
   CanarySafetyLatch latch;
   InitializeCanarySafetyLatch(latch);
   latch.valid=true;
   latch.unresolved=false;
   latch.protectionError=true;
   latch.emergencyCloseAttempted=true;
   latch.emergencyPositionId="4321";
   latch.activePositionDecisionId="bc0bc128a9155065dda0b5bc";
   latch.activePositionObservationId="53f2bd057c1ee3608a02d1f2";
   latch.activePositionId="4321";
   latch.activeRequestedVolume=0.01;
   latch.activeRequestedPrice=2400.0;
   latch.activeRequestedStopLoss=2392.0;
   latch.activeCalculatedRisk=7.5;
   latch.activeEntryComment=CanaryEntryCorrelationComment(latch.activePositionDecisionId);

   bool rejected=FinalizeCanaryEmergencyTerminalCorrelation(latch,false);
   bool waited=!rejected && !latch.unresolved && latch.activePositionDecisionId!=""
      && CanaryNearlyEqual(latch.activeCalculatedRisk,7.5);
   bool finalized=FinalizeCanaryEmergencyTerminalCorrelation(latch,true);
   bool cleared=finalized && !latch.unresolved && latch.activePositionDecisionId==""
      && latch.activePositionObservationId=="" && latch.activePositionId=="";
   bool pause_retained=latch.protectionError && latch.emergencyCloseAttempted
      && latch.emergencyPositionId=="4321";
   PrintFormat("%s emergency terminal waits for durable event",waited ? "PASS" : "FAIL");
   PrintFormat("%s emergency terminal clears active correlation after restart",cleared ? "PASS" : "FAIL");
   PrintFormat("%s emergency protection pause remains",pause_retained ? "PASS" : "FAIL");
   return waited && cleared && pause_retained;
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
   AddHarnessCase(cases,"stop mode unsupported",HARNESS_STOP_MODE_UNSUPPORTED,CANARY_LIFECYCLE_BLOCKED,"stop_risk");
   AddHarnessCase(cases,"stop tick unavailable",HARNESS_STOP_TICK_UNAVAILABLE,CANARY_LIFECYCLE_BLOCKED,"stop_risk");
   AddHarnessCase(cases,"stop tick misaligned",HARNESS_STOP_TICK_MISALIGNED,CANARY_LIFECYCLE_BLOCKED,"stop_risk");
   AddHarnessCase(cases,"risk",HARNESS_RISK_EXCESSIVE,CANARY_LIFECYCLE_BLOCKED,"stop_risk");
   AddHarnessCase(cases,"tighter daily loss equality",HARNESS_TIGHT_DAILY_LOSS_EQUALITY,CANARY_LIFECYCLE_BLOCKED,"daily_loss_count");
   AddHarnessCase(cases,"hard daily loss equality",HARNESS_HARD_DAILY_LOSS_EQUALITY,CANARY_LIFECYCLE_BLOCKED,"daily_loss_count");
   AddHarnessCase(cases,"spread",HARNESS_SPREAD_EXCESSIVE,CANARY_LIFECYCLE_BLOCKED,"spread_deviation");
   AddHarnessCase(cases,"session",HARNESS_SESSION_CLOSED,CANARY_LIFECYCLE_BLOCKED,"session");
   AddHarnessCase(cases,"news",HARNESS_NEWS_BLOCKED,CANARY_LIFECYCLE_BLOCKED,"news");
   AddHarnessCase(cases,"exposure",HARNESS_EXPOSURE_PRESENT,CANARY_LIFECYCLE_BLOCKED,"exposure");
   AddHarnessCase(cases,"loaded duplicate state",HARNESS_DUPLICATE_OBSERVATION,CANARY_LIFECYCLE_BLOCKED,"freshness");
   AddHarnessCase(cases,"malformed processed state",HARNESS_MALFORMED_PROCESSED_STATE,CANARY_LIFECYCLE_BLOCKED,"freshness");
   AddHarnessCase(cases,"log failure",HARNESS_LOG_FAILURE,CANARY_LIFECYCLE_BLOCKED,"log_preflight");
   AddHarnessCase(cases,"reconciliation",HARNESS_RECONCILIATION_MISSING,CANARY_LIFECYCLE_BLOCKED,"reconciliation");

   HarnessReconciliationCase reconciliation_cases[];
   AddHarnessReconciliationCase(reconciliation_cases,"rejected request",HARNESS_RECONCILE_REJECTED,CANARY_LIFECYCLE_ORDER_REJECTED);
   AddHarnessReconciliationCase(reconciliation_cases,"unknown result",HARNESS_RECONCILE_UNKNOWN,CANARY_LIFECYCLE_RECONCILIATION_REQUIRED);
   AddHarnessReconciliationCase(reconciliation_cases,"partial fill",HARNESS_RECONCILE_PARTIAL,CANARY_LIFECYCLE_RECONCILIATION_REQUIRED);
   AddHarnessReconciliationCase(reconciliation_cases,"filled with stop",HARNESS_RECONCILE_FILLED_WITH_STOP,CANARY_LIFECYCLE_FILLED_PROTECTED);
   AddHarnessReconciliationCase(reconciliation_cases,"filled without stop",HARNESS_RECONCILE_FILLED_WITHOUT_STOP,CANARY_LIFECYCLE_EMERGENCY_CLOSE);
   AddHarnessReconciliationCase(reconciliation_cases,"stopped observation",HARNESS_RECONCILE_STOPPED,CANARY_LIFECYCLE_STOPPED);
   AddHarnessReconciliationCase(reconciliation_cases,"same direction durable no-op",HARNESS_RECONCILE_SAME_DIRECTION,CANARY_LIFECYCLE_FILLED_PROTECTED);
   AddHarnessReconciliationCase(reconciliation_cases,"opposite signal close",HARNESS_RECONCILE_OPPOSITE_DIRECTION,CANARY_LIFECYCLE_CLOSE_REQUESTING);
   AddHarnessReconciliationCase(reconciliation_cases,"four losing positions",HARNESS_RECONCILE_FOUR_LOSSES,CANARY_LIFECYCLE_PAUSED);
   AddHarnessReconciliationCase(reconciliation_cases,"server day reset",HARNESS_RECONCILE_SERVER_DAY_RESET,CANARY_LIFECYCLE_READY);
   AddHarnessReconciliationCase(reconciliation_cases,"restart with protected position",HARNESS_RECONCILE_RESTART_PROTECTED,CANARY_LIFECYCLE_FILLED_PROTECTED);
   AddHarnessReconciliationCase(reconciliation_cases,"restart with foreign exposure",HARNESS_RECONCILE_RESTART_FOREIGN,CANARY_LIFECYCLE_BLOCKED);
   AddHarnessReconciliationCase(reconciliation_cases,"mixed magic unprotected position blocks close",HARNESS_RECONCILE_MIXED_UNPROTECTED,CANARY_LIFECYCLE_BLOCKED);
   AddHarnessReconciliationCase(reconciliation_cases,"multiple positions block close",HARNESS_RECONCILE_MULTIPLE_POSITIONS,CANARY_LIFECYCLE_RECONCILIATION_REQUIRED);
   AddHarnessReconciliationCase(reconciliation_cases,"protection error pauses after emergency closure",HARNESS_RECONCILE_PROTECTION_PAUSE_AFTER_CLOSE,CANARY_LIFECYCLE_PAUSED);

   int failures=0;
   for(int index=0;index<ArraySize(cases);index++)
      if(!RunHarnessCase(cases[index])) failures++;
   for(int index=0;index<ArraySize(reconciliation_cases);index++)
      if(!RunHarnessReconciliationCase(reconciliation_cases[index])) failures++;
   if(!RunActionableOppositeCase()) failures++;
   if(!RunClosedOwnershipCase()) failures++;
   if(!RunLifecycleCorrelationCase()) failures++;
   if(!RunProtectionPauseSemanticsCase()) failures++;
   if(!RunDuplicateObservationStateCase()) failures++;
   if(!RunTask3IdentityCase()) failures++;
   if(!RunGateJsonContractCase()) failures++;
   if(!RunJsonEscapeCase()) failures++;
   if(!RunQuotedPolicyCsvCase()) failures++;
   if(!RunStatusExactComparisonCase()) failures++;
   if(!RunPolicyVersionGrammarCase()) failures++;
   if(!RunMalformedProcessedStateCase()) failures++;
   if(!RunFourLossResetCase()) failures++;
   if(!RunGatewayBindingCase()) failures++;
   if(!RunActivePositionCorrelationCase()) failures++;
   if(!RunEmergencyTerminalCorrelationCase()) failures++;

   PrintFormat("JMB demo canary harness completed with %d failure(s).",failures);
   if(failures==0) Print("JMB_CANARY_HARNESS PASS");
   return failures==0 ? INIT_SUCCEEDED : INIT_FAILED;
}

void OnDeinit(const int reason) {}
