import {
  APIApplicationCommandOptionChoice,
  CacheType,
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextChannel,
} from 'discord.js';
import { EventEmitter } from 'events';
import TypedEventEmitter from 'typed-emitter';
import { Platform } from '../interfaces/platform';
import { createLogger } from './log';

const logger = createLogger('discord');

enum Commands {
  ALERT = 'alert',
  REMOVE = 'remove',
  DEBUG = 'debug',
}

interface Command {
  name: Commands;
  command: Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;
  action: (interaction: ChatInputCommandInteraction<CacheType>) => any;
}

type SubscriptionResult = Awaited<ReturnType<Platform['addStreamerAlert']>>['result'];

export type DiscordEvents = TypedEventEmitter<{
  online: (name: string, platform: string, url: string) => void;
  remove: (platformName: string, user: string, callback: (removedFrom: string[]) => void) => void;
  add: (platformName: string, user: string, callback: (result: SubscriptionResult) => void) => void;
  users: (callback: (usersInPlatforms: Record<string, string[]>) => void) => void;
}>;

export class Discord {
  private client: Client;
  private rest: REST;
  private DISCORD_TOKEN: string;
  private DISCORD_APP_ID: string;
  private GUILD_ID = '';
  private channel?: TextChannel;
  private platforms: string[] = [];
  private commands?: Command[];
  events = new EventEmitter() as DiscordEvents;

  constructor() {
    const { DISCORD_TOKEN, DISCORD_APP_ID, DISCORD_GUILD_ID } = this.loadTokens();

    this.DISCORD_TOKEN = DISCORD_TOKEN;
    this.DISCORD_APP_ID = DISCORD_APP_ID;
    this.GUILD_ID = DISCORD_GUILD_ID;

    this.client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
    this.rest = new REST({ version: '10' });

    this.client.login(DISCORD_TOKEN);
    this.rest.setToken(DISCORD_TOKEN);

    this.client.once(Events.ClientReady, () => {
      this.channel = this.client.channels.cache.get('1095076086494269636') as TextChannel;
    });
  }

  private attachEvents() {
    this.client.on(Events.InteractionCreate, (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      logger.info(`user ${interaction.user.username} used the slash command /${interaction.commandName}`);

      this.commands?.find(({ name }) => interaction.commandName === name)?.action(interaction);
    });

    this.events.on('online', (name, platform, url) => {
      this.channel?.send(`${name} is streaming live on ${platform} at ${url}`);
    });
  }

  private loadTokens() {
    const tokensToLoad = ['DISCORD_TOKEN', 'DISCORD_APP_ID', 'DISCORD_GUILD_ID'] as const;

    type Tokens = {
      [key in (typeof tokensToLoad)[number]]: string;
    };

    return tokensToLoad.reduce<Tokens>((acc, token) => {
      if (!process.env[token]) {
        logger.error(`${token} is missing in the environment`);
        process.exitCode = 1;
      }

      return { ...acc, [token]: process.env[token] ?? '' };
    }, {} as Tokens);
  }

  /**
   * Registers the slash commands to the discord server. Should be called after adding platform instances
   */
  async registerSlashCommands() {
    this.commands = [
      {
        name: Commands.ALERT,
        command: new SlashCommandBuilder()
          .setName(Commands.ALERT)
          .setDescription('Adds an alert for a streamer on a platform')
          .addStringOption((option) =>
            option
              .setName('platform')
              .setDescription('The streaming platform')
              .setRequired(true)
              .addChoices(
                ...this.platforms.map<APIApplicationCommandOptionChoice<string>>((platform) => ({
                  name: platform,
                  value: platform,
                })),
              ),
          )
          .addStringOption((option) =>
            option.setName('streamer').setDescription('the streamer that you want to add alerts for').setRequired(true),
          ),
        action: (interaction) => {
          const [platform, streamer] = [
            interaction.options.get('platform')?.value as string,
            interaction.options.get('streamer')?.value as string,
          ];

          if (!platform || !streamer) {
            return interaction.reply({ content: 'platform or streamer is missing', ephemeral: true });
          }

          this.events.emit('add', platform, streamer, (result) => {
            const messages: Record<SubscriptionResult, string> = {
              ADDED: `Added alerts for ${streamer} on ${platform} successfully`,
              EXISTS: `Alerts for ${streamer} on ${platform} already exists`,
              FAILED: `Failed to add alerts for ${streamer} on ${platform}`,
            };

            interaction.reply({
              content: messages[result],
              ephemeral: true,
            });
          });
        },
      },
      {
        name: Commands.REMOVE,
        command: new SlashCommandBuilder()
          .setName(Commands.REMOVE)
          .setDescription('Removes an alert for a streamer')
          .addStringOption((option) =>
            option
              .setName('platform')
              .setDescription('The streaming platform')
              .setRequired(true)
              .addChoices(
                ...this.platforms.map<APIApplicationCommandOptionChoice<string>>((platform) => ({
                  name: platform,
                  value: platform,
                })),
                {
                  name: 'all',
                  value: 'all',
                },
              ),
          )
          .addStringOption((option) =>
            option.setName('streamer').setDescription('the streamer that you want to add alerts for').setRequired(true),
          ),
        action: (interaction) => {
          const [platform, streamer] = [
            interaction.options.get('platform')?.value as string,
            interaction.options.get('streamer')?.value as string,
          ];

          if (!platform || !streamer) {
            return interaction.reply({ content: 'platform or streamer is missing', ephemeral: true });
          }

          this.events.emit('remove', platform, streamer, (success) => {
            const platformNames = this.platforms.join(', ');

            return interaction.reply({
              content: `${streamer} has been removed from ${platformNames}`,
              ephemeral: true,
            });
          });
        },
      },
      {
        name: Commands.DEBUG,
        command: new SlashCommandBuilder()
          .setName(Commands.DEBUG)
          .setDescription('Sends debug information to the sender'),
        action: (interaction) => {
          this.events.emit('users', (data) => {
            const lines = Object.keys(data)
              .map((user) => `${user}: ${data[user].join(', ')}`)
              .join('\n');

            let message = `The following users are in the following platform alerts:\n${lines}`;

            if (lines.length <= 0) message = 'There are no alerts currently';

            interaction.reply({ content: message, ephemeral: true });
          });
        },
      },
    ];

    await this.rest.put(Routes.applicationGuildCommands(this.DISCORD_APP_ID, this.GUILD_ID), {
      body: this.commands.map(({ command }) => command.toJSON()),
    });

    logger.info(`attached the following slashcommands ${this.commands.map((command) => command.name).join(', ')}`);

    return this.attachEvents();
  }

  addPlatformChoice(name: string) {
    this.platforms.push(name);
  }
}
