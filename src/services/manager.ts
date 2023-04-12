import { Express } from 'express';
import { Platform } from '../interfaces/platform';
import db from './db';
import { Discord } from './discord';

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

    this.discord.events.on('remove', (platformName, name, cb) => {
      if (platformName === 'all') {
        return cb(this.platforms.every((platform) => this.handleRemoveStreamer(platform.name, name)));
      }

      return cb(this.handleRemoveStreamer(platformName, name));
    });

    this.discord.events.on('add', (platformName, name, cb) => {
      const platform = this.platforms.find((platform) => platform.name === platformName);

      if (!platform) return cb(false);
      if (!platform.isStreamerSubscribed(name)) return cb(true);

      return platform.addStreamerAlert(name).then(cb);
    });
  }

  private handleRemoveStreamer(platformName: string, name: string) {
    const platform = this.platforms.find((platform) => platform.name === platformName);

    if (!platform) return false;
    if (!platform.isStreamerSubscribed(name)) return true;

    return platform.removeStreamerAlert(name);
  }

  private async processNextQueue(override = false): Promise<any> {
    if (!override && this.isProcessing) return;

    this.isProcessing = true;

    const [platform] = this.queue.splice(0, 1);

    console.log('start process', platform);

    if (!platform) {
      console.log('finished process');
      this.isProcessing = false;
      this.discord.registerSlashCommands();

      return;
    }

    const tokens = platform.TOKEN_NAMES.reduce<Record<string, string | undefined>>((acc, token) => {
      return { ...acc, [token]: process.env[token] };
    }, {});

    console.log('init');

    await platform.init(tokens, db);
    await platform.registerWebhooks(this.webhooks);

    console.log('after init');

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
