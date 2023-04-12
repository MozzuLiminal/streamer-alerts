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

enum Commands {
  ALERT = 'alert',
  REMOVE = 'remove',
}

export type DiscordEvents = TypedEventEmitter<{
  online(name: string, platform: string, url: string): void;
  remove(platformName: string, user: string, callback: (result: boolean) => void): void;
  add(platformName: string, user: string, callback: (result: boolean) => void): void;
}>;

export class Discord {
  private client: Client;
  private rest: REST;
  private DISCORD_TOKEN: string;
  private DISCORD_APP_ID: string;
  private GUILD_ID = '';
  private channel?: TextChannel;
  private platforms: string[] = [];
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

      console.log('got interaction', interaction.commandName);

      if (interaction.commandName === Commands.ALERT) {
        return void this.handleAddAlertPlatformStreamer(interaction);
      }

      if (interaction.commandName === Commands.REMOVE) {
        return void this.handleRemoveAlertPlatformStreamer(interaction);
      }
    });

    this.events.on('online', (name, platform, url) => {
      this.channel?.send(`${name} is streaming live on ${platform} at ${url}`);
    });
  }

  private async handleAddAlertPlatformStreamer(interaction: ChatInputCommandInteraction<CacheType>) {
    const [platform, streamer] = [
      interaction.options.get('platform')?.value as string,
      interaction.options.get('streamer')?.value as string,
    ];

    if (!platform || !streamer) {
      return interaction.reply({ content: 'platform or streamer is missing', ephemeral: true });
    }

    console.log('calling add');

    this.events.emit('add', platform, streamer, (success) => {
      interaction.reply({
        content: `Added alerts for ${streamer} on ${platform} ${success ? 'successfully' : 'unsuccessfully'}`,
        ephemeral: true,
      });
    });
  }

  private async handleRemoveAlertPlatformStreamer(interaction: ChatInputCommandInteraction<CacheType>) {
    const [platform, streamer] = [
      interaction.options.get('platform')?.value as string,
      interaction.options.get('streamer')?.value as string,
    ];

    if (!platform || !streamer) {
      return interaction.reply({ content: 'platform or streamer is missing', ephemeral: true });
    }

    this.events.emit('remove', platform, streamer, (success) => {
      const platformNames = this.platforms.join(', ');

      return interaction.reply({ content: `${streamer} has been removed from ${platformNames}`, ephemeral: true });
    });
  }

  private loadTokens() {
    const tokensToLoad = ['DISCORD_TOKEN', 'DISCORD_APP_ID', 'DISCORD_GUILD_ID'] as const;

    type Tokens = {
      [key in (typeof tokensToLoad)[number]]: string;
    };

    return tokensToLoad.reduce<Tokens>((acc, token) => {
      if (!process.env[token]) {
        console.error(`${token} is missing in the environment`);
        process.exitCode = 1;
      }

      return { ...acc, [token]: process.env[token] ?? '' };
    }, {} as Tokens);
  }

  /**
   * Registers the slash commands to the discord server. Should be called after adding platform instances
   */
  async registerSlashCommands() {
    const commands = [
      new SlashCommandBuilder()
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
      new SlashCommandBuilder()
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
    ];

    console.log('registering');

    await this.rest.put(Routes.applicationGuildCommands(this.DISCORD_APP_ID, this.GUILD_ID), {
      body: commands.map((command) => command.toJSON()),
    });

    return this.attachEvents();
  }

  addPlatformChoice(name: string) {
    this.platforms.push(name);
  }
}
