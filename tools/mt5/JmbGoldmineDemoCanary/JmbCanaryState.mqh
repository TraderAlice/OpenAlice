#ifndef OPENALICE_JMB_CANARY_STATE_MQH
#define OPENALICE_JMB_CANARY_STATE_MQH

#include "JmbCanaryTypes.mqh"
#include "JmbCanaryGates.mqh"

const string CANARY_EXECUTION_ROOT="OpenAliceMt5ExecutionV1";
const string CANARY_STATUS_HEADER="schema_version,captured_at,broker,server,account_mode,symbol,state,detail,rollout_stage,execution_enabled,kill_switch,decision_id,observation_id,event_id,event_type,event_time,result_code,result_detail,stop_protection_confirmed,position_direction,position_volume,position_open_price,position_stop_loss,position_id,reconciliation_state,daily_loss_count,daily_realized_loss,blocking_gate,next_safe_action";

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

bool CanaryIsDuplicateObservation(const CanaryObservationState &state,const string observation_id)
{
   return observation_id!="" && state.lastObservationId==observation_id;
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

string CanaryStatusDirectory(const string broker,const string symbol)
{
   return CANARY_EXECUTION_ROOT+"\\"+broker+"\\"+symbol;
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
   FileWriteString(handle,"preflight\n");
   FileFlush(handle);
   FileClose(handle);
   bool removed=FileDelete(path,FILE_COMMON);
   return removed;
}

bool CanaryStatusProjectionIsPossible(const CanaryEvaluation &evaluation,
                                      const CanaryPolicy &policy,
                                      const bool execution_enabled,
                                      const bool kill_switch)
{
   if(evaluation.state==CANARY_LIFECYCLE_DISABLED) return !execution_enabled && !evaluation.ready;
   if(evaluation.state==CANARY_LIFECYCLE_PAUSED) return execution_enabled && kill_switch && !evaluation.ready;
   if(evaluation.state==CANARY_LIFECYCLE_READY)
      return execution_enabled && !kill_switch && evaluation.ready
         && policy.rolloutStage!="status_only" && evaluation.blockingGate=="";
   return evaluation.state==CANARY_LIFECYCLE_BLOCKED && !evaluation.ready && evaluation.blockingGate!="";
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
   int handle=FileOpen(temporary_path,FILE_WRITE|FILE_CSV|FILE_ANSI|FILE_COMMON,',');
   if(handle==INVALID_HANDLE)
   {
      detail="The temporary status file could not be opened.";
      return false;
   }

   FileWrite(handle,
      "schema_version","captured_at","broker","server","account_mode","symbol","state","detail",
      "rollout_stage","execution_enabled","kill_switch","decision_id","observation_id","event_id",
      "event_type","event_time","result_code","result_detail","stop_protection_confirmed","position_direction",
      "position_volume","position_open_price","position_stop_loss","position_id","reconciliation_state",
      "daily_loss_count","daily_realized_loss","blocking_gate","next_safe_action");
   FileWrite(handle,
      1,CanaryIsoTime(TimeGMT()),broker,server,"demo",symbol,CanaryLifecycleLabel(evaluation.state),evaluation.detail,
      policy.rolloutStage,execution_enabled ? 1 : 0,kill_switch ? 1 : 0,
      decision.loaded ? decision.decisionId : "",decision.loaded ? decision.observationId : "",
      "","","","","",0,"","","","","",
      evaluation.state==CANARY_LIFECYCLE_READY ? "complete" : "required",
      daily_loss_count,daily_realized_loss,evaluation.blockingGate,evaluation.nextSafeAction);
   FileFlush(handle);
   FileClose(handle);

   if(FileMove(temporary_path, FILE_COMMON, destination_path, FILE_COMMON | FILE_REWRITE))
   {
      detail="The strict latest_status.csv projection was replaced atomically.";
      return true;
   }
   FileDelete(temporary_path,FILE_COMMON);
   detail="The temporary status file could not replace latest_status.csv.";
   return false;
}

#endif
