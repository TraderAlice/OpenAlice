#ifndef OPENALICE_JMB_CANARY_STATE_MQH
#define OPENALICE_JMB_CANARY_STATE_MQH

#include "JmbCanaryTypes.mqh"
#include "JmbCanaryGates.mqh"
#include "JmbCanaryCsv.mqh"
#include "JmbCanaryPolicy.mqh"

const string CANARY_EXECUTION_ROOT="OpenAliceMt5ExecutionV1";
const string CANARY_STATUS_HEADER="schema_version,captured_at,broker,server,account_mode,symbol,state,detail,rollout_stage,execution_enabled,kill_switch,decision_id,observation_id,event_id,event_type,event_time,result_code,result_detail,stop_protection_confirmed,position_direction,position_volume,position_open_price,position_stop_loss,position_id,reconciliation_state,daily_loss_count,daily_realized_loss,blocking_gate,next_safe_action";
const string CANARY_PROCESSED_HEADER="schema_version,decision_id,observation_id,attempted_at";

const CanaryLifecycleState CANARY_LIFECYCLE_ORDER_REQUESTING=(CanaryLifecycleState)4;
const CanaryLifecycleState CANARY_LIFECYCLE_ORDER_REJECTED=(CanaryLifecycleState)5;
const CanaryLifecycleState CANARY_LIFECYCLE_RECONCILIATION_REQUIRED=(CanaryLifecycleState)6;
const CanaryLifecycleState CANARY_LIFECYCLE_FILLED_PROTECTED=(CanaryLifecycleState)7;
const CanaryLifecycleState CANARY_LIFECYCLE_CLOSE_REQUESTING=(CanaryLifecycleState)8;
const CanaryLifecycleState CANARY_LIFECYCLE_CLOSED=(CanaryLifecycleState)9;
const CanaryLifecycleState CANARY_LIFECYCLE_STOPPED=(CanaryLifecycleState)10;
const CanaryLifecycleState CANARY_LIFECYCLE_EMERGENCY_CLOSE=(CanaryLifecycleState)11;
const CanaryLifecycleState CANARY_LIFECYCLE_ERROR=(CanaryLifecycleState)12;

enum CanaryBrokerResultClass
{
   CANARY_RESULT_NONE=0,
   CANARY_RESULT_REJECTED=1,
   CANARY_RESULT_UNKNOWN=2,
   CANARY_RESULT_PARTIAL=3
};

enum CanaryClosedOwnershipClass
{
   CANARY_CLOSED_OWNERSHIP_FOREIGN=0,
   CANARY_CLOSED_OWNERSHIP_EA=1,
   CANARY_CLOSED_OWNERSHIP_UNSAFE=2
};

struct CanaryPositionSnapshot
{
   bool present;
   ulong ticket;
   ulong identifier;
   string direction;
   double volume;
   double openPrice;
   double stopLoss;
   bool stopProtected;
};

struct CanarySafetyLatch
{
   bool valid;
   bool unresolved;
   bool protectionError;
   string pendingCloseDecisionId;
   string pendingCloseObservationId;
   bool emergencyCloseAttempted;
   string emergencyPositionId;
   string pendingEntryDecisionId;
   string pendingEntryObservationId;
   datetime pendingEntryAttemptedAt;
   string pendingEntryOrderId;
   string pendingEntryDealId;
   double pendingRequestedVolume;
   double pendingRequestedPrice;
   double pendingRequestedStopLoss;
   double pendingCalculatedRisk;
   string pendingEntryComment;
   string activePositionDecisionId;
   string activePositionObservationId;
   string activePositionId;
   double activeRequestedVolume;
   double activeRequestedPrice;
   double activeRequestedStopLoss;
   double activeCalculatedRisk;
   string activeEntryComment;
};

struct CanaryReconciliationFacts
{
   bool brokerStateAvailable;
   CanaryBrokerResultClass resultClass;
   bool hasEaPosition;
   bool eaPositionProtected;
   bool hasEaPendingOrder;
   bool hasForeignGoldExposure;
   bool sameDirection;
   bool oppositeDirection;
   bool closeConfirmed;
   bool stoppedObservation;
   bool persistentSafetyPause;
   bool dailyLimitReached;
};

struct CanaryReconciliation
{
   bool available;
   CanaryLifecycleState state;
   string detail;
   string reconciliationState;
   CanaryPositionSnapshot position;
   bool hasEaPendingOrder;
   bool hasForeignGoldExposure;
   CanaryDailyState daily;
   bool hasClosedPosition;
   bool lastCloseWasStop;
   datetime finalCloseTime;
   ulong dealTicket;
   ulong closedPositionId;
   double acceptedPrice;
   double commission;
   double swap;
   double fee;
   double netResult;
   bool authoritativeStopClosure;
   bool authoritativeEmergencyClosure;
};

struct CanaryExecutionEvent
{
   CanaryLifecycleState eventType;
   string eventId;
   datetime eventTime;
   string broker;
   string server;
   long accountLogin;
   string decisionId;
   string observationId;
   string gateResultsJson;
   bool hasCalculatedRisk;
   double calculatedRisk;
   bool hasRequestedOrder;
   double requestedVolume;
   double requestedPrice;
   double requestedStopLoss;
   bool hasAcceptedOrder;
   bool hasAcceptedStopLoss;
   double acceptedVolume;
   double acceptedPrice;
   double acceptedStopLoss;
   string resultCode;
   string resultDetail;
   ulong orderTicket;
   ulong dealTicket;
   ulong positionId;
   string reconciliationState;
   int dailyLossCount;
   double dailyRealizedLoss;
   bool hasOutcome;
   double commission;
   double swap;
   double fee;
   double netResult;
};

string CanaryAuthoritativeLifecycleLabel(const CanaryLifecycleState state)
{
   if(state==CANARY_LIFECYCLE_ORDER_REQUESTING) return "order_requesting";
   if(state==CANARY_LIFECYCLE_ORDER_REJECTED) return "order_rejected";
   if(state==CANARY_LIFECYCLE_RECONCILIATION_REQUIRED) return "reconciliation_required";
   if(state==CANARY_LIFECYCLE_FILLED_PROTECTED) return "filled_protected";
   if(state==CANARY_LIFECYCLE_CLOSE_REQUESTING) return "close_requesting";
   if(state==CANARY_LIFECYCLE_CLOSED) return "closed";
   if(state==CANARY_LIFECYCLE_STOPPED) return "stopped";
   if(state==CANARY_LIFECYCLE_EMERGENCY_CLOSE) return "emergency_close";
   if(state==CANARY_LIFECYCLE_ERROR) return "error";
   return CanaryLifecycleLabel(state);
}

string CanaryStatusDirectory(const string broker,const string symbol)
{
   return CANARY_EXECUTION_ROOT+"\\"+broker+"\\"+symbol;
}

string CanaryIsoTime(const datetime value)
{
   MqlDateTime parts;
   TimeToStruct(value,parts);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02d.000Z",
      parts.year,parts.mon,parts.day,parts.hour,parts.min,parts.sec);
}

