import os from 'node:os';
import path from 'node:path';
import winston from 'winston';
import { projectRoot } from '../config/env.js';
import { resolveWritableDir } from './writableDir.js';

// Packaged installs may sit in Program Files / /Applications, where the app
// directory is not writable. Fall back to the user's PerfectVentures folder.
const logsDir = resolveWritableDir(
  path.join(projectRoot, 'logs'),
  path.join(os.homedir(), 'PerfectVentures', 'logs'),
);

const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
  }),
);

function createLogger(level = 'info'): winston.Logger {
  return winston.createLogger({
    level,
    format: logFormat,
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          logFormat,
        ),
      }),
      new winston.transports.File({
        filename: path.join(logsDir, 'naukri-automation.log'),
        maxsize: 5 * 1024 * 1024,
        maxFiles: 5,
      }),
      new winston.transports.File({
        filename: path.join(logsDir, 'error.log'),
        level: 'error',
        maxsize: 5 * 1024 * 1024,
        maxFiles: 3,
      }),
    ],
  });
}

let loggerInstance: winston.Logger | null = null;

export function getLogger(level?: string): winston.Logger {
  if (!loggerInstance) {
    loggerInstance = createLogger(level ?? process.env.LOG_LEVEL ?? 'info');
  } else if (level) {
    loggerInstance.level = level;
  }
  return loggerInstance;
}

export const logger = getLogger();
