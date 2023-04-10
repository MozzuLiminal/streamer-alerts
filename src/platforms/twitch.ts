import dayjs from 'dayjs';
import { Express } from 'express';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { Platform } from '../interfaces/platform';
import { Database } from '../services/db';

enum DatabaseKeys {
  USER_ACCESS_TOKEN = 'USER_ACCESS_TOKEN',
  USER_ACCESS_TOKEN_EXPIRE = 'USER_ACCESS_TOKEN_EXPIRE',
  USER_ACCESS_REFRESH_TOKEN = 'USER_ACCESS_REFRESH_TOKEN',
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
  private secret = '';
  private client_id = '';
  private user_access_token = '';
  private events = new EventEmitter();
  private user_access_refresh_token = '';
  private socket_session_id?: string;
  private db?: Database;

  constructor() {
    this.name = 'Twitch';
    this.description = 'Twitch API';
  }

  registerWebhooks(app: Express) {
    app.get('/twitch', (req, res) => {
      if (req.query.state !== state) {
        return res.sendStatus(401);
      }

      this.events.emit(Events.USER_ACCESS_CODE, req.query.code);

      res.send('You have been authorized, you can close this tab');
    });
  }

  private async deleteAllSubscriptions() {
    const subscriptions = await this.getSubscriptions();

    return Promise.all(
      subscriptions.map((subscription) => {
        return this.deleteSubscription(subscription.id);
      }),
    );
  }

  private createRefreshTimeout = (diff: number) => {
    setTimeout(() => this.refreshToken(this.user_access_refresh_token), diff * 1000);
  };

  private refreshToken(refreshToken: string) {
    const endpoint = new URL('https://id.twitch.tv/oauth2/token');

    endpoint.searchParams.append('client_id', this.client_id);
    endpoint.searchParams.append('client_secret', this.secret);
    endpoint.searchParams.append('grant_type', 'refresh_token');
    endpoint.searchParams.append('refresh_token', refreshToken);

    fetch(endpoint, {
      method: 'POST',
    })
      .then((r) => r.json())
      .then((r) => console.log('refresh', r));
  }

  private async parseAndManageTokens() {
    const database = (await this.db?.get()) ?? {};

    const refresh_token = database[DatabaseKeys.USER_ACCESS_REFRESH_TOKEN];
    const access_token = database[DatabaseKeys.USER_ACCESS_TOKEN];
    const expire = database[DatabaseKeys.USER_ACCESS_TOKEN_EXPIRE];

    const refreshDiff = expire ? dayjs(expire).diff(dayjs(), 'seconds') : null;

    if (refreshDiff && refreshDiff <= 0) {
      console.log('refreshing');
      await this.refreshToken(refresh_token);
    } else {
      this.user_access_refresh_token = refresh_token;
      this.user_access_token = access_token;

      if (refreshDiff !== null) this.createRefreshTimeout(refreshDiff - 1000);
    }
  }

  async init(tokens: Record<string, string | undefined>, db: Database) {
    if (!tokens[Tokens.CLIENT_ID] || !tokens[Tokens.SECRET]) return console.log('missing tokens');

    this.client_id = tokens[Tokens.CLIENT_ID];
    this.secret = tokens[Tokens.SECRET];

    this.db = db;

    await this.parseAndManageTokens();
    await this.deleteAllSubscriptions();

    if (!this.user_access_token) {
      await this.oauthClient();
    }

    await this.websocket();
    // await this.getSubscriptions().then(console.log);
  }

  private getUserId(name: string) {
    const endpoint = new URL('https://api.twitch.tv/helix/users');

    endpoint.searchParams.append('login', name);

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

    return fetch(endpoint, {
      method: 'DELETE',
      headers: {
        'Client-Id': this.client_id,
        Authorization: `Bearer ${this.user_access_token}`,
      },
    });
  }

  private async getSubscriptions() {
    const endpoint = new URL('https://api.twitch.tv/helix/eventsub/subscriptions');

    return fetch(endpoint, {
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': this.client_id,
        Authorization: `Bearer ${this.user_access_token}`,
      },
    })
      .then((r) => r.json())
      .then((response) => response.data as any[]);
  }

  private async subscribe(username: string, event: string, session_id: string) {
    const userId = await this.getUserId(username);
    const subscriptions = await this.getSubscriptions();
    const endpoint = new URL('https://api.twitch.tv/helix/eventsub/subscriptions');

    if (subscriptions.some((subscription: any) => subscription.type === event)) {
      return console.log(event, 'subscription already exists, ignoring');
    }

    fetch(endpoint, {
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
        transport: { method: 'websocket', session_id },
      }),
    });
  }

  private oauthClient() {
    const endpoint = new URL('https://id.twitch.tv/oauth2/authorize');

    state = Math.random().toString(36).slice(2, 8);

    endpoint.searchParams.append('client_id', this.client_id);
    endpoint.searchParams.append('redirect_uri', 'http://localhost:3000/twitch');
    endpoint.searchParams.append('response_type', 'code');
    endpoint.searchParams.append('state', state);

    console.log('navigate to:', endpoint.toString());

    return new Promise<void>((resolve) =>
      this.events.once(Events.USER_ACCESS_CODE, (code: string) => {
        const endpoint = new URL('https://id.twitch.tv/oauth2/token');

        endpoint.searchParams.append('client_id', this.client_id);
        endpoint.searchParams.append('client_secret', this.secret);
        endpoint.searchParams.append('code', code);
        endpoint.searchParams.append('grant_type', 'authorization_code');
        endpoint.searchParams.append('redirect_uri', 'http://localhost:3000/twitch');

        fetch(endpoint, { method: 'POST' })
          .then((r) => r.json())
          .then((response) => {
            this.user_access_token = response.access_token;
            this.user_access_refresh_token = response.refresh_token;

            this.db?.set({
              [DatabaseKeys.USER_ACCESS_TOKEN]: this.user_access_token,
              [DatabaseKeys.USER_ACCESS_REFRESH_TOKEN]: this.user_access_refresh_token,
              [DatabaseKeys.USER_ACCESS_TOKEN_EXPIRE]: dayjs().add(response.expires_in, 'seconds').toISOString(),
            });

            resolve();
          });
      }),
    );
  }

  private websocket(reconnectAttempts = 0) {
    if (reconnectAttempts >= 5) {
      console.log('Reached max reconnect attempts, exiting');
      process.exitCode = 1;

      return;
    }

    const socket = new WebSocket('wss://eventsub-beta.wss.twitch.tv/ws');

    socket.on('message', (message) => {
      const data = JSON.parse(message.toString());
      const event = data.metadata.message_type;

      if (event === 'session_keepalive') return;

      if (event === 'session_welcome') {
        this.socket_session_id = data.payload.session.id;

        this.subscribe('TappT', 'stream.online', data.payload.session.id);
      }

      console.log('socket message', data);
    });

    socket.once('close', async () => {
      console.log('socket closed');
      if (this.socket_session_id) {
        const subscriptions = await this.getSubscriptions();

        subscriptions.forEach((subscription) => {
          if (subscription.transport.session_id === this.socket_session_id) {
            console.log('found dead subscription');
            this.deleteSubscription(subscription.id);
          }
        });
      }

      this.websocket(reconnectAttempts + 1);
    });
  }

  commands() {
    return [];
  }
}
