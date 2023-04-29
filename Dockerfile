FROM node:18

WORKDIR /app

COPY package*.json ./
COPY src src/

COPY tsconfig.json .

RUN npm install
RUN npm run build

COPY dist dist/

CMD ["npm", "run", "start"]