string CanaryDayKey(const datetime value)
{
   MqlDateTime parts;
   TimeToStruct(value,parts);
   return StringFormat("%04d-%02d-%02d",parts.year,parts.mon,parts.day);
}

string CanaryProcessedStatePath(const string broker,const string symbol)
{
   return CanaryStatusDirectory(broker,symbol)+"\\processed_observations.csv";
}

void InitializeCanaryProcessedState(CanaryProcessedState &state)
{
   state.valid=false;
   state.filePresent=false;
   ArrayResize(state.decisionIds,0);
   ArrayResize(state.observationIds,0);
   ArrayResize(state.attemptedAt,0);
}

bool IsCanaryHashIdentity(const string value)
{
   if(StringLen(value)!=24) return false;
   for(int index=0;index<StringLen(value);index++)
   {
      int character=(int)StringGetCharacter(value,index);
      if(!((character>=48 && character<=57) || (character>=97 && character<=102))) return false;
   }
   return true;
}

string CanaryEntryCorrelationComment(const string decision_id)
{
   return IsCanaryHashIdentity(decision_id) ? "JMB:"+StringSubstr(decision_id,0,20) : "";
}

bool IsCanaryTicketText(const string value)
{
   if(value=="") return true;
   long parsed=StringToInteger(value);
   return parsed>0 && StringFormat("%I64u",(ulong)parsed)==value;
}

void ClearCanaryPendingEntryLatch(CanarySafetyLatch &latch)
{
   latch.pendingEntryDecisionId="";
   latch.pendingEntryObservationId="";
   latch.pendingEntryAttemptedAt=0;
   latch.pendingEntryOrderId="";
   latch.pendingEntryDealId="";
   latch.pendingRequestedVolume=0.0;
   latch.pendingRequestedPrice=0.0;
   latch.pendingRequestedStopLoss=0.0;
   latch.pendingCalculatedRisk=0.0;
   latch.pendingEntryComment="";
}

void ClearCanaryActivePositionCorrelation(CanarySafetyLatch &latch)
{
   latch.activePositionDecisionId="";
   latch.activePositionObservationId="";
   latch.activePositionId="";
   latch.activeRequestedVolume=0.0;
   latch.activeRequestedPrice=0.0;
   latch.activeRequestedStopLoss=0.0;
   latch.activeCalculatedRisk=0.0;
   latch.activeEntryComment="";
}

bool FinalizeCanaryEmergencyTerminalCorrelation(CanarySafetyLatch &latch,
                                                const bool terminal_event_durable)
{
   if(!terminal_event_durable) return false;
   latch.unresolved=false;
   ClearCanaryPendingEntryLatch(latch);
   ClearCanaryActivePositionCorrelation(latch);
   return true;
}

bool CanaryRequestedEvidenceValid(const string decision_id,const string observation_id,
                                  const double volume,const double price,const double stop_loss,
                                  const double calculated_risk,const string entry_comment)
{
   return IsCanaryHashIdentity(decision_id) && IsCanaryHashIdentity(observation_id)
      && MathIsValidNumber(volume) && CanaryNearlyEqual(volume,CANARY_HARD_MAX_VOLUME)
      && MathIsValidNumber(price) && price>0.0
      && MathIsValidNumber(stop_loss) && stop_loss>0.0
      && MathIsValidNumber(calculated_risk) && calculated_risk>0.0
      && entry_comment==CanaryEntryCorrelationComment(decision_id);
}

bool ActivateCanaryPositionCorrelation(CanarySafetyLatch &latch,const ulong position_id)
{
   if(position_id==0 || !CanaryRequestedEvidenceValid(latch.pendingEntryDecisionId,
      latch.pendingEntryObservationId,latch.pendingRequestedVolume,latch.pendingRequestedPrice,
      latch.pendingRequestedStopLoss,latch.pendingCalculatedRisk,latch.pendingEntryComment)) return false;
   latch.activePositionDecisionId=latch.pendingEntryDecisionId;
   latch.activePositionObservationId=latch.pendingEntryObservationId;
   latch.activePositionId=CanaryTicketString(position_id);
   latch.activeRequestedVolume=latch.pendingRequestedVolume;
   latch.activeRequestedPrice=latch.pendingRequestedPrice;
   latch.activeRequestedStopLoss=latch.pendingRequestedStopLoss;
   latch.activeCalculatedRisk=latch.pendingCalculatedRisk;
   latch.activeEntryComment=latch.pendingEntryComment;
   return true;
}

bool ApplyCanaryPositionCorrelation(CanaryExecutionEvent &event,const CanarySafetyLatch &latch)
{
   string decision_id=latch.activePositionDecisionId!=""
      ? latch.activePositionDecisionId : latch.pendingEntryDecisionId;
   string observation_id=latch.activePositionDecisionId!=""
      ? latch.activePositionObservationId : latch.pendingEntryObservationId;
   double volume=latch.activePositionDecisionId!=""
      ? latch.activeRequestedVolume : latch.pendingRequestedVolume;
   double price=latch.activePositionDecisionId!=""
      ? latch.activeRequestedPrice : latch.pendingRequestedPrice;
   double stop_loss=latch.activePositionDecisionId!=""
      ? latch.activeRequestedStopLoss : latch.pendingRequestedStopLoss;
   double calculated_risk=latch.activePositionDecisionId!=""
      ? latch.activeCalculatedRisk : latch.pendingCalculatedRisk;
   string entry_comment=latch.activePositionDecisionId!=""
      ? latch.activeEntryComment : latch.pendingEntryComment;
   if(!CanaryRequestedEvidenceValid(decision_id,observation_id,volume,price,stop_loss,
      calculated_risk,entry_comment)) return false;
   event.decisionId=decision_id;
   event.observationId=observation_id;
   event.gateResultsJson="[]";
   event.hasCalculatedRisk=true;
   event.calculatedRisk=calculated_risk;
   event.hasRequestedOrder=true;
   event.requestedVolume=volume;
   event.requestedPrice=price;
   event.requestedStopLoss=stop_loss;
   return true;
}

bool CanaryProcessedStateContains(const CanaryProcessedState &state,
                                  const string decision_id,
                                  const string observation_id)
{
   if(!state.valid) return true;
   for(int index=0;index<ArraySize(state.observationIds);index++)
      if(state.observationIds[index]==observation_id || state.decisionIds[index]==decision_id) return true;
   return false;
}

