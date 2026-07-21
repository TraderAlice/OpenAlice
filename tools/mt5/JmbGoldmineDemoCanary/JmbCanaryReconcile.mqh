#ifndef OPENALICE_JMB_CANARY_RECONCILE_MQH
#define OPENALICE_JMB_CANARY_RECONCILE_MQH

#include "JmbCanaryState.mqh"

CanaryLifecycleState ReduceCanaryLifecycle(const CanaryReconciliationFacts &facts)
{
   if(!facts.brokerStateAvailable)
      return CANARY_LIFECYCLE_RECONCILIATION_REQUIRED;
   if(facts.hasForeignGoldExposure)
      return CANARY_LIFECYCLE_BLOCKED;
   if(facts.hasEaPosition && !facts.eaPositionProtected)
      return CANARY_LIFECYCLE_EMERGENCY_CLOSE;
   if(facts.stoppedObservation)
      return CANARY_LIFECYCLE_STOPPED;
   if(facts.persistentSafetyPause)
      return CANARY_LIFECYCLE_PAUSED;
   if(facts.resultClass==CANARY_RESULT_UNKNOWN || facts.resultClass==CANARY_RESULT_PARTIAL
      || facts.hasEaPendingOrder)
      return CANARY_LIFECYCLE_RECONCILIATION_REQUIRED;
   if(facts.oppositeDirection && facts.hasEaPosition)
      return CANARY_LIFECYCLE_CLOSE_REQUESTING;
   if(facts.hasEaPosition && facts.eaPositionProtected)
      return CANARY_LIFECYCLE_FILLED_PROTECTED;
   if(facts.closeConfirmed)
      return CANARY_LIFECYCLE_CLOSED;
   if(facts.dailyLimitReached)
      return CANARY_LIFECYCLE_PAUSED;
   if(facts.resultClass==CANARY_RESULT_REJECTED)
      return CANARY_LIFECYCLE_ORDER_REJECTED;
   return CANARY_LIFECYCLE_READY;
}

bool IsCanaryActionableOpposite(const string decision_direction,const string position_direction)
{
   return (decision_direction=="buy" && position_direction=="sell")
      || (decision_direction=="sell" && position_direction=="buy");
}

CanaryClosedOwnershipClass ClassifyCanaryClosedPositionOwnership(
   const bool origin_is_ea,const bool has_foreign_entry,const bool has_nonmagic_close)
{
   if(!origin_is_ea) return CANARY_CLOSED_OWNERSHIP_FOREIGN;
   if(has_foreign_entry) return CANARY_CLOSED_OWNERSHIP_UNSAFE;
   return CANARY_CLOSED_OWNERSHIP_EA;
}

bool IsCanaryCorrelatedLifecyclePosition(const string decision_id,
                                         const ulong expected_position_id,
                                         const string origin_comment,
                                         const ulong candidate_position_id)
{
   return expected_position_id>0 && candidate_position_id==expected_position_id
      && origin_comment==CanaryEntryCorrelationComment(decision_id);
}

