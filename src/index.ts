import dotenv from 'dotenv';
import express from 'express';
import { Twitch } from './platforms/twitch';
import { Discord } from './services/discord';
import { Manager } from './services/manager';
dotenv.config();

const main = async () => {
  const app = express();
  const discord = new Discord();
  const manager = new Manager(discord, app);

  manager.addPlatform(new Twitch());

  app.listen(3000, () => {
    console.log('express is listening to 3000');
  });
};

main();

// client.login(process.env.DISCORD_TOKEN);
