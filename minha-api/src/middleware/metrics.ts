/**
 * Request ID + Observability Middleware
 */

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import client from 'prom-client';

type RequestWithId = Request & { requestId?: string };

const register = new client.Registry();

client.collectDefaultMetrics({ register });

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

export const scrapingJobsTotal = new client.Counter({
  name: 'scraping_jobs_total',
  help: 'Total number of scraping jobs',
  labelNames: ['tribunal', 'status'],
  registers: [register],
});

export const scrapingDuration = new client.Histogram({
  name: 'scraping_duration_seconds',
  help: 'Duration of scraping operations in seconds',
  labelNames: ['tribunal'],
  buckets: [1, 5, 10, 30, 60, 120],
  registers: [register],
});

export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();
  const requestWithId = req as RequestWithId;
  requestWithId.requestId = requestId;
  next();
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path || 'unknown';
    const labels = {
      method: req.method,
      route,
      status_code: res.statusCode.toString(),
    };

    httpRequestDuration.observe(labels, duration);
    httpRequestsTotal.inc(labels);
  });

  next();
}

export { register };
