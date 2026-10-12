// B03: file import orchestration. The original bytes are retained and verified first,
// then the real format is detected, then the body is extracted, then the Raw is created,
// and finally the original is linked to the Raw. Every step after retention either succeeds
// or reports an explicit failure that names what was already committed (never a fake success).
import type { AssetStore, AssetRecord } from '../services/raw/assets.ts';
import type { RawRecord, RawStore } from '../services/raw/store.ts';
import { MAX_BODY_CHARS, MAX_UPLOAD_BYTES } from '../services/raw/limits.ts';
import {
  ParseError, declaredFormat, detectFileFormat, extractBody, fileExtension, fileStem, type RawFileFormat,
} from '../services/raw/parse.ts';
import { InputError, validateRawMetadata } from './validation.ts';

export type ImportResult = {
  raw: RawRecord;
  asset: AssetRecord;
  extraction: { parser: string; note: string; bodyChars: number };
};

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, ' ').trim().slice(0, 200) || '未知错误';
}

export async function importRawFile(input: {
  store: RawStore; assets: AssetStore; bytes: Buffer; fileName: string; metadata: unknown;
}): Promise<ImportResult> {
  const { store, assets, bytes } = input;
  const fileName = input.fileName?.trim() ? input.fileName : '未命名文件';
  const extension = fileExtension(fileName);
  const stem = fileStem(fileName);

  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new InputError('FILE_TOO_LARGE', `文件超过 ${MAX_UPLOAD_BYTES / 1024 / 1024} MiB 上限，已在接收阶段拒绝，未保存原件。`, 413, { retained: false, limitBytes: MAX_UPLOAD_BYTES, byteSize: bytes.length });
  }

  const supplied = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
    ? { ...(input.metadata as Record<string, unknown>) } : {};
  if (typeof supplied.title !== 'string' || !supplied.title.trim()) supplied.title = stem || '未命名文件';
  if (typeof supplied.sourceName !== 'string' || !supplied.sourceName.trim()) supplied.sourceName = stem || '文件导入';
  const metadata = validateRawMetadata(supplied);

  // 1) retain and verify the original before parsing anything.
  let asset: AssetRecord;
  try {
    asset = await assets.store(bytes, { fileName, format: declaredFormat(extension), declaredExtension: extension });
  } catch (error) {
    throw new InputError('ASSET_WRITE_FAILED', `原件写入本机失败，未创建 Raw：${message(error)}`, 500, { retained: false, fileName, byteSize: bytes.length });
  }

  const retentionError = async (code: string, text: string, status: number, format?: RawFileFormat): Promise<InputError> => {
    let warning: string | undefined;
    let recorded = asset;
    try { recorded = await assets.markFailed(asset.id, { code, message: text, format }) ?? asset; }
    catch { warning = `原件失败记录写入未完成（assetId ${asset.id}），原件字节仍保留在 knowledge/raw/assets/。`; }
    return new InputError(code, `${text} 原件已保留（assetId ${asset.id}，${asset.byteSize} 字节，SHA-256 ${asset.sha256}），正文未入库、未创建 Raw。`, status, {
      retained: true, assetId: asset.id, format: recorded.format, fileName, byteSize: asset.byteSize, sha256: asset.sha256,
      ...(warning ? { warning } : {}),
    });
  };

  // 2) detect the real format from the bytes (extension is only an expectation).
  const detection = detectFileFormat(bytes, extension);
  if ('failure' in detection) throw await retentionError(detection.failure.code, detection.failure.message, detection.failure.status);

  // 3) extract the body with a real parser.
  let extracted;
  try {
    extracted = await extractBody(bytes, detection.format);
  } catch (error) {
    if (error instanceof ParseError) throw await retentionError(error.code, error.message, error.status, detection.format);
    throw await retentionError('PARSE_FAILED', `解析失败：${message(error)}；未创建 Raw。`, 422, detection.format);
  }
  if (extracted.body.length > MAX_BODY_CHARS) {
    throw await retentionError('BODY_TOO_LARGE', `提取到的正文为 ${extracted.body.length.toLocaleString()} 个字符，超过 ${MAX_BODY_CHARS.toLocaleString()} 字符上限；未创建 Raw。`, 413, detection.format);
  }
  if (!extracted.body.trim()) {
    throw await retentionError('EMPTY_CONTENT', '提取到的正文为空或只有空白字符；未创建 Raw。', 422, detection.format);
  }

  // 4) create the formal Raw and record the original-file linkage.
  let raw: RawRecord;
  try {
    raw = await store.create({
      ...metadata, body: extracted.body,
      assetId: asset.id, assetFileName: fileName, assetFormat: detection.format,
      assetByteSize: asset.byteSize, assetSha256: asset.sha256,
      extractionParser: extracted.parser, extractionNote: extracted.note,
    });
  } catch (error) {
    throw await retentionError('RAW_WRITE_FAILED', `正文已提取，但写入正式 Raw 失败：${message(error)}`, 500, detection.format);
  }

  // 5) link the retained original to the committed Raw. This is a second file write, so it
  // can fail on its own: the Raw exists, the original exists, only the record linkage is
  // missing. That is a partial commit — it must never be reported as a plain success, and it
  // must be recoverable (start-up reconcile completes it, or compensates if the Raw is gone).
  let linked: AssetRecord | undefined;
  let linkFailure = '';
  try {
    linked = await assets.markParsed(asset.id, { format: detection.format, rawId: raw.id, parser: extracted.parser, extractionNote: extracted.note });
  } catch (error) { linkFailure = message(error); }
  if (!linked) {
    throw new InputError(
      'IMPORT_LINK_PENDING',
      `正文已写入正式 Raw（id ${raw.id}），原件已保留（assetId ${asset.id}，${asset.byteSize} 字节，SHA-256 ${asset.sha256}），但原件关联记录写入失败：${linkFailure}。`
      + '工作台会在此目录下次启动时自动补齐该关联；请不要重复导入同一文件，也不要手工移动 knowledge/raw/assets 中的文件。',
      500,
      {
        committed: true, recoverable: true, rawId: raw.id, assetId: asset.id, format: detection.format,
        fileName, byteSize: asset.byteSize, sha256: asset.sha256, cause: linkFailure, raw,
        asset: { ...asset, status: asset.status },
      },
    );
  }

  return {
    raw, asset: linked,
    extraction: { parser: extracted.parser, note: extracted.note, bodyChars: extracted.body.length },
  };
}
