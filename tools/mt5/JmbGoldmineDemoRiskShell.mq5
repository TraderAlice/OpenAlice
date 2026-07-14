// JMB Goldmine demo risk shell. This Expert Advisor validates local gates and
// writes status only. It deliberately has no trade-submit, amend, or close path.
#property strict
#property version "001.100"

input string InpBrokerId = "hfmarkets";
input string InpSymbol = "XAUUSD";
input double InpMaxLot = 0.01;
input double InpMaxSpread = 0.75;
input int InpDecisionMaxAgeSeconds = 300;
input bool InpKillSwitch = true;

const string DECISION_ROOT = "OpenAliceMt5DecisionLogV1";
const string STATUS_ROOT = "OpenAliceMt5RiskShellV1";

struct DecisionSnapshot
{
   bool parsed;
   string decisionId;
   datetime createdAt;
   int ageSeconds;
   string symbol;
   string mode;
   string direction;
   double volume;
   double stopLoss;
};

string AccountModeLabel()
{
   long mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(mode == ACCOUNT_TRADE_MODE_DEMO) return "demo";
   if(mode == ACCOUNT_TRADE_MODE_REAL) return "real";
   if(mode == ACCOUNT_TRADE_MODE_CONTEST) return "contest";
   return "unknown";
}

string IsoTime(datetime value)
{
   MqlDateTime parts;
   TimeToStruct(value, parts);
   return StringFormat(
      "%04d-%02d-%02dT%02d:%02d:%02d.000Z",
      parts.year,
      parts.mon,
      parts.day,
      parts.hour,
      parts.min,
      parts.sec
   );
}

void AddCsvCell(string &cells[], string value)
{
   int size = ArraySize(cells);
   ArrayResize(cells, size + 1);
   cells[size] = value;
}

void ParseCsvLine(string line, string &cells[])
{
   ArrayResize(cells, 0);
   string current = "";
   bool quoted = false;

   for(int index = 0; index < StringLen(line); index++)
   {
      string character = StringSubstr(line, index, 1);
      if(character == "\"")
      {
         if(quoted && index + 1 < StringLen(line) && StringSubstr(line, index + 1, 1) == "\"")
         {
            current += "\"";
            index++;
         }
         else
         {
            quoted = !quoted;
         }
      }
      else if(character == "," && !quoted)
      {
         AddCsvCell(cells, current);
         current = "";
      }
      else
      {
         current += character;
      }
   }

   AddCsvCell(cells, current);
}

bool TryCsvField(string headerLine, string valueLine, string fieldName, string &value)
{
   string headers[];
   string values[];
   ParseCsvLine(headerLine, headers);
   ParseCsvLine(valueLine, values);

   if(ArraySize(headers) != ArraySize(values)) return false;

   for(int index = 0; index < ArraySize(headers); index++)
   {
      if(headers[index] == fieldName)
      {
         value = values[index];
         return true;
      }
   }

   return false;
}

bool TryIsoTime(string value, datetime &result)
{
   if(StringLen(value) < 19) return false;

   string normalized = StringSubstr(value, 0, 19);
   StringReplace(normalized, "T", " ");
   StringReplace(normalized, "-", ".");
   result = StringToTime(normalized);
   return result > 0;
}

bool EnsureStatusDirectory()
{
   if(!FolderCreate(STATUS_ROOT, FILE_COMMON)) return false;
   if(!FolderCreate(STATUS_ROOT + "\\" + InpBrokerId, FILE_COMMON)) return false;
   return FolderCreate(STATUS_ROOT + "\\" + InpBrokerId + "\\" + InpSymbol, FILE_COMMON);
}

bool ReadDecisionLines(string &headerLine, string &valueLine)
{
   string path = DECISION_ROOT + "\\" + InpBrokerId + "\\" + InpSymbol + "\\latest_decision.csv";
   int handle = FileOpen(path, FILE_READ | FILE_BIN | FILE_COMMON | FILE_ANSI);
   if(handle == INVALID_HANDLE) return false;

   int size = (int)FileSize(handle);
   string text = FileReadString(handle, size);
   FileClose(handle);

   int firstLineEnd = StringFind(text, "\n");
   if(firstLineEnd < 0) return false;

   headerLine = StringSubstr(text, 0, firstLineEnd);
   string remainder = StringSubstr(text, firstLineEnd + 1);
   int secondLineEnd = StringFind(remainder, "\n");
   valueLine = secondLineEnd >= 0 ? StringSubstr(remainder, 0, secondLineEnd) : remainder;
   StringReplace(headerLine, "\r", "");
   StringReplace(valueLine, "\r", "");

   return headerLine != "" && valueLine != "";
}

DecisionSnapshot ReadLatestDecision()
{
   DecisionSnapshot snapshot;
   snapshot.parsed = false;
   snapshot.decisionId = "";
   snapshot.createdAt = 0;
   snapshot.ageSeconds = -1;
   snapshot.symbol = "";
   snapshot.mode = "";
   snapshot.direction = "";
   snapshot.volume = 0.0;
   snapshot.stopLoss = 0.0;

   string headerLine = "";
   string valueLine = "";
   if(!ReadDecisionLines(headerLine, valueLine)) return snapshot;

   string createdAt = "";
   string volume = "";
   string stopLoss = "";
   datetime parsedTime = 0;

   if(!TryCsvField(headerLine, valueLine, "decision_id", snapshot.decisionId)) return snapshot;
   if(!TryCsvField(headerLine, valueLine, "created_at", createdAt)) return snapshot;
   if(!TryCsvField(headerLine, valueLine, "symbol", snapshot.symbol)) return snapshot;
   if(!TryCsvField(headerLine, valueLine, "mode", snapshot.mode)) return snapshot;
   if(!TryCsvField(headerLine, valueLine, "direction", snapshot.direction)) return snapshot;
   if(!TryCsvField(headerLine, valueLine, "volume", volume)) return snapshot;
   if(!TryCsvField(headerLine, valueLine, "stop_loss", stopLoss)) return snapshot;
   if(!TryIsoTime(createdAt, parsedTime)) return snapshot;

   snapshot.createdAt = parsedTime;
   snapshot.ageSeconds = (int)(TimeGMT() - parsedTime);
   snapshot.volume = StringToDouble(volume);
   snapshot.stopLoss = StringToDouble(stopLoss);
   snapshot.parsed = true;
   return snapshot;
}

