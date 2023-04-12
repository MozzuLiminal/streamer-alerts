import dotenv from 'dotenv';
import express from 'express';
import { Twitch } from './platforms/twitch';
import { Discord } from './services/discord';
import { createLogger } from './services/log';
import { Manager } from './services/manager';

const logger = createLogger('index');

dotenv.config();

const PORT = process.env.PORT || 3000;

const main = async () => {
  const app = express();
  const discord = new Discord();
  const manager = new Manager(discord, app);

  manager.addPlatform(new Twitch());

  app.listen(PORT, () => {
    logger.info(`express started listening to port ${PORT}`);
  });
};

main();
