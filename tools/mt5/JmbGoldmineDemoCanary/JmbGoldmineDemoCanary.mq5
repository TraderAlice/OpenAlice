// JMB Goldmine broker-local demo canary with one protected demo-order gateway.
#property strict
#property version "1.300"

#include "JmbCanaryTypes.mqh"
#include "JmbCanaryCsv.mqh"
#include "JmbCanaryPolicy.mqh"
#include "JmbCanaryGates.mqh"
#include "JmbCanaryState.mqh"
#include "JmbCanaryReconcile.mqh"
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
bool g_reconciliation_dirty=true;
bool g_last_submit_sent=false;
uint g_last_submit_retcode=0;
ulong g_last_submit_order_ticket=0;
ulong g_last_submit_deal_ticket=0;
double g_last_submit_accepted_volume=0.0;
double g_last_submit_accepted_price=0.0;
string g_last_submit_detail="";
CanaryBrokerResultClass g_last_result_class=CANARY_RESULT_NONE;
CanaryExecutionEvent g_latest_event;

void BuildCanaryLifecycleEvent(const CanaryDecision &decision,
                               const CanaryReconciliation &reconciliation,
                               const CanaryLifecycleState state,
                               const string result_code,const string result_detail,
                               const double calculated_risk,
                               CanaryExecutionEvent &event)
{
   InitializeCanaryExecutionEvent(event);
   event.eventType=state;
   event.eventTime=TimeGMT();
   event.broker=InpBrokerId;
   event.server=InpExpectedServer;
   event.accountLogin=AccountInfoInteger(ACCOUNT_LOGIN);
   event.decisionId=decision.loaded ? decision.decisionId : "";
   event.observationId=decision.loaded ? decision.observationId : "";
   event.gateResultsJson=decision.loaded ? decision.gateResultsJson : "[]";
   event.hasCalculatedRisk=decision.loaded && calculated_risk>0.0;
   event.calculatedRisk=calculated_risk;
   event.hasRequestedOrder=decision.loaded;
   event.requestedVolume=decision.volume;
   event.requestedPrice=decision.entryReferencePrice;
   event.requestedStopLoss=decision.stopLoss;
   event.hasAcceptedOrder=reconciliation.position.present;
   event.hasAcceptedStopLoss=reconciliation.position.present && reconciliation.position.stopProtected;
   event.acceptedVolume=reconciliation.position.present ? reconciliation.position.volume : g_last_submit_accepted_volume;
   event.acceptedPrice=reconciliation.position.present ? reconciliation.position.openPrice : g_last_submit_accepted_price;
   event.acceptedStopLoss=reconciliation.position.present ? reconciliation.position.stopLoss : 0.0;
   event.resultCode=result_code;
   event.resultDetail=result_detail;
   event.orderTicket=g_last_submit_order_ticket;
   event.dealTicket=reconciliation.dealTicket!=0 ? reconciliation.dealTicket : g_last_submit_deal_ticket;
   event.positionId=reconciliation.position.present ? reconciliation.position.identifier : reconciliation.closedPositionId;
   event.reconciliationState=reconciliation.reconciliationState;
   event.dailyLossCount=reconciliation.daily.lossCount;
   event.dailyRealizedLoss=reconciliation.daily.realizedLoss;
   event.hasOutcome=reconciliation.hasClosedPosition;
   event.commission=reconciliation.commission;
   event.swap=reconciliation.swap;
   event.fee=reconciliation.fee;
   event.netResult=reconciliation.netResult;
}