void WriteGateStatus(string state, string detail, DecisionSnapshot &decision)
{
   if(!EnsureStatusDirectory())
   {
      Print("Unable to create risk shell status directory: ", GetLastError());
      return;
   }

   MqlTick tick;
   bool hasTick = SymbolSelect(InpSymbol, true) && SymbolInfoTick(InpSymbol, tick);
   int digits = (int)SymbolInfoInteger(InpSymbol, SYMBOL_DIGITS);
   double spread = hasTick ? tick.ask - tick.bid : 0.0;

   string path = STATUS_ROOT + "\\" + InpBrokerId + "\\" + InpSymbol + "\\gate_status.csv";
   FileDelete(path, FILE_COMMON);
   int handle = FileOpen(path, FILE_WRITE | FILE_CSV | FILE_COMMON | FILE_ANSI, ',');
   if(handle == INVALID_HANDLE)
   {
      Print("Unable to write risk shell status: ", GetLastError());
      return;
   }

   FileWrite(
      handle,
      "captured_at",
      "broker",
      "symbol",
      "account_mode",
      "state",
      "detail",
      "decision_id",
      "decision_mode",
      "direction",
      "decision_age_seconds",
      "decision_volume",
      "decision_stop_loss",
      "bid",
      "ask",
      "spread",
      "positions",
      "orders"
   );
   FileWrite(
      handle,
      IsoTime(TimeGMT()),
      InpBrokerId,
      InpSymbol,
      AccountModeLabel(),
      state,
      detail,
      decision.decisionId,
      decision.mode,
      decision.direction,
      IntegerToString(decision.ageSeconds),
      DoubleToString(decision.volume, 2),
      DoubleToString(decision.stopLoss, digits),
      hasTick ? DoubleToString(tick.bid, digits) : "",
      hasTick ? DoubleToString(tick.ask, digits) : "",
      hasTick ? DoubleToString(spread, digits) : "",
      IntegerToString(PositionsTotal()),
      IntegerToString(OrdersTotal())
   );
   FileClose(handle);
}

void Evaluate()
{
   DecisionSnapshot decision = ReadLatestDecision();

   if(InpKillSwitch)
   {
      WriteGateStatus("paused", "Kill switch is on; new entries are blocked.", decision);
      return;
   }

   if(AccountModeLabel() != "demo")
   {
      WriteGateStatus("blocked", "Account is not demo.", decision);
      return;
   }

   if(_Symbol != InpSymbol)
   {
      WriteGateStatus("blocked", "EA chart symbol does not match configured symbol.", decision);
      return;
   }

   if(!decision.parsed)
   {
      WriteGateStatus("blocked", "Latest JMB decision file is missing or unreadable.", decision);
      return;
   }

   if(decision.symbol != InpSymbol)
   {
      WriteGateStatus("blocked", "Decision symbol does not match configured symbol.", decision);
      return;
   }

   if(decision.ageSeconds < 0 || decision.ageSeconds > InpDecisionMaxAgeSeconds)
   {
      WriteGateStatus("blocked", "Decision is stale or has an invalid timestamp.", decision);
      return;
   }

   if(decision.mode != "shadow")
   {
      WriteGateStatus("blocked", "Latest decision is not a shadow-ready decision.", decision);
      return;
   }

   if(decision.direction != "buy" && decision.direction != "sell")
   {
      WriteGateStatus("blocked", "Latest decision has no actionable shadow direction.", decision);
      return;
   }

   if(decision.volume <= 0.0 || decision.volume > InpMaxLot)
   {
      WriteGateStatus("blocked", "Decision lot size is outside the configured shell limit.", decision);
      return;
   }

   if(decision.stopLoss <= 0.0)
   {
      WriteGateStatus("blocked", "Decision stop loss is missing or invalid.", decision);
      return;
   }

   if(PositionsTotal() > 0 || OrdersTotal() > 0)
   {
      WriteGateStatus("blocked", "Existing manual or foreign exposure is present.", decision);
      return;
   }

   if(!SymbolSelect(InpSymbol, true))
   {
      WriteGateStatus("blocked", "Configured symbol is unavailable.", decision);
      return;
   }

   MqlTick tick;
   if(!SymbolInfoTick(InpSymbol, tick))
   {
      WriteGateStatus("blocked", "Current quote is unavailable.", decision);
      return;
   }

   double spread = tick.ask - tick.bid;
   if(spread > InpMaxSpread)
   {
      WriteGateStatus("blocked", "Spread exceeds configured maximum.", decision);
      return;
   }

   WriteGateStatus("shadow_ready", "All local shell gates passed. This version writes status only.", decision);
}

int OnInit()
{
   if(InpBrokerId == "" || InpSymbol == "" || InpMaxLot <= 0.0 || InpMaxSpread <= 0.0 || InpDecisionMaxAgeSeconds <= 0)
      return INIT_PARAMETERS_INCORRECT;

   EventSetTimer(10);
   Evaluate();
   Print("JMB Goldmine demo risk shell started in status-only mode.");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   Evaluate();
}

void OnTick()
{
   Evaluate();
}
