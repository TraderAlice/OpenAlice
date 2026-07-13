#ifndef OPENALICE_JMB_CANARY_POLICY_MQH
#define OPENALICE_JMB_CANARY_POLICY_MQH

#include "JmbCanaryCsv.mqh"

const string CANARY_POLICY_HEADER="schema_version,policy_version,broker,server,symbol,strategy_version,rollout_stage,candidate_approved,completed_observation_max_age_hours,max_spread,max_deviation,max_risk_amount,max_daily_loss,max_daily_losing_trades,max_volume,magic_number";

string CanaryAllowedServer(const string broker)
{
   if(broker=="hfmarkets") return "HFMarketsGlobal-Demo4";
   if(broker=="icmarkets") return "ICMarketsSC-Demo";
   return "";
}

long CanaryAllowedMagic(const string broker)
{
   if(broker=="hfmarkets") return 880101;
   if(broker=="icmarkets") return 880201;
   return 0;
}

double CanaryHardSpread(const string broker)
{
   if(broker=="hfmarkets") return 0.75;
   if(broker=="icmarkets") return 0.30;
   return 0.0;
}

double CanaryHardDeviation(const string broker)
{
   if(broker=="hfmarkets") return 0.50;
   if(broker=="icmarkets") return 0.30;
   return 0.0;
}

bool CanaryRolloutAuthorized(const string broker,const string rollout_stage)
{
   if(broker=="hfmarkets") return rollout_stage=="hfm_canary" || rollout_stage=="both_demo";
   if(broker=="icmarkets") return rollout_stage=="ic_canary" || rollout_stage=="both_demo";
   return false;
}

bool IsCanonicalCanaryPolicyVersion(const string value)
{
   if(value=="" || StringFind(value,",")>=0 || StringFind(value,"\"")>=0
      || StringFind(value,"\r")>=0 || StringFind(value,"\n")>=0) return false;
   string trimmed=value;
   StringTrimLeft(trimmed);
   StringTrimRight(trimmed);
   return trimmed==value;
}

bool ValidateCanaryPolicy(const CanaryPolicy &policy,string &detail)
{
   string allowed_server=CanaryAllowedServer(policy.broker);
   long allowed_magic=CanaryAllowedMagic(policy.broker);
   if(policy.schemaVersion!=1 || !IsCanonicalCanaryPolicyVersion(policy.policyVersion)
      || allowed_server=="" || policy.server!=allowed_server || policy.symbol!="XAUUSD"
      || policy.strategyVersion!="daily-trend-v1" || policy.magicNumber!=allowed_magic)
   {
      detail="Policy identity does not match the immutable demo allowlist.";
      return false;
   }
   if(policy.rolloutStage!="status_only" && policy.rolloutStage!="hfm_canary"
      && policy.rolloutStage!="ic_canary" && policy.rolloutStage!="both_demo")
   {
      detail="Policy rollout_stage enum is invalid.";
      return false;
   }
   if(policy.completedObservationMaxAgeHours<=0.0 || policy.completedObservationMaxAgeHours>72.0
      || policy.maxSpread<=0.0 || policy.maxSpread>CanaryHardSpread(policy.broker)
      || policy.maxDeviation<=0.0 || policy.maxDeviation>CanaryHardDeviation(policy.broker)
      || policy.maxRiskAmount<=0.0 || policy.maxRiskAmount>CANARY_HARD_MAX_RISK
      || policy.maxDailyLoss<=0.0 || policy.maxDailyLoss>CANARY_HARD_MAX_DAILY_LOSS
      || policy.maxDailyLosingTrades<=0 || policy.maxDailyLosingTrades>CANARY_HARD_MAX_DAILY_LOSSES
      || policy.maxVolume<=0.0 || policy.maxVolume>CANARY_HARD_MAX_VOLUME)
   {
      detail="Policy limit exceeds or invalidates an immutable hard ceiling.";
      return false;
   }
   detail="Policy matches the exact schema and immutable hard ceilings.";
   return true;
}

bool ReadCanaryPolicy(const string path,CanaryPolicy &policy,string &detail)
{
   string expected[];
   string header_copy=CANARY_POLICY_HEADER;
   if(StringSplit(header_copy,(ushort)StringGetCharacter(",",0),expected)!=16)
   {
      detail="Internal policy schema definition is invalid.";
      return false;
   }
   string values[];
   if(!ReadStrictCanaryCsv(path,expected,values,detail)) return false;

   long schema=0;
   long loss_count=0;
   long magic=0;
   double observation_age=0.0;
   double spread=0.0;
   double deviation=0.0;
   double risk=0.0;
   double daily_loss=0.0;
   double volume=0.0;
   if(!TryCanaryLong(values[0],schema) || schema!=1
      || !TryCanaryDouble(values[8],observation_age)
      || !TryCanaryDouble(values[9],spread)
      || !TryCanaryDouble(values[10],deviation)
      || !TryCanaryDouble(values[11],risk)
      || !TryCanaryDouble(values[12],daily_loss)
      || !TryCanaryLong(values[13],loss_count)
      || !TryCanaryDouble(values[14],volume)
      || !TryCanaryLong(values[15],magic)
      || (values[7]!="0" && values[7]!="1"))
   {
      detail="Policy contains a malformed number, boolean, or schema version.";
      return false;
   }

   policy.loaded=true;
   policy.schemaVersion=(int)schema;
   policy.policyVersion=values[1];
   policy.broker=values[2];
   policy.server=values[3];
   policy.symbol=values[4];
   policy.strategyVersion=values[5];
   policy.rolloutStage=values[6];
   policy.candidateApproved=values[7]=="1";
   policy.completedObservationMaxAgeHours=observation_age;
   policy.maxSpread=spread;
   policy.maxDeviation=deviation;
   policy.maxRiskAmount=risk;
   policy.maxDailyLoss=daily_loss;
   policy.maxDailyLosingTrades=(int)loss_count;
   policy.maxVolume=volume;
   policy.magicNumber=magic;

   if(!ValidateCanaryPolicy(policy,detail))
   {
      policy.loaded=false;
      return false;
   }
   return true;
}

#endif
