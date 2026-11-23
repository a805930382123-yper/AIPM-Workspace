import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadImage } from '@napi-rs/canvas';
import { evaluateImageOcr, type OcrLineInput } from './media-ocr-triage.ts';
import { RawStore } from './store.ts';
import { identifyWebImages, recognizeWebImageLines, webImageRelativePath } from './web-material.ts';

type MigrationStatus = 'planned' | 'existing' | 'no_current_anchor' | 'no_images' | 'migrated' | 'error';
export type MediaMigrationItem = {
  rawId: string;
  imageIndex?: number;
  mediaId?: string;
  status: MigrationStatus;
  reason?: string;
  routeStatus?: string;
};
export type MediaMigrationOptions = {
  rawIds: string[];
  apply?: boolean;
  /** Local OCR seam; production uses Tesseract, never a model provider. */
  ocr?: (bytes: Buffer) => Promise<OcrLineInput[]>;
};

/** Only derivatives are written. Acquisition history and current anchors come from RawStore. */
export async function migrateRawMedia(store: RawStore, options: MediaMigrationOptions) {
  const items: MediaMigrationItem[] = [];
  for (const rawId of new Set(options.rawIds)) {
    try {
      const raw = await store.get(rawId);
      if (!raw) {
        items.push({ rawId, status: 'error', reason: 'raw_not_found' });
        continue;
      }
      const images = identifyWebImages(raw.id, raw.webImages);
      if (!images.length) {
        items.push({ rawId, status: 'no_images' });
        continue;
      }
      const { markers } = await store.mediaSource(raw);
      const anchored = new Set(markers.map(({ imageIndex }) => imageIndex));
      const existing = new Map((await store.getMediaArtifacts(raw.id)).map((artifact) => [artifact.mediaId, artifact]));
      for (const image of images) {
        const item: MediaMigrationItem = {
          rawId,
          imageIndex: image.imageIndex,
          mediaId: image.mediaId,
          status: 'planned',
        };
        items.push(item);
        const saved = existing.get(image.mediaId);
        if (saved) {
          item.status = 'existing';
          item.routeStatus = saved.routeStatus;
          if (!anchored.has(image.imageIndex)) item.reason = 'no_current_anchor';
          continue;
        }
        if (!anchored.has(image.imageIndex)) {
          item.status = 'no_current_anchor';
          continue;
        }
        try {
          const relative = webImageRelativePath(image.sha256);
          if (!relative) {
            item.status = 'error';
            item.reason = 'original_image_hash_missing_or_invalid';
            continue;
          }
          const bytes = await readFile(path.join(store.root, relative));
          if (createHash('sha256').update(bytes).digest('hex') !== image.sha256) {
            item.status = 'error';
            item.reason = 'original_image_hash_mismatch';
            continue;
          }
          if (!options.apply) continue;
          item.reason = 'original_image_decode_failed';
          const { width, height } = await loadImage(bytes);
          item.reason = 'local_ocr_unavailable';
          const lines = await (options.ocr ?? recognizeWebImageLines)(bytes);
          const result = evaluateImageOcr({ width, height, lines });
          item.reason = 'artifact_storage_failed';
          const artifact = await store.saveMediaArtifact(rawId, image.mediaId, result, { onlyIfMissing: true });
          if (!artifact) {
            item.status = 'error';
            item.reason = 'image_no_longer_available';
            continue;
          }
          item.status = 'migrated';
          item.routeStatus = artifact.routeStatus;
          delete item.reason;
        } catch (error) {
          item.status = 'error';
          item.reason ??=
            (error as NodeJS.ErrnoException).code === 'ENOENT'
              ? 'original_image_missing'
              : 'original_image_read_failed';
        }
      }
    } catch {
      items.push({ rawId, status: 'error', reason: 'raw_or_artifact_read_failed' });
    }
  }
  const summary: Record<MigrationStatus, number> = {
    planned: 0,
    existing: 0,
    no_current_anchor: 0,
    no_images: 0,
    migrated: 0,
    error: 0,
  };
  for (const item of items) summary[item.status]++;
  return {
    mode: options.apply ? ('apply' as const) : ('preview' as const),
    items,
    summary,
    complete: summary.error === 0,
  };
}
