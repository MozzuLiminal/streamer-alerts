import dotenv from 'dotenv';
import express from 'express';
import { Twitch } from './platforms/twitch';
import db from './services/db';

const app = express();

dotenv.config();

const twitch = new Twitch();

const tokens = twitch.TOKEN_NAMES.reduce<Record<string, string | undefined>>((acc, token) => {
  return { ...acc, [token]: process.env[token] };
}, {});

twitch.init(tokens, db).then(() => console.log('twitch has inited'));
twitch.registerWebhooks(app);

app.get('/', (req, res) => {
  res.send('ok');
});

app.listen(3000, () => {
  console.log('express is listening to 3000');
});
