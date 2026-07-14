import type { ConnectorDefinition } from './types.js'

/**
 * Built-in connector metadata is data, not UI branching. A downstream build
 * may append definitions and register matching adapters without changing the
 * Connector Service core or Settings renderer.
 */
export const DISCORD_CONNECTOR_DEFINITION: ConnectorDefinition = {
    id: 'discord',
    label: 'Discord',
    description: 'Send Inbox notifications to your private Discord app DM.',
    fields: [
      {
        key: 'applicationId',
        label: 'Application ID',
        kind: 'text',
        required: true,
        placeholder: 'Discord application ID',
      },
      {
        key: 'botToken',
        label: 'Bot token',
        kind: 'secret',
        required: true,
        placeholder: 'Stored locally and sealed',
      },
      {
        key: 'ownerUserId',
        label: 'Owner user ID',
        kind: 'text',
        required: false,
        learnedBy: 'link',
        description: 'Only this Discord account can link and receive notifications.',
        placeholder: 'Can be learned with /link',
      },
    ],
    commands: [
      { name: 'link', description: 'Link this Discord account as the owner.' },
      { name: 'status', description: 'Show connector health.' },
      { name: 'test', description: 'Send a test notification.' },
    ],
  }

export const TELEGRAM_CONNECTOR_DEFINITION: ConnectorDefinition = {
    id: 'telegram',
    label: 'Telegram',
    description: 'Send Inbox notifications to your private Telegram bot chat.',
    fields: [
      {
        key: 'botToken',
        label: 'Bot token',
        kind: 'secret',
        required: true,
        placeholder: 'Stored locally and sealed',
      },
      {
        key: 'ownerUserId',
        label: 'Owner user ID',
        kind: 'text',
        required: false,
        learnedBy: 'link',
        description: 'Only this Telegram account can link and receive notifications.',
        placeholder: 'Can be learned with /link',
      },
      {
        key: 'chatId',
        label: 'Private chat ID',
        kind: 'text',
        required: false,
        learnedBy: 'link',
        description: 'Learned automatically when the owner runs /link.',
        placeholder: 'Can be learned with /link',
      },
    ],
    commands: [
      { name: 'link', description: 'Link this private chat as the owner.' },
      { name: 'status', description: 'Show connector health.' },
      { name: 'test', description: 'Send a test notification.' },
    ],
  }

export const BUILTIN_CONNECTOR_DEFINITIONS: ConnectorDefinition[] = [
  DISCORD_CONNECTOR_DEFINITION,
  TELEGRAM_CONNECTOR_DEFINITION,
]
