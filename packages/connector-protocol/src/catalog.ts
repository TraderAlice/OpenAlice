import type { ConnectorCapability, ConnectorDefinition } from './types.js'

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
      {
        key: 'inboxPush',
        label: 'Push Inbox notifications',
        kind: 'boolean',
        required: false,
        group: 'preferences',
        defaultValue: true,
        description: 'When off, new Inbox items stay in OpenAlice until you open them there or run /inbox.',
      },
    ],
    commands: [
      { name: 'link', description: 'Link this Discord account as the owner.' },
      { name: 'status', description: 'Show connector health.' },
      { name: 'test', description: 'Send a test notification.' },
      { name: 'inbox', description: 'Browse recent Inbox items.' },
      { name: 'settings', description: 'Change Inbox push for this chat.' },
      { name: 'uta', description: 'Review and approve pending trades.' },
    ],
    capabilities: ['inbox', 'settings', 'uta'],
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
      {
        key: 'inboxPush',
        label: 'Push Inbox notifications',
        kind: 'boolean',
        required: false,
        group: 'preferences',
        defaultValue: true,
        description: 'When off, new Inbox items stay in OpenAlice until you run /inbox.',
      },
    ],
    commands: [
      { name: 'link', description: 'Link this private chat as the owner.' },
      { name: 'status', description: 'Show connector health.' },
      { name: 'test', description: 'Send a test notification.' },
      { name: 'inbox', description: 'Browse recent Inbox items.' },
      { name: 'settings', description: 'Change Inbox push for this chat.' },
      { name: 'uta', description: 'Review and approve pending trades.' },
    ],
    capabilities: ['inbox', 'settings', 'uta', 'desk'],
  }

export const SLACK_CONNECTOR_DEFINITION: ConnectorDefinition = {
    id: 'slack',
    label: 'Slack',
    description: 'Send Inbox notifications to your private Slack app DM.',
    fields: [
      {
        key: 'botToken',
        label: 'Bot token',
        kind: 'secret',
        required: true,
        placeholder: 'xoxb-… sealed locally',
      },
      {
        key: 'appToken',
        label: 'App-level token',
        kind: 'secret',
        required: true,
        placeholder: 'xapp-… Socket Mode, connections:write',
      },
      {
        key: 'ownerUserId',
        label: 'Owner user ID',
        kind: 'text',
        required: false,
        learnedBy: 'link',
        description: 'Only this Slack account can link and receive notifications.',
        placeholder: 'Can be learned with /link',
      },
      {
        key: 'inboxPush',
        label: 'Push Inbox notifications',
        kind: 'boolean',
        required: false,
        group: 'preferences',
        defaultValue: true,
        description: 'When off, new Inbox items stay in OpenAlice until you open them there or run /inbox.',
      },
    ],
    commands: [
      { name: 'link', description: 'Link this Slack account as the owner.' },
      { name: 'status', description: 'Show connector health.' },
      { name: 'test', description: 'Send a test notification.' },
      { name: 'inbox', description: 'Browse recent Inbox items.' },
      { name: 'settings', description: 'Change Inbox push for this chat.' },
      { name: 'uta', description: 'Review and approve pending trades.' },
    ],
    capabilities: ['inbox', 'settings', 'uta'],
  }

export const FEISHU_CONNECTOR_DEFINITION: ConnectorDefinition = {
    id: 'feishu',
    label: 'Feishu',
    description: 'Send Inbox notifications and owner-chat to your private Feishu bot chat.',
    fields: [
      {
        key: 'appId',
        label: 'App ID',
        kind: 'text',
        required: true,
        placeholder: 'cli_… from the Feishu or Lark developer console',
      },
      {
        key: 'appSecret',
        label: 'App secret',
        kind: 'secret',
        required: true,
        placeholder: 'Stored locally and sealed',
      },
      {
        key: 'domain',
        label: 'Open platform',
        kind: 'text',
        required: false,
        defaultValue: 'feishu',
        placeholder: 'feishu or lark',
        description: 'feishu is open.feishu.cn (China). lark is open.larksuite.com. Do not mix them.',
      },
      {
        key: 'ownerUserId',
        label: 'Owner open ID',
        kind: 'text',
        required: false,
        learnedBy: 'link',
        description: 'Only this Feishu/Lark account can link and receive notifications.',
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
      {
        key: 'inboxPush',
        label: 'Push Inbox notifications',
        kind: 'boolean',
        required: false,
        group: 'preferences',
        defaultValue: true,
        description: 'When off, new Inbox items stay in OpenAlice until you open them there or run /inbox.',
      },
    ],
    commands: [
      { name: 'link', description: 'Link this private chat as the owner.' },
      { name: 'status', description: 'Show connector health.' },
      { name: 'test', description: 'Send a test notification.' },
      { name: 'inbox', description: 'Browse recent Inbox items.' },
      { name: 'settings', description: 'Change Inbox push for this chat.' },
      { name: 'uta', description: 'Review and approve pending trades.' },
    ],
    capabilities: ['inbox', 'settings', 'uta', 'desk'],
  }

export const BUILTIN_CONNECTOR_DEFINITIONS: ConnectorDefinition[] = [
  DISCORD_CONNECTOR_DEFINITION,
  TELEGRAM_CONNECTOR_DEFINITION,
  SLACK_CONNECTOR_DEFINITION,
  FEISHU_CONNECTOR_DEFINITION,
]

export function connectorDefinitionHasCapability(
  definition: ConnectorDefinition,
  capability: ConnectorCapability,
): boolean {
  return definition.capabilities?.includes(capability) === true
}

export function builtinConnectorHasCapability(
  connectorId: string,
  capability: ConnectorCapability,
): boolean {
  const definition = BUILTIN_CONNECTOR_DEFINITIONS.find((item) => item.id === connectorId)
  return definition ? connectorDefinitionHasCapability(definition, capability) : false
}
