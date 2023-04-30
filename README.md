# streamer-alerts

This repository is a discord bot that utilizes a modular architechture to send alerts when a streamer goes online on multiple platforms.

## Setup

You need to add the following environment variables are required to start the application or be added to a .env file in the root of the repository

```
#used for Oauth
PORT=<port-number>
HOST=<domain-or-ip>

TWITCH_SECRET=<secret>
TWITCH_CLIENT_ID=<client-id>
DISCORD_TOKEN=<token>
DISCORD_APP_ID=<app-id>
```

## Authentication and Storage

The applications creates a `db.json` file store in the root of the repository. This file contains access tokens and other sensitive information.

## Twitch

You need to authenticate yourself to be able to listen to the twitch events. Once you start the application you will be prompted in the console or logs to authenticate. This application utilizes the websocket api which requires a client authentication instead of the normal application authentication.

## Docker Hub

The image can be found [here](https://hub.docker.com/repository/docker/mozzuliminal/streamer-alerts/general) on docker hub