bool AppendCanaryOrderRequestingEvent(const CanaryDecision &decision,
                                      const double calculated_risk,string &detail)
{
   CanaryReconciliation reconciliation;
   InitializeCanaryReconciliation(reconciliation);
   reconciliation.reconciliationState="pending";
   CanaryExecutionEvent candidate;
   BuildCanaryLifecycleEvent(decision,reconciliation,CANARY_LIFECYCLE_ORDER_REQUESTING,"",
      "Request persistence completed before submission.",calculated_risk,candidate);
   if(!AppendCanaryExecutionEvent(candidate,detail)) return false;
   g_latest_event=candidate;
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
                               const bool status_persisted,
                               const double calculated_risk)
{
   if(!status_persisted) return;
   if(!InpDemoExecutionEnabled || InpKillSwitch || !effective_execution_enabled
      || !evaluation.ready || evaluation.state!=CANARY_LIFECYCLE_READY) return;
   if(!processed_state.valid
      || CanaryProcessedStateContains(processed_state,decision.decisionId,decision.observationId)) return;

   string persistence_detail="";
   if(!AppendCanaryOrderRequestingEvent(decision,calculated_risk,persistence_detail))
   {
      Print("JMB demo canary order-requesting event failed: ",persistence_detail);
      return;
   }
   if(!PersistCanaryAttempt(processed_path,decision,processed_state,persistence_detail))
   {
      Print("JMB demo canary attempt persistence failed: ",persistence_detail);
      return;
   }

   CanarySafetyLatch latch;
   string latch_detail="";
   if(!LoadCanarySafetyLatch(InpBrokerId,InpSymbol,latch,latch_detail))
   {
      InitializeCanarySafetyLatch(latch);
      latch.valid=true;
   }
   if(latch.pendingEntryDecisionId!="") return;
   datetime pending_entry_attempted_at=TimeTradeServer();
   if(pending_entry_attempted_at<=0) return;
   latch.valid=true;
   latch.unresolved=true;
   latch.pendingEntryDecisionId=decision.decisionId;
   latch.pendingEntryObservationId=decision.observationId;
   latch.pendingEntryAttemptedAt=pending_entry_attempted_at;
   latch.pendingEntryOrderId="";
   latch.pendingEntryDealId="";
   latch.pendingRequestedVolume=decision.volume;
   latch.pendingRequestedPrice=decision.entryReferencePrice;
   latch.pendingRequestedStopLoss=decision.stopLoss;
   latch.pendingCalculatedRisk=calculated_risk;
   latch.pendingEntryComment=CanaryEntryCorrelationComment(decision.decisionId);
   if(!PersistCanarySafetyLatch(InpBrokerId,InpSymbol,latch,latch_detail))
   {
      Print("JMB demo canary pre-submit correlation latch failed: ",latch_detail);
      return;
   }

   TradeSubmitResult submission=SubmitProtectedMarketOrder(decision,policy,InpBrokerId,
      InpExpectedServer,InpExpectedAccountLogin,InpSymbol,InpMagicNumber);
   g_last_submit_sent=submission.sent;
   g_last_submit_retcode=submission.retcode;
   g_last_submit_order_ticket=submission.order_ticket;
   g_last_submit_deal_ticket=submission.deal_ticket;
   g_last_submit_accepted_volume=submission.accepted_volume;
   g_last_submit_accepted_price=submission.accepted_price;
   g_last_submit_detail=submission.detail;
   g_last_result_class=ClassifyCanaryBrokerResult(submission.sent,submission.retcode,
      decision.volume,submission.accepted_volume);
   latch.pendingEntryOrderId=CanaryTicketString(submission.order_ticket);
   latch.pendingEntryDealId=CanaryTicketString(submission.deal_ticket);
   if(g_last_result_class==CANARY_RESULT_REJECTED)
   {
      latch.unresolved=false;
      ClearCanaryPendingEntryLatch(latch);
   }

   CanaryReconciliation pending;
   InitializeCanaryReconciliation(pending);
   pending.reconciliationState=g_last_result_class==CANARY_RESULT_REJECTED ? "terminal" : "required";
   CanaryLifecycleState result_state=g_last_result_class==CANARY_RESULT_REJECTED
      ? CANARY_LIFECYCLE_ORDER_REJECTED : CANARY_LIFECYCLE_RECONCILIATION_REQUIRED;
   CanaryExecutionEvent candidate;
   BuildCanaryLifecycleEvent(decision,pending,result_state,IntegerToString((long)submission.retcode),
      submission.detail,calculated_risk,candidate);
   candidate.hasAcceptedOrder=submission.accepted_volume>0.0;
   candidate.acceptedVolume=submission.accepted_volume;
   candidate.acceptedPrice=submission.accepted_price;
   candidate.orderTicket=submission.order_ticket;
   candidate.dealTicket=submission.deal_ticket;
   if(!AppendCanaryExecutionEvent(candidate,persistence_detail))
   {
      latch.unresolved=true;
      g_last_result_class=CANARY_RESULT_UNKNOWN;
   }
   else g_latest_event=candidate;
   if(!PersistCanarySafetyLatch(InpBrokerId,InpSymbol,latch,latch_detail))
      Print("JMB demo canary reconciliation latch persistence failed: ",latch_detail);
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
                            const CanaryReconciliation &reconciliation,
                            const CanarySafetyLatch &latch,
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

   environment.dailyStateAvailable=reconciliation.available;
   environment.dailyLossCount=reconciliation.daily.lossCount;
   environment.dailyRealizedLoss=reconciliation.daily.realizedLoss;
   environment.exposureStateAvailable=reconciliation.available;
   environment.hasEaPosition=reconciliation.position.present;
   environment.hasEaPendingOrder=reconciliation.hasEaPendingOrder;
   environment.hasForeignGoldExposure=reconciliation.hasForeignGoldExposure;
   environment.deviationAvailable=policy.loaded;
   environment.requestedDeviation=policy.loaded ? policy.maxDeviation : 0.0;
   environment.sessionEvidenceAvailable=now>0;
   environment.sessionOpen=now>0 && CanarySessionOpen(now);
   datetime calendar_now=TimeTradeServer();
   environment.newsEvidenceAvailable=calendar_now>0
      && ReadCanaryNewsBlackout(calendar_now,environment.newsBlackout);
   environment.logPreflightReady=PreflightCanaryLog(InpBrokerId,InpSymbol);
   environment.reconciliationComplete=!g_reconciliation_dirty && reconciliation.available
      && reconciliation.state!=CANARY_LIFECYCLE_RECONCILIATION_REQUIRED
      && reconciliation.state!=CANARY_LIFECYCLE_EMERGENCY_CLOSE
      && !latch.unresolved && !latch.protectionError;
}

