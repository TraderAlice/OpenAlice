// JMB Goldmine broker-local demo canary with one protected demo-order gateway.
#property strict
#property version "0.300"

#include "JmbCanaryTypes.mqh"
#include "JmbCanaryCsv.mqh"
#include "JmbCanaryPolicy.mqh"
#include "JmbCanaryGates.mqh"
#include "JmbCanaryState.mqh"
#include "JmbCanaryTradeGateway.mqh"

input string InpBrokerId = "";
input string InpExpectedServer = "";
input long   InpExpectedAccountLogin = 0;
input string InpSymbol = "XAUUSD";
input long   InpMagicNumber = 0;
input bool InpDemoExecutionEnabled = false;
input bool InpKillSwitch = true;

const string CANARY_POLICY_ROOT="OpenAliceMt5DemoPolicyV1";
const string CANARY_DECISION_ROOT="OpenAliceMt5ExecutionDecisionV1";

bool g_evaluating=false;
bool g_reconciliation_dirty=false;
bool g_last_submit_sent=false;
uint g_last_submit_retcode=0;
ulong g_last_submit_order_ticket=0;
ulong g_last_submit_deal_ticket=0;
string g_last_submit_detail="";

bool AppendCanaryOrderRequestingEvent(const CanaryDecision &decision,string &detail)
{
   EnsureCanaryDirectory(InpBrokerId,InpSymbol);
   string path=CanaryStatusDirectory(InpBrokerId,InpSymbol)+"\\events.jsonl";
   string line="{\"schema_version\":1,\"event_type\":\"order_requesting\",\"event_time\":\""
      +CanaryIsoTime(TimeGMT())+"\",\"broker\":\""+InpBrokerId+"\",\"server\":\""
      +InpExpectedServer+"\",\"account_mode\":\"demo\",\"symbol\":\"XAUUSD\",\"decision_id\":\""
      +decision.decisionId+"\",\"observation_id\":\""+decision.observationId
      +"\",\"result_code\":\"\",\"result_detail\":\"Request persistence completed before submission.\"}\r\n";
   int handle=FileOpen(path,FILE_READ|FILE_WRITE|FILE_BIN|FILE_ANSI|FILE_COMMON);
   if(handle==INVALID_HANDLE)
   {
      detail="The order-requesting journal could not be opened.";
      return false;
   }
   if(!FileSeek(handle,0,SEEK_END))
   {
      FileClose(handle);
      detail="The order-requesting journal could not seek to its append boundary.";
      return false;
   }
   uint written=FileWriteString(handle,line);
   if(written!=StringLen(line))
   {
      FileClose(handle);
      detail="The complete order-requesting event could not be appended.";
      return false;
   }
   FileFlush(handle);
   FileClose(handle);

   string reopened="";
   string read_detail="";
   if(!ReadCanaryCommonText(path,reopened,read_detail)
      || StringLen(reopened)<StringLen(line)
      || StringSubstr(reopened,StringLen(reopened)-StringLen(line))!=line)
   {
      detail="The flushed order-requesting event could not be verified exactly.";
      return false;
   }
   detail="The order-requesting event was appended, flushed, and verified.";
   return true;
}

bool CanaryProcessedStateIsExactAppend(const CanaryProcessedState &prior,
                                       const CanaryProcessedState &candidate,
                                       const CanaryDecision &decision,
                                       const datetime attempted_at)
{
   if(!prior.valid || !candidate.valid) return false;
   int prior_count=ArraySize(prior.observationIds);
   int candidate_count=ArraySize(candidate.observationIds);
   if(ArraySize(prior.decisionIds)!=prior_count || ArraySize(prior.attemptedAt)!=prior_count
      || candidate_count!=prior_count+1
      || ArraySize(candidate.decisionIds)!=candidate_count
      || ArraySize(candidate.attemptedAt)!=candidate_count) return false;
   for(int index=0;index<prior_count;index++)
   {
      if(candidate.decisionIds[index]!=prior.decisionIds[index]
         || candidate.observationIds[index]!=prior.observationIds[index]
         || candidate.attemptedAt[index]!=prior.attemptedAt[index]) return false;
   }
   return candidate.decisionIds[prior_count]==decision.decisionId
      && candidate.observationIds[prior_count]==decision.observationId
      && candidate.attemptedAt[prior_count]==attempted_at;
}