bool LoadCanaryProcessedState(const string path,CanaryProcessedState &state,string &detail)
{
   InitializeCanaryProcessedState(state);
   if(!FileIsExist(path,FILE_COMMON))
   {
      state.valid=true;
      detail="Processed-observation state is absent and therefore empty.";
      return true;
   }
   state.filePresent=true;
   string text="";
   if(!ReadCanaryCommonText(path,text,detail)) return false;
   string lines[];
   int line_count=StringSplit(text,(ushort)StringGetCharacter("\n",0),lines);
   if(line_count<1)
   {
      detail="Processed-observation state has no strict header.";
      return false;
   }
   if(!StripCanaryLineEnding(lines[0],detail) || lines[0]!=CANARY_PROCESSED_HEADER)
   {
      detail="Processed-observation state header does not match the exact schema.";
      return false;
   }
   int record_count=line_count-1;
   if(record_count>0 && lines[line_count-1]=="") record_count--;
   for(int line_index=1;line_index<=record_count;line_index++)
   {
      if(!StripCanaryLineEnding(lines[line_index],detail) || lines[line_index]=="")
      {
         detail="Processed-observation state contains a blank or multiline record.";
         return false;
      }
      string values[];
      if(StringFind(lines[line_index],"\"")>=0
         || !ParseCanaryCsvRecord(lines[line_index],values,detail) || ArraySize(values)!=4
         || values[0]!="1" || !IsCanaryHashIdentity(values[1]) || !IsCanaryHashIdentity(values[2])
         || values[1]!=CanarySha256Identity("daily-trend-v1|"+values[2]))
      {
         detail="Processed-observation state contains a malformed record.";
         return false;
      }
      datetime attempted_at=0;
      if(!TryCanaryIsoUtc(values[3],attempted_at))
      {
         detail="Processed-observation state contains an invalid attempted_at timestamp.";
         return false;
      }
      for(int existing=0;existing<ArraySize(state.observationIds);existing++)
      {
         if(state.observationIds[existing]==values[2] || state.decisionIds[existing]==values[1])
         {
            detail="Processed-observation state contains a duplicate identity.";
            return false;
         }
      }
      int index=ArraySize(state.observationIds);
      ArrayResize(state.decisionIds,index+1);
      ArrayResize(state.observationIds,index+1);
      ArrayResize(state.attemptedAt,index+1);
      state.decisionIds[index]=values[1];
      state.observationIds[index]=values[2];
      state.attemptedAt[index]=attempted_at;
   }
   state.valid=true;
   detail="Processed-observation state matches the strict attempt schema.";
   return true;
}

void ResetCanaryDailyStateForDay(CanaryDailyState &state,const string broker_day)
{
   if(state.brokerDay==broker_day) return;
   state.brokerDay=broker_day;
   state.lossCount=0;
   state.realizedLoss=0.0;
}

void RecordCanaryDailyLoss(CanaryDailyState &state,const double loss_amount)
{
   if(loss_amount<=0.0) return;
   state.lossCount++;
   state.realizedLoss+=loss_amount;
}

void EnsureCanaryDirectory(const string broker,const string symbol)
{
   FolderCreate(CANARY_EXECUTION_ROOT,FILE_COMMON);
   FolderCreate(CANARY_EXECUTION_ROOT+"\\"+broker,FILE_COMMON);
   FolderCreate(CanaryStatusDirectory(broker,symbol),FILE_COMMON);
}

bool PreflightCanaryLog(const string broker,const string symbol)
{
   EnsureCanaryDirectory(broker,symbol);
   string path=CanaryStatusDirectory(broker,symbol)+"\\.write_preflight."
      +IntegerToString((int)GetTickCount())+".tmp";
   int handle=FileOpen(path,FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_COMMON);
   if(handle==INVALID_HANDLE) return false;
   const string payload="openalice-canary-preflight\r\n";
   uint preflight_written=FileWriteString(handle,payload);
   if(preflight_written!=StringLen(payload))
   {
      FileClose(handle);
      FileDelete(path,FILE_COMMON);
      return false;
   }
   FileFlush(handle);
   FileClose(handle);
   string reopened="";
   string read_detail="";
   if(!ReadCanaryCommonText(path,reopened,read_detail) || reopened!=payload)
   {
      FileDelete(path,FILE_COMMON);
      return false;
   }
   bool removed=FileDelete(path,FILE_COMMON);
   return removed;
}

bool CanaryExactValuesMatch(const string &intended_values[],const string &verified_values[])
{
   if(ArraySize(intended_values)!=ArraySize(verified_values)) return false;
   for(int index=0;index<ArraySize(intended_values);index++)
      if(intended_values[index]!=verified_values[index]) return false;
   return true;
}

string CanaryCsvEscapedCell(const string value)
{
   bool quoted=false;
   string escaped="";
   for(int index=0;index<StringLen(value);index++)
   {
      string character=StringSubstr(value,index,1);
      if(character=="\"" || character=="," || character=="\r" || character=="\n")
         quoted=true;
      if(character=="\"") escaped+="\"\"";
      else escaped+=character;
   }
   return quoted ? "\""+escaped+"\"" : escaped;
}

string CanaryCsvRecord(const string &values[])
{
   string record="";
   for(int index=0;index<ArraySize(values);index++)
   {
      if(index>0) record+=",";
      record+=CanaryCsvEscapedCell(values[index]);
   }
   return record;
}

bool CanaryStatusProjectionIsPossible(const CanaryEvaluation &evaluation,
                                      const CanaryPolicy &policy,
                                      const bool execution_enabled,
                                      const bool kill_switch)
{
   if(policy.rolloutStage=="status_only" && execution_enabled) return false;
   if(evaluation.state==CANARY_LIFECYCLE_DISABLED) return !execution_enabled && !evaluation.ready;
   if(evaluation.state==CANARY_LIFECYCLE_PAUSED) return kill_switch && !evaluation.ready;
   if(evaluation.state==CANARY_LIFECYCLE_READY)
      return execution_enabled && !kill_switch && evaluation.ready
         && policy.rolloutStage!="status_only" && evaluation.blockingGate=="";
   return evaluation.state==CANARY_LIFECYCLE_BLOCKED && !evaluation.ready && evaluation.blockingGate!="";
}

bool CanaryEffectiveExecutionEnabled(const bool input_enabled,const CanaryPolicy &policy)
{
   return input_enabled && policy.loaded && policy.candidateApproved
      && policy.rolloutStage!="status_only"
      && CanaryRolloutAuthorized(policy.broker,policy.rolloutStage);
}

