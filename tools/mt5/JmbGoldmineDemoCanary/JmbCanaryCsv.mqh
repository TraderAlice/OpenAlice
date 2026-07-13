#ifndef OPENALICE_JMB_CANARY_CSV_MQH
#define OPENALICE_JMB_CANARY_CSV_MQH

#include "JmbCanaryTypes.mqh"

const string CANARY_DECISION_HEADER="schema_version,decision_id,observation_id,observation_as_of,created_at,lease_issued_at,lease_expires_at,broker,server,account_mode,symbol,strategy_version,direction,entry_reference_price,volume,stop_loss,max_risk_amount,candidate_policy_version,cost_model_version,gate_results_json";

void AddCanaryCsvCell(string &cells[],const string value)
{
   int size=ArraySize(cells);
   ArrayResize(cells,size+1);
   cells[size]=value;
}

bool ParseCanaryCsvRecord(const string line,string &cells[],string &detail)
{
   ArrayResize(cells,0);
   string current="";
   bool quoted=false;
   bool quote_closed=false;

   for(int index=0;index<StringLen(line);index++)
   {
      string character=StringSubstr(line,index,1);
      if(character=="\"")
      {
         if(quoted && index+1<StringLen(line) && StringSubstr(line,index+1,1)=="\"")
         {
            current+="\"";
            index++;
         }
         else if(quoted)
         {
            quoted=false;
            quote_closed=true;
         }
         else if(current=="" && !quote_closed)
         {
            quoted=true;
         }
         else
         {
            detail="CSV contains a quote in an invalid position.";
            return false;
         }
      }
      else if(character=="," && !quoted)
      {
         AddCanaryCsvCell(cells,current);
         current="";
         quote_closed=false;
      }
      else
      {
         if(quote_closed)
         {
            detail="CSV contains text after a closing quote.";
            return false;
         }
         current+=character;
      }
   }

   if(quoted)
   {
      detail="CSV contains an unterminated quoted field.";
      return false;
   }
   AddCanaryCsvCell(cells,current);
   return true;
}

bool StripCanaryLineEnding(string &line,string &detail)
{
   int length=StringLen(line);
   if(length>0 && StringSubstr(line,length-1,1)=="\r")
      line=StringSubstr(line,0,length-1);
   if(StringFind(line,"\r")>=0)
   {
      detail="CSV physical multiline values are forbidden.";
      return false;
   }
   return true;
}

bool SplitCanaryCsvDocument(const string text,string &header_line,string &value_line,string &detail)
{
   int first_line_end=StringFind(text,"\n");
   if(first_line_end<0)
   {
      detail="CSV must contain exactly one header and one data row.";
      return false;
   }

   header_line=StringSubstr(text,0,first_line_end);
   string remainder=StringSubstr(text,first_line_end+1);
   int second_line_end=StringFind(remainder,"\n");
   if(second_line_end>=0)
   {
      if(second_line_end!=StringLen(remainder)-1)
      {
         detail="CSV physical multiline values or extra rows are forbidden.";
         return false;
      }
      value_line=StringSubstr(remainder,0,second_line_end);
   }
   else
   {
      value_line=remainder;
   }

   if(!StripCanaryLineEnding(header_line,detail) || !StripCanaryLineEnding(value_line,detail)) return false;
   if(header_line=="" || value_line=="")
   {
      detail="CSV header and data row must both be present.";
      return false;
   }
   return true;
}

bool ReadCanaryCommonText(const string path,string &text,string &detail)
{
   int handle=FileOpen(path,FILE_READ|FILE_BIN|FILE_COMMON|FILE_ANSI);
   if(handle==INVALID_HANDLE)
   {
      detail="Required Common Files input is missing or unreadable.";
      return false;
   }
   ulong size=FileSize(handle);
   if(size<=0 || size>1024*1024)
   {
      FileClose(handle);
      detail="Required Common Files input has an invalid size.";
      return false;
   }
   text=FileReadString(handle,(int)size);
   FileClose(handle);
   if(StringLen(text)==0)
   {
      detail="Required Common Files input is empty.";
      return false;
   }
   return true;
}

