import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'node:path';

const filepath = path.join(__dirname, '..', '..', 'data', 'db.json');

export interface Database {
  set: (callback: (data: Record<string, string>) => Record<string, string>) => Promise<void>;
  get: () => Promise<Record<string, any>>;
}

if (!fsSync.existsSync(filepath)) {
  const dirpath = path.dirname(filepath);

  fs.mkdir(dirpath, { recursive: true });
  fs.writeFile(filepath, '{}', 'utf-8');
}

export const set: Database['set'] = async (callback) => {
  const existingData = JSON.parse(await fs.readFile(filepath, 'utf-8'));

  const newData = callback(existingData);

  fs.writeFile(filepath, JSON.stringify(newData, null, 4), 'utf-8');
};

export const get: Database['get'] = async () => JSON.parse(await fs.readFile(filepath, 'utf-8'));

export default {
  set,
  get,
};