bool WriteCanaryLatestStatus(const string broker,
                             const string server,
                             const string symbol,
                             const CanaryPolicy &policy,
                             const CanaryDecision &decision,
                             const CanaryEvaluation &evaluation,
                             const bool execution_enabled,
                             const bool kill_switch,
                             const int daily_loss_count,
                             const double daily_realized_loss,
                             string &detail)
{
   if(!CanaryStatusProjectionIsPossible(evaluation,policy,execution_enabled,kill_switch))
   {
      detail="Refused to publish an impossible dry-run lifecycle projection.";
      return false;
   }

   EnsureCanaryDirectory(broker,symbol);
   string destination_path=CanaryStatusDirectory(broker,symbol)+"\\latest_status.csv";
   string temporary_path=destination_path+"."+IntegerToString((int)GetTickCount())+".tmp";
   int handle=FileOpen(temporary_path,FILE_WRITE|FILE_BIN|FILE_ANSI|FILE_COMMON);
   if(handle==INVALID_HANDLE)
   {
      detail="The temporary status file could not be opened.";
      return false;
   }

   string intended_values[];
   ArrayResize(intended_values,29);
   intended_values[0]="1";
   intended_values[1]=CanaryIsoTime(TimeGMT());
   intended_values[2]=broker;
   intended_values[3]=server;
   intended_values[4]="demo";
   intended_values[5]=symbol;
   intended_values[6]=CanaryLifecycleLabel(evaluation.state);
   intended_values[7]=evaluation.detail;
   intended_values[8]=policy.rolloutStage;
   intended_values[9]=execution_enabled ? "1" : "0";
   intended_values[10]=kill_switch ? "1" : "0";
   intended_values[11]=decision.loaded ? decision.decisionId : "";
   intended_values[12]=decision.loaded ? decision.observationId : "";
   intended_values[13]="";
   intended_values[14]="";
   intended_values[15]="";
   intended_values[16]="";
   intended_values[17]="";
   intended_values[18]="0";
   intended_values[19]="";
   intended_values[20]="";
   intended_values[21]="";
   intended_values[22]="";
   intended_values[23]="";
   intended_values[24]=evaluation.state==CANARY_LIFECYCLE_READY ? "complete" : "required";
   intended_values[25]=IntegerToString(daily_loss_count);
   intended_values[26]=DoubleToString(daily_realized_loss,2);
   intended_values[27]=evaluation.blockingGate;
   intended_values[28]=evaluation.nextSafeAction;

   string payload=CANARY_STATUS_HEADER+"\r\n"+CanaryCsvRecord(intended_values)+"\r\n";
   uint written=FileWriteString(handle,payload);
   if(written!=StringLen(payload))
   {
      FileClose(handle);
      FileDelete(temporary_path,FILE_COMMON);
      detail="The strict status payload could not be written completely.";
      return false;
   }
   FileFlush(handle);
   FileClose(handle);

   string expected_fields[];
   string header_copy=CANARY_STATUS_HEADER;
   if(StringSplit(header_copy,(ushort)StringGetCharacter(",",0),expected_fields)!=29)
   {
      FileDelete(temporary_path,FILE_COMMON);
      detail="The internal strict status schema is invalid.";
      return false;
   }
   string verified_values[];
   string verification_detail="";
   if(!ReadStrictCanaryCsv(temporary_path,expected_fields,verified_values,verification_detail))
   {
      FileDelete(temporary_path,FILE_COMMON);
      detail="The temporary status file failed strict completeness verification.";
      return false;
   }
   if(!CanaryExactValuesMatch(intended_values,verified_values))
   {
      FileDelete(temporary_path,FILE_COMMON);
      detail="The temporary status file did not preserve every intended field exactly.";
      return false;
   }

   if(FileMove(temporary_path, FILE_COMMON, destination_path, FILE_COMMON | FILE_REWRITE))
   {
      detail="The strict latest_status.csv projection was replaced atomically.";
      return true;
   }
   FileDelete(temporary_path,FILE_COMMON);
   detail="The temporary status file could not replace latest_status.csv.";
   return false;
}

string CanaryJsonEscape(const string value)
{
   string escaped="";
   for(int index=0;index<StringLen(value);index++)
   {
      int character=(int)StringGetCharacter(value,index);
      if(character==34) escaped+="\\\"";
      else if(character==92) escaped+="\\\\";
      else if(character==8) escaped+="\\b";
      else if(character==9) escaped+="\\t";
      else if(character==10) escaped+="\\n";
      else if(character==12) escaped+="\\f";
      else if(character==13) escaped+="\\r";
      else if(character<32) escaped+=StringFormat("\\u%04x",character);
      else escaped+=ShortToString((ushort)character);
   }
   return escaped;
}

string CanaryJsonString(const string value)
{
   return "\""+CanaryJsonEscape(value)+"\"";
}

string CanaryJsonNumberOrNull(const bool present,const double value,const int digits=8)
{
   if(!present || !MathIsValidNumber(value)) return "null";
   return DoubleToString(value,digits);
}

string CanaryTicketString(const ulong ticket)
{
   return ticket==0 ? "" : StringFormat("%I64u",ticket);
}

string CanaryMaskedAccountIdentity(const string server,const long account_login)
{
   return "masked-"+CanarySha256Identity(server+"|"+IntegerToString(account_login));
}

void InitializeCanaryExecutionEvent(CanaryExecutionEvent &event)
{
   ZeroMemory(event);
   event.eventType=CANARY_LIFECYCLE_ERROR;
   event.gateResultsJson="[]";
   event.reconciliationState="required";
}

