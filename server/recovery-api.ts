import type express from 'express';
import type { RecoveryRegistry } from '../services/storage/recovery.ts';
export function registerRecoveryRoutes(app: express.Express, registry: RecoveryRegistry) {
  app.get('/api/recovery-issues', async (_req, res, next) => {
    try {
      res.json(await registry.scan());
    } catch (e) {
      next(e);
    }
  });
}