CanaryBrokerResultClass ClassifyCanaryBrokerResult(const bool sent,const uint retcode,
                                                    const double requested_volume,
                                                    const double accepted_volume)
{
   if(retcode==TRADE_RETCODE_DONE_PARTIAL
      || (accepted_volume>0.0 && MathAbs(accepted_volume-requested_volume)>0.00000001))
      return CANARY_RESULT_PARTIAL;
   if(retcode==TRADE_RETCODE_REQUOTE || retcode==TRADE_RETCODE_REJECT || retcode==TRADE_RETCODE_CANCEL
      || retcode==TRADE_RETCODE_INVALID || retcode==TRADE_RETCODE_INVALID_VOLUME
      || retcode==TRADE_RETCODE_INVALID_PRICE || retcode==TRADE_RETCODE_INVALID_STOPS
      || retcode==TRADE_RETCODE_TRADE_DISABLED || retcode==TRADE_RETCODE_MARKET_CLOSED
      || retcode==TRADE_RETCODE_NO_MONEY || retcode==TRADE_RETCODE_PRICE_CHANGED
      || retcode==TRADE_RETCODE_PRICE_OFF || retcode==TRADE_RETCODE_INVALID_EXPIRATION
      || retcode==TRADE_RETCODE_NO_CHANGES || retcode==TRADE_RETCODE_SERVER_DISABLES_AT
      || retcode==TRADE_RETCODE_CLIENT_DISABLES_AT || retcode==TRADE_RETCODE_INVALID_FILL
      || retcode==TRADE_RETCODE_ONLY_REAL || retcode==TRADE_RETCODE_LIMIT_ORDERS
      || retcode==TRADE_RETCODE_LIMIT_VOLUME || retcode==TRADE_RETCODE_INVALID_ORDER
      || retcode==TRADE_RETCODE_POSITION_CLOSED || retcode==TRADE_RETCODE_INVALID_CLOSE_VOLUME
      || retcode==TRADE_RETCODE_LIMIT_POSITIONS || retcode==TRADE_RETCODE_REJECT_CANCEL
      || retcode==TRADE_RETCODE_LONG_ONLY || retcode==TRADE_RETCODE_SHORT_ONLY
      || retcode==TRADE_RETCODE_CLOSE_ONLY || retcode==TRADE_RETCODE_FIFO_CLOSE
      || retcode==TRADE_RETCODE_HEDGE_PROHIBITED)
      return CANARY_RESULT_REJECTED;
   if(!sent || retcode==0 || retcode==TRADE_RETCODE_TIMEOUT
      || retcode==TRADE_RETCODE_CONNECTION || retcode==TRADE_RETCODE_TOO_MANY_REQUESTS
      || retcode==TRADE_RETCODE_LOCKED || retcode==TRADE_RETCODE_FROZEN
      || retcode==TRADE_RETCODE_PLACED || retcode==TRADE_RETCODE_DONE)
      return CANARY_RESULT_UNKNOWN;
   return CANARY_RESULT_UNKNOWN;
}

void InitializeCanaryPositionSnapshot(CanaryPositionSnapshot &position)
{
   ZeroMemory(position);
   position.direction="";
}

void InitializeCanaryReconciliation(CanaryReconciliation &reconciliation)
{
   ZeroMemory(reconciliation);
   reconciliation.state=CANARY_LIFECYCLE_RECONCILIATION_REQUIRED;
   reconciliation.reconciliationState="required";
   InitializeCanaryPositionSnapshot(reconciliation.position);
}

bool CanaryPositionHasValidStop(const string direction,const double open_price,const double stop_loss)
{
   if(!MathIsValidNumber(open_price) || open_price<=0.0
      || !MathIsValidNumber(stop_loss) || stop_loss<=0.0) return false;
   return direction=="buy" ? stop_loss<open_price
      : direction=="sell" ? stop_loss>open_price : false;
}

bool CanaryOpenPositionOwnershipExact(const string symbol,const long magic_number,
                                      const ulong position_id,bool &exact_owned)
{
   exact_owned=false;
   if(position_id==0 || !HistorySelectByPosition(position_id)) return false;
   bool found_expected=false;
   int total=HistoryDealsTotal();
   for(int index=0;index<total;index++)
   {
      ulong deal_ticket=HistoryDealGetTicket(index);
      if(deal_ticket==0) return false;
      if(HistoryDealGetString(deal_ticket,DEAL_SYMBOL)!=symbol) continue;
      if(HistoryDealGetInteger(deal_ticket,DEAL_MAGIC)!=magic_number)
      {
         exact_owned=false;
         return true;
      }
      found_expected=true;
   }
   exact_owned=found_expected;
   return true;
}

bool ScanCanaryGoldExposure(const string symbol,const long magic_number,
                            CanaryPositionSnapshot &position,int &ea_position_count,
                            bool &has_ea_pending,bool &has_foreign_gold)
{
   InitializeCanaryPositionSnapshot(position);
   ea_position_count=0;
   has_ea_pending=false;
   has_foreign_gold=false;
   for(int index=0;index<PositionsTotal();index++)
   {
      ulong ticket=PositionGetTicket(index);
      if(ticket==0) return false;
      if(PositionGetString(POSITION_SYMBOL)!=symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC)==magic_number)
      {
         ea_position_count++;
         if(!position.present)
         {
            position.present=true;
            position.ticket=ticket;
            position.identifier=(ulong)PositionGetInteger(POSITION_IDENTIFIER);
            ENUM_POSITION_TYPE type=(ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
            position.direction=type==POSITION_TYPE_BUY ? "buy" : type==POSITION_TYPE_SELL ? "sell" : "";
            position.volume=PositionGetDouble(POSITION_VOLUME);
            position.openPrice=PositionGetDouble(POSITION_PRICE_OPEN);
            position.stopLoss=PositionGetDouble(POSITION_SL);
            position.stopProtected=CanaryPositionHasValidStop(position.direction,
               position.openPrice,position.stopLoss);
         }
      }
      else has_foreign_gold=true;
   }
   if(position.present)
   {
      bool exact_owned=false;
      if(!CanaryOpenPositionOwnershipExact(symbol,magic_number,position.identifier,exact_owned)) return false;
      if(!exact_owned) has_foreign_gold=true;
   }
   for(int index=0;index<OrdersTotal();index++)
   {
      ulong ticket=OrderGetTicket(index);
      if(ticket==0) return false;
      if(OrderGetString(ORDER_SYMBOL)!=symbol) continue;
      if(OrderGetInteger(ORDER_MAGIC)==magic_number) has_ea_pending=true;
      else has_foreign_gold=true;
   }
   return true;
}

