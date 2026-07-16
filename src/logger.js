const pino = require('pino');

const isProd = process.env.NODE_ENV === 'production';

// Coolify/docker capture raw stdout, so pretty-printing only helps local dev;
// production keeps structured JSON lines (one log entry per line, machine-parseable).
const logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  transport: isProd ? undefined : {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
  },
});

module.exports = logger;
