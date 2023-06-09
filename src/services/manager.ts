import { Express } from 'express';
import { Platform } from '../interfaces/platform';
import db from './db';
import { Discord } from './discord';
import { createLogger } from './log';

const logger = createLogger('manager');

export class Manager {
  private platforms: Platform[];
  private discord: Discord;
  private queue: Platform[] = [];
  private webhooks: Express;
  private isProcessing = false;

  constructor(discord: Discord, webhooks: Express, platforms: Platform[] = []) {
    this.platforms = platforms;
    this.discord = discord;
    this.webhooks = webhooks;

    this.discord.init(db.getSync()['Discord']);

    this.discord.events.on('remove', async (platformName, name, guildId, cb) => {
      if (platformName === 'all') {
        const allPlatforms = await Promise.all(
          this.platforms.map((platform) => this.handleRemoveStreamer(platform.name, name, guildId)),
        );
        const unqiuePlatforms = Array.from(new Set(...allPlatforms.flat(2)));

        return cb(unqiuePlatforms);
      }

      return this.handleRemoveStreamer(platformName, name, guildId).then(cb);
    });

    this.discord.events.on('add', (platformName, name, guildid, cb) => {
      const platform = this.platforms.find((platform) => platform.name === platformName);

      if (!platform) return cb('FAILED');
      if (!platform.isStreamerSubscribed(name, guildid)) return cb('ADDED');

      return platform.addStreamerAlert(name, guildid).then(({ result }) => cb(result));
    });

    this.discord.events.on('users', async (callback) => {
      const usersInPlatforms = await Promise.all(
        this.platforms.map(async (platform) => [platform.name, await platform.getSubscriptions()] as const),
      );

      const platformsOfuser = usersInPlatforms.reduce((acc, [platform, users]) => {
        return users.reduce<Record<string, string[]>>((userObject, user) => {
          if (!Array.isArray(userObject[user])) {
            return { ...userObject, [user]: [platform] };
          }

          userObject[user].push(platform);

          return userObject;
        }, acc);
      }, {});

      callback(platformsOfuser);
    });

    this.discord.events.on('serialize', () => {
      db.set((data) => ({ ...data, Discord: this.discord.serialize() }));
    });
  }

  private async handleRemoveStreamer(platformName: string, name: string, guildId: string) {
    if (platformName === 'all') {
      const platforms = this.platforms.filter((platform) => platform.isStreamerSubscribed(name, guildId));

      await Promise.all(platforms.map((platform) => platform.removeStreamerAlert(name, guildId)));

      return this.platforms.map((platform) => platform.name);
    }

    const platform = this.platforms.find((platform) => platform.name === platformName);

    if (!platform || !platform.isStreamerSubscribed(name, guildId)) return Promise.resolve([]);

    await platform.removeStreamerAlert(name, guildId);

    return [platform.name];
  }

  private async processNextQueue(override = false): Promise<any> {
    if (!override && this.isProcessing) return;

    if (!override) logger.info('started processing platforms');

    this.isProcessing = true;

    const [platform] = this.queue.splice(0, 1);

    if (!platform) {
      logger.info('finished processing platforms');

      this.isProcessing = false;
      this.discord.registerSlashCommands();

      return;
    }

    const tokens = platform.TOKEN_NAMES.reduce<Record<string, string | undefined>>((acc, token) => {
      return { ...acc, [token]: process.env[token] };
    }, {});

    const serialized = db.getSync()?.[platform.name] ?? {};

    platform.events.on('serialize', () => {
      db.set((data) => ({ ...data, [platform.name]: platform.serialize() }));
    });

    await platform.registerWebhooks(this.webhooks);
    await platform.init(tokens, serialized);

    logger.info(`initialized the ${platform.name} platform`);

    platform.events.on('online', (name: string) => {
      this.discord.events.emit('online', name, platform.name, platform.formatURL(name));
    });

    this.discord.addPlatformChoice(platform.name);
    this.platforms.push(platform);

    return this.processNextQueue(true);
  }

  addPlatform(platform: Platform) {
    this.queue.push(platform);
    this.processNextQueue();
  }

  removePlatform(platformOrName: Platform | string) {
    const name = typeof platformOrName === 'string' ? platformOrName : platformOrName.name;

    this.platforms = this.platforms.filter((platform) => platform.name !== name);
  }
}
