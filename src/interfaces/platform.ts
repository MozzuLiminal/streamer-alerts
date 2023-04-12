import { Express } from 'express';
import TypedEventEmitter from 'typed-emitter';
import { Database } from '../services/db';

export type PlatformEvents = TypedEventEmitter<{
  online: (name: string) => void;
}>;

export interface Platform {
  name: string;
  description: string;
  TOKEN_NAMES: string[];
  events: PlatformEvents;
  registerWebhooks: (express: Express) => void;
  init: (tokens: Record<string, string | undefined>, database: Database) => Promise<void>;
  addStreamerAlert: (name: string) => Promise<boolean>;
  removeStreamerAlert: (name: string) => boolean;
  isStreamerSubscribed: (name: string) => boolean;
  formatURL: (username: string) => string;
  close: () => void;
}
