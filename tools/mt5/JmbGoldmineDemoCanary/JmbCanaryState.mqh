#ifndef OPENALICE_JMB_CANARY_STATE_MQH
#define OPENALICE_JMB_CANARY_STATE_MQH

#include "JmbCanaryTypes.mqh"
#include "JmbCanaryGates.mqh"
#include "JmbCanaryCsv.mqh"
#include "JmbCanaryPolicy.mqh"

const string CANARY_EXECUTION_ROOT="OpenAliceMt5ExecutionV1";
const string CANARY_STATUS_HEADER="schema_version,captured_at,broker,server,account_mode,symbol,state,detail,rollout_stage,execution_enabled,kill_switch,decision_id,observation_id,event_id,event_type,event_time,result_code,result_detail,stop_protection_confirmed,position_direction,position_volume,position_open_price,position_stop_loss,position_id,reconciliation_state,daily_loss_count,daily_realized_loss,blocking_gate,next_safe_action";
const string CANARY_PROCESSED_HEADER="schema_version,decision_id,observation_id,attempted_at";

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
   uint preflight_written=FileWriteString(handle,"preflight\n");
   if(preflight_written!=StringLen("preflight\n"))
   {
      FileClose(handle);
      FileDelete(path,FILE_COMMON);
      return false;
   }
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
   int handle=FileOpen(temporary_path,FILE_WRITE|FILE_CSV|FILE_ANSI|FILE_COMMON,',');
   if(handle==INVALID_HANDLE)
   {
      detail="The temporary status file could not be opened.";
      return false;
   }

   uint header_written=FileWrite(handle,
      "schema_version","captured_at","broker","server","account_mode","symbol","state","detail",
      "rollout_stage","execution_enabled","kill_switch","decision_id","observation_id","event_id",
      "event_type","event_time","result_code","result_detail","stop_protection_confirmed","position_direction",
      "position_volume","position_open_price","position_stop_loss","position_id","reconciliation_state",
      "daily_loss_count","daily_realized_loss","blocking_gate","next_safe_action");
   if(header_written==0)
   {
      FileClose(handle);
      FileDelete(temporary_path,FILE_COMMON);
      detail="The strict status header could not be written completely.";
      return false;
   }
   uint row_written=FileWrite(handle,
      1,CanaryIsoTime(TimeGMT()),broker,server,"demo",symbol,CanaryLifecycleLabel(evaluation.state),evaluation.detail,
      policy.rolloutStage,execution_enabled ? 1 : 0,kill_switch ? 1 : 0,
      decision.loaded ? decision.decisionId : "",decision.loaded ? decision.observationId : "",
      "","","","","",0,"","","","","",
      evaluation.state==CANARY_LIFECYCLE_READY ? "complete" : "required",
      daily_loss_count,daily_realized_loss,evaluation.blockingGate,evaluation.nextSafeAction);
   if(row_written==0)
   {
      FileClose(handle);
      FileDelete(temporary_path,FILE_COMMON);
      detail="The strict status row could not be written completely.";
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
