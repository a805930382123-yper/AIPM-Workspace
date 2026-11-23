import type { Express } from 'express';
import type { LlmProvider } from '../services/llm/provider.ts';
import { assertRawNotMeeting } from '../services/meeting/source-policy.ts';
import { publicMediaArtifact, type MediaVlmParserService } from '../services/raw/media-vlm.ts';
import type { RawStore } from '../services/raw/store.ts';
import { InputError } from './validation.ts';
import { mediaForEvidence } from '../services/raw/media-context.ts';

const mediaIdPattern = /^[a-f0-9]{64}$/u;

export function registerRawMediaRoutes(
  app: Express,
  store: RawStore,
  service: MediaVlmParserService,
  provider: () => LlmProvider | undefined,
) {
  app.get('/api/raw/:rawId/media', async (req, res, next) => {
    try {
      const raw = await store.get(req.params.rawId);
      if (!raw) throw new InputError('RAW_NOT_FOUND', '没有找到这条原始资料。', 404);
      assertRawNotMeeting(raw);
      res.json({ items: (await store.getMediaArtifacts(raw.id)).map(publicMediaArtifact) });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/raw/:rawId/media/:mediaId', async (req, res, next) => {
    try {
      const raw = await store.get(req.params.rawId);
      if (!raw) throw new InputError('RAW_NOT_FOUND', '没有找到这条原始资料。', 404);
      assertRawNotMeeting(raw);
      const artifact = (await store.getMediaArtifacts(raw.id)).find((entry) => entry.mediaId === req.params.mediaId);
      if (!artifact) throw new InputError('RAW_MEDIA_NOT_FOUND', '没有找到该图片位置的解析记录。', 404);
      const current = mediaForEvidence(artifact);
      if (req.query.textSha256 !== undefined && (!current || req.query.textSha256 !== current.textSha256))
        throw new InputError('RAW_MEDIA_EVIDENCE_STALE', '图片解析结果已变化，请重新核对引用。', 409);
      res.json(publicMediaArtifact(artifact));
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/raw/:rawId/media/:mediaId/parse-vlm', async (req, res, next) => {
    try {
      const { rawId, mediaId } = req.params;
      const body = req.body ?? {};
      if (
        !mediaIdPattern.test(mediaId) ||
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).some((key) => key !== 'force') ||
        (Object.hasOwn(body, 'force') && typeof body.force !== 'boolean')
      )
        throw new InputError('RAW_MEDIA_REQUEST_INVALID', '精读请求需要图片位置 ID，只支持可选的 force 布尔值。');
      res.json(publicMediaArtifact(await service.parse(rawId, mediaId, { provider: provider(), force: body.force })));
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/raw/:rawId/media/parse-vlm-batch', async (req, res, next) => {
    try {
      const body = req.body ?? {};
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).some((key) => key !== 'mediaIds') ||
        (Object.hasOwn(body, 'mediaIds') &&
          (!Array.isArray(body.mediaIds) ||
            body.mediaIds.some((id: unknown) => typeof id !== 'string' || !mediaIdPattern.test(id)) ||
            new Set(body.mediaIds).size !== body.mediaIds.length))
      )
        throw new InputError('RAW_MEDIA_REQUEST_INVALID', '批量精读只接受各不相同的图片位置 ID。');
      const items = await service.batch(req.params.rawId, { provider: provider(), mediaIds: body.mediaIds });
      res.json({
        items: items.map(({ mediaId, artifact, error }) => ({
          mediaId,
          ...(artifact ? { artifact: publicMediaArtifact(artifact) } : { error }),
        })),
      });
    } catch (error) {
      next(error);
    }
  });
}
