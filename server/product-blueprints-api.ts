import type { Express } from 'express';
import { exportBlueprint } from '../services/product-blueprints/export.ts';
import type { ProductBlueprintStore } from '../services/product-blueprints/store.ts';
export function registerProductBlueprintRoutes(app: Express, store: ProductBlueprintStore) {
  app.get('/api/product-blueprints', async (_req, res) => res.json(await store.list()));
  app.post('/api/product-blueprints', async (req, res) => res.status(201).json(await store.create(req.body)));
  app.get('/api/product-blueprints/sources', async (_req, res) => res.json(await store.candidates()));
  app.get('/api/product-blueprints/:id/export', async (req, res) =>
    res
      .type('text/markdown')
      .set('Content-Disposition', 'attachment; filename="product-blueprint.md"')
      .send(exportBlueprint(await store.get(req.params.id))),
  );
  app.get('/api/product-blueprints/:id', async (req, res) => res.json(await store.get(req.params.id)));
  app.put('/api/product-blueprints/:id', async (req, res) => res.json(await store.update(req.params.id, req.body)));
  app.delete('/api/product-blueprints/:id', async (req, res) => {
    await store.delete(req.params.id, req.body?.baseRevision);
    res.json({ deleted: true });
  });
}
