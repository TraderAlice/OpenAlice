import { readdir, readFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { createPublicKey, verify } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { dataPath } from '@/core/paths.js'
import { ApprovalGateError } from './errors.js'

const approvalTicketSchema = z.object({
  ticket_id: z.string().min(1),
  account_id: z.string().min(1),
  account_role: z.string().min(1),
  allowed_symbols: z.array(z.string().min(1)).min(1),
  allowed_actions: z.array(z.string().min(1)).min(1),
  max_notional_usd: z.string().min(1),
  require_exit_plan: z.boolean(),
  exit_plan: z.string().optional(),
  run_id: z.string().min(1).optional(),
  expires_at: z.string().datetime(),
  signature: z.string().min(1),
}).passthrough()

export type ApprovalTicket = z.infer<typeof approvalTicketSchema>
export type VerifiedApprovalTicket = ApprovalTicket & { verified: true }

export interface LoadApprovalTicketsOptions {
  ticketDirectory: string
}

export function resolveApprovalGatePath(pathValue: string): string {
  if (isAbsolute(pathValue)) return pathValue
  const parts = pathValue.split(/[\\/]+/).filter(Boolean)
  return dataPath(...parts)
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    )
  }
  return value
}

export function canonicalApprovalPayload(ticketWithoutSignature: Omit<ApprovalTicket, 'signature'> | Record<string, unknown>): string {
  return JSON.stringify(sortJson(ticketWithoutSignature))
}

export async function loadApprovalTickets(options: LoadApprovalTicketsOptions): Promise<ApprovalTicket[]> {
  const directory = resolveApprovalGatePath(options.ticketDirectory)
  let entries: Dirent[]
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (err) {
    throw new ApprovalGateError('approval_gate_ticket_missing', `Approval ticket directory "${directory}" could not be read: ${errorMessage(err)}.`, {
      ticketDirectory: directory,
    })
  }
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => resolve(directory, entry.name))
    .sort()

  const tickets: ApprovalTicket[] = []
  for (const filePath of jsonFiles) {
    try {
      const raw = JSON.parse(await readFile(filePath, 'utf-8'))
      tickets.push(approvalTicketSchema.parse(raw))
    } catch (err) {
      throw new ApprovalGateError('approval_gate_ticket_invalid', `Approval ticket file "${filePath}" is invalid: ${errorMessage(err)}.`, {
        ticketFile: filePath,
      })
    }
  }
  return tickets
}

export function verifyApprovalTicket(ticket: ApprovalTicket, publicKeyPem: string): VerifiedApprovalTicket {
  let parsed: ApprovalTicket
  try {
    parsed = approvalTicketSchema.parse(ticket)
  } catch (err) {
    throw new ApprovalGateError('approval_gate_ticket_invalid', `Approval ticket shape is invalid: ${errorMessage(err)}.`)
  }
  const { signature, ...payload } = parsed
  if (!signature.startsWith('ed25519:')) {
    throw new ApprovalGateError('approval_gate_ticket_invalid', 'Approval ticket signature must use ed25519 prefix.')
  }

  const signatureBytes = Buffer.from(signature.slice('ed25519:'.length), 'base64')
  const payloadBytes = Buffer.from(canonicalApprovalPayload(payload))
  let ok = false
  try {
    const publicKey = createPublicKey(publicKeyPem)
    ok = verify(null, payloadBytes, publicKey, signatureBytes)
  } catch (err) {
    throw new ApprovalGateError('approval_gate_ticket_invalid', `Approval ticket "${parsed.ticket_id}" could not be verified: ${errorMessage(err)}.`, {
      ticketId: parsed.ticket_id,
    })
  }
  if (!ok) {
    throw new ApprovalGateError('approval_gate_ticket_invalid', `Approval ticket "${parsed.ticket_id}" has an invalid signature.`, {
      ticketId: parsed.ticket_id,
    })
  }

  return { ...parsed, verified: true }
}

export function findMatchingTicket(
  accountId: string,
  now: Date,
  tickets: VerifiedApprovalTicket[],
  allowedAccountRole: string,
): VerifiedApprovalTicket | null {
  const matchingAccount = tickets.filter((ticket) => ticket.account_id === accountId)
  const roleMatches = matchingAccount.filter((ticket) => ticket.account_role === allowedAccountRole)
  if (matchingAccount.length > 0 && roleMatches.length === 0) {
    throw new ApprovalGateError('approval_gate_ticket_invalid', `No approval ticket for account "${accountId}" matches role "${allowedAccountRole}".`, {
      accountId,
      role: allowedAccountRole,
    })
  }
  const valid = roleMatches.filter((ticket) => {
    const expiresAt = new Date(ticket.expires_at)
    if (Number.isNaN(expiresAt.getTime())) {
      throw new ApprovalGateError('approval_gate_ticket_invalid', `Approval ticket "${ticket.ticket_id}" has an invalid expires_at value.`, {
        ticketId: ticket.ticket_id,
      })
    }
    return expiresAt.getTime() > now.getTime()
  })

  if (matchingAccount.length > 0 && valid.length === 0) {
    throw new ApprovalGateError('approval_gate_ticket_expired', `No unexpired approval ticket matches account "${accountId}".`, {
      accountId,
    })
  }
  if (valid.length > 1) {
    throw new ApprovalGateError('approval_gate_ticket_ambiguous', `ambiguous approval tickets: multiple tickets match account "${accountId}".`, {
      accountId,
      count: valid.length,
    })
  }
  return valid[0] ?? null
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