bool AppendCanaryExecutionEvent(CanaryExecutionEvent &event,string &detail)
{
   if(event.broker!="hfmarkets" && event.broker!="icmarkets")
   {
      detail="The execution event broker is not allowlisted.";
      return false;
   }
   if(event.server!="HFMarketsGlobal-Demo4" && event.server!="ICMarketsSC-Demo")
   {
      detail="The execution event server is not allowlisted.";
      return false;
   }
   if(event.eventTime<=0) event.eventTime=TimeGMT();
   if(event.eventId=="")
      event.eventId=CanarySha256Identity(event.broker+"|"+event.decisionId+"|"
         +CanaryAuthoritativeLifecycleLabel(event.eventType)+"|"+CanaryIsoTime(event.eventTime)+"|"
         +event.resultCode+"|"+event.resultDetail+"|"+CanaryTicketString(event.orderTicket)+"|"
         +CanaryTicketString(event.dealTicket)+"|"+IntegerToString((long)GetTickCount()));
   string gate_results=event.gateResultsJson;
   if(StringLen(gate_results)<2 || StringSubstr(gate_results,0,1)!="["
      || StringSubstr(gate_results,StringLen(gate_results)-1,1)!="]") gate_results="[]";

   string line="{"
      +"\"schema_version\":1"
      +",\"event_id\":"+CanaryJsonString(event.eventId)
      +",\"event_type\":"+CanaryJsonString(CanaryAuthoritativeLifecycleLabel(event.eventType))
      +",\"event_time\":"+CanaryJsonString(CanaryIsoTime(event.eventTime))
      +",\"broker\":"+CanaryJsonString(event.broker)
      +",\"server\":"+CanaryJsonString(event.server)
      +",\"account_mode\":\"demo\""
      +",\"account_identity_masked\":"+CanaryJsonString(CanaryMaskedAccountIdentity(event.server,event.accountLogin))
      +",\"symbol\":\"XAUUSD\""
      +",\"strategy_version\":\"daily-trend-v1\""
      +",\"magic_number\":"+IntegerToString(event.broker=="hfmarkets" ? 880101 : 880201)
      +",\"decision_id\":"+CanaryJsonString(event.decisionId)
      +",\"observation_id\":"+CanaryJsonString(event.observationId)
      +",\"gate_results\":"+gate_results
      +",\"calculated_risk\":"+CanaryJsonNumberOrNull(event.hasCalculatedRisk,event.calculatedRisk,8)
      +",\"requested_volume\":"+CanaryJsonNumberOrNull(event.hasRequestedOrder,event.requestedVolume,8)
      +",\"requested_price\":"+CanaryJsonNumberOrNull(event.hasRequestedOrder,event.requestedPrice,8)
      +",\"requested_stop_loss\":"+CanaryJsonNumberOrNull(event.hasRequestedOrder,event.requestedStopLoss,8)
      +",\"accepted_volume\":"+CanaryJsonNumberOrNull(event.hasAcceptedOrder,event.acceptedVolume,8)
      +",\"accepted_price\":"+CanaryJsonNumberOrNull(event.hasAcceptedOrder,event.acceptedPrice,8)
      +",\"accepted_stop_loss\":"+CanaryJsonNumberOrNull(event.hasAcceptedStopLoss,event.acceptedStopLoss,8)
      +",\"result_code\":"+CanaryJsonString(event.resultCode)
      +",\"result_detail\":"+CanaryJsonString(event.resultDetail)
      +",\"order_ticket\":"+CanaryJsonString(CanaryTicketString(event.orderTicket))
      +",\"deal_ticket\":"+CanaryJsonString(CanaryTicketString(event.dealTicket))
      +",\"position_id\":"+CanaryJsonString(CanaryTicketString(event.positionId))
      +",\"reconciliation_state\":"+CanaryJsonString(event.reconciliationState)
      +",\"daily_loss_count\":"+IntegerToString(event.dailyLossCount)
      +",\"daily_realized_loss\":"+DoubleToString(event.dailyRealizedLoss,8)
      +",\"commission\":"+CanaryJsonNumberOrNull(event.hasOutcome,event.commission,8)
      +",\"swap\":"+CanaryJsonNumberOrNull(event.hasOutcome,event.swap,8)
      +",\"fee\":"+CanaryJsonNumberOrNull(event.hasOutcome,event.fee,8)
      +",\"net_result\":"+CanaryJsonNumberOrNull(event.hasOutcome,event.netResult,8)
      +",\"max_adverse_excursion\":null"
      +",\"max_favorable_excursion\":null}\r\n";

   EnsureCanaryDirectory(event.broker,"XAUUSD");
   string path=CanaryStatusDirectory(event.broker,"XAUUSD")+"\\events.jsonl";
   int handle=FileOpen(path,FILE_READ|FILE_WRITE|FILE_BIN|FILE_ANSI|FILE_COMMON);
   if(handle==INVALID_HANDLE || !FileSeek(handle,0,SEEK_END))
   {
      if(handle!=INVALID_HANDLE) FileClose(handle);
      detail="The append-only execution journal could not be opened at its boundary.";
      return false;
   }
   uint written=FileWriteString(handle,line);
   if(written!=StringLen(line))
   {
      FileClose(handle);
      detail="The complete execution event could not be appended.";
      return false;
   }
   FileFlush(handle);
   FileClose(handle);
   string reopened="";
   string read_detail="";
   if(!ReadCanaryCommonText(path,reopened,read_detail) || StringLen(reopened)<StringLen(line)
      || StringSubstr(reopened,StringLen(reopened)-StringLen(line))!=line)
   {
      detail="The flushed execution event could not be verified exactly.";
      return false;
   }
   detail="The stable execution event was appended, flushed, and verified.";
   return true;
}

bool CanaryLifecycleEventRecorded(const string broker,const CanaryLifecycleState state,
                                  const ulong position_id)
{
   if(position_id==0) return false;
   string path=CanaryStatusDirectory(broker,"XAUUSD")+"\\events.jsonl";
   string text="";
   string detail="";
   if(!ReadCanaryCommonText(path,text,detail)) return false;
   string lines[];
   int count=StringSplit(text,(ushort)StringGetCharacter("\n",0),lines);
   string type_token="\"event_type\":"+CanaryJsonString(CanaryAuthoritativeLifecycleLabel(state));
   string position_token="\"position_id\":"+CanaryJsonString(CanaryTicketString(position_id));
   for(int index=0;index<count;index++)
      if(StringFind(lines[index],type_token)>=0 && StringFind(lines[index],position_token)>=0) return true;
   return false;
}

bool CanaryCorrelatedTerminalEventRecorded(const string broker,
                                           const CanaryExecutionEvent &event)
{
   if((event.eventType!=CANARY_LIFECYCLE_CLOSED && event.eventType!=CANARY_LIFECYCLE_STOPPED)
      || event.positionId==0 || event.reconciliationState!="reconciled"
      || event.decisionId=="" || event.observationId==""
      || !event.hasCalculatedRisk || !event.hasRequestedOrder || !event.hasOutcome) return false;
   string path=CanaryStatusDirectory(broker,"XAUUSD")+"\\events.jsonl";
   string text="";
   string detail="";
   if(!ReadCanaryCommonText(path,text,detail)) return false;
   string tokens[]={
      "\"event_type\":"+CanaryJsonString(CanaryAuthoritativeLifecycleLabel(event.eventType)),
      "\"decision_id\":"+CanaryJsonString(event.decisionId),
      "\"observation_id\":"+CanaryJsonString(event.observationId),
      "\"calculated_risk\":"+CanaryJsonNumberOrNull(true,event.calculatedRisk,8),
      "\"requested_volume\":"+CanaryJsonNumberOrNull(true,event.requestedVolume,8),
      "\"requested_price\":"+CanaryJsonNumberOrNull(true,event.requestedPrice,8),
      "\"requested_stop_loss\":"+CanaryJsonNumberOrNull(true,event.requestedStopLoss,8),
      "\"deal_ticket\":"+CanaryJsonString(CanaryTicketString(event.dealTicket)),
      "\"position_id\":"+CanaryJsonString(CanaryTicketString(event.positionId)),
      "\"reconciliation_state\":\"reconciled\"",
      "\"commission\":"+CanaryJsonNumberOrNull(true,event.commission,8),
      "\"swap\":"+CanaryJsonNumberOrNull(true,event.swap,8),
      "\"fee\":"+CanaryJsonNumberOrNull(true,event.fee,8),
      "\"net_result\":"+CanaryJsonNumberOrNull(true,event.netResult,8)
   };
   string lines[];
   int count=StringSplit(text,(ushort)StringGetCharacter("\n",0),lines);
   for(int line_index=0;line_index<count;line_index++)
   {
      bool matches=true;
      for(int token_index=0;token_index<ArraySize(tokens);token_index++)
         if(StringFind(lines[line_index],tokens[token_index])<0)
         {
            matches=false;
            break;
         }
      if(matches) return true;
   }
   return false;
}

string CanarySafetyLatchPath(const string broker,const string symbol)
{
   return CanaryStatusDirectory(broker,symbol)+"\\reconciliation_latch.csv";
}

void InitializeCanarySafetyLatch(CanarySafetyLatch &latch)
{
   ZeroMemory(latch);
   latch.valid=false;
}