int FindCanaryHeader(const string &headers[],const string name)
{
   int found=-1;
   for(int index=0;index<ArraySize(headers);index++)
   {
      if(headers[index]!=name) continue;
      if(found>=0) return -2;
      found=index;
   }
   return found;
}

bool ReadStrictCanaryCsvText(const string text,const string &expected_fields[],string &ordered_values[],string &detail)
{
   string header_line="";
   string value_line="";
   if(!SplitCanaryCsvDocument(text,header_line,value_line,detail)) return false;

   string headers[];
   string values[];
   if(!ParseCanaryCsvRecord(header_line,headers,detail) || !ParseCanaryCsvRecord(value_line,values,detail)) return false;
   if(ArraySize(headers)!=ArraySize(expected_fields) || ArraySize(values)!=ArraySize(headers))
   {
      detail="CSV schema field count does not match the exact contract.";
      return false;
   }

   for(int left=0;left<ArraySize(headers);left++)
   {
      if(headers[left]=="")
      {
         detail="CSV contains an empty header name.";
         return false;
      }
      for(int right=left+1;right<ArraySize(headers);right++)
      {
         if(headers[left]==headers[right])
         {
            detail="CSV contains a duplicate header name.";
            return false;
         }
      }
   }

   ArrayResize(ordered_values,ArraySize(expected_fields));
   for(int expected=0;expected<ArraySize(expected_fields);expected++)
   {
      int source_index=FindCanaryHeader(headers,expected_fields[expected]);
      if(source_index<0)
      {
         detail="CSV is missing an exact required header.";
         return false;
      }
      if(source_index!=expected)
      {
         detail="CSV headers do not match the exact schema order.";
         return false;
      }
      ordered_values[expected]=values[source_index];
   }
   return true;
}

bool ReadStrictCanaryCsv(const string path,const string &expected_fields[],string &ordered_values[],string &detail)
{
   string text="";
   if(!ReadCanaryCommonText(path,text,detail)) return false;
   return ReadStrictCanaryCsvText(text,expected_fields,ordered_values,detail);
}

bool IsCanonicalCanaryText(const string value)
{
   if(value=="" || StringFind(value,"\r")>=0 || StringFind(value,"\n")>=0) return false;
   string trimmed=value;
   StringTrimLeft(trimmed);
   StringTrimRight(trimmed);
   return trimmed==value;
}

bool TryCanaryDouble(const string value,double &result)
{
   if(value=="") return false;
   bool has_digit=false;
   bool has_decimal=false;
   bool has_exponent=false;
   bool exponent_needs_digit=false;

   for(int index=0;index<StringLen(value);index++)
   {
      int character=(int)StringGetCharacter(value,index);
      if(character>=48 && character<=57)
      {
         has_digit=true;
         exponent_needs_digit=false;
         continue;
      }
      if((character==43 || character==45) && (index==0 || (index>0 && (StringSubstr(value,index-1,1)=="e" || StringSubstr(value,index-1,1)=="E"))))
         continue;
      if(character==46 && !has_decimal && !has_exponent)
      {
         has_decimal=true;
         continue;
      }
      if((character==101 || character==69) && has_digit && !has_exponent)
      {
         has_exponent=true;
         exponent_needs_digit=true;
         continue;
      }
      return false;
   }
   if(!has_digit || exponent_needs_digit) return false;
   result=StringToDouble(value);
   return MathIsValidNumber(result);
}

bool TryCanaryLong(const string value,long &result)
{
   if(value=="") return false;
   int start=0;
   if(StringSubstr(value,0,1)=="-") start=1;
   if(start>=StringLen(value)) return false;
   for(int index=start;index<StringLen(value);index++)
   {
      int character=(int)StringGetCharacter(value,index);
      if(character<48 || character>57) return false;
   }
   result=StringToInteger(value);
   return true;
}