bool ValidateCanaryInputs()
{
   return InpExpectedAccountLogin>0
      && InpSymbol=="XAUUSD"
      && (InpBrokerId=="hfmarkets" || InpBrokerId=="icmarkets")
      && InpExpectedServer==CanaryAllowedServer(InpBrokerId)
      && InpMagicNumber==CanaryAllowedMagic(InpBrokerId);
}

bool AppendManagedCanaryEvent(const CanaryDecision &decision,
                              const CanaryReconciliation &reconciliation,
                              const CanaryLifecycleState state,
                              const string result_code,const string result_detail)
{
   CanaryExecutionEvent candidate;
   BuildCanaryLifecycleEvent(decision,reconciliation,state,result_code,result_detail,0.0,candidate);
   string detail="";
   if(AppendCanaryExecutionEvent(candidate,detail))
   {
      g_latest_event=candidate;
      return true;
   }
   Print("JMB demo canary lifecycle event failed: ",detail);
   return false;
}

bool AppendManagedCanaryPositionEvent(const CanaryDecision &decision,
                                      const CanaryReconciliation &reconciliation,
                                      const CanaryLifecycleState state,
                                      const string result_code,const string result_detail,
                                      const CanarySafetyLatch &latch)
{
   CanaryExecutionEvent candidate;
   BuildCanaryLifecycleEvent(decision,reconciliation,state,result_code,result_detail,0.0,candidate);
   if(!ApplyCanaryPositionCorrelation(candidate,latch)) return false;
   string detail="";
   if(AppendCanaryExecutionEvent(candidate,detail))
   {
      g_latest_event=candidate;
      return true;
   }
   Print("JMB demo canary correlated lifecycle event failed: ",detail);
   return false;
}

bool HandleCanaryEmergencyClose(const CanaryDecision &decision,const CanaryPolicy &policy,
                                const CanaryReconciliation &reconciliation,
                                CanarySafetyLatch &latch)
{
   latch.valid=true;
   latch.protectionError=true;
   latch.unresolved=true;
   if(latch.emergencyCloseAttempted) return false;
   if(!AppendManagedCanaryPositionEvent(decision,reconciliation,CANARY_LIFECYCLE_EMERGENCY_CLOSE,"",
      "Emergency protective close is durably requesting.",latch)) return false;
   latch.emergencyCloseAttempted=true;
   latch.emergencyPositionId=CanaryTicketString(reconciliation.position.identifier);
   string detail="";
   if(!PersistCanarySafetyLatch(InpBrokerId,InpSymbol,latch,detail))
   {
      Print("JMB demo canary emergency latch failed: ",detail);
      return false;
   }

   TradeSubmitResult submission=SubmitCanaryEmergencyClose(reconciliation.position,policy,
      InpBrokerId,InpExpectedServer,InpExpectedAccountLogin,InpSymbol,InpMagicNumber);
   g_last_submit_sent=submission.sent;
   g_last_submit_retcode=submission.retcode;
   g_last_submit_order_ticket=submission.order_ticket;
   g_last_submit_deal_ticket=submission.deal_ticket;
   g_last_submit_accepted_volume=submission.accepted_volume;
   g_last_submit_accepted_price=submission.accepted_price;
   g_last_submit_detail=submission.detail;
   g_last_result_class=ClassifyCanaryBrokerResult(submission.sent,submission.retcode,
      reconciliation.position.volume,submission.accepted_volume);
   AppendManagedCanaryPositionEvent(decision,reconciliation,CANARY_LIFECYCLE_EMERGENCY_CLOSE,
      IntegerToString((long)submission.retcode),submission.detail,latch);
   PersistCanarySafetyLatch(InpBrokerId,InpSymbol,latch,detail);
   g_reconciliation_dirty=true;
   return true;
}