bool CanaryPositionIdentifierOpen(const string symbol,const ulong position_id)
{
   for(int index=0;index<PositionsTotal();index++)
   {
      ulong ticket=PositionGetTicket(index);
      if(ticket==0) return true;
      if(PositionGetString(POSITION_SYMBOL)==symbol
         && (ulong)PositionGetInteger(POSITION_IDENTIFIER)==position_id) return true;
   }
   return false;
}

double DealNet(const ulong deal_ticket)
{
   return HistoryDealGetDouble(deal_ticket,DEAL_PROFIT)
      +HistoryDealGetDouble(deal_ticket,DEAL_COMMISSION)
      +HistoryDealGetDouble(deal_ticket,DEAL_SWAP)
      +HistoryDealGetDouble(deal_ticket,DEAL_FEE);
}

int FindCanaryPositionId(const ulong &position_ids[],const ulong position_id)
{
   for(int index=0;index<ArraySize(position_ids);index++)
      if(position_ids[index]==position_id) return index;
   return -1;
}

bool FindCanaryPendingEntryPosition(const CanarySafetyLatch &latch,
                                    const string symbol,const long magic_number,
                                    const datetime now,bool &found,ulong &position_id)
{
   found=false;
   position_id=0;
   if(latch.pendingEntryDecisionId=="") return true;
   string expected_comment=CanaryEntryCorrelationComment(latch.pendingEntryDecisionId);
   if(expected_comment=="" || latch.pendingEntryAttemptedAt<=0 || now<latch.pendingEntryAttemptedAt)
      return false;

   if(latch.pendingEntryDealId!="")
   {
      ulong deal_ticket=(ulong)StringToInteger(latch.pendingEntryDealId);
      if(HistoryDealSelect(deal_ticket))
      {
         ENUM_DEAL_ENTRY entry=(ENUM_DEAL_ENTRY)HistoryDealGetInteger(deal_ticket,DEAL_ENTRY);
         ulong candidate=(ulong)HistoryDealGetInteger(deal_ticket,DEAL_POSITION_ID);
         if(HistoryDealGetString(deal_ticket,DEAL_SYMBOL)!=symbol
            || HistoryDealGetInteger(deal_ticket,DEAL_MAGIC)!=magic_number
            || (entry!=DEAL_ENTRY_IN && entry!=DEAL_ENTRY_INOUT)
            || !IsCanaryCorrelatedLifecyclePosition(latch.pendingEntryDecisionId,candidate,
               HistoryDealGetString(deal_ticket,DEAL_COMMENT),candidate)) return false;
         found=true;
         position_id=candidate;
         return true;
      }
   }

   if(latch.pendingEntryOrderId!="")
   {
      ulong order_ticket=(ulong)StringToInteger(latch.pendingEntryOrderId);
      if(HistoryOrderSelect(order_ticket))
      {
         ulong candidate=(ulong)HistoryOrderGetInteger(order_ticket,ORDER_POSITION_ID);
         if(HistoryOrderGetString(order_ticket,ORDER_SYMBOL)!=symbol
            || HistoryOrderGetInteger(order_ticket,ORDER_MAGIC)!=magic_number
            || HistoryOrderGetString(order_ticket,ORDER_COMMENT)!=expected_comment) return false;
         if(candidate>0)
         {
            found=true;
            position_id=candidate;
            return true;
         }
      }
   }

   datetime search_start=latch.pendingEntryAttemptedAt>300
      ? latch.pendingEntryAttemptedAt-300 : latch.pendingEntryAttemptedAt;
   if(!HistorySelect(search_start,now)) return false;
   int total=HistoryDealsTotal();
   for(int index=0;index<total;index++)
   {
      ulong deal_ticket=HistoryDealGetTicket(index);
      if(deal_ticket==0) return false;
      ENUM_DEAL_ENTRY entry=(ENUM_DEAL_ENTRY)HistoryDealGetInteger(deal_ticket,DEAL_ENTRY);
      if(HistoryDealGetString(deal_ticket,DEAL_SYMBOL)!=symbol
         || HistoryDealGetInteger(deal_ticket,DEAL_MAGIC)!=magic_number
         || (entry!=DEAL_ENTRY_IN && entry!=DEAL_ENTRY_INOUT)
         || HistoryDealGetString(deal_ticket,DEAL_COMMENT)!=expected_comment) continue;
      ulong candidate=(ulong)HistoryDealGetInteger(deal_ticket,DEAL_POSITION_ID);
      if(candidate==0 || (found && candidate!=position_id)) return false;
      found=true;
      position_id=candidate;
   }
   return true;
}