bool TryCanaryIsoUtc(const string value,datetime &result)
{
   int length=StringLen(value);
   if(length<20 || StringSubstr(value,4,1)!="-" || StringSubstr(value,7,1)!="-"
      || StringSubstr(value,10,1)!="T" || StringSubstr(value,length-1,1)!="Z") return false;
   if(length>20)
   {
      if(length<22 || StringSubstr(value,19,1)!=".") return false;
      for(int index=20;index<length-1;index++)
      {
         int character=(int)StringGetCharacter(value,index);
         if(character<48 || character>57) return false;
      }
   }
   string normalized=StringSubstr(value,0,19);
   StringReplace(normalized,"T"," ");
   StringReplace(normalized,"-",".");
   result=StringToTime(normalized);
   if(result<=0) return false;
   MqlDateTime parts;
   TimeToStruct(result,parts);
   string round_trip=StringFormat("%04d-%02d-%02dT%02d:%02d:%02d",
      parts.year,parts.mon,parts.day,parts.hour,parts.min,parts.sec);
   return round_trip==StringSubstr(value,0,19);
}

bool IsCanaryIsoDate(const string value)
{
   if(StringLen(value)!=10 || StringSubstr(value,4,1)!="-" || StringSubstr(value,7,1)!="-") return false;
   datetime parsed=StringToTime(StringSubstr(value,0,4)+"."+StringSubstr(value,5,2)+"."+StringSubstr(value,8,2));
   if(parsed<=0) return false;
   MqlDateTime parts;
   TimeToStruct(parsed,parts);
   return StringFormat("%04d-%02d-%02d",parts.year,parts.mon,parts.day)==value;
}

bool ConsumeCanaryJsonToken(const string json,int &cursor,const string token)
{
   if(StringSubstr(json,cursor,StringLen(token))!=token) return false;
   cursor+=StringLen(token);
   return true;
}

int CanaryHexDigit(const int character)
{
   if(character>=48 && character<=57) return character-48;
   if(character>=65 && character<=70) return character-65+10;
   if(character>=97 && character<=102) return character-97+10;
   return -1;
}

bool ParseCanaryJsonCodeUnit(const string json,int &cursor,int &code_unit)
{
   if(cursor+4>StringLen(json)) return false;
   code_unit=0;
   for(int index=0;index<4;index++)
   {
      int digit=CanaryHexDigit((int)StringGetCharacter(json,cursor+index));
      if(digit<0) return false;
      code_unit=code_unit*16+digit;
   }
   cursor+=4;
   return true;
}

bool ParseCanaryUnicodeEscape(const string json,int &cursor,string &decoded)
{
   decoded="";
   int first=0;
   if(!ParseCanaryJsonCodeUnit(json,cursor,first)) return false;
   if(first>=0xDC00 && first<=0xDFFF) return false;
   if(first>=0xD800 && first<=0xDBFF)
   {
      if(!ConsumeCanaryJsonToken(json,cursor,"\\u")) return false;
      int second=0;
      if(!ParseCanaryJsonCodeUnit(json,cursor,second) || second<0xDC00 || second>0xDFFF) return false;
      decoded=ShortToString((ushort)first)+ShortToString((ushort)second);
      return true;
   }
   decoded=ShortToString((ushort)first);
   return true;
}

