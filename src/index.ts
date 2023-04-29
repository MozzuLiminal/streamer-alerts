import dotenv from 'dotenv';
import express from 'express';
import { Twitch } from './platforms/twitch';
import { Discord } from './services/discord';
import { createLogger } from './services/log';
import { Manager } from './services/manager';

const logger = createLogger('index');

dotenv.config();

process.env.HOST = process.env.HOST || 'http://localhost';
process.env.PORT = process.env.PORT || '3000';

const PORT = parseInt(process.env.PORT);
const HOST = process.env.HOST.toString();

const main = async () => {
  const app = express();
  const discord = new Discord();
  const manager = new Manager(discord, app);

  manager.addPlatform(new Twitch());

  app.get('/', (req, res) => res.send('ok'));

  app.listen(PORT, HOST, () => {
    logger.info(`express started listening to  ${HOST}:${PORT}`);
  });
};

main();
