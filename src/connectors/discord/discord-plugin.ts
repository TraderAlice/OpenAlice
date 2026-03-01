import { Client, GatewayIntentBits, TextChannel, AttachmentBuilder } from 'discord.js';
import { readFile } from 'node:fs/promises';
import type { Plugin, EngineContext } from '../../core/types.js';
import type { Connector } from '../../core/connector-center.js';
import { SessionStore } from '../../core/session.js';

export interface DiscordConfig {
  enabled: boolean;
  botToken?: string;
  channelId?: string;
}

export class DiscordPlugin implements Plugin {
  name = 'discord';
  private config: DiscordConfig;
  private client: Client;
  private connectorCenter: EngineContext['connectorCenter'] | null = null;
  private sessions = new Map<string, SessionStore>();
  private unregisterConnector?: () => void;

  constructor(config: DiscordConfig) {
    this.config = config;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ]
    });
  }

  async start(engineCtx: EngineContext): Promise<void> {
    if (!this.config.enabled || !this.config.botToken) {
      return;
    }

    this.connectorCenter = engineCtx.connectorCenter;

    this.client.on('ready', () => {
      console.log(`discord plugin: connected as @${this.client.user?.tag}`);

      // Register the connector only when the client is ready
      if (this.config.channelId && !this.unregisterConnector) {
        this.unregisterConnector = this.connectorCenter!.register(this.createConnector(this.client, this.config.channelId!));
        console.log('discord: connector registered for push notifications');
      }
    });

    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;
      if (message.channel.id !== this.config.channelId) return;

      const channel = await this.client.channels.fetch(this.config.channelId) as TextChannel;
      if (!channel) return;

      const stopTyping = this.startTypingIndicator(channel);

      try {
        const session = await this.getSession(message.author.id);
        const result = await engineCtx.engine.askWithSession(message.content, session, {
          historyPreamble: 'The following is the recent conversation from this Discord chat. Use it as context if the user references earlier messages.',
        });
        stopTyping();

        // Send media
        if (result.media && result.media.length > 0) {
          for (const attachment of result.media) {
            try {
              const buf = await readFile(attachment.path);
              const discordAttachment = new AttachmentBuilder(buf, { name: 'image.png' });
              await channel.send({ files: [discordAttachment] });
            } catch (err) {
              console.error('discord: failed to send photo:', err);
            }
          }
        }

        if (result.text) {
          // split message into chunks of 2000 characters
          const chunks = result.text.match(/[\s\S]{1,2000}/g) || [];
          for (const chunk of chunks) {
            await channel.send(chunk);
          }
        }
      } catch (err) {
        stopTyping();
        console.error('discord message handling error:', err);
        await channel.send('Sorry, something went wrong processing your message.');
      }
    });

    await this.client.login(this.config.botToken);
  }

  async stop(): Promise<void> {
    await this.client.destroy();
    this.unregisterConnector?.();
  }

  private createConnector(client: Client, channelId: string): Connector {
    return {
      channel: 'discord',
      to: channelId,
      capabilities: { push: true, media: true },
      send: async (payload) => {
        const channel = await client.channels.fetch(channelId, { force: true, cache: true }) as TextChannel;
        if (!channel) {
          console.error(`discord: channel not found: ${channelId}`);
          return { delivered: false };
        }

        // Send media first
        if (payload.media && payload.media.length > 0) {
          for (const attachment of payload.media) {
            try {
              const buf = await readFile(attachment.path);
              const discordAttachment = new AttachmentBuilder(buf, { name: 'image.png' });
              await channel.send({ files: [discordAttachment] });
            } catch (err) {
              console.error('discord: failed to send photo:', err);
            }
          }
        }

        // Send text
        if (payload.text) {
          // split message into chunks of 2000 characters
          const chunks = payload.text.match(/[\s\S]{1,2000}/g) || [];
          for (const chunk of chunks) {
            await channel.send(chunk);
          }
        }

        return { delivered: true };
      },
    };
  }

  private startTypingIndicator(channel: TextChannel): () => void {
    channel.sendTyping();
    const interval = setInterval(() => {
      channel.sendTyping();
    }, 9000); // Discord's typing indicator lasts for 10 seconds
    return () => clearInterval(interval);
  }

  private async getSession(userId: string): Promise<SessionStore> {
    let session = this.sessions.get(userId);
    if (!session) {
      session = new SessionStore(`discord/${userId}`);
      await session.restore();
      this.sessions.set(userId, session);
      console.log(`discord: session discord/${userId} ready`);
    }
    return session;
  }
}
