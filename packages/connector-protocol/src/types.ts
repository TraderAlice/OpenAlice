import { z } from 'zod'

export const connectorFieldKindSchema = z.enum(['text', 'secret', 'number', 'boolean'])
export type ConnectorFieldKind = z.infer<typeof connectorFieldKindSchema>

export const connectorFieldDefinitionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  kind: connectorFieldKindSchema,
  required: z.boolean().default(false),
  placeholder: z.string().optional(),
  /** Slash command that owns this value. Settings renders these fields as
   *  lifecycle output rather than ordinary operator-entered configuration. */
  learnedBy: z.string().min(1).optional(),
})
export type ConnectorFieldDefinition = z.infer<typeof connectorFieldDefinitionSchema>

export const connectorDefinitionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  fields: z.array(connectorFieldDefinitionSchema),
  commands: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1),
  })).default([]),
})
export type ConnectorDefinition = z.infer<typeof connectorDefinitionSchema>

export const connectorAdapterConfigSchema = z.object({
  enabled: z.boolean().default(false),
  settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
})
export type ConnectorAdapterConfig = z.infer<typeof connectorAdapterConfigSchema>

export const connectorConfigSchema = z.object({
  version: z.literal(1).default(1),
  adapters: z.record(z.string(), connectorAdapterConfigSchema).default({}),
})
export type ConnectorConfig = z.infer<typeof connectorConfigSchema>

export const publicConnectorAdapterConfigSchema = z.object({
  enabled: z.boolean(),
  settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  configuredSecrets: z.array(z.string()),
})
export type PublicConnectorAdapterConfig = z.infer<typeof publicConnectorAdapterConfigSchema>

export const publicConnectorConfigSchema = z.object({
  serviceEnabled: z.boolean(),
  adapters: z.record(z.string(), publicConnectorAdapterConfigSchema),
})
export type PublicConnectorConfig = z.infer<typeof publicConnectorConfigSchema>

/** Keep inline delivery bounded below both Discord's ordinary upload limit and
 * Telegram's document limit. Alice reads only the small Markdown reports that
 * Inbox already exposes; Connector Service never reaches back into a Workspace. */
export const MAX_CONNECTOR_ATTACHMENT_BYTES = 1024 * 1024
export const MAX_CONNECTOR_ATTACHMENTS = 5

export const connectorAttachmentSourceSchema = z.object({
  sizeBytes: z.number().int().min(0).max(MAX_CONNECTOR_ATTACHMENT_BYTES),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  detectedEncoding: z.string().min(1).max(64).optional(),
  detectionConfidence: z.number().min(0).max(100).optional(),
})

export const connectorAttachmentSchema = z.object({
  filename: z.string().min(1).max(255),
  mediaType: z.string().min(1).max(128),
  sizeBytes: z.number().int().min(0).max(MAX_CONNECTOR_ATTACHMENT_BYTES),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  // Source evidence remains distinct when Alice creates an encoding-normalized
  // delivery copy. The Workspace file itself is never rewritten.
  source: connectorAttachmentSourceSchema.optional(),
  // One MiB is at most 1,398,104 base64 characters. The small allowance keeps
  // schema evolution from rejecting equivalent padded encodings.
  contentBase64: z.string().max(1_400_000),
})
export type ConnectorAttachment = z.infer<typeof connectorAttachmentSchema>

export const inboxNotificationSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  workspaceId: z.string().min(1),
  workspaceLabel: z.string().optional(),
  title: z.string().min(1),
  body: z.string().default(''),
  attachments: z.array(connectorAttachmentSchema).max(MAX_CONNECTOR_ATTACHMENTS).optional(),
  href: z.string().optional(),
  provenance: z.object({
    resumeId: z.string().optional(),
    actorLabel: z.string().optional(),
  }).optional(),
})
export type InboxNotification = z.infer<typeof inboxNotificationSchema>

export const connectorAdapterHealthSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  status: z.enum(['disabled', 'starting', 'awaiting_link', 'healthy', 'degraded', 'stopped']),
  detail: z.string().optional(),
  owner: z.string().optional(),
  lastAttemptAt: z.string().datetime().optional(),
  lastSuccessAt: z.string().datetime().optional(),
  lastError: z.string().optional(),
})
export type ConnectorAdapterHealth = z.infer<typeof connectorAdapterHealthSchema>

export const connectorServiceHealthSchema = z.object({
  status: z.enum(['healthy', 'degraded']),
  startedAt: z.string().datetime(),
  adapters: z.array(connectorAdapterHealthSchema),
})
export type ConnectorServiceHealth = z.infer<typeof connectorServiceHealthSchema>

export const connectorDeliveryReceiptSchema = z.object({
  accepted: z.literal(true),
  deliveryId: z.string().min(1),
})
export type ConnectorDeliveryReceipt = z.infer<typeof connectorDeliveryReceiptSchema>
