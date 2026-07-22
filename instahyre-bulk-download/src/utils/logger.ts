import path from 'node:path';
import winston from 'winston';
import fs from 'fs-extra';
import { projectRoot } from '../config/env.js';

const logsDir = path.join(projectRoot, 'logs');
fs.ensureDirSync(logsDir);

let loggerInstance: winston.Logger | null = null;

export function getLogger(level = 'info'): winston.Logger {
  if (loggerInstance) return loggerInstance;

  loggerInstance = winston.createLogger({
    level,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(({ timestamp, level: lvl, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} [${lvl.toUpperCase()}] ${message}${metaStr}`;
      }),
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
      }),
      new winston.transports.File({
        filename: path.join(logsDir, 'instahyre-automation.log'),
      }),
    ],
  });

  return loggerInstance;
}

export const logger = getLogger();