bool PersistCanaryAttempt(const string path,
                          const CanaryDecision &decision,
                          const CanaryProcessedState &processed_state,
                          string &detail)
{
   if(!processed_state.valid
      || CanaryProcessedStateContains(processed_state,decision.decisionId,decision.observationId))
   {
      detail="The observation is unavailable or already attempted.";
      return false;
   }
   datetime attempted_at=TimeGMT();
   if(attempted_at<=0)
   {
      detail="A durable attempt cannot be recorded without terminal UTC time.";
      return false;
   }

   EnsureCanaryDirectory(InpBrokerId,InpSymbol);
   string lock_path=CanaryStatusDirectory(InpBrokerId,InpSymbol)+"\\processed_observations.lock";
   int lock_handle=FileOpen(lock_path,FILE_WRITE|FILE_BIN|FILE_ANSI|FILE_COMMON);
   if(lock_handle==INVALID_HANDLE)
   {
      detail="Another canary instance owns the attempt-state lock.";
      return false;
   }
   CanaryProcessedState locked_state;
   InitializeCanaryProcessedState(locked_state);
   string verification_detail="";
   if(!LoadCanaryProcessedState(path,locked_state,verification_detail)
      || CanaryProcessedStateContains(locked_state,decision.decisionId,decision.observationId))
   {
      FileClose(lock_handle);
      FileDelete(lock_path,FILE_COMMON);
      detail="The locked attempt state is invalid or already contains this observation.";
      return false;
   }

   string temporary_path=path+"."+IntegerToString((int)GetTickCount())+".tmp";
   int handle=FileOpen(temporary_path,FILE_WRITE|FILE_CSV|FILE_ANSI|FILE_COMMON,',');
   if(handle==INVALID_HANDLE)
   {
      FileClose(lock_handle);
      FileDelete(lock_path,FILE_COMMON);
      detail="The temporary attempt store could not be opened.";
      return false;
   }
   uint header_written=FileWrite(handle,"schema_version","decision_id","observation_id","attempted_at");
   if(header_written==0)
   {
      FileClose(handle);
      FileDelete(temporary_path,FILE_COMMON);
      FileClose(lock_handle);
      FileDelete(lock_path,FILE_COMMON);
      detail="The attempt-store header could not be written.";
      return false;
   }
   for(int index=0;index<ArraySize(locked_state.observationIds);index++)
   {
      uint existing_written=FileWrite(handle,"1",locked_state.decisionIds[index],
         locked_state.observationIds[index],CanaryIsoTime(locked_state.attemptedAt[index]));
      if(existing_written==0)
      {
         FileClose(handle);
         FileDelete(temporary_path,FILE_COMMON);
         FileClose(lock_handle);
         FileDelete(lock_path,FILE_COMMON);
         detail="An existing durable attempt could not be preserved.";
         return false;
      }
   }
   uint attempt_written=FileWrite(handle,"1",decision.decisionId,decision.observationId,
      CanaryIsoTime(attempted_at));
   if(attempt_written==0)
   {
      FileClose(handle);
      FileDelete(temporary_path,FILE_COMMON);
      FileClose(lock_handle);
      FileDelete(lock_path,FILE_COMMON);
      detail="The new attempt could not be written.";
      return false;
   }
   FileFlush(handle);
   FileClose(handle);

   CanaryProcessedState temporary_state;
   InitializeCanaryProcessedState(temporary_state);
   if(!LoadCanaryProcessedState(temporary_path,temporary_state,verification_detail)
      || !CanaryProcessedStateIsExactAppend(locked_state,temporary_state,decision,attempted_at))
   {
      FileDelete(temporary_path,FILE_COMMON);
      FileClose(lock_handle);
      FileDelete(lock_path,FILE_COMMON);
      detail="The flushed attempt store failed strict verification.";
      return false;
   }
   if(!FileMove(temporary_path,FILE_COMMON,path,FILE_COMMON|FILE_REWRITE))
   {
      FileDelete(temporary_path,FILE_COMMON);
      FileClose(lock_handle);
      FileDelete(lock_path,FILE_COMMON);
      detail="The verified attempt store could not replace the durable state.";
      return false;
   }

   CanaryProcessedState durable_state;
   InitializeCanaryProcessedState(durable_state);
   if(!LoadCanaryProcessedState(path,durable_state,verification_detail)
      || !CanaryProcessedStateIsExactAppend(locked_state,durable_state,decision,attempted_at))
   {
      FileClose(lock_handle);
      FileDelete(lock_path,FILE_COMMON);
      detail="The replaced attempt store could not be reopened and verified.";
      return false;
   }
   FileClose(lock_handle);
   FileDelete(lock_path,FILE_COMMON);
   detail="The decision and observation attempt were durably recorded.";
   return true;
}