bool HandleCanaryOppositeClose(const CanaryDecision &decision,const CanaryPolicy &policy,
                               const CanaryProcessedState &processed_state,
                               const string processed_path,
                               const CanaryReconciliation &reconciliation,
                               CanarySafetyLatch &latch)
{
   if(latch.pendingCloseDecisionId!="") return false;
   if(!AppendManagedCanaryEvent(decision,reconciliation,CANARY_LIFECYCLE_CLOSE_REQUESTING,"",
      "Opposite-signal close is durably requesting before its sole broker call.")) return false;
   latch.valid=true;
   latch.unresolved=true;
   latch.pendingCloseDecisionId=decision.decisionId;
   latch.pendingCloseObservationId=decision.observationId;
   string detail="";
   if(!PersistCanarySafetyLatch(InpBrokerId,InpSymbol,latch,detail))
   {
      Print("JMB demo canary opposite-close latch failed: ",detail);
      return false;
   }

   TradeSubmitResult submission=SubmitCanaryReversalClose(reconciliation.position,decision,policy,
      InpBrokerId,InpExpectedServer,InpExpectedAccountLogin,InpSymbol,InpMagicNumber);
   g_last_submit_sent=submission.sent;
   g_last_submit_retcode=submission.retcode;
   g_last_submit_order_ticket=submission.order_ticket;
   g_last_submit_deal_ticket=submission.deal_ticket;
   g_last_submit_accepted_volume=submission.accepted_volume;
   g_last_submit_accepted_price=submission.accepted_price;
   g_last_submit_detail=submission.detail;
   g_last_result_class=ClassifyCanaryBrokerResult(submission.sent,submission.retcode,
      reconciliation.position.volume,submission.accepted_volume);
   CanaryLifecycleState result_state=g_last_result_class==CANARY_RESULT_REJECTED
      ? CANARY_LIFECYCLE_ORDER_REJECTED : CANARY_LIFECYCLE_RECONCILIATION_REQUIRED;
   AppendManagedCanaryEvent(decision,reconciliation,result_state,
      IntegerToString((long)submission.retcode),submission.detail);
   if(g_last_result_class==CANARY_RESULT_REJECTED)
   {
      string attempt_detail="";
      if(PersistCanaryAttempt(processed_path,decision,processed_state,attempt_detail))
      {
         latch.unresolved=false;
         latch.pendingCloseDecisionId="";
         latch.pendingCloseObservationId="";
      }
   }
   PersistCanarySafetyLatch(InpBrokerId,InpSymbol,latch,detail);
   g_reconciliation_dirty=true;
   return true;
}

bool PersistCanarySameDirectionNoOp(const CanaryDecision &decision,
                                    const CanaryProcessedState &processed_state,
                                    const string processed_path,
                                    const CanaryReconciliation &reconciliation,
                                    CanarySafetyLatch &latch)
{
   if(!AppendManagedCanaryEvent(decision,reconciliation,CANARY_LIFECYCLE_FILLED_PROTECTED,"",
      "Same-direction observation is a durable no-op; no broker request was made.")) return false;
   string detail="";
   if(PersistCanaryAttempt(processed_path,decision,processed_state,detail)) return true;
   latch.valid=true;
   latch.unresolved=true;
   PersistCanarySafetyLatch(InpBrokerId,InpSymbol,latch,detail);
   return false;
}

