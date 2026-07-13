#ifndef OPENALICE_JMB_CANARY_TRADE_GATEWAY_MQH
#define OPENALICE_JMB_CANARY_TRADE_GATEWAY_MQH

#include "JmbCanaryState.mqh"

struct TradeSubmitResult
{
   bool sent;
   uint retcode;
   ulong order_ticket;
   ulong deal_ticket;
   double accepted_volume;
   double accepted_price;
   string detail;
};

bool ResolveMarketFilling(const string symbol,ENUM_ORDER_TYPE_FILLING &resolved)
{
   long flags=0;
   long execution=0;
   if(!SymbolInfoInteger(symbol,SYMBOL_FILLING_MODE,flags)
      || !SymbolInfoInteger(symbol,SYMBOL_TRADE_EXEMODE,execution)) return false;
   if((flags&SYMBOL_FILLING_FOK)==SYMBOL_FILLING_FOK)
   {
      resolved=ORDER_FILLING_FOK;
      return true;
   }
   if((flags&SYMBOL_FILLING_IOC)==SYMBOL_FILLING_IOC)
   {
      resolved=ORDER_FILLING_IOC;
      return true;
   }
   if(execution!=SYMBOL_TRADE_EXECUTION_MARKET)
   {
      resolved=ORDER_FILLING_RETURN;
      return true;
   }
   return false;
}

TradeSubmitResult CheckedSendCanaryRequest(MqlTradeRequest &request)
{
   TradeSubmitResult result;
   ZeroMemory(result);
   MqlTradeCheckResult check={};
   MqlTradeResult broker={};
   if(!OrderCheck(request,check) || check.retcode!=0)
   {
      result.retcode=check.retcode;
      result.detail=check.comment;
      return result;
   }
   result.sent=OrderSend(request,broker);
   result.retcode=broker.retcode;
   result.order_ticket=broker.order;
   result.deal_ticket=broker.deal;
   result.accepted_volume=broker.volume;
   result.accepted_price=broker.price;
   result.detail=broker.comment;
   return result;
}

bool IsGatewayStopProtective(const CanaryDecision &decision,const MqlTick &tick)
{
   long order_mode=0;
   long stops_level=0;
   double point=0.0;
   double tick_size=0.0;
   if(!SymbolInfoInteger("XAUUSD",SYMBOL_ORDER_MODE,order_mode)
      || !SymbolInfoInteger("XAUUSD",SYMBOL_TRADE_STOPS_LEVEL,stops_level)
      || !SymbolInfoDouble("XAUUSD",SYMBOL_POINT,point)
      || !SymbolInfoDouble("XAUUSD",SYMBOL_TRADE_TICK_SIZE,tick_size)) return false;
   if((order_mode&SYMBOL_ORDER_SL)!=SYMBOL_ORDER_SL || stops_level<0
      || !MathIsValidNumber(point) || point<=0.0
      || !MathIsValidNumber(tick_size) || tick_size<=0.0
      || !MathIsValidNumber(decision.stopLoss) || decision.stopLoss<=0.0) return false;

   double aligned_stop=MathRound(decision.stopLoss/tick_size)*tick_size;
   double tolerance=MathMax(0.00000001,tick_size*0.0000001);
   if(MathAbs(decision.stopLoss-aligned_stop)>tolerance) return false;
   double entry=decision.direction=="buy" ? tick.ask : tick.bid;
   double minimum_distance=(double)stops_level*point;
   if(!MathIsValidNumber(entry) || entry<=0.0) return false;
   return decision.direction=="buy"
      ? decision.stopLoss<entry && entry-decision.stopLoss+tolerance>=minimum_distance
      : decision.stopLoss>entry && decision.stopLoss-entry+tolerance>=minimum_distance;
}