void SubmitReadyCanaryDecision(const CanaryDecision &decision,
                               const CanaryPolicy &policy,
                               const CanaryEvaluation &evaluation,
                               const CanaryProcessedState &processed_state,
                               const string processed_path,
                               const bool effective_execution_enabled,
                               const bool status_persisted)
{
   if(!status_persisted) return;
   if(!InpDemoExecutionEnabled || InpKillSwitch || !effective_execution_enabled
      || !evaluation.ready || evaluation.state!=CANARY_LIFECYCLE_READY) return;
   if(!processed_state.valid
      || CanaryProcessedStateContains(processed_state,decision.decisionId,decision.observationId)) return;

   string persistence_detail="";
   if(!AppendCanaryOrderRequestingEvent(decision,persistence_detail))
   {
      Print("JMB demo canary order-requesting event failed: ",persistence_detail);
      return;
   }
   if(!PersistCanaryAttempt(processed_path,decision,processed_state,persistence_detail))
   {
      Print("JMB demo canary attempt persistence failed: ",persistence_detail);
      return;
   }

   TradeSubmitResult submission=SubmitProtectedMarketOrder(decision,policy);
   g_last_submit_sent=submission.sent;
   g_last_submit_retcode=submission.retcode;
   g_last_submit_order_ticket=submission.order_ticket;
   g_last_submit_deal_ticket=submission.deal_ticket;
   g_last_submit_detail=submission.detail;
   g_reconciliation_dirty=true;
}

void InitializeCanaryPolicy(CanaryPolicy &policy)
{
   policy.loaded=false;
   policy.schemaVersion=0;
   policy.policyVersion="";
   policy.broker=InpBrokerId;
   policy.server=InpExpectedServer;
   policy.symbol=InpSymbol;
   policy.strategyVersion="daily-trend-v1";
   policy.rolloutStage="status_only";
   policy.candidateApproved=false;
   policy.completedObservationMaxAgeHours=0.0;
   policy.maxSpread=0.0;
   policy.maxDeviation=0.0;
   policy.maxRiskAmount=0.0;
   policy.maxDailyLoss=0.0;
   policy.maxDailyLosingTrades=0;
   policy.maxVolume=0.0;
   policy.magicNumber=0;
}

void InitializeCanaryDecision(CanaryDecision &decision)
{
   decision.loaded=false;
   decision.schemaVersion=0;
   decision.decisionId="";
   decision.observationId="";
   decision.observationAsOf="";
   decision.createdAt=0;
   decision.leaseIssuedAt=0;
   decision.leaseExpiresAt=0;
   decision.broker="";
   decision.server="";
   decision.accountMode="";
   decision.symbol="";
   decision.strategyVersion="";
   decision.direction="";
   decision.entryReferencePrice=0.0;
   decision.volume=0.0;
   decision.stopLoss=0.0;
   decision.maxRiskAmount=0.0;
   decision.candidatePolicyVersion="";
   decision.costModelVersion="";
   decision.gateResultsJson="";
   decision.preDecisionGatesPassed=false;
}

void InitializeCanaryEnvironment(CanaryEnvironment &environment)
{
   ZeroMemory(environment);
   environment.executionEnabled=InpDemoExecutionEnabled;
   environment.killSwitch=InpKillSwitch;
}

