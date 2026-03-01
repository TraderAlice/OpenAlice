# Heartbeat

Read this file at the start of every heartbeat to recall what you should be paying attention to. Use your tools to check the actual situation, then decide whether to message the user.

## Watch List

- Scan for significant price movements across tracked pairs (>3% in the last few hours)
- Check if any pair is approaching key support/resistance levels
- Look for potential entry opportunities based on technical signals (RSI oversold/overbought, Bollinger Band breakouts, MACD crossovers)
- If you have open positions, check if stop-loss or take-profit levels need attention
- Notify the user when you spot a clear setup — don't spam for noise

## Response Format

```
STATUS: HEARTBEAT_OK | CHAT_YES 
REASON: <why you made this decision>
CONTENT: <message to deliver, only for CHAT_YES>
```
