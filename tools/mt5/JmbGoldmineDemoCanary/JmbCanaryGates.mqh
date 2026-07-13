#ifndef OPENALICE_JMB_CANARY_GATES_MQH
#define OPENALICE_JMB_CANARY_GATES_MQH

#include "JmbCanaryTypes.mqh"

CanaryGateResult Gate(const string name,const bool passed,const string detail)
{
   CanaryGateResult result;
   result.name=name;
   result.passed=passed;
   result.detail=detail;
   return result;
}

void AppendCanaryGate(CanaryEvaluation &evaluation,CanaryGateResult &gate)
{
   int index=ArraySize(evaluation.gates);
   ArrayResize(evaluation.gates,index+1);
   evaluation.gates[index]=gate;
}

string CanaryLifecycleLabel(const CanaryLifecycleState state)
{
   if(state==CANARY_LIFECYCLE_DISABLED) return "disabled";
   if(state==CANARY_LIFECYCLE_PAUSED) return "paused";
   if(state==CANARY_LIFECYCLE_READY) return "ready";
   return "blocked";
}

bool CanaryNearlyEqual(const double left,const double right)
{
   return MathAbs(left-right)<=0.00000001;
}

CanaryEvaluation EvaluateCanaryGates(const CanaryDecision &decision,
                                     const CanaryPolicy &policy,
                                     const CanaryEnvironment &environment)
{
   CanaryEvaluation evaluation;
   evaluation.state=CANARY_LIFECYCLE_BLOCKED;
   evaluation.ready=false;
   evaluation.detail="One or more dry-run safety gates blocked readiness.";
   evaluation.blockingGate="";
   evaluation.nextSafeAction="Resolve the first blocking gate and evaluate again.";
   ArrayResize(evaluation.gates,0);

   bool identity_passed=decision.loaded
      && policy.loaded
      && environment.accountIsDemo
      && environment.loginMatches
      && environment.serverMatches
      && environment.brokerMatches
      && environment.chartSymbolMatches
      && environment.magicMatches;
   CanaryGateResult identity=Gate("demo_identity",identity_passed,
      identity_passed ? "Demo account and immutable identity bindings match."
                      : "Demo account or an immutable identity binding is missing or mismatched.");
   AppendCanaryGate(evaluation,identity);

   bool switches_passed=environment.executionEnabled && !environment.killSwitch;
   CanaryGateResult switches=Gate("switches",switches_passed,
      switches_passed ? "The local execution switch is enabled and the kill switch is off."
                      : "The local execution switch is disabled or the kill switch is on.");
   AppendCanaryGate(evaluation,switches);

   bool rollout_passed=environment.rolloutAuthorized && environment.candidateApproved;
   CanaryGateResult rollout=Gate("rollout",rollout_passed,
      rollout_passed ? "The operator policy authorizes this broker rollout."
                     : "The rollout stage or operator candidate approval blocks this broker.");
   AppendCanaryGate(evaluation,rollout);

   bool allowlists_passed=environment.allowlistsMatch;
   CanaryGateResult allowlists=Gate("allowlists",allowlists_passed,
      allowlists_passed ? "Gold and daily-trend-v1 match the immutable allowlists."
                        : "The broker, server, symbol, strategy, direction, or magic allowlist failed.");
   AppendCanaryGate(evaluation,allowlists);

   bool freshness_passed=environment.decisionFresh
      && environment.bridgeFresh
      && environment.policyFresh
      && environment.costModelFresh
      && environment.observationFresh
      && environment.processedStateAvailable
      && environment.observationUnused;
   CanaryGateResult freshness=Gate("freshness",freshness_passed,
      freshness_passed ? "Decision, bridge, policy, cost, and observation evidence is current and unused."
                       : "Freshness, broker evidence, or unique-observation evidence is missing or stale.");
   AppendCanaryGate(evaluation,freshness);

   bool volume_passed=environment.volumeEvidenceAvailable
      && environment.volumeCompatible
      && CanaryNearlyEqual(decision.volume,CANARY_HARD_MAX_VOLUME)
      && decision.volume<=policy.maxVolume
      && decision.volume<=CANARY_HARD_MAX_VOLUME;
   CanaryGateResult volume=Gate("volume",volume_passed,
      volume_passed ? "The requested 0.01 volume matches policy and broker constraints."
                    : "Volume evidence is missing or the requested volume violates policy or broker constraints.");
   AppendCanaryGate(evaluation,volume);

   double risk_ceiling=MathMin(CANARY_HARD_MAX_RISK,MathMin(policy.maxRiskAmount,decision.maxRiskAmount));
   bool stop_risk_passed=environment.stopEvidenceAvailable
      && environment.stopModeSupportsSl
      && environment.stopTickSizeAvailable
      && environment.stopTickAligned
      && environment.stopBrokerValid
      && environment.riskCalculationAvailable
      && decision.stopLoss>0.0
      && environment.calculatedStopRisk>0.0
      && environment.calculatedStopRisk<=risk_ceiling;
   CanaryGateResult stop_risk=Gate("stop_risk",stop_risk_passed,
      stop_risk_passed ? "The broker-valid stop and calculated account-currency risk are within the tighter ceiling."
                       : "Stop evidence or the account-currency risk calculation is unavailable or outside its ceiling.");
   AppendCanaryGate(evaluation,stop_risk);

   double daily_ceiling=MathMin(CANARY_HARD_MAX_DAILY_LOSS,policy.maxDailyLoss);
   int count_ceiling=MathMin(CANARY_HARD_MAX_DAILY_LOSSES,policy.maxDailyLosingTrades);
   bool daily_passed=environment.dailyStateAvailable
      && environment.dailyRealizedLoss>=0.0
      && environment.dailyRealizedLoss<=daily_ceiling
      && environment.dailyLossCount>=0
      && environment.dailyLossCount<count_ceiling;
   CanaryGateResult daily=Gate("daily_loss_count",daily_passed,
      daily_passed ? "Broker-day realized loss and losing-trade count are within policy."
                   : "Broker-day loss evidence is unavailable or a daily loss ceiling is reached.");
   AppendCanaryGate(evaluation,daily);

   bool exposure_passed=environment.exposureStateAvailable
      && !environment.hasEaPosition
      && !environment.hasEaPendingOrder
      && !environment.hasForeignGoldExposure;
   CanaryGateResult exposure=Gate("exposure",exposure_passed,
      exposure_passed ? "No EA-owned, pending, manual, or foreign Gold exposure exists."
                      : "Exposure evidence is unavailable or existing Gold exposure blocks a new entry.");
   AppendCanaryGate(evaluation,exposure);

   bool margin_passed=environment.marginCalculationAvailable
      && environment.estimatedMargin>0.0
      && environment.freeMargin>=environment.estimatedMargin
      && environment.freeMargin-environment.estimatedMargin
         >=environment.estimatedMargin*CANARY_MARGIN_BUFFER_MULTIPLIER;
   CanaryGateResult margin=Gate("margin",margin_passed,
      margin_passed ? "Estimated margin is available with the required ten-times post-estimate buffer."
                    : "Margin evidence is missing or the ten-times free-margin buffer would not remain.");
   AppendCanaryGate(evaluation,margin);

   bool spread_deviation_passed=environment.spreadAvailable
      && environment.deviationAvailable
      && environment.currentSpread>=0.0
      && environment.currentSpread<=policy.maxSpread
      && environment.requestedDeviation>=0.0
      && environment.requestedDeviation<=policy.maxDeviation;
   CanaryGateResult spread_deviation=Gate("spread_deviation",spread_deviation_passed,
      spread_deviation_passed ? "Current spread and requested deviation are within broker policy."
                              : "Spread or deviation evidence is missing or outside broker policy.");
   AppendCanaryGate(evaluation,spread_deviation);

   bool session_passed=environment.sessionEvidenceAvailable && environment.sessionOpen;
   CanaryGateResult session=Gate("session",session_passed,
      session_passed ? "The current UTC time is inside the approved weekday session."
                     : "Session evidence is unavailable or the UTC entry session is closed.");
   AppendCanaryGate(evaluation,session);

   bool news_passed=environment.newsEvidenceAvailable && !environment.newsBlackout;
   CanaryGateResult news=Gate("news",news_passed,
      news_passed ? "Calendar evidence is complete and no high-impact USD blackout is active."
                  : "Calendar evidence is unavailable or a high-impact USD blackout is active.");
   AppendCanaryGate(evaluation,news);

   bool log_passed=environment.logPreflightReady;
   CanaryGateResult log_preflight=Gate("log_preflight",log_passed,
      log_passed ? "The durable Common Files path passed its write preflight."
                 : "The durable Common Files path is missing or failed its write preflight.");
   AppendCanaryGate(evaluation,log_preflight);

   bool reconciliation_passed=environment.reconciliationComplete;
   CanaryGateResult reconciliation=Gate("reconciliation",reconciliation_passed,
      reconciliation_passed ? "Restart and unknown-state reconciliation evidence is complete."
                            : "Restart or unknown-state reconciliation evidence is incomplete.");
   AppendCanaryGate(evaluation,reconciliation);

   for(int index=0;index<ArraySize(evaluation.gates);index++)
   {
      if(!evaluation.gates[index].passed)
      {
         evaluation.blockingGate=evaluation.gates[index].name;
         evaluation.detail=evaluation.gates[index].detail;
         break;
      }
   }

   if(!environment.executionEnabled)
   {
      evaluation.state=CANARY_LIFECYCLE_DISABLED;
      evaluation.detail="Demo canary evaluation is disabled by local input.";
      evaluation.blockingGate="switches";
      evaluation.nextSafeAction="Keep disabled or enable only for an approved demo canary ceremony.";
      return evaluation;
   }
   if(environment.killSwitch)
   {
      evaluation.state=CANARY_LIFECYCLE_PAUSED;
      evaluation.detail="The persistent kill switch pauses new demo entries.";
      evaluation.blockingGate="switches";
      evaluation.nextSafeAction="Resolve the safety concern before turning the kill switch off.";
      return evaluation;
   }
   if(evaluation.blockingGate!="") return evaluation;

   evaluation.state=CANARY_LIFECYCLE_READY;
   evaluation.ready=true;
   evaluation.detail="Every dry-run gate passed; this build stops at readiness.";
   evaluation.nextSafeAction="Record readiness and await the separately reviewed execution gateway.";
   return evaluation;
}

#endif
