import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFile,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {storageFixture} from '../support/kb02-storage-fixture.ts';
import {storageHttp} from '../support/kb02-storage-http.ts';
import type {DraftRecord} from '../../services/wiki/drafts.ts';

export const originalRoot='.scratch-KB02-K204-C-20261024-vKvjss';
export const questionUnitIds=['fu-60870-60890-fact','fu-68471-68491-fact'];
export const markedText='人工标记待确认：异常审批负责人未知，AI仅未来分析建议。';
export async function r12Fixture(){
  const f=await storageFixture();
  const original=JSON.parse(await readFile(path.join(originalRoot,'candidate-C.json'),'utf8')) as DraftRecord;
  assert.equal(createHash('sha256').update(JSON.stringify(original)).digest('hex'),'80e518eb41ef9a962ae63020eb2cbc15b9d37bbb7df892ae19785facc0c2dc01');
  await copyFile(path.join(originalRoot,'knowledge/raw/reports',original.rawId+'.md'),path.join(f.root,'knowledge/raw/reports',original.rawId+'.md'));
  await writeFile(path.join(f.root,'drafts',original.id+'.json'),JSON.stringify(original));
  const raw=(await f.rawStore.get(original.rawId))!;assert(raw);assert.equal(raw.bodySha256,original.rawSha256);
  const draft=(await f.drafts.get(original.id))!;assert(draft);
  const h=await storageHttp({...f,raw},f.runner,{knowledge:true});
  return {...f,raw,draft,original,h,context:{body:raw.body,rulesDir:'rules'},file:path.join(f.root,'drafts',draft.id+'.json'),close:async()=>{await h.close();await f.clean();}};
}
