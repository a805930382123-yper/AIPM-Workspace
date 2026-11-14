import type { Express } from 'express';
import type { PdfPageService } from '../services/raw/pdf-pages.ts';
import type { PdfCleanupService } from '../services/raw/pdf-cleanup.ts';
import type { WikiStore } from '../services/wiki/store.ts';
import { InputError } from './validation.ts';

const pageNumber = (value: string) => /^[1-9]\d*$/u.test(value) ? Number(value) : NaN;

export function registerRawPdfRoutes(app: Express, pdf: PdfPageService, cleanup?: PdfCleanupService, wiki?: Pick<WikiStore, 'withLock'>): void {
  app.get('/api/raw/:id/pdf', async (req, res, next) => {
    try { res.json(await pdf.get(req.params.id)); } catch (error) { next(error); }
  });
  app.get('/api/raw/:id/pdf/original', async (req, res, next) => {
    try {
      const bytes = await pdf.original(req.params.id);
      res.type('application/pdf').set({ 'Content-Disposition': 'inline; filename="original.pdf"', 'X-Content-Type-Options': 'nosniff' }).send(bytes);
    } catch (error) { next(error); }
  });
  app.get('/api/raw/:id/pdf/pages/:page', async (req, res, next) => {
    try { res.json(await pdf.page(req.params.id, pageNumber(req.params.page))); } catch (error) { next(error); }
  });
  app.get('/api/raw/:id/pdf/pages/:page/image', async (req, res, next) => {
    try { res.type('png').send(await pdf.image(req.params.id, pageNumber(req.params.page))); } catch (error) { next(error); }
  });
  app.post('/api/raw/:id/pdf/understand', async (req, res, next) => {
    try {
      const start = () => pdf.start(req.params.id);
      const view = await (wiki ? wiki.withLock(start) : start());
      res.status(view.job?.status === 'queued' || view.job?.status === 'running' ? 202 : 200).json(view);
    } catch (error) { next(error); }
  });
  app.post('/api/raw/:id/pdf/cancel', async (req, res, next) => {
    try { res.json(await pdf.cancel(req.params.id)); } catch (error) { next(error); }
  });
  if (!cleanup) return;
  const range = (body: unknown) => {
    const { startPage, endPage } = (body ?? {}) as Record<string, unknown>;
    if (typeof startPage !== 'number' || typeof endPage !== 'number'
      || !Number.isSafeInteger(startPage) || !Number.isSafeInteger(endPage) || startPage < 1 || endPage < startPage) {
      throw new InputError('PDF_RANGE_INVALID', '请选择有效的 PDF 起始页和结束页。', 400);
    }
    return { startPage, endPage };
  };
  app.get('/api/raw/:id/pdf/cleanup', async (req, res, next) => {
    try { res.json(await cleanup.get(req.params.id)); } catch (error) { next(error); }
  });
  app.post('/api/raw/:id/pdf/cleanup', async (req, res, next) => {
    try {
      const input = range(req.body);
      const start = () => cleanup.start(req.params.id, input);
      const result = await (wiki ? wiki.withLock(start) : start());
      res.status(result.job?.status === 'queued' || result.job?.status === 'running' ? 202 : 200).json(result);
    } catch (error) { next(error); }
  });
  app.post('/api/raw/:id/pdf/cleanup/cancel', async (req, res, next) => {
    try { res.json(await cleanup.cancel(req.params.id)); } catch (error) { next(error); }
  });
  app.post('/api/raw/:id/pdf/cleanup/draft', async (req, res, next) => {
    try { res.json(await cleanup.draft(req.params.id, range(req.body))); } catch (error) { next(error); }
  });
}