bool ParseCanonicalCanaryJsonString(const string json,int &cursor,string &value)
{
   value="";
   if(!ConsumeCanaryJsonToken(json,cursor,"\"")) return false;
   while(cursor<StringLen(json))
   {
      string character=StringSubstr(json,cursor,1);
      cursor++;
      if(character=="\"") return true;
      if(character=="\\")
      {
         if(cursor>=StringLen(json)) return false;
         string escaped=StringSubstr(json,cursor,1);
         cursor++;
         if(escaped=="\"" || escaped=="\\" || escaped=="/") value+=escaped;
         else if(escaped=="b") value+=ShortToString((ushort)8);
         else if(escaped=="f") value+=ShortToString((ushort)12);
         else if(escaped=="n") value+=ShortToString((ushort)10);
         else if(escaped=="r") value+=ShortToString((ushort)13);
         else if(escaped=="t") value+=ShortToString((ushort)9);
         else if(escaped=="u")
         {
            string decoded="";
            if(!ParseCanaryUnicodeEscape(json,cursor,decoded)) return false;
            value+=decoded;
         }
         else return false;
         continue;
      }
      int code=(int)StringGetCharacter(character,0);
      if(code<32) return false;
      value+=character;
   }
   return false;
}

bool ParseCanaryGateResultsJson(const string json,bool &all_passed,string &detail)
{
   all_passed=true;
   if(StringFind(json,"\r")>=0 || StringFind(json,"\n")>=0)
   {
      detail="Execution decision gate JSON contains physical multiline evidence.";
      return false;
   }
   string expected_names[]={"bridge","completed_observation","candidate_policy","cost_model",
                             "learning","quote","spread","direction","stop_loss"};
   int cursor=0;
   if(!ConsumeCanaryJsonToken(json,cursor,"[")) return false;
   for(int index=0;index<ArraySize(expected_names);index++)
   {
      if(index>0 && !ConsumeCanaryJsonToken(json,cursor,",")) return false;
      if(!ConsumeCanaryJsonToken(json,cursor,"{")) return false;
      string key="";
      string name="";
      string state="";
      string evidence_detail="";
      if(!ParseCanonicalCanaryJsonString(json,cursor,key) || key!="name"
         || !ConsumeCanaryJsonToken(json,cursor,":")
         || !ParseCanonicalCanaryJsonString(json,cursor,name) || name!=expected_names[index]
         || !ConsumeCanaryJsonToken(json,cursor,",")
         || !ParseCanonicalCanaryJsonString(json,cursor,key) || key!="state"
         || !ConsumeCanaryJsonToken(json,cursor,":")
         || !ParseCanonicalCanaryJsonString(json,cursor,state)
         || (state!="pass" && state!="block")
         || !ConsumeCanaryJsonToken(json,cursor,",")
         || !ParseCanonicalCanaryJsonString(json,cursor,key) || key!="detail"
         || !ConsumeCanaryJsonToken(json,cursor,":")
         || !ParseCanonicalCanaryJsonString(json,cursor,evidence_detail)
         || !IsCanonicalCanaryText(evidence_detail)
         || !ConsumeCanaryJsonToken(json,cursor,"}"))
      {
         detail="Execution decision gate JSON violates the exact object contract.";
         return false;
      }
      if(state=="block") all_passed=false;
   }
   if(!ConsumeCanaryJsonToken(json,cursor,"]") || cursor!=StringLen(json))
   {
      detail="Execution decision gate JSON contains unknown, duplicate, missing, or trailing evidence.";
      return false;
   }
   return true;
}

string CanarySha256Identity(const string input)
{
   uchar source[];
   uchar key[];
   uchar digest[];
   int copied=StringToCharArray(input,source,0,StringLen(input),CP_UTF8);
   if(copied!=StringLen(input)) return "";
   ArrayResize(key,0);
   if(CryptEncode(CRYPT_HASH_SHA256,source,key,digest)!=32) return "";
   string hex="";
   for(int index=0;index<12;index++) hex+=StringFormat("%02x",(int)digest[index]);
   return hex;
}

string CreateCanaryObservationId(const CanaryDecision &decision)
{
   return CanarySha256Identity(decision.broker+"|"+decision.symbol+"|"
      +decision.strategyVersion+"|"+decision.observationAsOf);
}

string CreateCanaryDecisionId(const CanaryDecision &decision)
{
   return CanarySha256Identity("daily-trend-v1|"+decision.observationId);
}