bool ReadCanaryLifecyclePositionById(const string symbol,const long magic_number,
                                     const ulong position_id,const string expected_decision_id,
                                     CanaryReconciliation &reconciliation,bool &closed)
{
   closed=false;
   if(position_id==0 || !HistorySelectByPosition(position_id)) return false;
   int total=HistoryDealsTotal();
   bool has_origin=false;
   datetime origin_time=0;
   ulong origin_ticket=0;
   string origin_comment="";
   bool has_foreign_entry=false;
   datetime final_close_time=0;
   ulong final_deal_ticket=0;
   long final_reason=0;
   double accepted_price=0.0;
   double commission=0.0;
   double swap=0.0;
   double fee=0.0;
   double net_result=0.0;
   for(int index=0;index<total;index++)
   {
      ulong deal_ticket=HistoryDealGetTicket(index);
      if(deal_ticket==0) return false;
      if(HistoryDealGetString(deal_ticket,DEAL_SYMBOL)!=symbol) continue;
      ENUM_DEAL_ENTRY entry=(ENUM_DEAL_ENTRY)HistoryDealGetInteger(deal_ticket,DEAL_ENTRY);
      datetime deal_time=(datetime)HistoryDealGetInteger(deal_ticket,DEAL_TIME);
      if(entry==DEAL_ENTRY_IN || entry==DEAL_ENTRY_INOUT)
      {
         if(!has_origin || deal_time<origin_time || (deal_time==origin_time && deal_ticket<origin_ticket))
         {
            has_origin=true;
            origin_time=deal_time;
            origin_ticket=deal_ticket;
            origin_comment=HistoryDealGetString(deal_ticket,DEAL_COMMENT);
         }
      }
   }
   if(!has_origin || HistoryDealGetInteger(origin_ticket,DEAL_MAGIC)!=magic_number) return false;
   for(int index=0;index<total;index++)
   {
      ulong deal_ticket=HistoryDealGetTicket(index);
      if(deal_ticket==0) return false;
      if(deal_ticket==origin_ticket || HistoryDealGetString(deal_ticket,DEAL_SYMBOL)!=symbol) continue;
      ENUM_DEAL_ENTRY entry=(ENUM_DEAL_ENTRY)HistoryDealGetInteger(deal_ticket,DEAL_ENTRY);
      if((entry==DEAL_ENTRY_IN || entry==DEAL_ENTRY_INOUT)
         && HistoryDealGetInteger(deal_ticket,DEAL_MAGIC)!=magic_number)
         has_foreign_entry=true;
   }
   if(has_foreign_entry) return false;
   if(expected_decision_id!="" && !IsCanaryCorrelatedLifecyclePosition(expected_decision_id,
      position_id,origin_comment,position_id)) return false;
   if(CanaryPositionIdentifierOpen(symbol,position_id)) return true;

   for(int index=0;index<total;index++)
   {
      ulong deal_ticket=HistoryDealGetTicket(index);
      if(deal_ticket==0) return false;
      if(HistoryDealGetString(deal_ticket,DEAL_SYMBOL)!=symbol) continue;
      double deal_net=DealNet(deal_ticket);
      if(!MathIsValidNumber(deal_net)) return false;
      net_result+=deal_net;
      commission+=HistoryDealGetDouble(deal_ticket,DEAL_COMMISSION);
      swap+=HistoryDealGetDouble(deal_ticket,DEAL_SWAP);
      fee+=HistoryDealGetDouble(deal_ticket,DEAL_FEE);
      ENUM_DEAL_ENTRY entry=(ENUM_DEAL_ENTRY)HistoryDealGetInteger(deal_ticket,DEAL_ENTRY);
      datetime deal_time=(datetime)HistoryDealGetInteger(deal_ticket,DEAL_TIME);
      if((entry==DEAL_ENTRY_OUT || entry==DEAL_ENTRY_OUT_BY) && deal_time>=final_close_time)
      {
         final_close_time=deal_time;
         final_deal_ticket=deal_ticket;
         final_reason=HistoryDealGetInteger(deal_ticket,DEAL_REASON);
         accepted_price=HistoryDealGetDouble(deal_ticket,DEAL_PRICE);
      }
   }
   if(final_close_time<=0) return false;
   closed=true;
   reconciliation.hasClosedPosition=true;
   reconciliation.finalCloseTime=final_close_time;
   reconciliation.dealTicket=final_deal_ticket;
   reconciliation.closedPositionId=position_id;
   reconciliation.lastCloseWasStop=final_reason==DEAL_REASON_SL;
   reconciliation.acceptedPrice=accepted_price;
   reconciliation.commission=commission;
   reconciliation.swap=swap;
   reconciliation.fee=fee;
   reconciliation.netResult=net_result;
   return true;
}