bool LoadCanarySafetyLatch(const string broker,const string symbol,
                           CanarySafetyLatch &latch,string &detail)
{
   InitializeCanarySafetyLatch(latch);
   string path=CanarySafetyLatchPath(broker,symbol);
   if(!FileIsExist(path,FILE_COMMON))
   {
      latch.valid=true;
      detail="No persistent reconciliation or protection error is latched.";
      return true;
   }
   string expected[]={"schema_version","unresolved","protection_error",
      "pending_close_decision_id","pending_close_observation_id","emergency_close_attempted",
      "emergency_position_id","pending_entry_decision_id","pending_entry_observation_id",
      "pending_entry_attempted_at","pending_entry_order_id","pending_entry_deal_id",
      "pending_requested_volume","pending_requested_price","pending_requested_stop_loss",
      "pending_calculated_risk","pending_entry_comment","active_position_decision_id",
      "active_position_observation_id","active_position_id","active_requested_volume",
      "active_requested_price","active_requested_stop_loss","active_calculated_risk",
      "active_entry_comment"};
   string values[];
   if(!ReadStrictCanaryCsv(path,expected,values,detail) || ArraySize(values)!=25
      || values[0]!="1" || (values[1]!="0" && values[1]!="1")
      || (values[2]!="0" && values[2]!="1") || (values[5]!="0" && values[5]!="1")
      || ((values[3]=="")!=(values[4]=="")) || ((values[5]=="1")!=(values[6]!=""))
      || ((values[7]=="")!=(values[8]=="")) || ((values[7]=="")!=(values[9]==""))
      || (values[7]=="" && (values[10]!="" || values[11]!="" || values[12]!=""
         || values[13]!="" || values[14]!="" || values[15]!="" || values[16]!=""))
      || ((values[17]=="")!=(values[18]=="")) || ((values[17]=="")!=(values[19]==""))
      || (values[17]=="" && (values[20]!="" || values[21]!="" || values[22]!=""
         || values[23]!="" || values[24]!=""))
      || !IsCanaryTicketText(values[10]) || !IsCanaryTicketText(values[11])
      || (values[19]!="" && !IsCanaryTicketText(values[19])))
   {
      detail="The persistent reconciliation latch is malformed.";
      return false;
   }
   latch.valid=true;
   latch.unresolved=values[1]=="1";
   latch.protectionError=values[2]=="1";
   latch.pendingCloseDecisionId=values[3];
   latch.pendingCloseObservationId=values[4];
   latch.emergencyCloseAttempted=values[5]=="1";
   latch.emergencyPositionId=values[6];
   latch.pendingEntryDecisionId=values[7];
   latch.pendingEntryObservationId=values[8];
   if(values[9]!="" && !TryCanaryIsoUtc(values[9],latch.pendingEntryAttemptedAt))
   {
      detail="The persistent entry correlation timestamp is invalid.";
      return false;
   }
   latch.pendingEntryOrderId=values[10];
   latch.pendingEntryDealId=values[11];
   latch.pendingRequestedVolume=StringToDouble(values[12]);
   latch.pendingRequestedPrice=StringToDouble(values[13]);
   latch.pendingRequestedStopLoss=StringToDouble(values[14]);
   latch.pendingCalculatedRisk=StringToDouble(values[15]);
   latch.pendingEntryComment=values[16];
   latch.activePositionDecisionId=values[17];
   latch.activePositionObservationId=values[18];
   latch.activePositionId=values[19];
   latch.activeRequestedVolume=StringToDouble(values[20]);
   latch.activeRequestedPrice=StringToDouble(values[21]);
   latch.activeRequestedStopLoss=StringToDouble(values[22]);
   latch.activeCalculatedRisk=StringToDouble(values[23]);
   latch.activeEntryComment=values[24];
   if((latch.pendingEntryDecisionId!="" && !CanaryRequestedEvidenceValid(
         latch.pendingEntryDecisionId,latch.pendingEntryObservationId,latch.pendingRequestedVolume,
         latch.pendingRequestedPrice,latch.pendingRequestedStopLoss,latch.pendingCalculatedRisk,
         latch.pendingEntryComment))
      || (latch.activePositionDecisionId!="" && !CanaryRequestedEvidenceValid(
         latch.activePositionDecisionId,latch.activePositionObservationId,latch.activeRequestedVolume,
         latch.activeRequestedPrice,latch.activeRequestedStopLoss,latch.activeCalculatedRisk,
         latch.activeEntryComment)))
   {
      detail="The persistent position correlation evidence is malformed.";
      return false;
   }
   detail="The persistent reconciliation latch was loaded exactly.";
   return true;
}