bool CanaryGatewayIdentityValid(const long magic_number)
{
   return (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO
      && (magic_number==880101 || magic_number==880201);
}

bool SetCanaryCloseVolume(MqlTradeRequest &close,const double close_volume)
{
   if(!MathIsValidNumber(close_volume) || close_volume<=0.0
      || close_volume>CANARY_HARD_MAX_VOLUME) return false;
   close.volume=close_volume;
   return true;
}

bool BuildCanaryCloseRequest(const CanaryPositionSnapshot &position,
                             const long magic_number,
                             const double max_deviation,
                             const string comment,
                             MqlTradeRequest &close)
{
   if(!CanaryGatewayIdentityValid(magic_number) || !position.present || position.ticket==0
      || (position.direction!="buy" && position.direction!="sell")) return false;
   MqlTick tick;
   double point=0.0;
   if(!SymbolInfoTick("XAUUSD",tick) || !SymbolInfoDouble("XAUUSD",SYMBOL_POINT,point)
      || !MathIsValidNumber(point) || point<=0.0 || !MathIsValidNumber(max_deviation)
      || max_deviation<0.0) return false;
   double deviation_points=MathFloor(max_deviation/point);
   if(!MathIsValidNumber(deviation_points) || deviation_points<0.0
      || deviation_points>(double)ULONG_MAX) return false;

   ZeroMemory(close);
   close.action=TRADE_ACTION_DEAL;
   close.magic=(ulong)magic_number;
   close.symbol="XAUUSD";
   if(!SetCanaryCloseVolume(close,position.volume)) return false;
   close.type=position.direction=="buy" ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
   close.price=position.direction=="buy" ? tick.bid : tick.ask;
   close.position=position.ticket;
   close.deviation=(ulong)deviation_points;
   close.comment=comment;
   return ResolveMarketFilling("XAUUSD",close.type_filling);
}

TradeSubmitResult SubmitProtectedMarketOrder(const CanaryDecision &decision,const CanaryPolicy &policy)
{
   TradeSubmitResult result;
   ZeroMemory(result);
   if(!CanaryGatewayIdentityValid(policy.magicNumber))
   {
      result.detail="Account is not demo or broker magic is not allowlisted.";
      return result;
   }
   if(!decision.loaded || !policy.loaded || decision.accountMode!="demo"
      || decision.symbol!="XAUUSD" || policy.symbol!="XAUUSD"
      || decision.volume!=CANARY_HARD_MAX_VOLUME || policy.maxVolume!=CANARY_HARD_MAX_VOLUME)
   {
      result.detail="The immutable Gold or 0.01-volume binding failed.";
      return result;
   }
   long expected_magic=decision.broker=="hfmarkets" ? 880101
      : decision.broker=="icmarkets" ? 880201 : 0;
   if(expected_magic==0 || policy.broker!=decision.broker || policy.magicNumber!=expected_magic
      || (policy.magicNumber!=880101 && policy.magicNumber!=880201))
   {
      result.detail="The immutable broker magic binding failed.";
      return result;
   }
   if(decision.direction!="buy" && decision.direction!="sell")
   {
      result.detail="The direction is not allowlisted.";
      return result;
   }

   MqlTick tick;
   double point=0.0;
   if(!SymbolInfoTick("XAUUSD",tick) || !IsGatewayStopProtective(decision,tick)
      || !SymbolInfoDouble("XAUUSD",SYMBOL_POINT,point) || !MathIsValidNumber(point) || point<=0.0
      || !MathIsValidNumber(policy.maxDeviation) || policy.maxDeviation<0.0)
   {
      result.detail="The original request cannot carry a broker-valid protective stop.";
      return result;
   }
   double deviation_points=MathFloor(policy.maxDeviation/point);
   if(!MathIsValidNumber(deviation_points) || deviation_points<0.0
      || deviation_points>(double)ULONG_MAX)
   {
      result.detail="The deviation cannot be represented safely in points.";
      return result;
   }

   MqlTradeRequest request={};
   request.action=TRADE_ACTION_DEAL;
   request.magic=(ulong)policy.magicNumber;
   request.symbol="XAUUSD";
   request.volume=CANARY_HARD_MAX_VOLUME;
   request.type=decision.direction=="buy" ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   request.price=decision.direction=="buy" ? tick.ask : tick.bid;
   request.sl=decision.stopLoss;
   request.deviation=(ulong)deviation_points;
   request.comment=CanaryEntryCorrelationComment(decision.decisionId);
   if(!ResolveMarketFilling("XAUUSD",request.type_filling))
   {
      result.detail="No supported market filling mode is available.";
      return result;
   }
   return CheckedSendCanaryRequest(request);
}

TradeSubmitResult SubmitCanaryReversalClose(const CanaryPositionSnapshot &position,
                                            const CanaryDecision &decision,
                                            const CanaryPolicy &policy)
{
   MqlTradeRequest request={};
   TradeSubmitResult result;
   ZeroMemory(result);
   if(!decision.loaded || !policy.loaded || decision.symbol!="XAUUSD"
      || policy.symbol!="XAUUSD" || !BuildCanaryCloseRequest(position,policy.magicNumber,
         policy.maxDeviation,"JMB-REV:"+StringSubstr(decision.decisionId,0,16),request))
   {
      result.detail="The reversal close request failed immutable validation.";
      return result;
   }
   return CheckedSendCanaryRequest(request);
}

TradeSubmitResult SubmitCanaryEmergencyClose(const CanaryPositionSnapshot &position,
                                             const CanaryPolicy &policy)
{
   MqlTradeRequest request={};
   TradeSubmitResult result;
   ZeroMemory(result);
   if(!policy.loaded || policy.symbol!="XAUUSD"
      || !BuildCanaryCloseRequest(position,policy.magicNumber,policy.maxDeviation,
         "JMB-EMERGENCY-CLOSE",request))
   {
      result.detail="The emergency close request failed immutable validation.";
      return result;
   }
   return CheckedSendCanaryRequest(request);
}

#endif
