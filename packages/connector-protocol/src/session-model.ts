import { z } from 'zod'

export const connectorModelSelectionSchema = z.object({
  credential: z.string().min(1).max(200),
  model: z.string().trim().min(1).max(200).nullable(),
  effort: z.string().min(1).max(30).nullable(),
}).strict()
export const connectorModelRequestSchema = z.object({
  resumeId: z.string().max(200).optional(),
  revision: z.string().max(100).optional(),
  selection: connectorModelSelectionSchema.optional(),
  apply: z.boolean().optional(),
}).strict()
export type ConnectorModelRequest = z.infer<typeof connectorModelRequestSchema>
export type ConnectorModelSelection = z.infer<typeof connectorModelSelectionSchema>
export interface ConnectorModelPanel {
  resumeId: string
  revision: string
  runtime: string
  selection: ConnectorModelSelection
  credentials: Array<{ id: string; label: string }>
  models: Array<{ id: string; label: string }>
  efforts: string[]
  running: boolean
  saved: boolean
}
