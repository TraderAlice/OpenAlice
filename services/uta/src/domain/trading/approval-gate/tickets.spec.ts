import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, it, expect, afterEach } from 'vitest'
import {
  canonicalApprovalPayload,
  findMatchingTicket,
  loadApprovalTickets,
  verifyApprovalTicket,
  type ApprovalTicket,
} from './tickets.js'
import { ApprovalGateError } from './errors.js'

let tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs = []
})

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey,
  }
}

function signTicket(payload: Omit<ApprovalTicket, 'signature'>, privateKey: ReturnType<typeof keyPair>['privateKey']): ApprovalTicket {
  const bytes = sign(null, Buffer.from(canonicalApprovalPayload(payload)), privateKey)
  return { ...payload, signature: `ed25519:${bytes.toString('base64')}` } as ApprovalTicket
}

function basePayload(overrides: Partial<Omit<ApprovalTicket, 'signature'>> = {}): Omit<ApprovalTicket, 'signature'> {
  return {
    ticket_id: 'ticket-1',
    account_id: 'ibkr-tws-b9646326',
    account_role: 'paper',
    allowed_symbols: ['AAPL'],
    allowed_actions: ['BUY', 'cancelOrder', 'closePosition'],
    max_notional_usd: '1000',
    require_exit_plan: true,
    exit_plan: 'Cancel any open paper order or close any paper AAPL fill.',
    run_id: 'run-1',
    expires_at: '2026-06-10T21:01:59.746Z',
    ...overrides,
  }
}

describe('approval ticket verification', () => {
  it('accepts a valid Ed25519 signed ticket', () => {
    const keys = keyPair()
    const ticket = signTicket(basePayload(), keys.privateKey)

    const verified = verifyApprovalTicket(ticket, keys.publicPem)

    expect(verified.ticket_id).toBe('ticket-1')
    expect(verified.signature).toBe(ticket.signature)
  })

  it('rejects an invalid signature', () => {
    const keys = keyPair()
    const ticket = signTicket(basePayload(), keys.privateKey)
    const tampered = { ...ticket, max_notional_usd: '1001' }

    expect(() => verifyApprovalTicket(tampered, keys.publicPem))
      .toThrow(ApprovalGateError)
  })

  it('rejects signatures without ed25519 prefix', () => {
    const keys = keyPair()
    const ticket = signTicket(basePayload(), keys.privateKey)

    expect(() => verifyApprovalTicket({ ...ticket, signature: ticket.signature.replace('ed25519:', '') }, keys.publicPem))
      .toThrow(/ed25519/)
  })

  it('preserves extra signed payload fields before canonical signature verification', () => {
    const keys = keyPair()
    const payload = {
      ...basePayload(),
      portfolio_id: 'portfolio-1',
      strategy_id: 'strategy-1',
      policy_ref: 'risk-policy-v1.0',
      max_new_risk_pct: '1',
      require_stop_loss: false,
      notes: 'extra signed metadata',
    }
    const ticket = signTicket(payload, keys.privateKey)

    const verified = verifyApprovalTicket(ticket, keys.publicPem)

    expect(verified.strategy_id).toBe('strategy-1')
  })

  it('rejects an expired matching ticket with injected now', () => {
    const keys = keyPair()
    const ticket = verifyApprovalTicket(
      signTicket(basePayload({ expires_at: '2026-06-10T10:00:00.000Z' }), keys.privateKey),
      keys.publicPem,
    )

    expect(() =>
      findMatchingTicket('ibkr-tws-b9646326', new Date('2026-06-10T10:00:01.000Z'), [ticket], 'paper'),
    ).toThrow(/expired/)
  })

  it('returns null when there is no matching ticket', () => {
    const keys = keyPair()
    const ticket = verifyApprovalTicket(
      signTicket(basePayload({ account_id: 'other-account' }), keys.privateKey),
      keys.publicPem,
    )

    expect(findMatchingTicket('ibkr-tws-b9646326', new Date('2026-06-10T09:00:00.000Z'), [ticket], 'paper')).toBeNull()
  })

  it('rejects a matching account ticket with the wrong account role', () => {
    const keys = keyPair()
    const ticket = verifyApprovalTicket(
      signTicket(basePayload({ account_role: 'live' }), keys.privateKey),
      keys.publicPem,
    )

    expect(() =>
      findMatchingTicket('ibkr-tws-b9646326', new Date('2026-06-10T09:00:00.000Z'), [ticket], 'paper'),
    ).toThrow(/role/)
  })

  it('rejects multiple valid matching tickets as ambiguous', () => {
    const keys = keyPair()
    const first = verifyApprovalTicket(signTicket(basePayload({ ticket_id: 'ticket-1' }), keys.privateKey), keys.publicPem)
    const second = verifyApprovalTicket(signTicket(basePayload({ ticket_id: 'ticket-2' }), keys.privateKey), keys.publicPem)

    expect(() =>
      findMatchingTicket('ibkr-tws-b9646326', new Date('2026-06-10T09:00:00.000Z'), [first, second], 'paper'),
    ).toThrow(/ambiguous/)
  })

  it('loads json tickets from a directory', async () => {
    const keys = keyPair()
    const dir = await mkdtemp(join(tmpdir(), 'approval-tickets-'))
    tempDirs.push(dir)
    await mkdir(join(dir, 'nested'))
    await writeFile(join(dir, 'ticket.json'), JSON.stringify(signTicket(basePayload(), keys.privateKey), null, 2))
    await writeFile(join(dir, 'ignore.txt'), 'not json')

    const tickets = await loadApprovalTickets({ ticketDirectory: dir })

    expect(tickets).toHaveLength(1)
    expect(tickets[0].ticket_id).toBe('ticket-1')
  })

  it('verifies an IBKR pilot-shaped ticket with injected time before expiry', () => {
    const keys = keyPair()
    const ticket = signTicket(basePayload({
      ticket_id: 'hermes-ibkr-paper-pilot-ibkr-001',
      run_id: 'hermes-ibkr-paper-pilot-run-20260610T150159Z',
      account_id: 'ibkr-tws-b9646326',
      expires_at: '2026-06-10T21:01:59.746Z',
    }), keys.privateKey)

    const verified = verifyApprovalTicket(ticket, keys.publicPem)
    const match = findMatchingTicket(
      'ibkr-tws-b9646326',
      new Date('2026-06-10T20:00:00.000Z'),
      [verified],
      'paper',
    )

    expect(match?.run_id).toBe('hermes-ibkr-paper-pilot-run-20260610T150159Z')
  })
})
