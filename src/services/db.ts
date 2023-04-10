import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'node:path';

const filepath = path.join(__dirname, '..', '..', 'db.json');

export interface Database {
  set: (object: Record<string, any>) => Promise<void>;
  get: () => Promise<Record<string, any>>;
}

if (!fsSync.existsSync(filepath)) {
  fs.writeFile(filepath, '{}', 'utf-8');
}

export const set: Database['set'] = async (object) => {
  const existingData = JSON.parse(await fs.readFile(filepath, 'utf-8'));

  fs.writeFile(filepath, JSON.stringify({ ...existingData, ...object }, null, 4), 'utf-8');
};

export const get: Database['get'] = async () => JSON.parse(await fs.readFile(filepath, 'utf-8'));

export default {
  set,
  get,
};
