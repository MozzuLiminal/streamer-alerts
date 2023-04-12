import { Express } from 'express';
import TypedEventEmitter from 'typed-emitter';

export type PlatformEvents = TypedEventEmitter<{
  online: (name: string) => void;
}>;

export interface Platform {
  name: string;
  description: string;
  TOKEN_NAMES: string[];
  events: PlatformEvents;
  registerWebhooks: (express: Express) => void;
  init: (tokens: Record<string, string | undefined>) => Promise<void>;
  addStreamerAlert: (name: string) => Promise<boolean>;
  removeStreamerAlert: (name: string) => Promise<boolean>;
  isStreamerSubscribed: (name: string) => Promise<boolean>;
  formatURL: (username: string) => string;
  close: () => void;
  getSubscriptions: () => Promise<string[]>;
}
