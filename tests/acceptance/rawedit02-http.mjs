import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setup, sha, waitFor, rawPath, draftPath, editInput } from './rawedit02-fixture.mjs';

const out = path.resolve(process.argv[2] ?? 'docs/reports/RAWEDIT02-20261114-builder-evidence');
await mkdir(out, { recursive: true });
const report = { success: false, steps: [] };
const pass = name => { report.steps.push(name); console.log('PASS ' + name); };
let fixture;
try {
  fixture = await setup(report, { fakeHttp: true });
  const { api, request, edit, confirm, rawFile, snapshot, assetFile, standard, standardDraft, formal, formalCommit, answer,
    meeting, bridged, url, translated, checkpoint, running, txt, txtBytes, rawPdf, pdfDraft, runningPdf, pdfBytes } = fixture;
  const read = raw => api(rawPath(raw));
  const history = (raw, revision, status = 200) => api(rawPath(raw) + '/body-history/' + revision, 'GET', undefined, status);
  const absent = file => assert.rejects(readFile(file), { code: 'ENOENT' });
  const before = await read(standard);
  const beforeBytes = await readFile(rawFile(standard));
  const wikiBefore = await api('/api/wiki');
  const wikiDetails = () => Promise.all(wikiBefore.items.map(item => api('/api/wiki/' + item.id)));
  const wikiDetailsBefore = await wikiDetails();
  const pdfStateDir = path.join(fixture.data, 'state', 'raw-pdf', rawPdf.id);
  const pdfStateBefore = await readFile(path.join(pdfStateDir, 'manifest.json'));
  assert(wikiBefore.items.length > 0 && formalCommit.status === 'completed');
  assert.deepEqual(await edit(before, before.body), before);
  await absent(snapshot(standard, 0));
  const newBody = '  校订后的门店覆盖16家。\r\n---\n回访改为10天。🐈\n  ';
  const edited = await edit(before, newBody);
  assert.equal(edited.body, newBody);
  assert.equal(edited.bodySha256, sha(newBody));
  assert.equal(edited.bodyRevision, 1);
  assert(Number.isFinite(Date.parse(edited.bodyEditedAt)));
  const { body, bodySha256, bodyRevision, bodyEditedAt, ...metadata } = edited;
  const { body: _body, bodySha256: _sha, ...beforeMetadata } = before;
  assert.deepEqual(metadata, beforeMetadata);
  assert.deepEqual(await read(standard), edited);
  assert.deepEqual(await history(standard, 0), before);
  assert.deepEqual(await readFile(snapshot(standard, 0)), beforeBytes);
  assert.equal((await history(standard, 1, 404)).error.code, 'NOT_FOUND');
  assert.deepEqual(await edit(edited, edited.body), edited);
  assert.deepEqual(await readdir(path.dirname(snapshot(standard, 0))), ['0.md']);
  pass('Original text saved byte-for-byte; identity preserved; old Markdown preserved exactly; no-op creates no revision');

  const contenders = await Promise.all(['并发一。','并发二。'].map(body => request(rawPath(standard) + '/body', 'PATCH', editInput(edited, body))));
  assert.deepEqual(contenders.map(response => response.status).sort(), [200, 409]);
  assert.equal((await contenders.find(response => response.status === 409).json()).error.code, 'RAW_BODY_CONFLICT');
  const stale = await edit(edited, '保留在客户端的输入。', 409);
  assert.equal(stale.error.code, 'RAW_BODY_CONFLICT');
  const winner = await read(standard);
  assert.equal(winner.bodyRevision, 2);
  assert.deepEqual(await history(standard, 1), edited);
  const restored = await edit(winner, before.body);
  assert.equal(restored.bodySha256, before.bodySha256);
  assert.equal((await edit(before, 'ABA stale request', 409)).error.code, 'RAW_BODY_CONFLICT');
  const latest = await edit(restored, '当前正文，完全不同。');
  assert.equal(latest.bodyRevision, 4);
  pass('Two competing old-version requests give exactly one success; restored SHA still rejects stale revision');

  const base = rawPath(standard) + '/body';
  for (const [value, status, code] of [
    [{ body: '无版本' }, 400, 'INVALID_RAW_BODY_VERSION'],
    [{ ...editInput(latest, '正文'), expectedBodyRevision: -1 }, 400, 'INVALID_RAW_BODY_VERSION'],
    [editInput(latest, '  \n '), 400, 'REQUIRED_FIELD'],
    [editInput(latest, '字'.repeat(500001)), 413, 'BODY_TOO_LARGE'],
    [editInput(latest, '\ud800'), 400, 'INVALID_BODY'],
    [{ ...editInput(latest, '正文'), title: '企图改标题' }, 403, 'SYSTEM_FIELD_FORBIDDEN'],
    [{ ...editInput(latest, '正文'), bodyRevision: 40 }, 403, 'SYSTEM_FIELD_FORBIDDEN'],
  ]) {
    assert.equal((await api(base, 'PATCH', value, status)).error.code, code);
  }
  for (const field of ['bodyRevision', 'bodyEditedAt']) {
    const fields = { title: '导入', sourceType: 'note', sourceName: '合成', body: '文本', [field]: 1 };
    assert.equal((await api('/api/raw', 'POST', fields, 403)).error.code, 'SYSTEM_FIELD_FORBIDDEN');
    assert.equal((await api('/api/raw/import', 'POST', { metadata: fields, body: '文本' }, 403)).error.code, 'SYSTEM_FIELD_FORBIDDEN');
  }
  assert.deepEqual(await read(standard), latest);
  pass('Invalid version, empty/oversized/invalid Unicode, metadata and injected import revision rejected');

  const blockedPath = path.dirname(snapshot(meeting, 0));
  await mkdir(path.dirname(blockedPath), { recursive: true });
  await writeFile(blockedPath, '故意造成快照写入失败。');
  assert.equal((await edit(meeting, '不应提交。', 500)).error.code, 'INTERNAL_ERROR');
  assert.deepEqual(await read(meeting), JSON.parse(JSON.stringify(meeting)));
  await unlink(blockedPath);
  await mkdir(blockedPath);
  await writeFile(snapshot(meeting, 0), '已有不相符历史。');
  assert.equal((await edit(meeting, '仍不应提交。', 409)).error.code, 'RAW_INTEGRITY_ERROR');
  assert.equal(await readFile(snapshot(meeting, 0), 'utf8'), '已有不相符历史。');
  assert.deepEqual(await read(meeting), JSON.parse(JSON.stringify(meeting)));
  await unlink(snapshot(meeting, 0));
  await rmdir(blockedPath);
  const editedMeeting = await edit(meeting, '普通会议可编辑。');
  assert.equal(editedMeeting.bodyRevision, 1);
  assert.equal(editedMeeting.sourceType, 'meeting');
  const denied = await edit(bridged, '禁止修改。', 403);
  assert.equal(denied.error.code, 'MEETING_RAW_EDIT_FORBIDDEN');
  assert.match(denied.error.message, /会议档案/u);
  assert.deepEqual(await read(bridged), bridged);
  await absent(snapshot(bridged, 0));
  pass('Snapshot write failure and conflicting history preserve current text; legacy meeting editable; bridged meeting immutable');

  assert.equal((await api(draftPath(standardDraft))).preview.rawSha256Matches, false);
  assert.equal((await confirm(standardDraft)).error.code, 'RAW_CHANGED');
  const citation = answer.citations[0];
  const citationRoute = '/api/knowledge/answers/' + answer.id + '/citations/' + citation.id;
  assert.deepEqual(await api(citationRoute), citation);
  const editedFormal = await edit(formal, '修改已引用的来源正文。');
  assert.equal(editedFormal.id, formal.id);
  assert.deepEqual(await wikiDetails(), wikiDetailsBefore);
  assert.equal((await api(citationRoute, 'GET', undefined, 409)).error.code, 'ANSWER_BASIS_CHANGED');
  const updatedCheckpoint = await edit(checkpoint, '改为新的检查点输入。');
  assert.equal(updatedCheckpoint.bodyRevision, 1);
  const previousJob = (await api('/api/raw-processing')).items.find(item => item.rawId === checkpoint.id);
  assert(previousJob?.jobId);
  const cpFile = path.join(fixture.data, 'state', 'extraction-checkpoints', previousJob.jobId + '.json');
  const cpBefore = await readFile(cpFile);
  assert.equal((await api(rawPath(checkpoint) + '/extract', 'POST', {}, 409)).error.code, 'LLM_CHECKPOINT_INCOMPATIBLE');
  assert.deepEqual(await readFile(cpFile), cpBefore);
  assert.equal((await api(rawPath(url) + '/translation')).translation.body, translated.body);
  await edit(url, '此修订版不得使用旧译文。');
  assert.equal((await api(rawPath(url) + '/translation', 'GET', undefined, 409)).error.code, 'TRANSLATION_SOURCE_CHANGED');
  assert.equal(report.fakeHttpCalls.length, 0);
  pass('Prior draft confirmation, checkpoint, translation, and question citation reuse fail closed; existing formal Wiki unchanged');

  const updatedTxt = await edit(txt.raw, '人工更正文本提取。');
  assert.equal(updatedTxt.assetId, txt.asset.id);
  assert.deepEqual(await assetFile(txt.asset.storedFile), txtBytes);
  const importedPdf = await read(rawPdf);
  assert.equal((await api(rawPath(rawPdf) + '/pdf')).job.status, 'completed');
  assert.equal((await api(rawPath(rawPdf) + '/pdf/cleanup')).job.status, 'completed');
  assert((await api(rawPath(rawPdf) + '/pdf/pages/1')).understanding);
  const revisedPdf = await edit(rawPdf, '替换 PDF 提取文字，和原页不同。');
  assert.equal(revisedPdf.assetSha256, sha(pdfBytes));
  assert.equal(revisedPdf.assetId, importedPdf.assetId);
  assert.deepEqual(await history(rawPdf, 0), importedPdf);
  const original = await request(rawPath(rawPdf) + '/pdf/original');
  assert.equal(original.status, 200);
  assert.match(original.headers.get('Content-Type'), /application\/pdf/u);
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), pdfBytes);
  for (const [route, method, value] of [['', 'GET'], ['/pages/1', 'GET'], ['/pages/1/image', 'GET'], ['/understand','POST',{}], ['/cleanup','GET'], ['/cleanup','POST',{startPage:1,endPage:3}], ['/cleanup/draft','POST',{startPage:1,endPage:3}]]) {
    assert.equal((await api(rawPath(rawPdf) + '/pdf' + route, method, value, 409)).error.code, 'PDF_TEXT_EDITED');
  }
  assert.equal((await confirm(pdfDraft)).error.code, 'RAW_CHANGED');
  await edit(revisedPdf, importedPdf.body);
  assert.equal((await api(draftPath(pdfDraft))).preview.rawSha256Matches, false);
  assert.equal((await confirm(pdfDraft)).error.code, 'RAW_CHANGED');
  assert.deepEqual(await readFile(path.join(pdfStateDir, 'manifest.json')), pdfStateBefore);
  assert.equal(report.fakeHttpCalls.length, 0);
  pass('PDF original downloads unchanged; stale text ranges, page evidence, cleanup and PDF draft unusable after edits including restore');

  const extract = await api(rawPath(running) + '/extract', 'POST', {}, 202);
  await waitFor(() => report.fakeHttpCalls.length, value => value === 1);
  assert.equal((await edit(running, '活跃任务中不可保存。', 409)).error.code, 'RAW_ACTIVE_WORK');
  await api('/api/extraction-jobs/' + extract.jobId + '/cancel', 'POST', {});
  await waitFor(() => api('/api/extraction-jobs/' + extract.jobId), value => value.execution === 'settled');
  await edit(running, '任务取消后可保存。');
  await api(rawPath(runningPdf) + '/pdf/understand', 'POST', {}, 202);
  await waitFor(() => report.fakeHttpCalls.length, value => value === 2);
  assert.equal((await edit(runningPdf, '活跃 PDF 任务中不可保存。', 409)).error.code, 'RAW_ACTIVE_WORK');
  await api(rawPath(runningPdf) + '/pdf/cancel', 'POST', {});
  await edit(runningPdf, 'PDF 任务取消后可保存。');
  assert.equal((await api(rawPath(runningPdf) + '/pdf/understand', 'POST', {}, 409)).error.code, 'PDF_TEXT_EDITED');
  assert.equal(report.fakeHttpCalls.length, 2);
  assert.deepEqual(await wikiDetails(), wikiDetailsBefore);
  assert.deepEqual(await api('/api/wiki'), wikiBefore);
  pass('HTTP extraction and PDF understanding hold edits while active; cancel releases; edits issue no model calls or formal writes');

  report.raw = { id: latest.id, before: sha(beforeBytes), after: sha(await readFile(rawFile(standard))), currentBodySha256: latest.bodySha256 };
  report.asset = { pdfSha256: sha(pdfBytes), txtSha256: sha(txtBytes) };
  report.wikiIds = wikiBefore.items.map(item => item.id);
  report.success = true;
} catch (error) {
  report.error = error.stack;
  throw error;
} finally {
  try { await fixture?.stop(); }
  finally { await writeFile(path.join(out, 'http-result.json'), JSON.stringify(report, null, 2)); }
}
