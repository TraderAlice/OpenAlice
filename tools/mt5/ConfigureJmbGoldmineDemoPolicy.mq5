#property strict
#property script_show_inputs

input string InpPolicyVersion = "operator-policy-v1";
input string InpRolloutStage = "status_only";
input bool InpCandidateApproved = false;
input int InpCompletedObservationMaxAgeHours = 72;
input double InpMaxSpread = 0.75;
input double InpMaxDeviation = 0.50;
input double InpMaxRiskAmount = 10.00;
input double InpMaxDailyLoss = 40.00;
input int InpMaxDailyLosingTrades = 4;
input double InpMaxVolume = 0.01;

const string POLICY_ROOT = "OpenAliceMt5DemoPolicyV1";
const string POLICY_SYMBOL = "XAUUSD";
const string STRATEGY_VERSION = "daily-trend-v1";

struct BrokerPolicyBinding
{
   string broker;
   string server;
   long magic_number;
   double max_spread;
   double max_deviation;
};

bool ResolveBrokerBinding(BrokerPolicyBinding &binding)
{
   string server = AccountInfoString(ACCOUNT_SERVER);
   if(server == "HFMarketsGlobal-Demo4")
   {
      binding.broker = "hfmarkets";
      binding.server = server;
      binding.magic_number = 880101;
      binding.max_spread = 0.75;
      binding.max_deviation = 0.50;
      return true;
   }
   if(server == "ICMarketsSC-Demo")
   {
      binding.broker = "icmarkets";
      binding.server = server;
      binding.magic_number = 880201;
      binding.max_spread = 0.30;
      binding.max_deviation = 0.30;
      return true;
   }
   return false;
}

bool IsSafePolicyVersion()
{
   return InpPolicyVersion != ""
      && StringFind(InpPolicyVersion, ",") < 0
      && StringFind(InpPolicyVersion, "\"") < 0
      && StringFind(InpPolicyVersion, "\r") < 0
      && StringFind(InpPolicyVersion, "\n") < 0;
}

bool IsAllowedRolloutStage(const BrokerPolicyBinding &binding)
{
   if(InpRolloutStage == "status_only") return true;
   if(InpRolloutStage == "both_demo") return true;
   if(binding.broker == "hfmarkets" && InpRolloutStage == "hfm_canary") return true;
   if(binding.broker == "icmarkets" && InpRolloutStage == "ic_canary") return true;
   return false;
}

bool IsPositiveFinite(const double value)
{
   return MathIsValidNumber(value) && value > 0.0;
}

bool ValidateLimits(const BrokerPolicyBinding &binding)
{
   return InpCompletedObservationMaxAgeHours > 0
      && InpCompletedObservationMaxAgeHours <= 72
      && IsPositiveFinite(InpMaxSpread)
      && InpMaxSpread <= binding.max_spread
      && IsPositiveFinite(InpMaxDeviation)
      && InpMaxDeviation <= binding.max_deviation
      && IsPositiveFinite(InpMaxRiskAmount)
      && InpMaxRiskAmount <= 10.00
      && IsPositiveFinite(InpMaxDailyLoss)
      && InpMaxDailyLoss <= 40.00
      && InpMaxDailyLosingTrades > 0
      && InpMaxDailyLosingTrades <= 4
      && IsPositiveFinite(InpMaxVolume)
      && InpMaxVolume <= 0.01;
}

bool WritePolicy(const BrokerPolicyBinding &binding)
{
   string directory = POLICY_ROOT + "\\" + binding.broker + "\\" + POLICY_SYMBOL;
   FolderCreate(POLICY_ROOT, FILE_COMMON);
   FolderCreate(POLICY_ROOT + "\\" + binding.broker, FILE_COMMON);
   FolderCreate(directory, FILE_COMMON);

   string final_path = directory + "\\policy.csv";
   string temporary_path = final_path + "." + IntegerToString((int)GetTickCount()) + ".tmp";
   int handle = FileOpen(temporary_path, FILE_WRITE | FILE_CSV | FILE_ANSI | FILE_COMMON, ',');
   if(handle == INVALID_HANDLE)
   {
      PrintFormat("Policy temporary file could not be opened. Error %d", GetLastError());
      return false;
   }

   FileWrite(handle,"schema_version","policy_version","broker","server","symbol","strategy_version","rollout_stage","candidate_approved","completed_observation_max_age_hours","max_spread","max_deviation","max_risk_amount","max_daily_loss","max_daily_losing_trades","max_volume","magic_number");
   FileWrite(handle,
      1,
      InpPolicyVersion,
      binding.broker,
      binding.server,
      POLICY_SYMBOL,
      STRATEGY_VERSION,
      InpRolloutStage,
      InpCandidateApproved ? 1 : 0,
      InpCompletedObservationMaxAgeHours,
      InpMaxSpread,
      InpMaxDeviation,
      InpMaxRiskAmount,
      InpMaxDailyLoss,
      InpMaxDailyLosingTrades,
      InpMaxVolume,
      binding.magic_number);
   FileFlush(handle);
   FileClose(handle);

   if(FileMove(temporary_path, FILE_COMMON, final_path, FILE_COMMON | FILE_REWRITE)) return true;
   PrintFormat("Policy file could not be replaced. Error %d", GetLastError());
   FileDelete(temporary_path, FILE_COMMON);
   return false;
}

void OnStart()
{
   if((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE) != ACCOUNT_TRADE_MODE_DEMO)
   {
      Print("Policy configuration refused: the current account is not demo.");
      return;
   }
   if(_Symbol != POLICY_SYMBOL)
   {
      Print("Policy configuration refused: only the exact XAUUSD symbol is supported.");
      return;
   }

   BrokerPolicyBinding binding;
   if(!ResolveBrokerBinding(binding))
   {
      Print("Policy configuration refused: the current demo server is not allowlisted.");
      return;
   }
   if(!IsSafePolicyVersion() || !IsAllowedRolloutStage(binding) || !ValidateLimits(binding))
   {
      Print("Policy configuration refused: inputs violate the immutable policy contract.");
      return;
   }

   if(WritePolicy(binding))
      PrintFormat("Operator demo policy written for %s / %s at stage %s.", binding.broker, POLICY_SYMBOL, InpRolloutStage);
}
