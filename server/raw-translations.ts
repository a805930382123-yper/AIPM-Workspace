import type { Express } from 'express';
import type { RawTranslationService } from '../services/raw/translations.ts';

export function registerRawTranslationRoutes(app: Express, translations: RawTranslationService): void {
  app.get('/api/raw/:id/translation', async (req, res, next) => {
    try { res.json({ translation: await translations.get(req.params.id) }); }
    catch (error) { next(error); }
  });
  app.post('/api/raw/:id/translation/retry', async (req, res, next) => {
    try { res.json({ translation: await translations.start(req.params.id, true) }); }
    catch (error) { next(error); }
  });
  app.post('/api/raw/:id/translation/cancel', async (req, res, next) => {
    try { res.json({ translation: await translations.cancel(req.params.id) }); }
    catch (error) { next(error); }
  });
}
