/**
 * Account summary tag constants.
 * Mirrors: ibapi/account_summary_tags.py
 */

export const AccountSummaryTags = {
  AccountType: 'AccountType',
  NetLiquidation: 'NetLiquidation',
  TotalCashValue: 'TotalCashValue',
  SettledCash: 'SettledCash',
  AccruedCash: 'AccruedCash',
  BuyingPower: 'BuyingPower',
  EquityWithLoanValue: 'EquityWithLoanValue',
  PreviousDayEquityWithLoanValue: 'PreviousDayEquityWithLoanValue',
  GrossPositionValue: 'GrossPositionValue',
  ReqTEquity: 'ReqTEquity',
  ReqTMargin: 'ReqTMargin',
  SMA: 'SMA',
  InitMarginReq: 'InitMarginReq',
  MaintMarginReq: 'MaintMarginReq',
  AvailableFunds: 'AvailableFunds',
  ExcessLiquidity: 'ExcessLiquidity',
  Cushion: 'Cushion',
  FullInitMarginReq: 'FullInitMarginReq',
  FullMaintMarginReq: 'FullMaintMarginReq',
  FullAvailableFunds: 'FullAvailableFunds',
  FullExcessLiquidity: 'FullExcessLiquidity',
  LookAheadNextChange: 'LookAheadNextChange',
  LookAheadInitMarginReq: 'LookAheadInitMarginReq',
  LookAheadMaintMarginReq: 'LookAheadMaintMarginReq',
  LookAheadAvailableFunds: 'LookAheadAvailableFunds',
  LookAheadExcessLiquidity: 'LookAheadExcessLiquidity',
  HighestSeverity: 'HighestSeverity',
  DayTradesRemaining: 'DayTradesRemaining',
  Leverage: 'Leverage',
} as const

export const AllTags = Object.values(AccountSummaryTags).join(',')
