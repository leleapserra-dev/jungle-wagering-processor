import pino from 'pino';
import type { NextFunction, Request, Response } from 'express';

const QUIET_PATHS = new Set(['/health/live', '/health/ready', '/metrics']);
const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const path = req.originalUrl.split('?')[0] ?? req.originalUrl;
    if (QUIET_PATHS.has(path)) return;
    logger.info(
      {
        context: 'HttpRequest',
        correlationId: res.getHeader('x-correlation-id'),
        method: req.method,
        path,
        statusCode: res.statusCode,
        durationMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6)
      },
      'request completed'
    );
  });
  next();
}
