import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CANARY_DIRECTORY = join('tools', 'mt5', 'JmbGoldmineDemoCanary')

async function readCanarySource(file: string): Promise<string> {
  return readFile(join(CANARY_DIRECTORY, file), 'utf8')
}

async function readMqlSources(directory: string): Promise<Array<{ path: string; source: string }>> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return readMqlSources(path)
    if (!/\.mq[5h]$/i.test(entry.name)) return []
    return [{ path, source: await readFile(path, 'utf8') }]
  }))
  return nested.flat()
}

async function readCanarySources(): Promise<Array<{ path: string; source: string }>> {
  return readMqlSources(CANARY_DIRECTORY)
}

async function readCanaryBundle(): Promise<string> {
  return (await readCanarySources()).map(({ source }) => source).join('\n')
}

describe('MT5 demo canary source contract', () => {
  it('has one protected gateway and keeps every other MQL source order-API-free', async () => {
    const sources = await readMqlSources(join('tools', 'mt5'))
    const gatewayPath = join(CANARY_DIRECTORY, 'JmbCanaryTradeGateway.mqh')
    const gateway = sources.find(({ path }) => path === gatewayPath)

    expect(gateway, 'the protected-order gateway must exist').toBeDefined()
    expect(gateway?.source.match(/\bOrderCheck\s*\(/g)).toHaveLength(1)
    expect(gateway?.source.match(/\bOrderSend\s*\(/g)).toHaveLength(1)
    expect(gateway?.source).toContain('TradeSubmitResult CheckedSendCanaryRequest(')
    expect(gateway?.source).toMatch(/SubmitProtectedMarketOrder[\s\S]*CheckedSendCanaryRequest\(request\)/)
    expect(gateway?.source).toMatch(/SubmitCanaryReversalClose[\s\S]*CheckedSendCanaryRequest\(request\)/)
    expect(gateway?.source).toMatch(/SubmitCanaryEmergencyClose[\s\S]*CheckedSendCanaryRequest\(request\)/)
    expect(gateway?.source).not.toMatch(/\bCTrade\b/)
    for (const file of sources.filter(({ path }) => path !== gatewayPath)) {
      expect(file.source, `${file.path} must not call an order API`).not.toMatch(/\bOrder(?:Check|Send)\s*\(/)
      expect(file.source, `${file.path} must not use CTrade`).not.toMatch(/\bCTrade\b/)
    }
  })

  it('reconciles authoritative Gold state by exact magic before any decision or resend', async () => {
    const [main, reconcile] = await Promise.all([
      readCanarySource('JmbGoldmineDemoCanary.mq5'),
      readCanarySource('JmbCanaryReconcile.mqh'),
    ])

    expect(main).toContain('#include "JmbCanaryReconcile.mqh"')
    expect(main).toContain('g_reconciliation_dirty=true;')
    expect(main).toMatch(/void OnTradeTransaction\([\s\S]*g_reconciliation_dirty=true;\s*return;\s*\}/)
    expect(main).toMatch(/void Evaluate\([\s\S]*ReconcileCanaryBrokerState\([\s\S]*EvaluateCanaryGates\(/)
    expect(reconcile).toContain('PositionGetString(POSITION_SYMBOL)!=symbol')
    expect(reconcile).toContain('PositionGetInteger(POSITION_MAGIC)==magic_number')
    expect(reconcile).toContain('OrderGetString(ORDER_SYMBOL)!=symbol')
    expect(reconcile).toContain('OrderGetInteger(ORDER_MAGIC)==magic_number')
    expect(reconcile).not.toMatch(/if\s*\(\s*PositionsTotal\(\)\s*>\s*0\s*\)/)
    expect(main).not.toMatch(/\b(?:PositionsTotal|OrdersTotal|HistorySelect|HistoryDealGet)\s*\(/)
    expect(main).not.toMatch(/\b(?:retry|resend)\b/i)
  })

  it('groups fully closed positions by broker day and complete net result', async () => {
    const reconcile = await readCanarySource('JmbCanaryReconcile.mqh')

    expect(reconcile).toContain('DEAL_POSITION_ID')
    expect(reconcile).toContain('HistorySelect(day_start,now)')
    expect(reconcile).toContain('HistorySelectByPosition(position_id)')
    expect(reconcile).toMatch(/double DealNet\(const ulong deal_ticket\)[\s\S]*DEAL_PROFIT[\s\S]*DEAL_COMMISSION[\s\S]*DEAL_SWAP[\s\S]*DEAL_FEE/)
    expect(reconcile).toContain('DEAL_ENTRY_OUT_BY')
    expect(reconcile).toContain('final_close_time')
    expect(reconcile).toContain('daily.lossCount++')
    expect(reconcile).toContain('daily.realizedLoss+=MathAbs(net_result)')
  })

  it('publishes the stable flushed event schema without exposing the raw login', async () => {
    const [state, main] = await Promise.all([
      readCanarySource('JmbCanaryState.mqh'),
      readCanarySource('JmbGoldmineDemoCanary.mq5'),
    ])
    const stableFields = [
      'schema_version', 'event_id', 'event_type', 'event_time', 'broker', 'server', 'account_mode',
      'account_identity_masked', 'symbol', 'strategy_version', 'magic_number', 'decision_id',
      'observation_id', 'gate_results', 'calculated_risk', 'requested_volume', 'requested_price',
      'requested_stop_loss', 'accepted_volume', 'accepted_price', 'accepted_stop_loss', 'result_code',
      'result_detail', 'order_ticket', 'deal_ticket', 'position_id', 'reconciliation_state',
      'daily_loss_count', 'daily_realized_loss', 'commission', 'swap', 'fee', 'net_result',
      'max_adverse_excursion', 'max_favorable_excursion',
    ]

    for (const field of stableFields) expect(state).toContain(`\\"${field}\\"`)
    expect(state).toContain('events.jsonl')
    expect(state).toContain('FileFlush(handle)')
    expect(state).toContain('CanaryMaskedAccountIdentity(')
    expect(state).not.toMatch(/FileWrite(?:String)?\([^;]*ACCOUNT_LOGIN/s)
    expect(main).not.toMatch(/(?:Print|Comment)\([^;]*ACCOUNT_LOGIN/s)
  })

  it('models protection, closures, durable no-ops, and persistent broker safety latches', async () => {
    const [main, reconcile, state, harness] = await Promise.all([
      readCanarySource('JmbGoldmineDemoCanary.mq5'),
      readCanarySource('JmbCanaryReconcile.mqh'),
      readCanarySource('JmbCanaryState.mqh'),
      readFile(join('tools', 'mt5', 'tests', 'JmbGoldmineDemoCanaryHarness.mq5'), 'utf8'),
    ])

    expect(reconcile).toContain('CANARY_LIFECYCLE_RECONCILIATION_REQUIRED')
    expect(reconcile).toContain('CANARY_LIFECYCLE_FILLED_PROTECTED')
    expect(reconcile).toContain('CANARY_LIFECYCLE_EMERGENCY_CLOSE')
    expect(reconcile).toContain('CANARY_LIFECYCLE_STOPPED')
    expect(main).toContain('SubmitCanaryReversalClose(')
    expect(main).toContain('SubmitCanaryEmergencyClose(')
    expect(main).toContain('PersistCanarySafetyLatch(')
    expect(main).toContain('PersistCanaryAttempt(')
    expect(state).toContain('reconciliation_latch.csv')
    expect(state).toContain('protection_error')
    expect(state).toContain('pending_close_decision_id')
    expect(harness).toContain('rejected request')
    expect(harness).toContain('unknown result')
    expect(harness).toContain('partial fill')
    expect(harness).toContain('filled with stop')
    expect(harness).toContain('filled without stop')
    expect(harness).toContain('stopped observation')
    expect(harness).toContain('opposite signal close')
    expect(harness).toContain('four losing positions')
    expect(harness).toContain('server day reset')
    expect(harness).toContain('restart with protected position')
    expect(harness).toContain('restart with foreign exposure')
  })

  it('requires an exact actionable opposite and complete gate authorization before reversal close', async () => {
    const [main, reconcile, harness] = await Promise.all([
      readCanarySource('JmbGoldmineDemoCanary.mq5'),
      readCanarySource('JmbCanaryReconcile.mqh'),
      readFile(join('tools', 'mt5', 'tests', 'JmbGoldmineDemoCanaryHarness.mq5'), 'utf8'),
    ])

    expect(reconcile).toMatch(/bool IsCanaryActionableOpposite\([\s\S]*decision_direction=="buy"[\s\S]*position_direction=="sell"[\s\S]*decision_direction=="sell"[\s\S]*position_direction=="buy"/)
    expect(reconcile).toContain('facts.oppositeDirection=!observation_used')
    expect(reconcile).toContain('IsCanaryActionableOpposite(decision.direction,reconciliation.position.direction)')
    expect(main).toMatch(/CanaryEnvironment reversal_environment;[\s\S]*reversal_environment=environment;[\s\S]*reversal_environment\.hasEaPosition=false;[\s\S]*CanaryEvaluation reversal_evaluation=EvaluateCanaryGates\(decision,policy,reversal_environment\)/)
    expect(main).toMatch(/reversal_evaluation\.ready[\s\S]*HandleCanaryOppositeClose\(/)
    expect(harness).toContain('flat decision cannot close')
  })

  it('blocks every close request when authoritative ownership is foreign or unavailable', async () => {
    const [main, reconcile, harness] = await Promise.all([
      readCanarySource('JmbGoldmineDemoCanary.mq5'),
      readCanarySource('JmbCanaryReconcile.mqh'),
      readFile(join('tools', 'mt5', 'tests', 'JmbGoldmineDemoCanaryHarness.mq5'), 'utf8'),
    ])
    const reducer = reconcile.match(/CanaryLifecycleState ReduceCanaryLifecycle\([\s\S]*?\n\}/)?.[0] ?? ''

    expect(reducer.indexOf('!facts.brokerStateAvailable')).toBeGreaterThan(-1)
    expect(reducer.indexOf('facts.hasForeignGoldExposure')).toBeGreaterThan(reducer.indexOf('!facts.brokerStateAvailable'))
    expect(reducer.indexOf('facts.hasEaPosition && !facts.eaPositionProtected')).toBeGreaterThan(reducer.indexOf('facts.hasForeignGoldExposure'))
    expect(main).toMatch(/reconciliation\.state==CANARY_LIFECYCLE_EMERGENCY_CLOSE[\s\S]*reconciliation\.available[\s\S]*!reconciliation\.hasForeignGoldExposure[\s\S]*HandleCanaryEmergencyClose/)
    expect(harness).toContain('mixed magic unprotected position blocks close')
    expect(harness).toContain('multiple positions block close')
  })

  it('counts EA-origin positions closed by a nonmagic final deal without claiming foreign-origin trades', async () => {
    const [reconcile, harness] = await Promise.all([
      readCanarySource('JmbCanaryReconcile.mqh'),
      readFile(join('tools', 'mt5', 'tests', 'JmbGoldmineDemoCanaryHarness.mq5'), 'utf8'),
    ])

    expect(reconcile).toContain('CanaryClosedOwnershipClass ClassifyCanaryClosedPositionOwnership(')
    expect(reconcile).toContain('HistoryDealGetString(deal_ticket,DEAL_SYMBOL)!=symbol) continue;')
    expect(reconcile).toMatch(/if\(entry!=DEAL_ENTRY_OUT && entry!=DEAL_ENTRY_OUT_BY\) continue;[\s\S]*DEAL_POSITION_ID/)
    expect(reconcile).toContain('origin_magic==magic_number')
    expect(reconcile).toContain('CANARY_CLOSED_OWNERSHIP_EA')
    expect(reconcile).toContain('CANARY_CLOSED_OWNERSHIP_FOREIGN')
    expect(reconcile).toContain('CANARY_CLOSED_OWNERSHIP_UNSAFE')
    expect(harness).toContain('nonmagic final closure ownership')
  })

  it('resolves authoritative immediate stops and emergency closures without allowing resend', async () => {
    const [main, reconcile, state, harness] = await Promise.all([
      readCanarySource('JmbGoldmineDemoCanary.mq5'),
      readCanarySource('JmbCanaryReconcile.mqh'),
      readCanarySource('JmbCanaryState.mqh'),
      readFile(join('tools', 'mt5', 'tests', 'JmbGoldmineDemoCanaryHarness.mq5'), 'utf8'),
    ])
    const reducer = reconcile.match(/CanaryLifecycleState ReduceCanaryLifecycle\([\s\S]*?\n\}/)?.[0] ?? ''

    expect(reducer.indexOf('facts.stoppedObservation')).toBeLessThan(reducer.indexOf('facts.resultClass==CANARY_RESULT_UNKNOWN'))
    expect(reconcile).toContain('authoritative_stop_closure')
    expect(reconcile).toContain('authoritative_emergency_closure')
    expect(state).toContain('emergency_position_id')
    expect(main).toContain('latch.emergencyPositionId=CanaryTicketString(reconciliation.position.identifier)')
    expect(main).toMatch(/CANARY_LIFECYCLE_STOPPED[\s\S]*latch\.unresolved=false;[\s\S]*PersistCanarySafetyLatch/)
    expect(main).toMatch(/authoritative_emergency_closure[\s\S]*latch\.unresolved=false;[\s\S]*latch\.protectionError/)
    expect(harness).toContain('correlated stopped observation')
    expect(harness).toContain('unrelated stop remains unresolved')
    expect(harness).toContain('protection error pauses after emergency closure')
  })

  it('publishes the in-memory latest event only after durable append verification succeeds', async () => {
    const main = await readCanarySource('JmbGoldmineDemoCanary.mq5')
    const managed = main.match(/bool AppendManagedCanaryEvent\([\s\S]*?\n\}/)?.[0] ?? ''

    expect(managed).toContain('CanaryExecutionEvent candidate;')
    expect(managed).toContain('AppendCanaryExecutionEvent(candidate,detail)')
    expect(managed.indexOf('g_latest_event=candidate;')).toBeGreaterThan(managed.indexOf('AppendCanaryExecutionEvent(candidate,detail)'))
    expect(main).not.toMatch(/BuildCanaryLifecycleEvent\([^;]*g_latest_event\)/s)
    expect(main).not.toMatch(/AppendCanaryExecutionEvent\(g_latest_event,/)
  })

  it('correlates an unresolved entry decision to its authoritative position before accepting a stop', async () => {
    const [main, reconcile, state, harness] = await Promise.all([
      readCanarySource('JmbGoldmineDemoCanary.mq5'),
      readCanarySource('JmbCanaryReconcile.mqh'),
      readCanarySource('JmbCanaryState.mqh'),
      readFile(join('tools', 'mt5', 'tests', 'JmbGoldmineDemoCanaryHarness.mq5'), 'utf8'),
    ])

    expect(state).toContain('pending_entry_decision_id')
    expect(state).toContain('pending_entry_observation_id')
    expect(state).toContain('pending_entry_attempted_at')
    expect(main).toMatch(/latch\.pendingEntryDecisionId=decision\.decisionId[\s\S]*PersistCanarySafetyLatch\([\s\S]*SubmitProtectedMarketOrder/)
    expect(reconcile).toContain('CanaryEntryCorrelationComment(latch.pendingEntryDecisionId)')
    expect(reconcile).toContain('IsCanaryCorrelatedLifecyclePosition(')
    expect(reconcile).toMatch(/facts\.stoppedObservation=[^;]*correlated_entry_position[^;]*lastCloseWasStop/s)
    expect(harness).toContain('correlated stopped observation')
    expect(harness).toContain('unrelated stop remains unresolved')
  })

  it('recovers a correlated stop or emergency closure independently of broker-day loss selection', async () => {
    const [reconcile, harness] = await Promise.all([
      readCanarySource('JmbCanaryReconcile.mqh'),
      readFile(join('tools', 'mt5', 'tests', 'JmbGoldmineDemoCanaryHarness.mq5'), 'utf8'),
    ])
    const lifecycleRecovery = reconcile.match(/bool ReadCanaryLifecyclePositionById\([\s\S]*?\n\}/)?.[0] ?? ''

    expect(lifecycleRecovery).toContain('HistorySelectByPosition(position_id)')
    expect(lifecycleRecovery).not.toContain('day_start')
    expect(reconcile).toContain('latch.emergencyPositionId')
    expect(reconcile).toContain('latch.pendingEntryAttemptedAt')
    expect(harness).toContain('position-specific rollover recovery')
  })

  it('projects persistent protection pauses distinctly from broker-day loss pauses', async () => {
    const [main, reconcile, state, harness] = await Promise.all([
      readCanarySource('JmbGoldmineDemoCanary.mq5'),
      readCanarySource('JmbCanaryReconcile.mqh'),
      readCanarySource('JmbCanaryState.mqh'),
      readFile(join('tools', 'mt5', 'tests', 'JmbGoldmineDemoCanaryHarness.mq5'), 'utf8'),
    ])

    expect(reconcile).toMatch(/CANARY_LIFECYCLE_PAUSED[\s\S]*facts\.persistentSafetyPause[\s\S]*reconciliationState="protection_error"/)
    expect(state).toMatch(/reconciliation\.reconciliationState=="protection_error"[\s\S]*"protection"/)
    expect(state).toContain('Resolve the persistent broker protection error before operator clearance.')
    expect(main).toContain('Persistent broker protection error keeps this canary paused pending operator clearance.')
    expect(harness).toContain('persistent protection status semantics')
  })

  it('keeps execution disabled, demo-only, Gold-only, fixed-volume, and non-expanding', async () => {
    const [sources, gateway, types] = await Promise.all([
      readCanarySources(),
      readCanarySource('JmbCanaryTradeGateway.mqh'),
      readCanarySource('JmbCanaryTypes.mqh'),
    ])
    const source = sources.map((file) => file.source).join('\n')

    expect(source).toContain('input bool InpDemoExecutionEnabled = false;')
    expect(source).toContain('input bool InpKillSwitch = true;')
    for (const file of sources) {
      expect(file.source, `${file.path} must not add a live-mode input`).not.toMatch(/input[^;]*(?:live|real)/i)
      expect(file.source, `${file.path} must remain Gold-only and non-expanding`).not.toMatch(
        /EURUSD|martingale|grid|recovery|take.?profit|\b(?:tp|take_profit)\s*=|lot.?growth|volume.?growth|scale.?in|pyramid/i,
      )
      for (const match of file.source.matchAll(/\b(?:volume|maxVolume|max_volume)\s*=\s*(\d+(?:\.\d+)?)/g)) {
        expect(Number(match[1]), `${file.path} must not assign volume above 0.01`).toBeLessThanOrEqual(0.01)
      }
      for (const match of file.source.matchAll(/\b(?:volume|maxVolume|max_volume)\s*=(?!=)\s*([^;\r\n]+)/g)) {
        expect(match[1], `${file.path} must not scale a volume assignment`).not.toMatch(/[*/+-]/)
      }
    }
    expect(types).toMatch(/const double CANARY_HARD_MAX_VOLUME\s*=\s*0\.01;/)
    expect(gateway).toContain('ACCOUNT_TRADE_MODE_DEMO')
    expect(gateway).toContain('decision.symbol!="XAUUSD"')
    expect(gateway).toContain('decision.volume!=CANARY_HARD_MAX_VOLUME')
    expect([...gateway.matchAll(/request\.volume\s*=\s*([^;]+);/g)].map((match) => match[1].trim()))
      .toEqual(['CANARY_HARD_MAX_VOLUME'])
    expect(gateway).not.toMatch(/(?:request\.volume\s*(?:\*=|\/=|\+=|-=)|(?:\+\+|--)request\.volume|request\.volume(?:\+\+|--))/)
    expect(gateway).toContain('request.sl=decision.stopLoss;')
    expect(gateway).toMatch(/policy\.magicNumber!=880101\s*&&\s*policy\.magicNumber!=880201/)
  })

  it('persists requesting and attempt barriers before one submit then defers every result to reconciliation', async () => {
    const [main, state] = await Promise.all([
      readCanarySource('JmbGoldmineDemoCanary.mq5'),
      readCanarySource('JmbCanaryState.mqh'),
    ])
    const submissionFlow = main.match(/void SubmitReadyCanaryDecision\([\s\S]*?\n\}/)?.[0] ?? ''
    const eventBarrier = submissionFlow.indexOf('AppendCanaryOrderRequestingEvent(')
    const attemptBarrier = submissionFlow.indexOf('PersistCanaryAttempt(')
    const submit = submissionFlow.indexOf('SubmitProtectedMarketOrder(')

    expect(main).toContain('#include "JmbCanaryTradeGateway.mqh"')
    expect(main).toContain('evaluation.state!=CANARY_LIFECYCLE_READY')
    expect(main).toContain('!InpDemoExecutionEnabled || InpKillSwitch')
    expect(main).toContain('if(!status_persisted)')
    expect(main).toContain('CanaryProcessedStateContains(processed_state,decision.decisionId,decision.observationId)')
    expect(eventBarrier).toBeGreaterThan(-1)
    expect(attemptBarrier).toBeGreaterThan(eventBarrier)
    expect(submit).toBeGreaterThan(attemptBarrier)
    expect(main).toContain('AppendCanaryOrderRequestingEvent(')
    expect(state).toMatch(/AppendCanaryExecutionEvent\([\s\S]*FileFlush\(handle\)[\s\S]*ReadCanaryCommonText/)
    expect(main).toMatch(/PersistCanaryAttempt\([\s\S]*FileFlush\(handle\)[\s\S]*LoadCanaryProcessedState/)
    expect(main).toContain('processed_observations.lock')
    expect(main).toMatch(/PersistCanaryAttempt\([\s\S]*FileOpen\(lock_path[\s\S]*LoadCanaryProcessedState\(path,locked_state/)
    expect(main.match(/SubmitProtectedMarketOrder\s*\(/g)).toHaveLength(1)
    expect(main).toContain('g_reconciliation_dirty=true;')
    expect(main).toContain('environment.reconciliationComplete=!g_reconciliation_dirty')
    expect(main).toContain('void OnTradeTransaction(')
    expect(main).not.toMatch(/filled_protected/)
    expect(main).not.toMatch(/\b(?:retry|resend)\b/i)
  })

  it('rejects durable replacements that drop, mutate, reorder, duplicate, or truncate prior attempts', async () => {
    const main = await readCanarySource('JmbGoldmineDemoCanary.mq5')
    const submissionFlow = main.match(/void SubmitReadyCanaryDecision\([\s\S]*?\n\}/)?.[0] ?? ''

    expect(main).toContain('bool CanaryProcessedStateIsExactAppend(')
    expect(main).toMatch(/CanaryProcessedStateIsExactAppend\([\s\S]*candidate_count!=prior_count\+1/)
    expect(main).toMatch(/CanaryProcessedStateIsExactAppend\([\s\S]*candidate\.decisionIds\[index\]!=prior\.decisionIds\[index\][\s\S]*candidate\.observationIds\[index\]!=prior\.observationIds\[index\][\s\S]*candidate\.attemptedAt\[index\]!=prior\.attemptedAt\[index\]/)
    expect(main).toMatch(/candidate\.decisionIds\[prior_count\]==decision\.decisionId[\s\S]*candidate\.observationIds\[prior_count\]==decision\.observationId[\s\S]*candidate\.attemptedAt\[prior_count\]==attempted_at/)
    expect(main).toContain('CanaryProcessedStateIsExactAppend(locked_state,temporary_state,decision,attempted_at)')
    expect(main).toContain('CanaryProcessedStateIsExactAppend(locked_state,durable_state,decision,attempted_at)')
    expect(submissionFlow).toMatch(/if\(!PersistCanaryAttempt\([\s\S]*?\n\s*return;\n\s*\}[\s\S]*TradeSubmitResult submission=SubmitProtectedMarketOrder/)
  })

  it('keeps risk evaluation pure while retaining broker-side calculation evidence', async () => {
    const source = await readCanaryBundle()

    expect(source).toContain('CanaryEvaluation EvaluateCanaryGates(')
    expect(source).toContain('OrderCalcProfit(')
    expect(source).toContain('OrderCalcMargin(')
    expect(source).toContain('CalendarValueHistory(')
    expect(source).toContain('FileMove(temporary_path, FILE_COMMON, destination_path, FILE_COMMON | FILE_REWRITE)')
    expect(source).toContain('FileFlush(handle)')
  })

  it('binds the exact policy, decision, status, and harness safety contracts', async () => {
    const source = await readCanaryBundle()

    expect(source).toContain('HFMarketsGlobal-Demo4')
    expect(source).toContain('ICMarketsSC-Demo')
    expect(source).toContain('daily-trend-v1')
    expect(source).toContain('880101')
    expect(source).toContain('880201')
    expect(source).toContain('schema_version,decision_id,observation_id,observation_as_of,created_at,lease_issued_at,lease_expires_at,broker,server,account_mode,symbol,strategy_version,direction,entry_reference_price,volume,stop_loss,max_risk_amount,candidate_policy_version,cost_model_version,gate_results_json')
    expect(source).toContain('schema_version,captured_at,broker,server,account_mode,symbol,state,detail,rollout_stage,execution_enabled,kill_switch,decision_id,observation_id,event_id,event_type,event_time,result_code,result_detail,stop_protection_confirmed,position_direction,position_volume,position_open_price,position_stop_loss,position_id,reconciliation_state,daily_loss_count,daily_realized_loss,blocking_gate,next_safe_action')
    expect(source).not.toMatch(/FileWrite\([^;]*InpExpectedAccountLogin/s)
    expect(source).not.toMatch(/(?:Print|Comment)\([^;]*InpExpectedAccountLogin/s)
  })

  it('strictly validates policy grammar, gate JSON, and Task 3 hash identities', async () => {
    const [csv, policy, harness] = await Promise.all([
      readCanarySource('JmbCanaryCsv.mqh'),
      readCanarySource('JmbCanaryPolicy.mqh'),
      readFile(join('tools', 'mt5', 'tests', 'JmbGoldmineDemoCanaryHarness.mq5'), 'utf8'),
    ])

    expect(policy).toContain('bool IsCanonicalCanaryPolicyVersion(')
    expect(policy).toContain('StringFind(value,",")')
    expect(policy).toContain('StringFind(value,"\\\"")')
    expect(csv).toContain('bool ParseCanaryGateResultsJson(')
    expect(csv).toContain('CRYPT_HASH_SHA256')
    expect(csv).toContain('CreateCanaryObservationId(')
    expect(csv).toContain('CreateCanaryDecisionId(')
    expect(csv).toContain('decision.observationId!=CreateCanaryObservationId(decision)')
    expect(csv).toContain('decision.decisionId!=CreateCanaryDecisionId(decision)')
    expect(harness).toContain('arbitrary decision ids')
    expect(harness).toContain('malformed gate JSON')
    expect(harness).toContain('unknown gate name')
    expect(harness).toContain('unknown gate state')
    expect(harness).toContain('unknown gate field')
    expect(harness).toContain('duplicate gate field')
    expect(harness).toContain('missing gate field')
    expect(harness).toContain('noncanonical gate evidence')
    expect(harness).toContain('policy version grammar')
  })

  it('exports Task 5-compatible effective enablement and loads durable attempt state', async () => {
    const [main, state, harness] = await Promise.all([
      readCanarySource('JmbGoldmineDemoCanary.mq5'),
      readCanarySource('JmbCanaryState.mqh'),
      readFile(join('tools', 'mt5', 'tests', 'JmbGoldmineDemoCanaryHarness.mq5'), 'utf8'),
    ])

    expect(state).toContain('schema_version,decision_id,observation_id,attempted_at')
    expect(state).toContain('processed_observations.csv')
    expect(state).toContain('bool LoadCanaryProcessedState(')
    expect(state).toContain('CanarySha256Identity("daily-trend-v1|"+values[2])')
    expect(main).toContain('LoadCanaryProcessedState(')
    expect(main).toContain('bool effective_execution_enabled=')
    expect(state).toContain('policy.rolloutStage!="status_only"')
    expect(state).toContain('if(policy.rolloutStage=="status_only" && execution_enabled) return false;')
    expect(main).not.toMatch(/WriteCanaryLatestStatus\([^;]*InpDemoExecutionEnabled/s)
    expect(harness).toContain('loaded duplicate state')
    expect(harness).toContain('malformed processed state')
  })

  it('requires broker-valid stop metadata, checked writes, and a working timer', async () => {
    const [main, state, harness] = await Promise.all([
      readCanarySource('JmbGoldmineDemoCanary.mq5'),
      readCanarySource('JmbCanaryState.mqh'),
      readFile(join('tools', 'mt5', 'tests', 'JmbGoldmineDemoCanaryHarness.mq5'), 'utf8'),
    ])

    expect(main).toContain('SYMBOL_ORDER_MODE')
    expect(main).toContain('SYMBOL_ORDER_SL')
    expect(main).toContain('SYMBOL_TRADE_TICK_SIZE')
    expect(main).toContain('if(!EventSetTimer(10))')
    expect(state).toContain('uint preflight_written=FileWriteString(handle,payload)')
    expect(state).toContain('if(preflight_written!=StringLen(payload))')
    expect(state).toContain('uint header_written=FileWrite(')
    expect(state).toContain('uint row_written=FileWrite(')
    expect(state).toContain('ReadStrictCanaryCsv(temporary_path')
    expect(harness).toContain('stop mode unsupported')
    expect(harness).toContain('stop tick unavailable')
    expect(harness).toContain('stop tick misaligned')
  })

  it('rejects physical policy quotes without weakening quoted decision CSV', async () => {
    const [csv, policy, harness] = await Promise.all([
      readCanarySource('JmbCanaryCsv.mqh'),
      readCanarySource('JmbCanaryPolicy.mqh'),
      readFile(join('tools', 'mt5', 'tests', 'JmbGoldmineDemoCanaryHarness.mq5'), 'utf8'),
    ])

    expect(csv).toContain('bool ReadStrictCanaryCsvText(')
    expect(csv).toMatch(/bool ReadCanaryDecision\([\s\S]*ReadStrictCanaryCsv\(path,expected,values,detail\)/)
    expect(policy).toContain('bool ParseCanaryPolicyCsvText(')
    expect(policy).toContain('StringFind(policy_text,"\\\"")>=0')
    expect(policy).toContain('ReadStrictCanaryCsvText(policy_text')
    expect(harness).toContain('fully quoted policy row')
    expect(harness).toContain('partially quoted policy row')
  })

  it('verifies exact reopened preflight and all intended status fields', async () => {
    const [state, harness] = await Promise.all([
      readCanarySource('JmbCanaryState.mqh'),
      readFile(join('tools', 'mt5', 'tests', 'JmbGoldmineDemoCanaryHarness.mq5'), 'utf8'),
    ])

    expect(state).toContain('const string payload="openalice-canary-preflight\\r\\n";')
    expect(state).toContain('ReadCanaryCommonText(path,reopened,read_detail)')
    expect(state).toContain('reopened!=payload')
    expect(state).toContain('bool CanaryExactValuesMatch(')
    expect(state).toContain('CanaryExactValuesMatch(intended_values,verified_values)')
    expect(harness).toContain('truncated next safe action')
  })

  it('decodes canonical JSON escapes and rejects malformed Unicode sequences', async () => {
    const [csv, harness] = await Promise.all([
      readCanarySource('JmbCanaryCsv.mqh'),
      readFile(join('tools', 'mt5', 'tests', 'JmbGoldmineDemoCanaryHarness.mq5'), 'utf8'),
    ])

    expect(csv).toContain('bool ParseCanaryUnicodeEscape(')
    expect(csv).toContain('escaped=="b"')
    expect(csv).toContain('escaped=="f"')
    expect(csv).toContain('escaped=="n"')
    expect(csv).toContain('escaped=="r"')
    expect(csv).toContain('escaped=="t"')
    expect(csv).toContain('escaped=="/"')
    expect(harness).toContain('canonical JSON escapes')
    expect(harness).toContain('invalid JSON escapes')
    expect(harness).toContain('invalid surrogate pairs')
  })
})
