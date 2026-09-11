export const INTERNAL_ROLE_FLAG = '--internal-role'

export const OPENALICE_INTERNAL_ROLES = [
  'guardian',
  'alice',
  'uta',
  'connector',
] as const

export type OpenAliceInternalRole = typeof OPENALICE_INTERNAL_ROLES[number]

export interface ParsedInternalRole {
  role: OpenAliceInternalRole
  argv: string[]
}

export function parseInternalRole(argv: string[]): ParsedInternalRole | null {
  if (argv[0] !== INTERNAL_ROLE_FLAG) return null
  const role = argv[1]
  if (!OPENALICE_INTERNAL_ROLES.includes(role as OpenAliceInternalRole)) {
    throw new Error(`invalid private runtime role: ${role ?? '(missing)'}`)
  }
  return {
    role: role as OpenAliceInternalRole,
    argv: argv.slice(2),
  }
}
