import type { ConnectorSettingsSnapshot } from '../../api/connectors'

export const demoConnectorSnapshot: ConnectorSettingsSnapshot = {
  definitions: [
    {
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
          description: 'Only this Discord account can link and receive notifications.',
          kind: 'text',
          required: false,
          placeholder: 'Can be learned with /link',
          learnedBy: 'link',
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
      ],
      capabilities: ['inbox', 'settings'],
    },
    {
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
          description: 'Only this Telegram account can link and receive notifications.',
          kind: 'text',
          required: false,
          placeholder: 'Can be learned with /link',
          learnedBy: 'link',
        },
        {
          key: 'chatId',
          label: 'Private chat ID',
          description: 'Learned automatically when the owner runs /link.',
          kind: 'text',
          required: false,
          placeholder: 'Can be learned with /link',
          learnedBy: 'link',
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
      ],
      capabilities: ['inbox', 'settings'],
    },
    {
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
          description: 'Only this Slack account can link and receive notifications.',
          kind: 'text',
          required: false,
          placeholder: 'Can be learned with /link',
          learnedBy: 'link',
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
      ],
      capabilities: ['inbox', 'settings'],
    },
  ],
  config: {
    serviceEnabled: false,
    adapters: {
      discord: { enabled: false, settings: {}, configuredSecrets: [] },
      telegram: { enabled: false, settings: {}, configuredSecrets: [] },
      slack: { enabled: false, settings: {}, configuredSecrets: [] },
    },
  },
  health: {
    enabled: false,
    status: 'disabled',
  },
}

export function createDemoConnectorSnapshot(): ConnectorSettingsSnapshot {
  return structuredClone(demoConnectorSnapshot)
}
