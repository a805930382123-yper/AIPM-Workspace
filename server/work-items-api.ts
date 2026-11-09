import type { Express } from 'express';
import multer from 'multer';
import { StorageError } from '../services/storage/files.ts';
import type { WorkAnalysisRuns } from '../services/work-items/analysis-runs.ts';
import { MAX_WORK_SCREENSHOT_BYTES, type WorkItemStore } from '../services/work-items/store.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_WORK_SCREENSHOT_BYTES + 1, files: 1, fields: 2, fieldSize: 4_000 },
}).single('file');

export function registerWorkItemRoutes(app: Express, store: WorkItemStore, analysis: WorkAnalysisRuns) {
  app.get('/api/work-items', async (req, res) => {
    res.json({ items: await store.list(req.query.due === '1') });
  });
  app.post('/api/work-items', async (req, res) => {
    res.status(201).json(await store.create(req.body));
  });
  app.get('/api/work-items/:id', async (req, res) => {
    res.json(await store.get(req.params.id));
  });
  app.delete('/api/work-items/:id', async (req, res) => {
    await store.delete(req.params.id, req.body?.baseRevision, () => analysis.isRunning(req.params.id));
    res.json({ deleted: true });
  });
  app.put('/api/work-items/:id', async (req, res) => {
    res.json(await store.update(req.params.id, req.body));
  });
  app.get('/api/work-items/:id/analysis-runs', async (req, res) => {
    res.json({ items: await analysis.list(req.params.id) });
  });
  app.post('/api/work-items/:id/analysis-runs', async (req, res) => {
    res.status(201).json(await analysis.start(req.params.id, req.body));
  });
  app.post('/api/work-items/:id/analysis-runs/:runId/basis-review', async (req, res) => {
    res.json(await analysis.basisReviews.start(req.params.id, req.params.runId, req.body));
  });
  app.post('/api/work-items/:id/screenshots', (req, res, next) => {
    upload(req, res, error => {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return next(new StorageError('WORK_SCREENSHOT_TOO_LARGE', '截图不能超过 5 MiB。', 413));
      }
      next(error);
    });
  }, async (req, res) => {
    if (!req.file) throw new StorageError('INVALID_WORK_SCREENSHOT', '请选择一张 PNG 或 JPEG 截图。', 400);
    const revision = req.body.baseRevision;
    const baseRevision = typeof revision === 'string' && /^\d+$/.test(revision) ? Number(revision) : NaN;
    res.status(201).json(await store.addScreenshot(req.params.id, baseRevision, req.body.note, req.file.mimetype, req.file.buffer));
  });
  app.get('/api/work-items/:id/screenshots/:screenshotId', async (req, res) => {
    const { type, bytes } = await store.getScreenshot(req.params.id, req.params.screenshotId);
    res.set({ 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }).send(bytes);
  });
}
