import dayjs from 'dayjs';
import { Express } from 'express';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { Platform, PlatformEvents } from '../interfaces/platform';
import { Subscription } from '../interfaces/twitch';
import { createLogger } from '../services/log';

const logger = createLogger('twitch');

enum DatabaseKeys {
  USER_ACCESS_TOKEN = 'USER_ACCESS_TOKEN',
  USER_ACCESS_TOKEN_EXPIRE = 'USER_ACCESS_TOKEN_EXPIRE',
  USER_ACCESS_REFRESH_TOKEN = 'USER_ACCESS_REFRESH_TOKEN',
  GUILD_SUBSCRIPTIONS = 'GUILD_SUBSCRIPTIONS',
}

enum Tokens {
  SECRET = 'TWITCH_SECRET',
  CLIENT_ID = 'TWITCH_CLIENT_ID',
}

enum Events {
  USER_ACCESS_CODE = 'USER_ACCESS_TOKEN',
}

let state = '';

// TODO make sure to refresh token when actually using it. Currently only does it on startup

export class Twitch implements Platform {
  name: string;
  description: string;
  TOKEN_NAMES = [Tokens.SECRET, Tokens.CLIENT_ID];
  events = new EventEmitter() as PlatformEvents;
  private secret = '';
  private client_id = '';
  private user_access_token = '';
  private twitchEvents = new EventEmitter();
  private user_access_refresh_token = '';
  private user_access_expire = '';
  private socket_session_id = '';
  private socket?: WebSocket;
  private idToUsername: Record<string, string> = {};
  private HOST = process.env.HOST || 'http://localhost';
  private subscriptionsByGuildId = new Map<string, string[]>();

  constructor() {
    this.name = 'Twitch';
    this.description = 'Twitch API';
  }

  registerWebhooks(app: Express) {
    logger.info('Registered /twitch webhook');

    app.get('/twitch', (req, res) => {
      if (req.query.state !== state) {
        return res.sendStatus(401);
      }

      this.twitchEvents.emit(Events.USER_ACCESS_CODE, req.query.code);

      res.send('You have been authorized, you can close this tab');
    });
  }

  private async deleteAllSubscriptions() {
    const subscriptions = await this.getTwitchSubscriptions();

    return Promise.all(
      subscriptions.map((subscription) => {
        return this.deleteSubscription(subscription.id);
      }),
    );
  }

  private createRefreshTimeout = (diff: number) => {
    logger.info(`refreshing token in timeout ${Math.round(diff / 60)} minutes`);

    setTimeout(() => {
      logger.info('refreshing token in timeout');

      this.refreshToken(this.user_access_refresh_token);
    }, diff * 1000);
  };

  private refreshToken(refreshToken: string) {
    const endpoint = new URL('https://id.twitch.tv/oauth2/token');

    endpoint.searchParams.append('client_id', this.client_id);
    endpoint.searchParams.append('client_secret', this.secret);
    endpoint.searchParams.append('grant_type', 'refresh_token');
    endpoint.searchParams.append('refresh_token', refreshToken);

    logger.info('POST https://id.twitch.tv/oauth2/token');

    return fetch(endpoint, {
      method: 'POST',
    })
      .then((r) => r.json())
      .then((response) => {
        this.user_access_token = response.access_token;
        this.user_access_refresh_token = response.refresh_token;

        const refreshDiff = dayjs().add(response.expires_in, 'seconds').diff(dayjs(), 'seconds');

        this.createRefreshTimeout(refreshDiff);

        this.events.emit('serialize');
      });
  }

  private async parseAndManageTokens() {
    const refresh_token = this.user_access_refresh_token;
    const access_token = this.user_access_token;
    const expire = this.user_access_expire;

    const refreshDiff = expire ? dayjs(expire).diff(dayjs(), 'seconds') : null;

    if (refreshDiff && refreshDiff <= 0) {
      logger.info(`refreshing token access expire diff is ${refreshDiff}`);
      await this.refreshToken(refresh_token);
    } else {
      this.user_access_refresh_token = refresh_token;
      this.user_access_token = access_token;

      if (refreshDiff !== null) this.createRefreshTimeout(refreshDiff - 1000);
    }
  }

  async init(tokens: Record<string, string | undefined>, serialized: Record<string, any>) {
    if (!tokens[Tokens.CLIENT_ID] || !tokens[Tokens.SECRET]) {
      return void logger.error(`missing the ${Tokens.CLIENT_ID} or the ${Tokens.SECRET} token in the env`);
    }

    this.user_access_expire = serialized[DatabaseKeys.USER_ACCESS_TOKEN_EXPIRE];
    this.user_access_token = serialized[DatabaseKeys.USER_ACCESS_TOKEN];
    this.user_access_refresh_token = serialized[DatabaseKeys.USER_ACCESS_REFRESH_TOKEN];

    this.subscriptionsByGuildId = new Map(serialized[DatabaseKeys.GUILD_SUBSCRIPTIONS]);

    this.client_id = tokens[Tokens.CLIENT_ID];
    this.secret = tokens[Tokens.SECRET];

    await this.parseAndManageTokens();
    await this.deleteAllSubscriptions();

    if (!this.user_access_token) {
      await this.oauthClient();
    }
  }