bool ReadCanaryClosedPositionResults(const string symbol,const long magic_number,
                                     const datetime day_start,const datetime now,
                                     CanaryDailyState &daily,CanaryReconciliation &reconciliation)
{
   daily.brokerDay="";
   daily.lossCount=0;
   daily.realizedLoss=0.0;
   if(day_start<=0 || now<day_start || !HistorySelect(day_start,now)) return false;

   ulong position_ids[];
   datetime final_close_times[];
   int day_total=HistoryDealsTotal();
   for(int index=0;index<day_total;index++)
   {
      ulong deal_ticket=HistoryDealGetTicket(index);
      if(deal_ticket==0) return false;
      if(HistoryDealGetString(deal_ticket,DEAL_SYMBOL)!=symbol) continue;
      ENUM_DEAL_ENTRY entry=(ENUM_DEAL_ENTRY)HistoryDealGetInteger(deal_ticket,DEAL_ENTRY);
      if(entry!=DEAL_ENTRY_OUT && entry!=DEAL_ENTRY_OUT_BY) continue;
      ulong position_id=(ulong)HistoryDealGetInteger(deal_ticket,DEAL_POSITION_ID);
      datetime close_time=(datetime)HistoryDealGetInteger(deal_ticket,DEAL_TIME);
      if(position_id==0 || close_time<day_start || close_time>now) continue;
      int found=FindCanaryPositionId(position_ids,position_id);
      if(found<0)
      {
         int size=ArraySize(position_ids);
         ArrayResize(position_ids,size+1);
         ArrayResize(final_close_times,size+1);
         position_ids[size]=position_id;
         final_close_times[size]=close_time;
      }
      else if(close_time>final_close_times[found]) final_close_times[found]=close_time;
   }

   for(int position_index=0;position_index<ArraySize(position_ids);position_index++)
   {
      ulong position_id=position_ids[position_index];
      if(CanaryPositionIdentifierOpen(symbol,position_id)) continue;
      if(!HistorySelectByPosition(position_id)) return false;
      int position_deals=HistoryDealsTotal();
      bool has_origin=false;
      long origin_magic=0;
      datetime origin_time=0;
      ulong origin_ticket=0;
      bool has_foreign_entry=false;
      bool has_nonmagic_close=false;
      datetime final_close_time=0;
      ulong final_deal_ticket=0;
      long final_reason=0;
      double accepted_price=0.0;
      double commission=0.0;
      double swap=0.0;
      double fee=0.0;
      double net_result=0.0;

      for(int deal_index=0;deal_index<position_deals;deal_index++)
      {
         ulong deal_ticket=HistoryDealGetTicket(deal_index);
         if(deal_ticket==0) return false;
         if(HistoryDealGetString(deal_ticket,DEAL_SYMBOL)!=symbol) continue;
         ENUM_DEAL_ENTRY entry=(ENUM_DEAL_ENTRY)HistoryDealGetInteger(deal_ticket,DEAL_ENTRY);
         if(entry!=DEAL_ENTRY_IN && entry!=DEAL_ENTRY_INOUT) continue;
         datetime deal_time=(datetime)HistoryDealGetInteger(deal_ticket,DEAL_TIME);
         if(!has_origin || deal_time<origin_time || (deal_time==origin_time && deal_ticket<origin_ticket))
         {
            has_origin=true;
            origin_time=deal_time;
            origin_ticket=deal_ticket;
            origin_magic=HistoryDealGetInteger(deal_ticket,DEAL_MAGIC);
         }
      }
      if(!has_origin) return false;
      for(int deal_index=0;deal_index<position_deals;deal_index++)
      {
         ulong deal_ticket=HistoryDealGetTicket(deal_index);
         if(deal_ticket==0) return false;
         if(HistoryDealGetString(deal_ticket,DEAL_SYMBOL)!=symbol || deal_ticket==origin_ticket) continue;
         ENUM_DEAL_ENTRY entry=(ENUM_DEAL_ENTRY)HistoryDealGetInteger(deal_ticket,DEAL_ENTRY);
         if((entry==DEAL_ENTRY_IN || entry==DEAL_ENTRY_INOUT)
            && HistoryDealGetInteger(deal_ticket,DEAL_MAGIC)!=magic_number)
            has_foreign_entry=true;
         if((entry==DEAL_ENTRY_OUT || entry==DEAL_ENTRY_OUT_BY)
            && HistoryDealGetInteger(deal_ticket,DEAL_MAGIC)!=magic_number)
            has_nonmagic_close=true;
      }
      CanaryClosedOwnershipClass ownership=ClassifyCanaryClosedPositionOwnership(
         origin_magic==magic_number,has_foreign_entry,has_nonmagic_close);
      if(ownership==CANARY_CLOSED_OWNERSHIP_FOREIGN) continue;
      if(ownership==CANARY_CLOSED_OWNERSHIP_UNSAFE) return false;

      for(int deal_index=0;deal_index<position_deals;deal_index++)
      {
         ulong deal_ticket=HistoryDealGetTicket(deal_index);
         if(deal_ticket==0) return false;
         if(HistoryDealGetString(deal_ticket,DEAL_SYMBOL)!=symbol) continue;
         double deal_net=DealNet(deal_ticket);
         if(!MathIsValidNumber(deal_net)) return false;
         net_result+=deal_net;
         commission+=HistoryDealGetDouble(deal_ticket,DEAL_COMMISSION);
         swap+=HistoryDealGetDouble(deal_ticket,DEAL_SWAP);
         fee+=HistoryDealGetDouble(deal_ticket,DEAL_FEE);
         ENUM_DEAL_ENTRY entry=(ENUM_DEAL_ENTRY)HistoryDealGetInteger(deal_ticket,DEAL_ENTRY);
         datetime deal_time=(datetime)HistoryDealGetInteger(deal_ticket,DEAL_TIME);
         if((entry==DEAL_ENTRY_OUT || entry==DEAL_ENTRY_OUT_BY) && deal_time>=final_close_time)
         {
            final_close_time=deal_time;
            final_deal_ticket=deal_ticket;
            final_reason=HistoryDealGetInteger(deal_ticket,DEAL_REASON);
            accepted_price=HistoryDealGetDouble(deal_ticket,DEAL_PRICE);
         }
      }
      if(final_close_time<day_start || final_close_time>now) continue;
      if(net_result<0.0)
      {
         daily.lossCount++;
         daily.realizedLoss+=MathAbs(net_result);
      }
      if(!reconciliation.hasClosedPosition || final_close_time>reconciliation.finalCloseTime)
      {
         reconciliation.hasClosedPosition=true;
         reconciliation.finalCloseTime=final_close_time;
         reconciliation.dealTicket=final_deal_ticket;
         reconciliation.closedPositionId=position_id;
         reconciliation.lastCloseWasStop=final_reason==DEAL_REASON_SL;
         reconciliation.acceptedPrice=accepted_price;
         reconciliation.commission=commission;
         reconciliation.swap=swap;
         reconciliation.fee=fee;
         reconciliation.netResult=net_result;
      }
   }
   daily.brokerDay=CanaryDayKey(day_start);
   return HistorySelect(day_start,now);
}

