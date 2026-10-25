import pino from 'pino';
import type { NextFunction, Request, Response } from 'express';
import { httpRequestDuration } from '../observability/metrics';

const QUIET_PATHS = new Set(['/health/live', '/health/ready', '/metrics']);
const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    const path = req.originalUrl.split('?')[0] ?? req.originalUrl;
    const route = (req.route as { path?: string } | undefined)?.path ?? 'unmatched';
    httpRequestDuration.observe({ method: req.method, route, status_code: String(res.statusCode) }, elapsedSeconds);
    if (QUIET_PATHS.has(path)) return;
    logger.info(
      {
        context: 'HttpRequest',
        correlationId: res.getHeader('x-correlation-id'),
        method: req.method,
        path,
        statusCode: res.statusCode,
        durationMs: Math.round(elapsedSeconds * 1000)
      },
      'request completed'
    );
  });
  next();
}