bool CanaryObservationIsFresh(const CanaryDecision &decision,const CanaryPolicy &policy,const datetime now)
{
   if(!decision.loaded || !policy.loaded || !IsCanaryIsoDate(decision.observationAsOf)) return false;
   string normalized=decision.observationAsOf;
   StringReplace(normalized,"-",".");
   datetime observation_time=StringToTime(normalized);
   double age_seconds=(double)(now-observation_time);
   return observation_time>0 && age_seconds>=0.0
      && age_seconds<=policy.completedObservationMaxAgeHours*3600.0;
}

bool CanaryVolumeEvidence(const CanaryDecision &decision,bool &compatible)
{
   compatible=false;
   double minimum=0.0;
   double maximum=0.0;
   double step=0.0;
   if(!SymbolInfoDouble(InpSymbol,SYMBOL_VOLUME_MIN,minimum)
      || !SymbolInfoDouble(InpSymbol,SYMBOL_VOLUME_MAX,maximum)
      || !SymbolInfoDouble(InpSymbol,SYMBOL_VOLUME_STEP,step)
      || minimum<=0.0 || maximum<minimum || step<=0.0) return false;
   double steps=MathRound(decision.volume/step);
   compatible=decision.volume>=minimum && decision.volume<=maximum
      && MathAbs(steps*step-decision.volume)<=0.00000001;
   return true;
}

bool CalculateCanaryStopRisk(const CanaryDecision &decision,
                             const MqlTick &tick,
                             bool &evidence_available,
                             bool &mode_supports_sl,
                             bool &tick_size_available,
                             bool &tick_aligned,
                             bool &stop_valid,
                             double &calculated_risk)
{
   evidence_available=false;
   mode_supports_sl=false;
   tick_size_available=false;
   tick_aligned=false;
   stop_valid=false;
   calculated_risk=0.0;
   if(decision.direction!="buy" && decision.direction!="sell") return false;
   long order_mode=0;
   long stops_level=0;
   double point=0.0;
   double tick_size=0.0;
   if(!SymbolInfoInteger(InpSymbol,SYMBOL_ORDER_MODE,order_mode)
      || !SymbolInfoInteger(InpSymbol,SYMBOL_TRADE_STOPS_LEVEL,stops_level)
      || !SymbolInfoDouble(InpSymbol,SYMBOL_POINT,point)
      || !SymbolInfoDouble(InpSymbol,SYMBOL_TRADE_TICK_SIZE,tick_size)) return false;
   evidence_available=true;
   mode_supports_sl=(order_mode&SYMBOL_ORDER_SL)==SYMBOL_ORDER_SL;
   tick_size_available=MathIsValidNumber(tick_size) && tick_size>0.0;
   if(!mode_supports_sl || !tick_size_available || !MathIsValidNumber(point) || point<=0.0 || stops_level<0)
      return false;
   double aligned_stop=MathRound(decision.stopLoss/tick_size)*tick_size;
   double alignment_tolerance=MathMax(0.00000001,tick_size*0.0000001);
   tick_aligned=MathAbs(decision.stopLoss-aligned_stop)<=alignment_tolerance;
   if(!tick_aligned) return false;
   double entry=decision.direction=="buy" ? tick.ask : tick.bid;
   double minimum_distance=(double)stops_level*point;
   stop_valid=decision.direction=="buy"
      ? decision.stopLoss<entry && entry-decision.stopLoss+alignment_tolerance>=minimum_distance
      : decision.stopLoss>entry && decision.stopLoss-entry+alignment_tolerance>=minimum_distance;
   if(!stop_valid) return false;

   ENUM_ORDER_TYPE calculation_type=decision.direction=="buy" ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   double projected_result=0.0;
   if(!OrderCalcProfit(calculation_type,InpSymbol,decision.volume,entry,decision.stopLoss,projected_result))
      return false;
   calculated_risk=MathAbs(projected_result);
   return MathIsValidNumber(calculated_risk) && calculated_risk>0.0;
}

bool CalculateCanaryMargin(const CanaryDecision &decision,const MqlTick &tick,double &estimated_margin)
{
   estimated_margin=0.0;
   if(decision.direction!="buy" && decision.direction!="sell") return false;
   ENUM_ORDER_TYPE calculation_type=decision.direction=="buy" ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   double entry=decision.direction=="buy" ? tick.ask : tick.bid;
   if(!OrderCalcMargin(calculation_type,InpSymbol,decision.volume,entry,estimated_margin)) return false;
   return MathIsValidNumber(estimated_margin) && estimated_margin>0.0;
}