bool PersistCanarySafetyLatch(const string broker,const string symbol,
                              const CanarySafetyLatch &latch,string &detail)
{
   if(!latch.valid || ((latch.pendingCloseDecisionId=="")!=(latch.pendingCloseObservationId==""))
      || (latch.emergencyCloseAttempted!=(latch.emergencyPositionId!=""))
      || ((latch.pendingEntryDecisionId=="")!=(latch.pendingEntryObservationId==""))
      || ((latch.pendingEntryDecisionId=="")!=(latch.pendingEntryAttemptedAt==0))
      || (latch.pendingEntryDecisionId!="" && (!IsCanaryHashIdentity(latch.pendingEntryDecisionId)
         || !IsCanaryHashIdentity(latch.pendingEntryObservationId)))
      || (latch.pendingEntryDecisionId==""
         && (latch.pendingEntryOrderId!="" || latch.pendingEntryDealId!=""
            || latch.pendingRequestedVolume!=0.0 || latch.pendingRequestedPrice!=0.0
            || latch.pendingRequestedStopLoss!=0.0 || latch.pendingCalculatedRisk!=0.0
            || latch.pendingEntryComment!=""))
      || (latch.pendingEntryDecisionId!="" && !CanaryRequestedEvidenceValid(
         latch.pendingEntryDecisionId,latch.pendingEntryObservationId,latch.pendingRequestedVolume,
         latch.pendingRequestedPrice,latch.pendingRequestedStopLoss,latch.pendingCalculatedRisk,
         latch.pendingEntryComment))
      || (latch.activePositionDecisionId=="" && (latch.activePositionObservationId!=""
         || latch.activePositionId!="" || latch.activeRequestedVolume!=0.0
         || latch.activeRequestedPrice!=0.0 || latch.activeRequestedStopLoss!=0.0
         || latch.activeCalculatedRisk!=0.0 || latch.activeEntryComment!=""))
      || (latch.activePositionDecisionId!="" && (!IsCanaryTicketText(latch.activePositionId)
         || latch.activePositionId=="" || !CanaryRequestedEvidenceValid(
            latch.activePositionDecisionId,latch.activePositionObservationId,
            latch.activeRequestedVolume,latch.activeRequestedPrice,latch.activeRequestedStopLoss,
            latch.activeCalculatedRisk,latch.activeEntryComment)))
      || !IsCanaryTicketText(latch.pendingEntryOrderId) || !IsCanaryTicketText(latch.pendingEntryDealId))
   {
      detail="Refused to persist an invalid reconciliation latch.";
      return false;
   }
   EnsureCanaryDirectory(broker,symbol);
   string path=CanarySafetyLatchPath(broker,symbol);
   string temporary_path=path+"."+IntegerToString((long)GetTickCount())+".tmp";
   int handle=FileOpen(temporary_path,FILE_WRITE|FILE_CSV|FILE_ANSI|FILE_COMMON,',');
   if(handle==INVALID_HANDLE)
   {
      detail="The temporary reconciliation latch could not be opened.";
      return false;
   }
   uint header_written=FileWrite(handle,"schema_version","unresolved","protection_error",
      "pending_close_decision_id","pending_close_observation_id","emergency_close_attempted",
      "emergency_position_id","pending_entry_decision_id","pending_entry_observation_id",
      "pending_entry_attempted_at","pending_entry_order_id","pending_entry_deal_id",
      "pending_requested_volume","pending_requested_price","pending_requested_stop_loss",
      "pending_calculated_risk","pending_entry_comment","active_position_decision_id",
      "active_position_observation_id","active_position_id","active_requested_volume",
      "active_requested_price","active_requested_stop_loss","active_calculated_risk",
      "active_entry_comment");
   uint row_written=FileWrite(handle,"1",latch.unresolved ? "1" : "0",
      latch.protectionError ? "1" : "0",latch.pendingCloseDecisionId,
      latch.pendingCloseObservationId,latch.emergencyCloseAttempted ? "1" : "0",
      latch.emergencyPositionId,latch.pendingEntryDecisionId,latch.pendingEntryObservationId,
      latch.pendingEntryAttemptedAt>0 ? CanaryIsoTime(latch.pendingEntryAttemptedAt) : "",
      latch.pendingEntryOrderId,latch.pendingEntryDealId,
      latch.pendingEntryDecisionId!="" ? DoubleToString(latch.pendingRequestedVolume,8) : "",
      latch.pendingEntryDecisionId!="" ? DoubleToString(latch.pendingRequestedPrice,8) : "",
      latch.pendingEntryDecisionId!="" ? DoubleToString(latch.pendingRequestedStopLoss,8) : "",
      latch.pendingEntryDecisionId!="" ? DoubleToString(latch.pendingCalculatedRisk,8) : "",
      latch.pendingEntryComment,latch.activePositionDecisionId,latch.activePositionObservationId,
      latch.activePositionId,latch.activePositionDecisionId!="" ? DoubleToString(latch.activeRequestedVolume,8) : "",
      latch.activePositionDecisionId!="" ? DoubleToString(latch.activeRequestedPrice,8) : "",
      latch.activePositionDecisionId!="" ? DoubleToString(latch.activeRequestedStopLoss,8) : "",
      latch.activePositionDecisionId!="" ? DoubleToString(latch.activeCalculatedRisk,8) : "",
      latch.activeEntryComment);
   if(header_written==0 || row_written==0)
   {
      FileClose(handle);
      FileDelete(temporary_path,FILE_COMMON);
      detail="The complete reconciliation latch could not be written.";
      return false;
   }
   FileFlush(handle);
   FileClose(handle);
   string expected[]={"schema_version","unresolved","protection_error",
      "pending_close_decision_id","pending_close_observation_id","emergency_close_attempted",
      "emergency_position_id","pending_entry_decision_id","pending_entry_observation_id",
      "pending_entry_attempted_at","pending_entry_order_id","pending_entry_deal_id",
      "pending_requested_volume","pending_requested_price","pending_requested_stop_loss",
      "pending_calculated_risk","pending_entry_comment","active_position_decision_id",
      "active_position_observation_id","active_position_id","active_requested_volume",
      "active_requested_price","active_requested_stop_loss","active_calculated_risk",
      "active_entry_comment"};
   string intended[]={"1",latch.unresolved ? "1" : "0",latch.protectionError ? "1" : "0",
      latch.pendingCloseDecisionId,latch.pendingCloseObservationId,
      latch.emergencyCloseAttempted ? "1" : "0",latch.emergencyPositionId,
      latch.pendingEntryDecisionId,latch.pendingEntryObservationId,
      latch.pendingEntryAttemptedAt>0 ? CanaryIsoTime(latch.pendingEntryAttemptedAt) : "",
      latch.pendingEntryOrderId,latch.pendingEntryDealId,
      latch.pendingEntryDecisionId!="" ? DoubleToString(latch.pendingRequestedVolume,8) : "",
      latch.pendingEntryDecisionId!="" ? DoubleToString(latch.pendingRequestedPrice,8) : "",
      latch.pendingEntryDecisionId!="" ? DoubleToString(latch.pendingRequestedStopLoss,8) : "",
      latch.pendingEntryDecisionId!="" ? DoubleToString(latch.pendingCalculatedRisk,8) : "",
      latch.pendingEntryComment,latch.activePositionDecisionId,latch.activePositionObservationId,
      latch.activePositionId,latch.activePositionDecisionId!="" ? DoubleToString(latch.activeRequestedVolume,8) : "",
      latch.activePositionDecisionId!="" ? DoubleToString(latch.activeRequestedPrice,8) : "",
      latch.activePositionDecisionId!="" ? DoubleToString(latch.activeRequestedStopLoss,8) : "",
      latch.activePositionDecisionId!="" ? DoubleToString(latch.activeCalculatedRisk,8) : "",
      latch.activeEntryComment};
   string verified_values[];
   string verify_detail="";
   if(!ReadStrictCanaryCsv(temporary_path,expected,verified_values,verify_detail)
      || !CanaryExactValuesMatch(intended,verified_values))
   {
      FileDelete(temporary_path,FILE_COMMON);
      detail="The flushed reconciliation latch failed exact verification.";
      return false;
   }
   if(!FileMove(temporary_path,FILE_COMMON,path,FILE_COMMON|FILE_REWRITE))
   {
      FileDelete(temporary_path,FILE_COMMON);
      detail="The reconciliation latch could not be replaced atomically.";
      return false;
   }
   CanarySafetyLatch durable;
   if(!LoadCanarySafetyLatch(broker,symbol,durable,verify_detail)
      || durable.unresolved!=latch.unresolved || durable.protectionError!=latch.protectionError
      || durable.pendingCloseDecisionId!=latch.pendingCloseDecisionId
      || durable.pendingCloseObservationId!=latch.pendingCloseObservationId
      || durable.emergencyCloseAttempted!=latch.emergencyCloseAttempted
      || durable.emergencyPositionId!=latch.emergencyPositionId
      || durable.pendingEntryDecisionId!=latch.pendingEntryDecisionId
      || durable.pendingEntryObservationId!=latch.pendingEntryObservationId
      || durable.pendingEntryAttemptedAt!=latch.pendingEntryAttemptedAt
      || durable.pendingEntryOrderId!=latch.pendingEntryOrderId
      || durable.pendingEntryDealId!=latch.pendingEntryDealId
      || !CanaryNearlyEqual(durable.pendingRequestedVolume,latch.pendingRequestedVolume)
      || !CanaryNearlyEqual(durable.pendingRequestedPrice,latch.pendingRequestedPrice)
      || !CanaryNearlyEqual(durable.pendingRequestedStopLoss,latch.pendingRequestedStopLoss)
      || !CanaryNearlyEqual(durable.pendingCalculatedRisk,latch.pendingCalculatedRisk)
      || durable.pendingEntryComment!=latch.pendingEntryComment
      || durable.activePositionDecisionId!=latch.activePositionDecisionId
      || durable.activePositionObservationId!=latch.activePositionObservationId
      || durable.activePositionId!=latch.activePositionId
      || !CanaryNearlyEqual(durable.activeRequestedVolume,latch.activeRequestedVolume)
      || !CanaryNearlyEqual(durable.activeRequestedPrice,latch.activeRequestedPrice)
      || !CanaryNearlyEqual(durable.activeRequestedStopLoss,latch.activeRequestedStopLoss)
      || !CanaryNearlyEqual(durable.activeCalculatedRisk,latch.activeCalculatedRisk)
      || durable.activeEntryComment!=latch.activeEntryComment)
   {
      detail="The durable reconciliation latch failed exact reopen verification.";
      return false;
   }
   detail="The reconciliation and protection latch was persisted atomically.";
   return true;
}

