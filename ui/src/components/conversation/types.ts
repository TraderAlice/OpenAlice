/** Ephemeral presentation data. Adapters own wire protocols and persistence. */
export type ConversationContent = readonly ConversationBlock[]

export type ConversationBlock =
  | { readonly kind: 'markdown'; readonly text: string }
  | { readonly kind: 'disclosure'; readonly label: string; readonly content: ConversationContent }
  | { readonly kind: 'data'; readonly text: string }

export interface ConversationToolStep {
  readonly id: string
  readonly name: string
  readonly summary: string | null
  readonly input: string
  readonly result?: ConversationContent
  readonly resultChars?: number
  readonly thinking: readonly string[]
  readonly status: 'running' | 'succeeded' | 'failed'
}

export interface ConversationActivity {
  readonly steps: readonly ConversationToolStep[]
  readonly thinking: readonly string[]
  readonly unknownParts: readonly string[]
}

export type ConversationItem =
  | { readonly kind: 'user'; readonly key: string; readonly content: ConversationContent }
  | { readonly kind: 'assistant-turn'; readonly key: string; readonly progress: readonly string[]; readonly final: string | null; readonly activity: ConversationActivity | null }
  | { readonly kind: 'unknown'; readonly key: string; readonly content: ConversationContent }
