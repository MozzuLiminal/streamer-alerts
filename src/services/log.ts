import path from 'path';
import winston from 'winston';
import { Console, File } from 'winston/lib/winston/transports';

const print = winston.format.printf(({ level, message, timestamp, label = '' }) => {
  label = label ? ` [${label}]` : label;

  return `${timestamp} - ${level}:${label} ${message}`;
});

const transports = [new Console(), new File({ filename: path.join('data', 'logs.log') })];

const logger = winston.createLogger({
  transports,
  format: winston.format.combine(winston.format.timestamp(), winston.format.label(), print),
});

export const createLogger = (label: string) => {
  return winston.createLogger({
    transports,
    format: winston.format.combine(winston.format.timestamp(), winston.format.label({ label }), print),
  });
};

export default logger;
