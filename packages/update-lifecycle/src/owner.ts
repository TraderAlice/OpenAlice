import { approveUpdate, createUpdatePlan, transitionUpdate, type UpdateIdentity, type UpdateJournal, type UpdateUnit } from './coordinator.js'

/** Called inside an owner's existing transaction/lease after exact-plan validation.
 * The owner proves rollback/commit on startup; the outer coordinator consumes
 * this receipt and never bypasses that reconciliation by replaying an HTTP call. */
export async function recordOwnerUpdate<T>(input: {
  journal: UpdateJournal
  unit: UpdateUnit
  fingerprint: string
  id: string
  apply: () => Promise<T>
  receipt: (result: T) => string
  now?: () => string
}): Promise<T> {
  const now = input.now ?? (() => new Date().toISOString())
  const plan = createUpdatePlan(input.unit.id, [{ unit: input.unit, fingerprint: input.fingerprint, stages: ['apply'] }])
  let op = approveUpdate(plan, plan.fingerprint, input.id, now())
  op = transitionUpdate(op, { type: 'start', step: plan.steps[0]!.id }, now())
  await input.journal.write(op)
  try {
    const result = await input.apply()
    op = transitionUpdate(op, { type: 'complete', step: plan.steps[0]!.id, fingerprint: input.fingerprint, receipt: input.receipt(result) }, now())
    await input.journal.write(op)
    return result
  } catch (error) {
    await input.journal.write(transitionUpdate(op, { type: 'recover', message: 'Owner transaction must reconcile commit or rollback before replay' }, now()))
    throw error
  }
}
export function projectUpdateUnit(id: string, owner: string, location: string, installed: UpdateIdentity | null, desired: UpdateIdentity | null): UpdateUnit {
  return { id, installationId: location, projectId: location, roles: [owner], owner, location, installed, active: installed, desired,
    source: owner, policyScope: owner === 'broker-pack' ? 'pack' : 'project', capabilities: null, operations: ['update'] }
}
