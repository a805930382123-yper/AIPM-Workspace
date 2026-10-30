import type { Express, Request, Response, NextFunction } from 'express';
import express from 'express';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { MeetingError } from '../services/meeting/errors.ts';
import { MeetingStore } from '../services/meeting/store.ts';
import { capabilities } from '../services/meeting/policy.ts';
import { detectFileFormat, extractBody, fileExtension, ParseError } from '../services/raw/parse.ts';
import type { MeetingRawBridge } from '../services/meeting/raw-bridge.ts';

function expose(meeting: Awaited<ReturnType<MeetingStore['get']>>) {
  if (!meeting) return undefined;
  const { creation: _creation, ...publicRecord } = meeting;
  return { ...publicRecord, imports: publicRecord.imports.map(({file_base64: _file, ...item}) => item), capabilities: capabilities(meeting) };
}
function wrap(work: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response, next: NextFunction) => { try { await work(req, res); } catch (error) { next(error); } };
}

export function registerMeetingRoutes(app: Express, store: MeetingStore, bridge?: MeetingRawBridge): void {
  app.get('/api/meeting-catalog', wrap(async (_req, res) => { res.json(await store.getCatalog()); }));
  for (const kind of ['types', 'tags'] as const) {
    app.post(`/api/meeting-catalog/${kind}`, wrap(async (req, res) => { res.json(await store.mutateCatalog(req.body, kind)); }));
    app.patch(`/api/meeting-catalog/${kind}/:id`, wrap(async (req, res) => { res.json(await store.mutateCatalog(req.body, kind, req.params.id)); }));
  }
  app.get('/api/meetings', wrap(async (_req, res) => { res.json({ items: await store.list() }); }));
  app.post('/api/meetings', wrap(async (req, res) => {
    const result = await store.create(req.body);
    res.status(result.reused ? 200 : 201).json({ ...expose(result.meeting), reused: result.reused });
  }));
  app.get('/api/meetings/:id', wrap(async (req, res) => {
    const meeting = await store.get(req.params.id);
    if (!meeting) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有找到这条会议记录。' } }); return; }
    res.json(expose(meeting));
  }));
  app.patch('/api/meetings/:id/policy', wrap(async (req, res) => {
    res.json(expose(await store.updatePolicy(req.params.id, req.body)));
  }));
  app.patch('/api/meetings/:id', wrap(async (req, res) => {
    res.json(expose(await store.update(req.params.id, req.body)));
  }));
  app.delete('/api/meetings/:id', wrap(async (req, res) => {
    res.json({ deleted: true, ...(await store.delete(req.params.id, req.body)) });
  }));
  if (bridge) {
    app.post('/api/meetings/:id/raw-links', wrap(async (req, res) => {
      const result = await bridge.register(req.params.id, req.body);
      res.status(result.reused ? 200 : 201).json({ ...expose(result.meeting), raw_id: result.rawId, reused: result.reused });
    }));
    app.delete('/api/meetings/:id/raw-links/:rawId', wrap(async (req, res) => {
      const meeting = await bridge.unlink(req.params.id, req.params.rawId, req.body);
      res.json(expose(meeting));
    }));
  }
}

const minutesUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 3, parts: 4, fieldSize: 1024 }, defParamCharset: 'utf8' });
function parseBooleanField(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new MeetingError('INVALID_FIELD', `${field} 必须是 true 或 false。`, 400, { field });
}
function preflightImport(store: MeetingStore) {
  return async (req: Request, res: Response, next: NextFunction) => {
   try {
    const meeting = await store.get(req.params.id);
    if (!meeting) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有找到这条会议记录。' } }); return; }
    const canImport = meeting.storage_mode === 'local_archive' && meeting.confidentiality !== 'Restricted'
      && (meeting.confidentiality === 'Public' || meeting.local_storage_authorized);
    if (!canImport) { res.status(403).json({ error: { code: 'MINUTES_NOT_AUTHORIZED', message: meeting.confidentiality === 'Restricted' ? 'Restricted 会议禁止保存本地正文。' : '当前会议策略不允许导入纪要。' } }); return; }
    next();
   } catch (error) { next(error); }
  };
}
function minutesRoute(store: MeetingStore) {
  return wrap(async (req, res) => {
    let payload: Record<string, unknown>;
    if (req.is('application/json')) {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new MeetingError('INVALID_BODY', '导入请求必须是 JSON 对象。');
      const allowed = ['baseRevision','requestId','text','confirmReimport'];
      if (Object.keys(body).some(key => !allowed.includes(key))) throw new MeetingError('UNKNOWN_FIELD', '导入请求包含不支持的字段。');
      payload = body;
    } else if (req.is('multipart/form-data')) {
      const file = req.file;
      if (!file) throw new MeetingError('MISSING_FILE', '请上传一个字段名为 file 的 DOCX、PDF、MD 或 TXT 文件。');
      const ext = fileExtension(file.originalname);
      if (!['.md','.txt','.docx','.pdf'].includes(ext)) throw new MeetingError('UNSUPPORTED_FILE', '支持 DOCX、PDF、MD、TXT；旧版 DOC 请先另存为 DOCX。', 415);
      const detection = detectFileFormat(file.buffer, ext);
      if ('failure' in detection) throw new MeetingError(detection.failure.code, detection.failure.message.replaceAll('未创建 Raw', '未保存纪要'), detection.failure.status);
      let text: string;
      try { text = detection.format === 'markdown' || detection.format === 'txt' ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.buffer) : (await extractBody(file.buffer, detection.format)).body; }
      catch (error) { if (error instanceof ParseError) throw new MeetingError(error.code, error.message.replaceAll('未创建 Raw', '未保存纪要'), error.status); throw error; }
      const allowed = ['baseRevision','requestId','confirmReimport'];
      if (Object.keys(req.body ?? {}).some(key => !allowed.includes(key))) throw new MeetingError('UNKNOWN_FIELD', '上传请求包含不支持的字段。');
      payload = { ...req.body, confirmReimport: parseBooleanField(req.body?.confirmReimport, 'confirmReimport'), text,
        original_filename: file.originalname, file_base64: file.buffer.toString('base64'), file_format: detection.format, file_sha256: createHash('sha256').update(file.buffer).digest('hex') };
      if (typeof payload.baseRevision === 'string' && /^\d+$/.test(payload.baseRevision)) payload.baseRevision = Number(payload.baseRevision);
    } else {
      throw new MeetingError('UNSUPPORTED_CONTENT_TYPE', '请使用 JSON 粘贴纪要或 multipart/form-data 上传 DOCX、PDF、MD 或 TXT 文件。', 415);
    }
    const result = await store.importMinutes(req.params.id, payload);
    const { creation: _creation, minute_requests: _requests, ...publicRecord } = result.meeting;
    const { file_base64: _file, ...imported } = result.imported;
    res.status(result.reused ? 200 : 201).json({ ...publicRecord, imports: publicRecord.imports.map(({file_base64: _bytes, ...item}) => item), capabilities: capabilities(result.meeting), imported, reused: result.reused });
  });
}
export function registerMeetingMinutesRoutes(app: Express, store: MeetingStore): void {
  const preflight = preflightImport(store);
  app.get('/api/meetings/:id/minutes/:importId/file', wrap(async (req, res) => {
    const meeting = await store.get(req.params.id);
    const item = meeting?.imports.find(version => version.import_id === req.params.importId);
    if (!item?.file_base64 || !item.original_filename) throw new MeetingError('NOT_FOUND', '该版本没有可下载的原文件。', 404);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(item.original_filename)}`);
    res.send(Buffer.from(item.file_base64, 'base64'));
  }));
  app.post('/api/meetings/:id/minutes/import', preflight, (req, res, next) => {
    if (req.is('application/json')) { express.json({ limit: '3mb', strict: true })(req, res, error => error ? next(error) : minutesRoute(store)(req, res, next)); return; }
    if (req.is('multipart/form-data')) { minutesUpload.single('file')(req, res, error => {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') { next(new MeetingError('MINUTES_TOO_LARGE', '纪要文件超过 2 MiB 上限，未保存。', 413, { limitBytes: 2 * 1024 * 1024 })); return; }
      if (error instanceof multer.MulterError) { next(new MeetingError('INVALID_UPLOAD', '上传请求格式不正确，请只上传一个 file 字段和允许的纪要字段。', 400)); return; }
      if (error) { next(error); return; }
      void minutesRoute(store)(req, res, next);
    }); return; }
    next(new MeetingError('UNSUPPORTED_CONTENT_TYPE', '请使用 JSON 粘贴纪要或 multipart/form-data 上传 DOCX、PDF、MD 或 TXT 文件。', 415));
  });
  app.patch('/api/meetings/:id/minutes/:importId', preflight, (req,res,next)=>express.json({limit:'3mb',strict:true})(req,res,error=>error?next(error):wrap(async (innerReq,innerRes)=>{
    const result = await store.updateEditableMinutes(innerReq.params.id, innerReq.params.importId, innerReq.body);
    const { creation: _creation, minute_requests: _requests, ...publicRecord } = result;
    innerRes.json({ ...publicRecord, imports: publicRecord.imports.map(({file_base64: _file, ...item}) => item), capabilities: capabilities(result) });
  })(req,res,next)));
  app.delete('/api/meetings/:id/minutes', (req,res,next)=>express.json({limit:'32kb',strict:true})(req,res,error=>error?next(error):wrap(async (innerReq,innerRes)=>{
    const result = await store.clearMinutes(innerReq.params.id, innerReq.body);
    const { creation: _creation, minute_requests: _requests, ...publicRecord } = result;
    innerRes.json({ ...publicRecord, capabilities: capabilities(result) });
  })(req,res,next)));
}

export function meetingErrorMiddleware(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (!(error instanceof MeetingError)) { next(error); return; }
  res.status(error.status).json({ error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) } });
}

