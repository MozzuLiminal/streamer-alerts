import {
  APIApplicationCommandOptionChoice,
  CacheType,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  DMChannel,
  Events,
  GatewayIntentBits,
  Guild,
  NonThreadGuildBasedChannel,
  REST,
  Routes,
  SlashCommandBuilder,
  TextChannel,
} from 'discord.js';
import { EventEmitter } from 'events';
import TypedEventEmitter from 'typed-emitter';
import { Platform } from '../interfaces/platform';
import db from '../services/db';
import { createLogger } from './log';

const logger = createLogger('discord');

enum DatabaseKeys {
  GUILD_CHANNELS = 'GUILD_CHANNELS',
  GUILD_SUBSCRIPTIONS = 'GUILD_SUBSCRIPTIONS',
}

enum Commands {
  ALERT = 'alert',
  REMOVE = 'remove',
  DEBUG = 'debug',
  JOIN = 'join',
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

const _GUILD_CHANNELS_DB: any = db.getSync()?.[DatabaseKeys.GUILD_CHANNELS] ?? [];
const _GUILD_SUBSCRIPTIONS_DB: any = db.getSync()?.[DatabaseKeys.GUILD_SUBSCRIPTIONS] ?? [];

export class Discord {
  private client: Client;
  private rest: REST;
  private DISCORD_APP_ID: string;
  private platforms: string[] = [];
  private channel: Map<string, TextChannel> = new Map();
  private commands: Map<string, Awaited<ReturnType<typeof this.createSlashCommands>>> = new Map();
  private guildSubscriptions: Map<string, { streamer: string; platform: string }[]> = new Map(_GUILD_SUBSCRIPTIONS_DB);
  events = new EventEmitter() as DiscordEvents;

  constructor() {
    const { DISCORD_TOKEN, DISCORD_APP_ID } = this.loadTokens();

    this.DISCORD_APP_ID = DISCORD_APP_ID;

    this.client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
    this.rest = new REST({ version: '10' });

    this.client.login(DISCORD_TOKEN);
    this.rest.setToken(DISCORD_TOKEN);

    this.client.on(Events.GuildCreate, async (guild) => {
      logger.info(`Discord has joined the server ${guild.name}`);

      const commands = await this.createSlashCommands(guild);

      if (this.commands) guild.commands.set(commands.map(({ command }) => command));
    });

    const handleChannelChange = async (channel: NonThreadGuildBasedChannel | DMChannel) => {
      if (!channel.isThread() && !channel.isDMBased()) {
        logger.info(`Text channel was changed in ${channel.guild.name}, updating commands`);

        const commands = await this.createSlashCommands(channel.guild);

        if (this.commands) channel.guild.commands.set(commands.map(({ command }) => command));
      }
    };

    this.client.on(Events.ChannelCreate, handleChannelChange);
    this.client.on(Events.ChannelDelete, handleChannelChange);
    this.client.on(Events.ChannelUpdate, handleChannelChange);
  }

  private attachEvents() {
    this.client.on(Events.InteractionCreate, async (interaction) => {
      const commands = await this.commands.get(interaction.guildId as string);

      if (!interaction.isChatInputCommand() || !commands) return;

      logger.info(`user ${interaction.user.username} used the slash command /${interaction.commandName}`);

      commands.find(({ name }) => interaction.commandName === name)?.action(interaction);
    });

    this.events.on('online', (name, platform, url) => {
      this.guildSubscriptions.forEach((subscriptions, guildId) => {
        subscriptions.forEach((subscription) => {
          if (subscription.platform === platform && subscription.streamer === name) {
            this.channel?.get(guildId)?.send(`${name} is streaming live on ${platform} at ${url}`);
          }
        });
      });
    });
  }