bool ReadCanaryExposure(bool &has_ea_position,bool &has_ea_pending,bool &has_foreign_gold)
{
   has_ea_position=false;
   has_ea_pending=false;
   has_foreign_gold=false;

   for(int index=0;index<PositionsTotal();index++)
   {
      ulong ticket=PositionGetTicket(index);
      if(ticket==0) return false;
      if(PositionGetString(POSITION_SYMBOL)!=InpSymbol) continue;
      long magic=PositionGetInteger(POSITION_MAGIC);
      if(magic==InpMagicNumber) has_ea_position=true;
      else has_foreign_gold=true;
   }
   for(int index=0;index<OrdersTotal();index++)
   {
      ulong ticket=OrderGetTicket(index);
      if(ticket==0) return false;
      if(OrderGetString(ORDER_SYMBOL)!=InpSymbol) continue;
      long magic=OrderGetInteger(ORDER_MAGIC);
      if(magic==InpMagicNumber) has_ea_pending=true;
      else has_foreign_gold=true;
   }
   return true;
}

datetime CanaryBrokerDayStart()
{
   MqlDateTime parts;
   TimeToStruct(TimeTradeServer(),parts);
   parts.hour=0;
   parts.min=0;
   parts.sec=0;
   return StructToTime(parts);
}

bool ReadCanaryDailyLoss(int &loss_count,double &realized_loss)
{
   loss_count=0;
   realized_loss=0.0;
   datetime now=TimeTradeServer();
   if(now<=0 || !HistorySelect(CanaryBrokerDayStart(),now)) return false;
   int total=HistoryDealsTotal();
   for(int index=0;index<total;index++)
   {
      ulong ticket=HistoryDealGetTicket(index);
      if(ticket==0) return false;
      if(HistoryDealGetString(ticket,DEAL_SYMBOL)!=InpSymbol
         || HistoryDealGetInteger(ticket,DEAL_MAGIC)!=InpMagicNumber) continue;
      ENUM_DEAL_ENTRY entry=(ENUM_DEAL_ENTRY)HistoryDealGetInteger(ticket,DEAL_ENTRY);
      if(entry!=DEAL_ENTRY_OUT && entry!=DEAL_ENTRY_OUT_BY) continue;
      double net=HistoryDealGetDouble(ticket,DEAL_PROFIT)
         +HistoryDealGetDouble(ticket,DEAL_COMMISSION)
         +HistoryDealGetDouble(ticket,DEAL_SWAP)
         +HistoryDealGetDouble(ticket,DEAL_FEE);
      if(!MathIsValidNumber(net)) return false;
      if(net<0.0)
      {
         loss_count++;
         realized_loss+=MathAbs(net);
      }
   }
   return true;
}

bool CanarySessionOpen(const datetime now)
{
   MqlDateTime parts;
   if(!TimeToStruct(now,parts)) return false;
   if(parts.day_of_week==0 || parts.day_of_week==6) return false;
   if(parts.day_of_week>=1 && parts.day_of_week<=4) return parts.hour>=6 && parts.hour<20;
   return parts.day_of_week==5 && parts.hour>=6 && parts.hour<16;
}

bool ReadCanaryNewsBlackout(const datetime now,bool &blackout)
{
   blackout=false;
   MqlCalendarValue values[];
   ResetLastError();
   int count=CalendarValueHistory(values,now-CANARY_NEWS_WINDOW_SECONDS,
                                  now+CANARY_NEWS_WINDOW_SECONDS,NULL,"USD");
   if(count<0) return false;
   for(int index=0;index<count;index++)
   {
      if(values[index].event_id==0) return false;
      MqlCalendarEvent event;
      if(!CalendarEventById(values[index].event_id,event)) return false;
      if(event.importance==CALENDAR_IMPORTANCE_HIGH)
      {
         blackout=true;
         return true;
      }
   }
   return true;
}