bool ConfirmCanaryOppositeClosure(const CanaryDecision &decision,
                                  const CanaryReconciliation &reconciliation,
                                  CanarySafetyLatch &latch)
{
   bool closed_event_recorded=CanaryLifecycleEventRecorded(InpBrokerId,CANARY_LIFECYCLE_CLOSED,
      reconciliation.closedPositionId);
   if(!closed_event_recorded
      && !AppendManagedCanaryPositionEvent(decision,reconciliation,CANARY_LIFECYCLE_CLOSED,"",
         "Opposite-signal closure is broker-confirmed and durable before gate re-evaluation.",latch)) return false;
   latch.unresolved=false;
   latch.pendingCloseDecisionId="";
   latch.pendingCloseObservationId="";
   ClearCanaryActivePositionCorrelation(latch);
   string detail="";
   if(!PersistCanarySafetyLatch(InpBrokerId,InpSymbol,latch,detail))
   {
      Print("JMB demo canary confirmed-close latch failed: ",detail);
      return false;
   }
   return true;
}

bool ConfirmCanaryEmergencyClosure(const CanaryDecision &decision,
                                   const CanaryReconciliation &reconciliation,
                                   CanarySafetyLatch &latch)
{
   if(!reconciliation.authoritativeEmergencyClosure || reconciliation.closedPositionId==0)
      return false;
   string closed_position_id=CanaryTicketString(reconciliation.closedPositionId);
   if(latch.activePositionDecisionId!="" && latch.activePositionId!=closed_position_id)
      return false;

   if(latch.activePositionDecisionId==""
      && !ActivateCanaryPositionCorrelation(latch,reconciliation.closedPositionId)) return false;
   CanaryReconciliation terminal_reconciliation;
   terminal_reconciliation=reconciliation;
   terminal_reconciliation.state=CANARY_LIFECYCLE_CLOSED;
   terminal_reconciliation.reconciliationState="reconciled";
   CanaryExecutionEvent expected_terminal;
   BuildCanaryLifecycleEvent(decision,terminal_reconciliation,CANARY_LIFECYCLE_CLOSED,"",
      "Emergency protection closure is broker-confirmed with its opening evidence.",0.0,
      expected_terminal);
   if(!ApplyCanaryPositionCorrelation(expected_terminal,latch)) return false;
   bool any_terminal_event_durable=CanaryLifecycleEventRecorded(InpBrokerId,
      CANARY_LIFECYCLE_CLOSED,reconciliation.closedPositionId);
   bool terminal_event_durable=CanaryCorrelatedTerminalEventRecorded(InpBrokerId,
      expected_terminal);
   if(any_terminal_event_durable && !terminal_event_durable) return false;
   if(!terminal_event_durable)
   {
      terminal_event_durable=AppendManagedCanaryPositionEvent(decision,terminal_reconciliation,
         CANARY_LIFECYCLE_CLOSED,"",
         "Emergency protection closure is broker-confirmed with its opening evidence.",latch);
   }

   CanarySafetyLatch finalized_latch;
   finalized_latch=latch;
   if(!FinalizeCanaryEmergencyTerminalCorrelation(finalized_latch,terminal_event_durable)) return false;
   string detail="";
   if(!PersistCanarySafetyLatch(InpBrokerId,InpSymbol,finalized_latch,detail))
   {
      Print("JMB demo canary emergency-terminal latch failed: ",detail);
      return false;
   }
   latch=finalized_latch;
   return true;
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

   CanarySafetyLatch latch;
   bool latch_loaded=LoadCanarySafetyLatch(InpBrokerId,InpSymbol,latch,read_detail);
   if(!latch_loaded)
   {
      InitializeCanarySafetyLatch(latch);
      latch.valid=true;
      latch.unresolved=true;
   }
   bool observation_used=decision.loaded && processed_state.valid
      && CanaryProcessedStateContains(processed_state,decision.decisionId,decision.observationId);
   CanaryReconciliation reconciliation;
   bool reconciled=ReconcileCanaryBrokerState(InpSymbol,InpMagicNumber,decision,observation_used,
      g_last_result_class,latch,reconciliation);
   g_reconciliation_dirty=!reconciled;
   if(!reconciled)
   {
      latch.valid=true;
      latch.unresolved=true;
      string unresolved_detail="";
      PersistCanarySafetyLatch(InpBrokerId,InpSymbol,latch,unresolved_detail);
   }

   if(reconciled && reconciliation.state==CANARY_LIFECYCLE_FILLED_PROTECTED
      && latch.unresolved && !latch.protectionError)
   {
      string latch_detail="";
      bool correlation_activated=ActivateCanaryPositionCorrelation(latch,
         reconciliation.position.identifier);
      if(correlation_activated)
      {
         latch.unresolved=false;
         ClearCanaryPendingEntryLatch(latch);
         if(PersistCanarySafetyLatch(InpBrokerId,InpSymbol,latch,latch_detail))
         {
            g_last_result_class=CANARY_RESULT_NONE;
            reconciled=ReconcileCanaryBrokerState(InpSymbol,InpMagicNumber,decision,observation_used,
               CANARY_RESULT_NONE,latch,reconciliation);
            g_reconciliation_dirty=!reconciled;
         }
      }
      else g_reconciliation_dirty=true;
   }

   if(reconciled && reconciliation.state==CANARY_LIFECYCLE_STOPPED
      && reconciliation.authoritativeStopClosure && latch.unresolved)
   {
      string stopped_latch_detail="";
      if((latch.activePositionDecisionId!="" || ActivateCanaryPositionCorrelation(latch,
            reconciliation.closedPositionId)))
      {
         latch.unresolved=false;
         ClearCanaryPendingEntryLatch(latch);
         g_last_result_class=CANARY_RESULT_NONE;
         if(!PersistCanarySafetyLatch(InpBrokerId,InpSymbol,latch,stopped_latch_detail))
            Print("JMB demo canary stopped-position latch failed: ",stopped_latch_detail);
      }
   }
   bool authoritative_emergency_closure=reconciled
      && reconciliation.authoritativeEmergencyClosure;
   if(authoritative_emergency_closure && (latch.unresolved
      || latch.activePositionDecisionId!="" || latch.pendingEntryDecisionId!=""))
   {
      if(ConfirmCanaryEmergencyClosure(decision,reconciliation,latch))
         g_last_result_class=CANARY_RESULT_NONE;
      else g_reconciliation_dirty=true;
   }

   CanaryEnvironment environment;
   BuildCanaryEnvironment(decision,policy,processed_state,reconciliation,latch,environment);
   CanaryEvaluation evaluation=EvaluateCanaryGates(decision,policy,environment);
   bool mutation_identity_valid=CanaryGatewayIdentityValid(InpBrokerId,InpExpectedServer,
      InpExpectedAccountLogin,InpSymbol,InpMagicNumber);
   bool mutation_requested=reconciliation.state==CANARY_LIFECYCLE_EMERGENCY_CLOSE
      || reconciliation.state==CANARY_LIFECYCLE_CLOSE_REQUESTING;
   if(mutation_requested && !mutation_identity_valid)
   {
      reconciliation.state=CANARY_LIFECYCLE_BLOCKED;
      reconciliation.available=false;
      reconciliation.reconciliationState="identity_mismatch";
      reconciliation.detail="The actual terminal identity changed; every broker mutation is refused.";
      latch.valid=true;
      latch.unresolved=true;
      string identity_latch_detail="";
      PersistCanarySafetyLatch(InpBrokerId,InpSymbol,latch,identity_latch_detail);
   }

   if(reconciliation.state==CANARY_LIFECYCLE_EMERGENCY_CLOSE
      && mutation_identity_valid && reconciliation.available && !reconciliation.hasForeignGoldExposure)
      HandleCanaryEmergencyClose(decision,policy,reconciliation,latch);
   else if(reconciliation.state==CANARY_LIFECYCLE_CLOSE_REQUESTING && decision.loaded
      && !observation_used && latch.pendingCloseDecisionId=="")
   {
      CanaryEnvironment reversal_environment;
      reversal_environment=environment;
      reversal_environment.hasEaPosition=false;
      CanaryEvaluation reversal_evaluation=EvaluateCanaryGates(decision,policy,reversal_environment);
      if(mutation_identity_valid && reconciliation.available && !reconciliation.hasForeignGoldExposure
         && reversal_evaluation.ready)
         HandleCanaryOppositeClose(decision,policy,processed_state,processed_path,reconciliation,latch);
   }
   else if(reconciliation.state==CANARY_LIFECYCLE_CLOSED)
   {
      if(ConfirmCanaryOppositeClosure(decision,reconciliation,latch))
      {
         g_last_result_class=CANARY_RESULT_NONE;
         reconciled=ReconcileCanaryBrokerState(InpSymbol,InpMagicNumber,decision,false,
            CANARY_RESULT_NONE,latch,reconciliation);
         g_reconciliation_dirty=!reconciled;
      }
   }
   else if(reconciliation.state==CANARY_LIFECYCLE_FILLED_PROTECTED && decision.loaded
      && !observation_used && decision.direction==reconciliation.position.direction)
      PersistCanarySameDirectionNoOp(decision,processed_state,processed_path,reconciliation,latch);

   if(reconciliation.state==CANARY_LIFECYCLE_FILLED_PROTECTED
      && !CanaryLifecycleEventRecorded(InpBrokerId,CANARY_LIFECYCLE_FILLED_PROTECTED,
         reconciliation.position.identifier))
      AppendManagedCanaryPositionEvent(decision,reconciliation,CANARY_LIFECYCLE_FILLED_PROTECTED,"",
         "Broker-confirmed EA-owned exposure has a valid protective stop.",latch);
   if(reconciliation.state==CANARY_LIFECYCLE_STOPPED
      && !CanaryLifecycleEventRecorded(InpBrokerId,CANARY_LIFECYCLE_STOPPED,
         reconciliation.closedPositionId))
   {
      if(AppendManagedCanaryPositionEvent(decision,reconciliation,CANARY_LIFECYCLE_STOPPED,"",
         "The fully reconciled stop-loss closure consumes its observation.",latch))
      {
         latch.unresolved=false;
         latch.pendingCloseDecisionId="";
         latch.pendingCloseObservationId="";
         ClearCanaryActivePositionCorrelation(latch);
         string terminal_latch_detail="";
         PersistCanarySafetyLatch(InpBrokerId,InpSymbol,latch,terminal_latch_detail);
      }
   }
   else if(reconciliation.state==CANARY_LIFECYCLE_STOPPED
      && CanaryLifecycleEventRecorded(InpBrokerId,CANARY_LIFECYCLE_STOPPED,
         reconciliation.closedPositionId) && latch.activePositionDecisionId!="")
   {
      latch.unresolved=false;
      latch.pendingCloseDecisionId="";
      latch.pendingCloseObservationId="";
      ClearCanaryActivePositionCorrelation(latch);
      string recovered_terminal_detail="";
      PersistCanarySafetyLatch(InpBrokerId,InpSymbol,latch,recovered_terminal_detail);
   }
   if(reconciliation.state==CANARY_LIFECYCLE_PAUSED && !authoritative_emergency_closure
      && reconciliation.hasClosedPosition
      && !CanaryLifecycleEventRecorded(InpBrokerId,CANARY_LIFECYCLE_PAUSED,
         reconciliation.closedPositionId))
      AppendManagedCanaryEvent(decision,reconciliation,CANARY_LIFECYCLE_PAUSED,"",
         IsCanaryPersistentProtectionPause(reconciliation)
            ? "Persistent broker protection error keeps this canary paused pending operator clearance."
            : "The broker-day losing-trade or realized-loss ceiling pauses new entries.");

   BuildCanaryEnvironment(decision,policy,processed_state,reconciliation,latch,environment);
   evaluation=EvaluateCanaryGates(decision,policy,environment);
   bool effective_execution_enabled=CanaryEffectiveExecutionEnabled(InpDemoExecutionEnabled,policy);

   string write_detail="";
   bool broker_lifecycle_active=reconciliation.state!=CANARY_LIFECYCLE_READY;
   bool status_persisted=broker_lifecycle_active
      ? WriteCanaryReconciledStatus(InpBrokerId,AccountInfoString(ACCOUNT_SERVER),InpSymbol,
         policy,decision,reconciliation,g_latest_event,effective_execution_enabled,InpKillSwitch,write_detail)
      : WriteCanaryLatestStatus(InpBrokerId,AccountInfoString(ACCOUNT_SERVER),InpSymbol,
         policy,decision,evaluation,effective_execution_enabled,InpKillSwitch,
         environment.dailyLossCount,environment.dailyRealizedLoss,write_detail);
   if(!status_persisted)
      Print("JMB demo canary status publication failed: ",write_detail);
   if(reconciliation.state==CANARY_LIFECYCLE_READY)
      SubmitReadyCanaryDecision(decision,policy,evaluation,processed_state,processed_path,
         effective_execution_enabled,status_persisted,environment.calculatedStopRisk);

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
