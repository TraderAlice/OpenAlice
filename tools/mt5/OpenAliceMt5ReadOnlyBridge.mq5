// OpenAlice MT5 read-only bridge. This Expert Advisor does not include any
// trade function and cannot place, change, or cancel orders.
#property strict
#property version "1.100"

input string InpBrokerId = "hfmarkets";
input string InpSymbol = "XAUUSD";
input int InpHeartbeatSeconds = 30;
input int InpTradeLedgerHistoryDays = 30;
input int InpTradeLedgerRefreshMinutes = 15;

const string OUTPUT_ROOT = "OpenAliceMt5BridgeV1";
const string TRADE_LEDGER_ROOT = "OpenAliceMt5TradeLedgerV1";

datetime g_last_trade_ledger_refresh = 0;

string IsoTime(datetime value)
{
   MqlDateTime parts;
   TimeToStruct(value, parts);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02d.000Z", parts.year, parts.mon, parts.day, parts.hour, parts.min, parts.sec);
}

string IsoDate(datetime value)
{
   MqlDateTime parts;
   TimeToStruct(value, parts);
   return StringFormat("%04d-%02d-%02d", parts.year, parts.mon, parts.day);
}

string AccountModeLabel()
{
   ENUM_ACCOUNT_TRADE_MODE mode = (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(mode == ACCOUNT_TRADE_MODE_DEMO) return "demo";
   if(mode == ACCOUNT_TRADE_MODE_CONTEST) return "contest";
   if(mode == ACCOUNT_TRADE_MODE_REAL) return "real";
   return "unknown";
}

bool EnsureOutputDirectory()
{
   if(!FolderCreate(OUTPUT_ROOT, FILE_COMMON)) return false;
   if(!FolderCreate(OUTPUT_ROOT + "\\" + InpBrokerId, FILE_COMMON)) return false;
   return FolderCreate(OUTPUT_ROOT + "\\" + InpBrokerId + "\\" + InpSymbol, FILE_COMMON);
}

bool EnsureTradeLedgerDirectory()
{
   if(!FolderCreate(TRADE_LEDGER_ROOT, FILE_COMMON)) return false;
   if(!FolderCreate(TRADE_LEDGER_ROOT + "\\" + InpBrokerId, FILE_COMMON)) return false;
   return FolderCreate(TRADE_LEDGER_ROOT + "\\" + InpBrokerId + "\\" + InpSymbol, FILE_COMMON);
}

bool ReplaceCommonFile(const string temp_path,const string final_path)
{
   return FileMove(temp_path,FILE_COMMON,final_path,FILE_COMMON|FILE_REWRITE);
}

bool WriteCompletedD1()
{
   MqlRates rates[];
   ArraySetAsSeries(rates,false);
   int copied=CopyRates(InpSymbol,PERIOD_D1,1,300,rates);
   if(copied<2) return false;
   string final_path=OUTPUT_ROOT+"\\"+InpBrokerId+"\\"+InpSymbol+"\\completed_d1.csv";
   string temp_path=final_path+".tmp";
   int handle=FileOpen(temp_path,FILE_WRITE|FILE_CSV|FILE_ANSI|FILE_COMMON,',');
   if(handle==INVALID_HANDLE) return false;
   datetime captured_at=TimeGMT();
   FileWrite(handle,"schema_version","captured_at","broker","server","account_mode","symbol","bar_as_of","bar_open_epoch","open","high","low","close");
   for(int i=0;i<copied;i++)
      FileWrite(handle,1,IsoTime(captured_at),InpBrokerId,AccountInfoString(ACCOUNT_SERVER),AccountModeLabel(),InpSymbol,
         IsoDate(rates[i].time),IntegerToString((long)rates[i].time),rates[i].open,rates[i].high,rates[i].low,rates[i].close);
   FileFlush(handle);
   FileClose(handle);
   return ReplaceCommonFile(temp_path,final_path);
}

string DateKey(datetime value)
{
   MqlDateTime parts;
   TimeToStruct(value,parts);
   return StringFormat("%04d%02d%02d",parts.year,parts.mon,parts.day);
}

void RetainRecentSpreadFiles(const string directory,const string current_file,const string previous_file)
{
   string found;
   long search_handle=FileFindFirst(directory+"\\spread_samples_*.csv",found,FILE_COMMON);
   if(search_handle==INVALID_HANDLE) return;
   do
   {
      if(found!=current_file && found!=previous_file)
         FileDelete(directory+"\\"+found,FILE_COMMON);
   }
   while(FileFindNext(search_handle,found));
   FileFindClose(search_handle);
}

bool WriteSpreadSample(const MqlTick &tick)
{
   datetime captured_at=TimeGMT();
   string directory=OUTPUT_ROOT+"\\"+InpBrokerId+"\\"+InpSymbol;
   string current_file="spread_samples_"+DateKey(captured_at)+".csv";
   string previous_file="spread_samples_"+DateKey(captured_at-86400)+".csv";
   string path=directory+"\\"+current_file;
   int handle=FileOpen(path,FILE_READ|FILE_WRITE|FILE_CSV|FILE_ANSI|FILE_COMMON,',');
   if(handle==INVALID_HANDLE) return false;
   if(FileSize(handle)==0)
      FileWrite(handle,"schema_version","captured_at","broker","server","account_mode","symbol","bid","ask","spread","point","digits","contract_size","volume_min","volume_step","stops_level","freeze_level");
   FileSeek(handle,0,SEEK_END);
   FileWrite(handle,1,IsoTime(captured_at),InpBrokerId,AccountInfoString(ACCOUNT_SERVER),AccountModeLabel(),InpSymbol,
      tick.bid,tick.ask,tick.ask-tick.bid,SymbolInfoDouble(InpSymbol,SYMBOL_POINT),(int)SymbolInfoInteger(InpSymbol,SYMBOL_DIGITS),
      SymbolInfoDouble(InpSymbol,SYMBOL_TRADE_CONTRACT_SIZE),SymbolInfoDouble(InpSymbol,SYMBOL_VOLUME_MIN),
      SymbolInfoDouble(InpSymbol,SYMBOL_VOLUME_STEP),(int)SymbolInfoInteger(InpSymbol,SYMBOL_TRADE_STOPS_LEVEL),
      (int)SymbolInfoInteger(InpSymbol,SYMBOL_TRADE_FREEZE_LEVEL));
   FileFlush(handle);
   FileClose(handle);
   RetainRecentSpreadFiles(directory,current_file,previous_file);
   return true;
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

bool ShouldRefreshTradeLedger(const datetime captured_at)
{
   if(InpTradeLedgerHistoryDays <= 0 || InpTradeLedgerRefreshMinutes <= 0)
      return false;
   if(g_last_trade_ledger_refresh == 0)
      return true;
   return captured_at - g_last_trade_ledger_refresh >= InpTradeLedgerRefreshMinutes * 60;
}

bool WriteTradeLedger(const datetime captured_at)
{
   if(!EnsureTradeLedgerDirectory()) return false;

   datetime from_time = captured_at - (InpTradeLedgerHistoryDays * 86400);
   if(!HistorySelect(from_time, captured_at)) return false;

   string final_path = TRADE_LEDGER_ROOT + "\\" + InpBrokerId + "\\" + InpSymbol + "\\deals.csv";
   string temp_path = final_path + ".tmp";
   int handle = FileOpen(temp_path, FILE_WRITE | FILE_CSV | FILE_COMMON | FILE_ANSI, ',');
   if(handle == INVALID_HANDLE) return false;

   FileWrite(handle, "account_mode", "server", "login", "broker", "symbol", "deal_ticket", "order_ticket", "position_id", "time", "entry", "type", "reason", "volume", "price", "commission", "fee", "swap", "profit", "magic", "comment");

   int total = HistoryDealsTotal();
   for(int index = 0; index < total; index++)
   {
      ulong ticket = HistoryDealGetTicket(index);
      string deal_symbol = HistoryDealGetString(ticket, DEAL_SYMBOL);
      if(deal_symbol != InpSymbol) continue;

      datetime deal_time = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
      FileWrite(
         handle,
         AccountModeLabel(),
         AccountInfoString(ACCOUNT_SERVER),
         IntegerToString((int)AccountInfoInteger(ACCOUNT_LOGIN)),
         InpBrokerId,
         InpSymbol,
         IntegerToString((long)ticket),
         IntegerToString((long)HistoryDealGetInteger(ticket, DEAL_ORDER)),
         IntegerToString((long)HistoryDealGetInteger(ticket, DEAL_POSITION_ID)),
         IsoTime(deal_time),
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

   FileFlush(handle);
   FileClose(handle);
   if(!ReplaceCommonFile(temp_path, final_path))
      return false;
   g_last_trade_ledger_refresh = captured_at;
   return true;
}

void WriteHeartbeat()
{
   if(!SymbolSelect(InpSymbol, true) || !EnsureOutputDirectory()) return;

   MqlTick tick;
   if(!SymbolInfoTick(InpSymbol, tick)) return;

   string relativePath = OUTPUT_ROOT + "\\" + InpBrokerId + "\\" + InpSymbol + "\\status.csv";
   FileDelete(relativePath, FILE_COMMON);
   int handle = FileOpen(relativePath, FILE_WRITE | FILE_CSV | FILE_ANSI | FILE_COMMON, ',');
   if(handle == INVALID_HANDLE)
   {
      PrintFormat("OpenAlice bridge could not write %s. Error %d", relativePath, GetLastError());
      return;
   }

   FileWrite(handle,
      "captured_at", "broker", "symbol", "bridge_mode", "account_mode", "server", "terminal_connected",
      "trade_allowed", "trade_expert", "symbol_trade_mode", "bid", "ask", "spread_price", "tick_time",
      "contract_size", "volume_min", "volume_max", "volume_step", "stops_level", "open_positions", "open_orders");
   datetime captured_at = TimeGMT();
   FileWrite(handle,
      IsoTime(captured_at), InpBrokerId, InpSymbol, "read_only", AccountModeLabel(), AccountInfoString(ACCOUNT_SERVER),
      (int)TerminalInfoInteger(TERMINAL_CONNECTED), (int)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED),
      (int)AccountInfoInteger(ACCOUNT_TRADE_EXPERT), (int)SymbolInfoInteger(InpSymbol, SYMBOL_TRADE_MODE),
      tick.bid, tick.ask, tick.ask - tick.bid, IsoTime(captured_at), SymbolInfoDouble(InpSymbol, SYMBOL_TRADE_CONTRACT_SIZE),
      SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_MIN), SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_MAX),
      SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_STEP), (int)SymbolInfoInteger(InpSymbol, SYMBOL_TRADE_STOPS_LEVEL),
      PositionsTotal(), OrdersTotal());
   FileClose(handle);

   if(!WriteCompletedD1())
      PrintFormat("OpenAlice bridge could not refresh completed D1 bars. Error %d",GetLastError());
   if(!WriteSpreadSample(tick))
      PrintFormat("OpenAlice bridge could not append the spread sample. Error %d",GetLastError());
   if(ShouldRefreshTradeLedger(captured_at) && !WriteTradeLedger(captured_at))
      PrintFormat("OpenAlice bridge could not refresh trade ledger. Error %d",GetLastError());
}

int OnInit()
{
   if(InpBrokerId == "" || InpSymbol == "" || InpHeartbeatSeconds < 5 || InpTradeLedgerHistoryDays < 0 || InpTradeLedgerRefreshMinutes < 0)
      return INIT_PARAMETERS_INCORRECT;
   EventSetTimer(InpHeartbeatSeconds);
   WriteHeartbeat();
   Print("OpenAlice read-only bridge started. No trade functions are present.");
   return INIT_SUCCEEDED;
}

void OnTimer() { WriteHeartbeat(); }

void OnDeinit(const int reason) { EventKillTimer(); }