  private loadTokens() {
    const tokensToLoad = ['DISCORD_TOKEN', 'DISCORD_APP_ID'] as const;

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

  private createSlashCommands = async (guild: Guild): Promise<Command[]> => {
    const textChannels = await guild.channels.fetch().then((channels) => {
      return channels
        .filter((channel) => channel && channel.type === ChannelType.GuildText)
        .map((channel) => ({ name: channel?.name as string, value: channel?.id as string }));
    });

    return [
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
          const guildId = interaction.guildId as string;
          const subscriptions = this.guildSubscriptions.get(interaction.guildId as string) ?? [];
          const channel = this.channel.get(guildId);

          const [platform, streamer] = [
            interaction.options.get('platform')?.value as string,
            interaction.options.get('streamer')?.value as string,
          ];

          if (!platform || !streamer) {
            return interaction.reply({ content: 'platform or streamer is missing', ephemeral: true });
          }

          this.events.emit('add', platform, streamer, (result) => {
            const messages: Record<SubscriptionResult, string> = {
              ADDED: `Added alerts for ${streamer} on ${platform}`,
              EXISTS: `Alerts for ${streamer} on ${platform} already exists`,
              FAILED: `Failed to add alerts for ${streamer} on ${platform}`,
            };

            let content = messages[result];

            if (result === 'ADDED') {
              this.guildSubscriptions.set(guildId, [...subscriptions, { streamer, platform }]);
            }

            if (!channel) {
              content +=
                '\n\n**You have not specified what channel i should send alerts in, use the _/join_ slash command to select one**';
            }

            interaction.reply({
              content,
              ephemeral: true,
            });

            const seralized: Record<string, any> = {};

            this.guildSubscriptions.forEach((value, key) => {
              seralized[key] = value;
            });

            db.set((data) => ({
              ...data,
              [DatabaseKeys.GUILD_SUBSCRIPTIONS]: Object.entries(seralized),
            }));
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
          const guildId = interaction.guildId as string;
          const subscriptions = this.guildSubscriptions.get(interaction.guildId as string) ?? [];

          const [platform, streamer] = [
            interaction.options.get('platform')?.value as string,
            interaction.options.get('streamer')?.value as string,
          ];

          if (!platform || !streamer) {
            return interaction.reply({ content: 'platform or streamer is missing', ephemeral: true });
          }

          this.guildSubscriptions.set(
            guildId,
            subscriptions.filter((sub) => {
              return sub.platform === platform && sub.streamer === streamer;
            }),
          );

          this.events.emit('remove', platform, streamer, () => {
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
      {
        name: Commands.JOIN,
        command: new SlashCommandBuilder()
          .setName(Commands.JOIN)
          .setDescription('Joins a text channel to send alerts in')
          .addStringOption((option) =>
            option
              .setName('channel')
              .setDescription('The text channel')
              .setRequired(true)
              .addChoices(...textChannels),
          ),
        action: (interaction) => {
          const channelId = interaction.options.get('channel')?.value as string;

          if (!channelId) {
            return interaction.reply({ content: 'The channel does not exist', ephemeral: true });
          }

          const channel = this.client.channels.cache.get(channelId) as TextChannel;

          this.channel.set(interaction.guildId as string, channel);

          const serialized: Record<string, string> = {};

          this.channel.forEach((channel, guildId) => {
            serialized[guildId] = channel.id;
          });

          db.set((data) => ({ ...data, [DatabaseKeys.GUILD_CHANNELS]: Object.entries(serialized) }));

          interaction.reply({ content: `Alerts will now be sent in the ${channel.name} channel`, ephemeral: true });
        },
      },
    ];
  };

  /**
   * Registers the slash commands to the discord server. Should be called after adding platform instances
   */
  async registerSlashCommands() {
    const guildIds = await this.client.guilds.fetch().then((guilds) => guilds.map((guild) => guild.id));

    const guildCommandsByName = await Promise.all(
      guildIds.map(async (id) => {
        const guild = await this.client.guilds.fetch(id);
        const commands = await this.createSlashCommands(guild);

        _GUILD_CHANNELS_DB.forEach(([guildId, channelId]: any) => {
          guild.channels.fetch(channelId).then((channel) => {
            this.channel.set(guildId, channel as TextChannel);
          });
        });

        await this.rest
          .put(Routes.applicationGuildCommands(this.DISCORD_APP_ID, id), {
            body: commands.map(({ command }) => command.toJSON()),
          })
          .catch((err) => {
            logger.error(`Register slash command failed for ${id}. ${err?.toString()}`);
          });

        this.commands.set(id, commands);

        return [guild.name, commands] as const;
      }),
    );

    guildCommandsByName.forEach(([name, commands]) => {
      logger.info(
        `attached the following slashcommands ${commands
          .map((command) => command.name)
          .join(', ')} in the '${name}' server`,
      );
    });

    return this.attachEvents();
  }

  addPlatformChoice(name: string) {
    this.platforms.push(name);
  }
}