bool PersistCanaryStatusValues(const string broker,const string symbol,
                               const string &intended_values[],string &detail)
{
   if(ArraySize(intended_values)!=29) return false;
   EnsureCanaryDirectory(broker,symbol);
   string destination_path=CanaryStatusDirectory(broker,symbol)+"\\latest_status.csv";
   string temporary_path=destination_path+"."+IntegerToString((long)GetTickCount())+".tmp";
   int handle=FileOpen(temporary_path,FILE_WRITE|FILE_BIN|FILE_ANSI|FILE_COMMON);
   if(handle==INVALID_HANDLE) return false;
   string payload=CANARY_STATUS_HEADER+"\r\n"+CanaryCsvRecord(intended_values)+"\r\n";
   uint written=FileWriteString(handle,payload);
   if(written!=StringLen(payload))
   {
      FileClose(handle);
      FileDelete(temporary_path,FILE_COMMON);
      return false;
   }
   FileFlush(handle);
   FileClose(handle);
   string expected_fields[];
   string header_copy=CANARY_STATUS_HEADER;
   StringSplit(header_copy,(ushort)StringGetCharacter(",",0),expected_fields);
   string verified_values[];
   string verify_detail="";
   if(!ReadStrictCanaryCsv(temporary_path,expected_fields,verified_values,verify_detail)
      || !CanaryExactValuesMatch(intended_values,verified_values)
      || !FileMove(temporary_path,FILE_COMMON,destination_path,FILE_COMMON|FILE_REWRITE))
   {
      FileDelete(temporary_path,FILE_COMMON);
      detail="The authoritative status failed exact atomic verification.";
      return false;
   }
   detail="The authoritative Task 5-compatible latest status was replaced atomically.";
   return true;
}

bool WriteCanaryReconciledStatus(const string broker,const string server,const string symbol,
                                 const CanaryPolicy &policy,const CanaryDecision &decision,
                                 const CanaryReconciliation &reconciliation,
                                 const CanaryExecutionEvent &latest_event,
                                 const bool execution_enabled,const bool kill_switch,
                                 string &detail)
{
   if(reconciliation.state==CANARY_LIFECYCLE_FILLED_PROTECTED
      && (!reconciliation.position.present || !reconciliation.position.stopProtected
         || reconciliation.position.stopLoss<=0.0))
   {
      detail="Refused to publish filled_protected without broker-confirmed stop protection.";
      return false;
   }
   string values[];
   ArrayResize(values,29);
   values[0]="1";
   values[1]=CanaryIsoTime(TimeGMT());
   values[2]=broker;
   values[3]=server;
   values[4]="demo";
   values[5]=symbol;
   values[6]=CanaryAuthoritativeLifecycleLabel(reconciliation.state);
   values[7]=reconciliation.detail;
   values[8]=policy.rolloutStage;
   values[9]=execution_enabled ? "1" : "0";
   values[10]=kill_switch ? "1" : "0";
   values[11]=decision.loaded ? decision.decisionId : "";
   values[12]=decision.loaded ? decision.observationId : "";
   values[13]=latest_event.eventId;
   values[14]=latest_event.eventId=="" ? "" : CanaryAuthoritativeLifecycleLabel(latest_event.eventType);
   values[15]=latest_event.eventId=="" ? "" : CanaryIsoTime(latest_event.eventTime);
   values[16]=latest_event.resultCode;
   values[17]=latest_event.resultDetail;
   values[18]=reconciliation.position.present && reconciliation.position.stopProtected ? "1" : "0";
   values[19]=reconciliation.position.present ? reconciliation.position.direction : "";
   values[20]=reconciliation.position.present ? DoubleToString(reconciliation.position.volume,8) : "";
   values[21]=reconciliation.position.present ? DoubleToString(reconciliation.position.openPrice,8) : "";
   values[22]=reconciliation.position.present ? DoubleToString(reconciliation.position.stopLoss,8) : "";
   values[23]=reconciliation.position.present ? CanaryTicketString(reconciliation.position.identifier) : "";
   values[24]=reconciliation.reconciliationState;
   values[25]=IntegerToString(reconciliation.daily.lossCount);
   values[26]=DoubleToString(reconciliation.daily.realizedLoss,2);
   values[27]=reconciliation.reconciliationState=="identity_mismatch" ? "demo_identity"
      : reconciliation.reconciliationState=="protection_error" ? "protection"
      : reconciliation.state==CANARY_LIFECYCLE_RECONCILIATION_REQUIRED ? "reconciliation"
      : reconciliation.state==CANARY_LIFECYCLE_EMERGENCY_CLOSE ? "protection"
      : reconciliation.state==CANARY_LIFECYCLE_BLOCKED ? "exposure"
      : reconciliation.state==CANARY_LIFECYCLE_PAUSED ? "daily_loss_count" : "";
   values[28]=reconciliation.state==CANARY_LIFECYCLE_FILLED_PROTECTED
      ? "Monitor broker-side protection and reconciliation."
      : reconciliation.state==CANARY_LIFECYCLE_EMERGENCY_CLOSE
         ? "Keep the broker paused and confirm the protective close before operator review."
      : reconciliation.reconciliationState=="identity_mismatch"
         ? "Restore the exact configured demo account, server, broker, symbol, and magic binding."
      : reconciliation.state==CANARY_LIFECYCLE_RECONCILIATION_REQUIRED
         ? "Do not submit again; inspect authoritative broker orders, deals, and positions."
      : reconciliation.reconciliationState=="protection_error"
         ? "Resolve the persistent broker protection error before operator clearance."
      : reconciliation.state==CANARY_LIFECYCLE_PAUSED
         ? "Wait for the next broker server day; unresolved safety latches remain active."
      : "Re-evaluate every entry gate before any new protected demo request.";
   return PersistCanaryStatusValues(broker,symbol,values,detail);
}

bool IsCanaryPersistentProtectionPause(const CanaryReconciliation &reconciliation)
{
   return reconciliation.state==CANARY_LIFECYCLE_PAUSED
      && reconciliation.reconciliationState=="protection_error";
}

#endif
