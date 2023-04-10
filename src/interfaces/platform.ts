import { SlashCommandBuilder } from 'discord.js';
import { Express } from 'express';
import { Database } from '../services/db';

export interface Platform {
  name: string;
  description: string;
  TOKEN_NAMES: string[];
  commands: () => SlashCommandBuilder[];
  registerWebhooks: (express: Express) => void;
  init: (tokens: Record<string, string | undefined>, database: Database) => Promise<void>;
}