  private getUserId(name: string) {
    const endpoint = new URL('https://api.twitch.tv/helix/users');

    endpoint.searchParams.append('login', name);

    logger.info('GET https://api.twitch.tv/helix/users');

    return fetch(endpoint, {
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': this.client_id,
        Authorization: `Bearer ${this.user_access_token}`,
      },
    })
      .then((res) => res.json())
      .then(({ data }) => data[0].id);
  }

  private deleteSubscription(id: string) {
    const endpoint = new URL('https://api.twitch.tv/helix/eventsub/subscriptions');

    endpoint.searchParams.append('id', id);

    logger.info('DELETE https://api.twitch.tv/helix/eventsub/subscriptions');

    return fetch(endpoint, {
      method: 'DELETE',
      headers: {
        'Client-Id': this.client_id,
        Authorization: `Bearer ${this.user_access_token}`,
      },
    }).then((response) => {
      if (!response.ok) {
        response.text().then((text) => {
          logger.error(`delete subscription failed with response: (${response.status}) ${text}`);
        });
      }
    });
  }

  private async getTwitchSubscriptions(): Promise<Subscription[]> {
    const endpoint = new URL('https://api.twitch.tv/helix/eventsub/subscriptions');

    logger.info('GET https://api.twitch.tv/helix/eventsub/subscriptions');

    return fetch(endpoint, {
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': this.client_id,
        Authorization: `Bearer ${this.user_access_token}`,
      },
    })
      .then((response) => {
        if (!response.ok) {
          return response.text().then((text) => {
            logger.error(`fetch subscriptions failed with response: (${response.status}) ${text}`);
          });
        }

        return response.json();
      })
      .then((response) => response?.data ?? []);
  }

  private userHasSubscription(subscriptions: Subscription[], userId: string, event: string) {
    return subscriptions.some((subscription) => {
      return subscription.type === event && subscription.condition.broadcaster_user_id === userId;
    });
  }

  private userHasGuildSubscription(
    subscriptions: Subscription[],
    guildSubscriptions: string[],
    userId: string,
    event: string,
  ) {
    return subscriptions.some((subscription) => {
      if (subscription.type === event && subscription.condition.broadcaster_user_id === userId) {
        return guildSubscriptions.includes(subscription.id);
      }
    });
  }

  private async subscribe(username: string, event: string, guildId: string): ReturnType<Platform['addStreamerAlert']> {
    const userId = await this.getUserId(username);
    const subscriptions = await this.getTwitchSubscriptions();
    const endpoint = new URL('https://api.twitch.tv/helix/eventsub/subscriptions');

    const returnStatus: Awaited<ReturnType<Platform['addStreamerAlert']>> = { result: 'ADDED' };

    this.idToUsername[userId] = username;

    if (!this.socket_session_id) {
      await this.websocket();
    }

    const subscriptionsByGuild = this.subscriptionsByGuildId.get(guildId) ?? [];

    // TODO we get {"error":"Conflict","status":409,"message":"subscription already exists"} if we subscribe to the same person on two different servers.
    // Need to catch this and relay the event to all servers who subscribe to the same person

    if (this.userHasGuildSubscription(subscriptions, subscriptionsByGuild, userId, event)) {
      logger.info(`user ${username} already has subscription ${event}, ignoring...`);
      return { result: 'EXISTS' };
    }

    logger.info('POST https://api.twitch.tv/helix/eventsub/subscriptions');

    await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': this.client_id,
        Authorization: `Bearer ${this.user_access_token}`,
      },
      body: JSON.stringify({
        type: 'stream.online',
        version: '1',
        condition: { broadcaster_user_id: userId },
        transport: { method: 'websocket', session_id: this.socket_session_id },
      }),
    })
      .then((response) => {
        if (!response.ok) {
          response.text().then((text) => {
            logger.error(`create subscription failed with response: (${response.status}) ${text}`);
          });

          returnStatus.result = 'FAILED';
        }
        return response.json();
      })
      .then((body) => {
        const existing = this.subscriptionsByGuildId.get(guildId) ?? [];

        this.subscriptionsByGuildId.set(guildId, [...existing, body.data[0].id]);
        this.events.emit('serialize');

        console.log('we did create the subscription', username, event);
      })
      .catch(() => {
        returnStatus.result = 'FAILED';
      });

    logger.info(`added ${event} event subscription for the user ${username} - ${userId}`);

    return returnStatus;
  }

  private oauthClient() {
    const endpoint = new URL('https://id.twitch.tv/oauth2/authorize');

    state = Math.random().toString(36).slice(2, 8);

    endpoint.searchParams.append('client_id', this.client_id);
    endpoint.searchParams.append('redirect_uri', this.HOST + '/twitch');
    endpoint.searchParams.append('response_type', 'code');
    endpoint.searchParams.append('state', state);

    console.log('To authenticate yourself for the Twitch API, please login using the following url:');
    console.log(endpoint.toString());

    return new Promise<void>((resolve) =>
      this.twitchEvents.once(Events.USER_ACCESS_CODE, (code: string) => {
        const endpoint = new URL('https://id.twitch.tv/oauth2/token');

        endpoint.searchParams.append('client_id', this.client_id);
        endpoint.searchParams.append('client_secret', this.secret);
        endpoint.searchParams.append('code', code);
        endpoint.searchParams.append('grant_type', 'authorization_code');
        endpoint.searchParams.append('redirect_uri', 'http://localhost:3000/twitch');

        fetch(endpoint, { method: 'POST' })
          .then((response) => {
            if (!response.ok) {
              response.text().then((text) => {
                logger.error(`client OAuth failed: (${response.status}) ${text}`);
              });
            }

            return response.json();
          })
          .then((response) => {
            this.user_access_token = response.access_token;
            this.user_access_refresh_token = response.refresh_token;
            this.user_access_expire = dayjs().add(response.expires_in, 'seconds').toISOString();

            this.events.emit('serialize');

            resolve();
          });
      }),
    );
  }

  private websocket() {
    return new Promise<void>((resolve) => {
      logger.info('WSS wss://eventsub-beta.wss.twitch.tv/ws');

      const socket = new WebSocket('wss://eventsub-beta.wss.twitch.tv/ws');

      socket.on('message', (message) => {
        const data = JSON.parse(message.toString());
        const event = data.metadata.message_type;
        const type = data.metadata.subscription_type;

        if (event === 'session_keepalive') return;

        if (event === 'session_welcome') {
          this.socket_session_id = data.payload.session.id;
          logger.info('socket welcome message received');

          return resolve();
        }

        logger.info(`socket received event ${type} with message type ${event}.`);

        if (type === 'stream.online') {
          this.events.emit('online', data.payload.event.broadcaster_user_name);
        }
      });

      socket.once('close', async () => {
        logger.info('socket has disconnected');

        if (this.socket_session_id) {
          const subscriptions = await this.getTwitchSubscriptions();

          subscriptions.forEach((subscription) => {
            if (subscription.transport.session_id === this.socket_session_id) {
              logger.info(
                `deleting dead or disconnected subscription with for userId ${subscription.condition.broadcaster_user_id} for the event ${subscription.type}`,
              );
              this.deleteSubscription(subscription.id);
            }
          });

          this.socket_session_id = '';
        }
      });

      this.socket = socket;
    });
  }

  async getSubscriptions() {
    const subscriptions = await this.getTwitchSubscriptions();

    return subscriptions
      .map((subscription) => this.idToUsername[subscription.condition.broadcaster_user_id])
      .filter(Boolean);
  }

  addStreamerAlert(name: string, guildId: string) {
    return this.subscribe(name, 'stream.online', guildId);
  }

  async removeStreamerAlert(name: string, guildId: string) {
    const subscriptions = await this.getTwitchSubscriptions();

    const existing = this.subscriptionsByGuildId.get(guildId) ?? [];

    // this.subscriptionsByGuildId.set(guildId, [...existing, body.data[0].id]);
    // this.events.emit('serialize');

    const match = subscriptions.find((subscription) => {
      return this.idToUsername[subscription.condition.broadcaster_user_id] === name;
    });

    if (match) {
      const isGuildSub = this.userHasGuildSubscription(
        subscriptions,
        existing,
        match.condition.broadcaster_user_id,
        'stream.online',
      );

      if (isGuildSub) {
        logger.info(`removing ${match?.type} event subscription for the user ${name}`);

        await this.deleteSubscription(match.id);

        return true;
      } else {
        logger.info(`found matching subscription for the user ${name}, but it belongs in a different server`);
      }

      return false;
    }

    return true;
  }

  serialize() {
    const serialized: Record<string, any> = {};

    serialized[DatabaseKeys.USER_ACCESS_REFRESH_TOKEN] = this.user_access_refresh_token;
    serialized[DatabaseKeys.USER_ACCESS_TOKEN] = this.user_access_token;
    serialized[DatabaseKeys.USER_ACCESS_TOKEN_EXPIRE] = this.user_access_expire;

    const subscriptions: Record<string, string[]> = {};

    this.subscriptionsByGuildId.forEach((value, key) => {
      subscriptions[key] = value;
    });

    serialized[DatabaseKeys.GUILD_SUBSCRIPTIONS] = Object.entries(subscriptions);

    return serialized;
  }

  async isStreamerSubscribed(name: string, guilId: string) {
    return (await this.getSubscriptions()).includes(name);
  }

  formatURL(username: string) {
    return `https://www.twitch.tv/${username}`;
  }

  close() {
    this.socket?.close();
  }
}