void BuildCanaryEnvironment(const CanaryDecision &decision,
                            const CanaryPolicy &policy,
                            const CanaryProcessedState &processed_state,
                            CanaryEnvironment &environment)
{
   InitializeCanaryEnvironment(environment);
   datetime now=TimeGMT();
   string account_server=AccountInfoString(ACCOUNT_SERVER);

   environment.accountIsDemo=(ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO;
   environment.loginMatches=AccountInfoInteger(ACCOUNT_LOGIN)==InpExpectedAccountLogin;
   environment.serverMatches=account_server==InpExpectedServer
      && (!policy.loaded || policy.server==InpExpectedServer)
      && (!decision.loaded || decision.server==InpExpectedServer);
   environment.brokerMatches=policy.loaded && decision.loaded
      && policy.broker==InpBrokerId && decision.broker==InpBrokerId;
   environment.chartSymbolMatches=_Symbol==InpSymbol;
   environment.magicMatches=policy.loaded && policy.magicNumber==InpMagicNumber;

   environment.rolloutAuthorized=policy.loaded && CanaryRolloutAuthorized(InpBrokerId,policy.rolloutStage);
   environment.candidateApproved=policy.loaded && policy.candidateApproved;
   environment.allowlistsMatch=policy.loaded && decision.loaded
      && InpSymbol=="XAUUSD" && policy.symbol=="XAUUSD" && decision.symbol=="XAUUSD"
      && policy.strategyVersion=="daily-trend-v1" && decision.strategyVersion=="daily-trend-v1"
      && (decision.direction=="buy" || decision.direction=="sell")
      && policy.server==CanaryAllowedServer(InpBrokerId)
      && policy.magicNumber==CanaryAllowedMagic(InpBrokerId);

   environment.decisionFresh=decision.loaded && now>=decision.leaseIssuedAt && now<=decision.leaseExpiresAt;
   environment.bridgeFresh=decision.loaded && decision.preDecisionGatesPassed;
   environment.policyFresh=policy.loaded && decision.loaded
      && decision.candidatePolicyVersion==policy.policyVersion;
   environment.costModelFresh=decision.loaded && decision.preDecisionGatesPassed
      && IsCanonicalCanaryText(decision.costModelVersion);
   environment.observationFresh=CanaryObservationIsFresh(decision,policy,now);
   environment.processedStateAvailable=processed_state.valid;
   environment.observationUnused=decision.loaded && processed_state.valid
      && !CanaryProcessedStateContains(processed_state,decision.decisionId,decision.observationId);

   environment.volumeEvidenceAvailable=decision.loaded && CanaryVolumeEvidence(decision,environment.volumeCompatible);

   MqlTick tick;
   bool has_tick=decision.loaded && SymbolSelect(InpSymbol,true) && SymbolInfoTick(InpSymbol,tick);
   if(has_tick)
   {
      environment.riskCalculationAvailable=CalculateCanaryStopRisk(decision,tick,
         environment.stopEvidenceAvailable,environment.stopModeSupportsSl,
         environment.stopTickSizeAvailable,environment.stopTickAligned,
         environment.stopBrokerValid,environment.calculatedStopRisk);
      environment.marginCalculationAvailable=CalculateCanaryMargin(decision,tick,environment.estimatedMargin);
      environment.freeMargin=AccountInfoDouble(ACCOUNT_MARGIN_FREE);
      environment.spreadAvailable=tick.ask>=tick.bid && tick.bid>0.0;
      environment.currentSpread=tick.ask-tick.bid;
   }

   environment.dailyStateAvailable=ReadCanaryDailyLoss(environment.dailyLossCount,environment.dailyRealizedLoss);
   environment.exposureStateAvailable=ReadCanaryExposure(environment.hasEaPosition,
      environment.hasEaPendingOrder,environment.hasForeignGoldExposure);
   environment.deviationAvailable=policy.loaded;
   environment.requestedDeviation=policy.loaded ? policy.maxDeviation : 0.0;
   environment.sessionEvidenceAvailable=now>0;
   environment.sessionOpen=now>0 && CanarySessionOpen(now);
   datetime calendar_now=TimeTradeServer();
   environment.newsEvidenceAvailable=calendar_now>0
      && ReadCanaryNewsBlackout(calendar_now,environment.newsBlackout);
   environment.logPreflightReady=PreflightCanaryLog(InpBrokerId,InpSymbol);
   environment.reconciliationComplete=!g_reconciliation_dirty
      && environment.dailyStateAvailable && environment.exposureStateAvailable;
}

bool ValidateCanaryInputs()
{
   return InpExpectedAccountLogin>0
      && InpSymbol=="XAUUSD"
      && (InpBrokerId=="hfmarkets" || InpBrokerId=="icmarkets")
      && InpExpectedServer==CanaryAllowedServer(InpBrokerId)
      && InpMagicNumber==CanaryAllowedMagic(InpBrokerId);
}

void Evaluate()
{
   if(g_evaluating) return;
   g_evaluating=true;

   CanaryPolicy policy;
   InitializeCanaryPolicy(policy);
   CanaryDecision decision;
   InitializeCanaryDecision(decision);
   string read_detail="";
   string policy_path=CANARY_POLICY_ROOT+"\\"+InpBrokerId+"\\"+InpSymbol+"\\policy.csv";
   if(!ReadCanaryPolicy(policy_path,policy,read_detail)) InitializeCanaryPolicy(policy);
   string decision_path=CANARY_DECISION_ROOT+"\\"+InpBrokerId+"\\"+InpSymbol+"\\latest_decision.csv";
   ReadCanaryDecision(decision_path,TimeGMT(),decision,read_detail);

   CanaryProcessedState processed_state;
   InitializeCanaryProcessedState(processed_state);
   string processed_path=CanaryProcessedStatePath(InpBrokerId,InpSymbol);
   LoadCanaryProcessedState(processed_path,processed_state,read_detail);

   CanaryEnvironment environment;
   BuildCanaryEnvironment(decision,policy,processed_state,environment);
   CanaryEvaluation evaluation=EvaluateCanaryGates(decision,policy,environment);
   bool effective_execution_enabled=CanaryEffectiveExecutionEnabled(InpDemoExecutionEnabled,policy);

   string write_detail="";
   bool status_persisted=WriteCanaryLatestStatus(InpBrokerId,AccountInfoString(ACCOUNT_SERVER),InpSymbol,
      policy,decision,evaluation,effective_execution_enabled,InpKillSwitch,
      environment.dailyLossCount,environment.dailyRealizedLoss,write_detail);
   if(!status_persisted)
      Print("JMB demo canary status publication failed: ",write_detail);
   SubmitReadyCanaryDecision(decision,policy,evaluation,processed_state,processed_path,
      effective_execution_enabled,status_persisted);

   g_evaluating=false;
}

void PublishCanarySchedulerFailure()
{
   CanaryPolicy policy;
   InitializeCanaryPolicy(policy);
   CanaryDecision decision;
   InitializeCanaryDecision(decision);
   CanaryEvaluation evaluation;
   evaluation.state=CANARY_LIFECYCLE_BLOCKED;
   evaluation.ready=false;
   evaluation.detail="The ten-second evaluation timer could not be started.";
   evaluation.blockingGate="scheduler";
   evaluation.nextSafeAction="Keep the canary disabled and resolve the terminal timer failure.";
   ArrayResize(evaluation.gates,0);
   string write_detail="";
   if(!WriteCanaryLatestStatus(InpBrokerId,AccountInfoString(ACCOUNT_SERVER),InpSymbol,
      policy,decision,evaluation,false,InpKillSwitch,0,0.0,write_detail))
      Print("JMB demo canary scheduler failure status could not be published: ",write_detail);
}

int OnInit()
{
   if(InpExpectedAccountLogin<=0 || InpSymbol!="XAUUSD") return INIT_PARAMETERS_INCORRECT;
   if(!ValidateCanaryInputs()) return INIT_PARAMETERS_INCORRECT;
   if(!EventSetTimer(10))
   {
      PublishCanarySchedulerFailure();
      Print("JMB demo canary initialization failed because its evaluation timer is unavailable.");
      return INIT_FAILED;
   }
   Evaluate();
   return INIT_SUCCEEDED;
}

void OnTimer() { Evaluate(); }
void OnTick()  { Evaluate(); }
void OnTradeTransaction(const MqlTradeTransaction &transaction,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
{
   g_reconciliation_dirty=true;
   return;
}
void OnDeinit(const int reason) { EventKillTimer(); }
