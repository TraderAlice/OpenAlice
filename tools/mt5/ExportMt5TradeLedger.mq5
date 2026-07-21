#property strict
#property script_show_inputs

input string InpBrokerId = "hfmarkets";
input string InpSymbol = "XAUUSD";
input int InpHistoryDays = 30;

string AccountModeLabel()
{
   long mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(mode == ACCOUNT_TRADE_MODE_DEMO) return "demo";
   if(mode == ACCOUNT_TRADE_MODE_REAL) return "real";
   return "contest";
}

string DealEntryLabel(long value)
{
   if(value == DEAL_ENTRY_IN) return "in";
   if(value == DEAL_ENTRY_OUT) return "out";
   if(value == DEAL_ENTRY_INOUT) return "inout";
   if(value == DEAL_ENTRY_OUT_BY) return "out_by";
   return IntegerToString((int)value);
}

string DealTypeLabel(long value)
{
   if(value == DEAL_TYPE_BUY) return "buy";
   if(value == DEAL_TYPE_SELL) return "sell";
   if(value == DEAL_TYPE_BALANCE) return "balance";
   if(value == DEAL_TYPE_CREDIT) return "credit";
   if(value == DEAL_TYPE_CHARGE) return "charge";
   if(value == DEAL_TYPE_CORRECTION) return "correction";
   return IntegerToString((int)value);
}

string DealReasonLabel(long value)
{
   if(value == DEAL_REASON_CLIENT) return "client";
   if(value == DEAL_REASON_MOBILE) return "mobile";
   if(value == DEAL_REASON_WEB) return "web";
   if(value == DEAL_REASON_EXPERT) return "expert";
   return IntegerToString((int)value);
}

string CsvEscape(string value)
{
   StringReplace(value, "\"", "\"\"");
   if(StringFind(value, ",") >= 0 || StringFind(value, "\"") >= 0)
      return "\"" + value + "\"";
   return value;
}

void OnStart()
{
   string symbol = InpSymbol == "" ? _Symbol : InpSymbol;
   datetime toTime = TimeCurrent();
   datetime fromTime = toTime - (InpHistoryDays * 86400);
   if(!HistorySelect(fromTime, toTime))
   {
      Print("HistorySelect failed: ", GetLastError());
      return;
   }

   string directory = "OpenAliceMt5TradeLedgerV1\\" + InpBrokerId + "\\" + symbol;
   FolderCreate("OpenAliceMt5TradeLedgerV1", FILE_COMMON);
   FolderCreate("OpenAliceMt5TradeLedgerV1\\" + InpBrokerId, FILE_COMMON);
   FolderCreate(directory, FILE_COMMON);

   string path = directory + "\\deals.csv";
   int handle = FileOpen(path, FILE_WRITE | FILE_CSV | FILE_COMMON | FILE_ANSI, ',');
   if(handle == INVALID_HANDLE)
   {
      Print("FileOpen failed for ", path, ": ", GetLastError());
      return;
   }

   FileWrite(handle, "account_mode", "server", "login", "broker", "symbol", "deal_ticket", "order_ticket", "position_id", "time", "entry", "type", "reason", "volume", "price", "commission", "fee", "swap", "profit", "magic", "comment");

   int total = HistoryDealsTotal();
   for(int index = 0; index < total; index++)
   {
      ulong ticket = HistoryDealGetTicket(index);
      string dealSymbol = HistoryDealGetString(ticket, DEAL_SYMBOL);
      if(dealSymbol != symbol) continue;

      datetime dealTime = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
      string isoTime = TimeToString(dealTime, TIME_DATE | TIME_SECONDS);
      StringReplace(isoTime, ".", "-");
      StringReplace(isoTime, " ", "T");
      isoTime = isoTime + ".000Z";

      FileWrite(
         handle,
         AccountModeLabel(),
         AccountInfoString(ACCOUNT_SERVER),
         IntegerToString((int)AccountInfoInteger(ACCOUNT_LOGIN)),
         InpBrokerId,
         symbol,
         IntegerToString((long)ticket),
         IntegerToString((long)HistoryDealGetInteger(ticket, DEAL_ORDER)),
         IntegerToString((long)HistoryDealGetInteger(ticket, DEAL_POSITION_ID)),
         isoTime,
         DealEntryLabel(HistoryDealGetInteger(ticket, DEAL_ENTRY)),
         DealTypeLabel(HistoryDealGetInteger(ticket, DEAL_TYPE)),
         DealReasonLabel(HistoryDealGetInteger(ticket, DEAL_REASON)),
         DoubleToString(HistoryDealGetDouble(ticket, DEAL_VOLUME), 2),
         DoubleToString(HistoryDealGetDouble(ticket, DEAL_PRICE), _Digits),
         DoubleToString(HistoryDealGetDouble(ticket, DEAL_COMMISSION), 2),
         DoubleToString(HistoryDealGetDouble(ticket, DEAL_FEE), 2),
         DoubleToString(HistoryDealGetDouble(ticket, DEAL_SWAP), 2),
         DoubleToString(HistoryDealGetDouble(ticket, DEAL_PROFIT), 2),
         IntegerToString((long)HistoryDealGetInteger(ticket, DEAL_MAGIC)),
         CsvEscape(HistoryDealGetString(ticket, DEAL_COMMENT))
      );
   }

   FileClose(handle);
   Print("JMB Goldmine trade ledger exported: ", path);
}