bool ReadCanaryDecision(const string path,const datetime now,CanaryDecision &decision,string &detail)
{
   string expected[];
   string header_copy=CANARY_DECISION_HEADER;
   if(StringSplit(header_copy,(ushort)StringGetCharacter(",",0),expected)!=20)
   {
      detail="Internal decision schema definition is invalid.";
      return false;
   }
   string values[];
   if(!ReadStrictCanaryCsv(path,expected,values,detail)) return false;

   long schema=0;
   double entry=0.0;
   double volume=0.0;
   double stop=0.0;
   double max_risk=0.0;
   bool all_application_gates_passed=false;
   datetime created=0;
   datetime issued=0;
   datetime expires=0;
   bool has_entry=values[13]!="";
   bool has_stop=values[15]!="";
   if(!TryCanaryLong(values[0],schema) || schema!=1
      || !TryCanaryIsoUtc(values[4],created)
      || !TryCanaryIsoUtc(values[5],issued)
      || !TryCanaryIsoUtc(values[6],expires)
      || (has_entry && !TryCanaryDouble(values[13],entry))
      || !TryCanaryDouble(values[14],volume)
      || (has_stop && !TryCanaryDouble(values[15],stop))
      || !TryCanaryDouble(values[16],max_risk))
   {
      detail="Execution decision contains a malformed number or timestamp.";
      return false;
   }
   if(!IsCanonicalCanaryText(values[1]) || !IsCanonicalCanaryText(values[2]) || !IsCanaryIsoDate(values[3])
      || created>issued || issued>=expires || now<issued || now>expires)
   {
      detail="Execution decision identity or lease interval is invalid or expired.";
      return false;
   }
   string expected_server=values[7]=="hfmarkets" ? "HFMarketsGlobal-Demo4"
                           : values[7]=="icmarkets" ? "ICMarketsSC-Demo" : "";
   if(expected_server=="" || values[8]!=expected_server || values[9]!="demo" || values[10]!="XAUUSD"
      || values[11]!="daily-trend-v1" || (values[12]!="buy" && values[12]!="sell" && values[12]!="flat"))
   {
      detail="Execution decision contains an enum or immutable allowlist violation.";
      return false;
   }
   bool actionable=values[12]=="buy" || values[12]=="sell";
   if((actionable && (!has_entry || entry<=0.0 || !has_stop || stop<=0.0))
      || (!actionable && (has_entry || has_stop))
      || volume<=0.0 || max_risk<=0.0 || max_risk>CANARY_HARD_MAX_RISK
      || !IsCanonicalCanaryText(values[17]) || !IsCanonicalCanaryText(values[18])
      || !ParseCanaryGateResultsJson(values[19],all_application_gates_passed,detail))
   {
      detail="Execution decision contains invalid entry, risk, version, or gate evidence.";
      return false;
   }

   decision.loaded=true;
   decision.schemaVersion=(int)schema;
   decision.decisionId=values[1];
   decision.observationId=values[2];
   decision.observationAsOf=values[3];
   decision.createdAt=created;
   decision.leaseIssuedAt=issued;
   decision.leaseExpiresAt=expires;
   decision.broker=values[7];
   decision.server=values[8];
   decision.accountMode=values[9];
   decision.symbol=values[10];
   decision.strategyVersion=values[11];
   decision.direction=values[12];
   decision.entryReferencePrice=entry;
   decision.volume=volume;
   decision.stopLoss=stop;
   decision.maxRiskAmount=max_risk;
   decision.candidatePolicyVersion=values[17];
   decision.costModelVersion=values[18];
   decision.gateResultsJson=values[19];
   decision.preDecisionGatesPassed=all_application_gates_passed;
   if(decision.observationId!=CreateCanaryObservationId(decision)
      || decision.decisionId!=CreateCanaryDecisionId(decision))
   {
      decision.loaded=false;
      detail="Execution decision IDs do not match the immutable Task 3 hash identity.";
      return false;
   }
   detail="Execution decision lease matches the strict schema and current UTC lease window.";
   return true;
}

#endif