datetime CanaryServerDayStart(const datetime server_now)
{
   MqlDateTime parts;
   if(server_now<=0 || !TimeToStruct(server_now,parts)) return 0;
   parts.hour=0;
   parts.min=0;
   parts.sec=0;
   return StructToTime(parts);
}

bool ReconcileCanaryBrokerState(const string symbol,const long magic_number,
                                const CanaryDecision &decision,const bool observation_used,
                                const CanaryBrokerResultClass result_class,
                                const CanarySafetyLatch &latch,
                                CanaryReconciliation &reconciliation)
{
   InitializeCanaryReconciliation(reconciliation);
   int ea_position_count=0;
   if(symbol!="XAUUSD" || (magic_number!=880101 && magic_number!=880201)
      || !ScanCanaryGoldExposure(symbol,magic_number,reconciliation.position,
         ea_position_count,reconciliation.hasEaPendingOrder,reconciliation.hasForeignGoldExposure))
   {
      reconciliation.detail="Authoritative Gold exposure could not be classified.";
      return false;
   }

   datetime now=TimeTradeServer();
   datetime day_start=CanaryServerDayStart(now);
   if(!ReadCanaryClosedPositionResults(symbol,magic_number,day_start,now,
      reconciliation.daily,reconciliation))
   {
      reconciliation.detail="Authoritative broker-day deal history could not be reconciled.";
      return false;
   }

   bool correlated_entry_position=false;
   bool correlated_entry_closed=false;
   ulong correlated_entry_position_id=0;
   string correlated_entry_decision_id="";
   if(latch.activePositionDecisionId!="")
   {
      correlated_entry_position=true;
      correlated_entry_decision_id=latch.activePositionDecisionId;
      correlated_entry_position_id=(ulong)StringToInteger(latch.activePositionId);
      if(correlated_entry_position_id==0
         || !ReadCanaryLifecyclePositionById(symbol,magic_number,correlated_entry_position_id,
            correlated_entry_decision_id,reconciliation,correlated_entry_closed)
         || (!correlated_entry_closed && (!reconciliation.position.present
            || reconciliation.position.identifier!=correlated_entry_position_id)))
      {
         reconciliation.detail="The active opening correlation could not recover its exact position lifecycle.";
         return false;
      }
   }
   else if(latch.pendingEntryDecisionId!="")
   {
      correlated_entry_decision_id=latch.pendingEntryDecisionId;
      if(!FindCanaryPendingEntryPosition(latch,symbol,magic_number,now,
         correlated_entry_position,correlated_entry_position_id))
      {
         reconciliation.detail="The pending entry identity could not be authoritatively correlated.";
         return false;
      }
      if(correlated_entry_position
         && !ReadCanaryLifecyclePositionById(symbol,magic_number,correlated_entry_position_id,
            correlated_entry_decision_id,reconciliation,correlated_entry_closed))
      {
         reconciliation.detail="The correlated entry position lifecycle could not be recovered.";
         return false;
      }
   }
   bool emergency_position_closed=false;
   if(latch.emergencyPositionId!="")
   {
      ulong emergency_position_id=(ulong)StringToInteger(latch.emergencyPositionId);
      if(!ReadCanaryLifecyclePositionById(symbol,magic_number,emergency_position_id,"",
         reconciliation,emergency_position_closed))
      {
         reconciliation.detail="The emergency position lifecycle could not be recovered.";
         return false;
      }
   }

   CanaryReconciliationFacts facts;
   ZeroMemory(facts);
   facts.brokerStateAvailable=ea_position_count<=1;
   facts.resultClass=result_class;
   facts.hasEaPosition=reconciliation.position.present;
   facts.eaPositionProtected=reconciliation.position.stopProtected;
   if(reconciliation.position.present
      && MathAbs(reconciliation.position.volume-CANARY_HARD_MAX_VOLUME)>0.00000001)
      facts.resultClass=CANARY_RESULT_PARTIAL;
   facts.hasEaPendingOrder=reconciliation.hasEaPendingOrder;
   facts.hasForeignGoldExposure=reconciliation.hasForeignGoldExposure;
   facts.sameDirection=decision.loaded && !observation_used && reconciliation.position.present
      && (decision.direction=="buy" || decision.direction=="sell")
      && decision.direction==reconciliation.position.direction;
   facts.oppositeDirection=!observation_used && decision.loaded && reconciliation.position.present
      && IsCanaryActionableOpposite(decision.direction,reconciliation.position.direction);
   facts.closeConfirmed=latch.pendingCloseDecisionId!="" && correlated_entry_position
      && correlated_entry_closed && !reconciliation.position.present && !reconciliation.hasEaPendingOrder;
   facts.stoppedObservation=!latch.protectionError
      && (latch.unresolved || latch.activePositionDecisionId!="")
      && correlated_entry_position && correlated_entry_closed
      && reconciliation.lastCloseWasStop && !reconciliation.position.present
      && !reconciliation.hasEaPendingOrder;
   bool authoritative_stop_closure=facts.stoppedObservation;
   bool authoritative_emergency_closure=latch.protectionError && latch.emergencyCloseAttempted
      && latch.emergencyPositionId!="" && !reconciliation.position.present
      && emergency_position_closed
      && CanaryTicketString(reconciliation.closedPositionId)==latch.emergencyPositionId;
   reconciliation.authoritativeStopClosure=authoritative_stop_closure;
   reconciliation.authoritativeEmergencyClosure=authoritative_emergency_closure;
   facts.persistentSafetyPause=latch.protectionError && !reconciliation.position.present;
   facts.dailyLimitReached=reconciliation.daily.lossCount>=CANARY_HARD_MAX_DAILY_LOSSES
      || reconciliation.daily.realizedLoss>=CANARY_HARD_MAX_DAILY_LOSS;
   if(latch.protectionError && reconciliation.position.present)
      facts.eaPositionProtected=false;
   if(authoritative_stop_closure || authoritative_emergency_closure)
      facts.resultClass=CANARY_RESULT_NONE;
   else if(facts.resultClass==CANARY_RESULT_UNKNOWN
      && ((correlated_entry_position && reconciliation.position.present
            && reconciliation.position.identifier==correlated_entry_position_id
            && reconciliation.position.stopProtected
            && MathAbs(reconciliation.position.volume-CANARY_HARD_MAX_VOLUME)<=0.00000001)
         || facts.closeConfirmed))
      facts.resultClass=CANARY_RESULT_NONE;
   if(latch.unresolved && result_class==CANARY_RESULT_NONE
      && !reconciliation.position.present && !facts.closeConfirmed
      && !authoritative_stop_closure && !authoritative_emergency_closure)
      facts.resultClass=CANARY_RESULT_UNKNOWN;

   reconciliation.state=ReduceCanaryLifecycle(facts);
   reconciliation.available=facts.brokerStateAvailable;
   if(reconciliation.state==CANARY_LIFECYCLE_FILLED_PROTECTED)
   {
      reconciliation.reconciliationState="reconciled";
      reconciliation.detail=facts.sameDirection
         ? "Broker confirms the same-direction EA-owned Gold position and protective stop; no new order is allowed."
         : "Broker confirms the EA-owned Gold position and valid protective stop.";
   }
   else if(reconciliation.state==CANARY_LIFECYCLE_EMERGENCY_CLOSE)
   {
      reconciliation.reconciliationState="protection_error";
      reconciliation.detail="Broker confirms EA-owned Gold exposure without a valid protective stop.";
   }
   else if(reconciliation.state==CANARY_LIFECYCLE_RECONCILIATION_REQUIRED)
   {
      reconciliation.reconciliationState="required";
      reconciliation.detail="The broker outcome is unknown, partial, pending, or otherwise unresolved; submission remains blocked.";
   }
   else if(reconciliation.state==CANARY_LIFECYCLE_BLOCKED)
   {
      reconciliation.reconciliationState="foreign_exposure";
      reconciliation.detail="Manual or foreign Gold exposure blocks this broker.";
   }
   else if(reconciliation.state==CANARY_LIFECYCLE_STOPPED)
   {
      reconciliation.reconciliationState="reconciled";
      reconciliation.detail="The broker confirms a stop-loss closure and the attempted observation remains consumed.";
   }
   else if(reconciliation.state==CANARY_LIFECYCLE_CLOSED)
   {
      reconciliation.reconciliationState="reconciled";
      reconciliation.detail="The broker confirms the opposite-signal position closure.";
   }
   else if(reconciliation.state==CANARY_LIFECYCLE_ORDER_REJECTED)
   {
      reconciliation.reconciliationState="terminal";
      reconciliation.detail="The broker definitively rejected the request; this decision remains consumed.";
   }
   else if(reconciliation.state==CANARY_LIFECYCLE_PAUSED)
   {
      if(facts.persistentSafetyPause)
      {
         reconciliation.reconciliationState="protection_error";
         reconciliation.detail="A persistent broker protection error pauses new entries until operator clearance.";
      }
      else
      {
         reconciliation.reconciliationState="reconciled";
         reconciliation.detail="The broker-day realized-loss ceiling pauses new entries until the next server day.";
      }
   }
   else
   {
      reconciliation.reconciliationState="reconciled";
      reconciliation.detail="Authoritative broker state is reconciled and contains no blocking Gold exposure.";
   }
   return reconciliation.available;
}

#endif
