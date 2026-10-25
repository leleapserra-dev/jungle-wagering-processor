import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { LoggerModule } from 'nestjs-pino';

function correlationIdOf(req: IncomingMessage): string {
  const header = req.headers['x-correlation-id'];
  return typeof header === 'string' && header.length > 0 ? header : randomUUID();
}

export const AppLoggerModule = LoggerModule.forRoot({
  pinoHttp: {
    level: process.env['LOG_LEVEL'] ?? 'info',
    genReqId: correlationIdOf,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    autoLogging: false
  }
});
