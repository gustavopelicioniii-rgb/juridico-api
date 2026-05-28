import { NextFunction, Request, Response } from 'express';
import ApiUsage from '../models/ApiUsage';
import logger from '../config/logger';

const EXCLUDED_PREFIXES = ['/health', '/metrics'];

const getRequestId = (req: Request): string | undefined => {
  const withRequestId = req as Request & { requestId?: string };
  return withRequestId.requestId;
};

const shouldAudit = (req: Request): boolean => {
  const fullPath = `${req.baseUrl}${req.path}`;
  if (!fullPath.startsWith('/api/v1')) return false;
  return !EXCLUDED_PREFIXES.some(prefix => fullPath.startsWith(prefix));
};

export function usageAuditMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!shouldAudit(req)) {
    next();
    return;
  }

  const fullPath = `${req.baseUrl}${req.path}`;
  const startedAt = Date.now();
  res.on('finish', () => {
    const tribunalCodigo = typeof req.params?.codigo === 'string'
      ? req.params.codigo.toUpperCase()
      : undefined;

    void ApiUsage.create({
      advogadoId: req.user?.advogadoId || req.user?.userId,
      actorRole: req.user?.role,
      endpoint: fullPath,
      metodo: req.method,
      statusCode: res.statusCode,
      tribunalCodigo,
      latencyMs: Date.now() - startedAt,
      cacheHit: res.locals?.cacheHit === true ? true : (res.locals?.cacheHit === false ? false : undefined),
      resultStatus: typeof res.locals?.resultStatus === 'string' ? res.locals.resultStatus : undefined,
      requestId: getRequestId(req),
    }).catch((error) => {
      logger.warn('Falha ao registrar auditoria de uso', {
        endpoint: fullPath,
        method: req.method,
        error: (error as Error).message,
      });
    });
  });

  next();
}
