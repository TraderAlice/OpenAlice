// OpenAlice MT5 read-only bridge. This Expert Advisor does not include any
// trade function and cannot place, change, or cancel orders.
#property strict
#property version "0.1.0"

input string InpBrokerId = "hfmarkets";
input string InpSymbol = "XAUUSD";
input int InpHeartbeatSeconds = 30;

const string OUTPUT_ROOT = "OpenAliceMt5BridgeV1";

string IsoTime(datetime value)
{
   MqlDateTime parts;
   TimeToStruct(value, parts);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02d.000Z", parts.year, parts.mon, parts.day, parts.hour, parts.min, parts.sec);
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
         TimeToString(rates[i].time,TIME_DATE),LongToString((long)rates[i].time),rates[i].open,rates[i].high,rates[i].low,rates[i].close);
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
   FileWrite(handle,
      IsoTime(TimeGMT()), InpBrokerId, InpSymbol, "read_only", AccountModeLabel(), AccountInfoString(ACCOUNT_SERVER),
      (int)TerminalInfoInteger(TERMINAL_CONNECTED), (int)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED),
      (int)AccountInfoInteger(ACCOUNT_TRADE_EXPERT), (int)SymbolInfoInteger(InpSymbol, SYMBOL_TRADE_MODE),
      tick.bid, tick.ask, tick.ask - tick.bid, IsoTime(TimeGMT()), SymbolInfoDouble(InpSymbol, SYMBOL_TRADE_CONTRACT_SIZE),
      SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_MIN), SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_MAX),
      SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_STEP), (int)SymbolInfoInteger(InpSymbol, SYMBOL_TRADE_STOPS_LEVEL),
      PositionsTotal(), OrdersTotal());
   FileClose(handle);

   if(!WriteCompletedD1())
      PrintFormat("OpenAlice bridge could not refresh completed D1 bars. Error %d",GetLastError());
   if(!WriteSpreadSample(tick))
      PrintFormat("OpenAlice bridge could not append the spread sample. Error %d",GetLastError());
}

int OnInit()
{
   if(InpBrokerId == "" || InpSymbol == "" || InpHeartbeatSeconds < 5)
      return INIT_PARAMETERS_INCORRECT;
   EventSetTimer(InpHeartbeatSeconds);
   WriteHeartbeat();
   Print("OpenAlice read-only bridge started. No trade functions are present.");
   return INIT_SUCCEEDED;
}

void OnTimer() { WriteHeartbeat(); }

void OnDeinit(const int reason) { EventKillTimer(); }
