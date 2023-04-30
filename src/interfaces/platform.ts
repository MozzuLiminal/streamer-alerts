import { Express } from 'express';
import TypedEventEmitter from 'typed-emitter';

export type PlatformEvents = TypedEventEmitter<{
  online: (name: string) => void;
  serialize: () => void;
}>;

export interface Platform {
  name: string;
  description: string;
  TOKEN_NAMES: string[];
  events: PlatformEvents;
  registerWebhooks: (express: Express) => void;
  init: (
    tokens: Record<string, string | undefined>,
    serialized: Awaited<ReturnType<Platform['serialize']>>,
  ) => Promise<void>;
  addStreamerAlert: (name: string, guildId: string) => Promise<{ result: 'EXISTS' | 'ADDED' | 'FAILED' }>;
  removeStreamerAlert: (name: string, guildId: string) => Promise<boolean>;
  isStreamerSubscribed: (name: string, guildId: string) => Promise<boolean>;
  formatURL: (username: string) => string;
  close: () => void;
  getSubscriptions: () => Promise<string[]>;
  serialize: () => Record<string, any>;
}
