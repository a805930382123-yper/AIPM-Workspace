import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseStructuredNote, renderStructuredNote } from '../services/wiki/structured-note.ts';

const note = parseStructuredNote(
  JSON.parse(await readFile('tests/fixtures/kb03-structured-note.json', 'utf8')),
  new Set(['fact-1']),
);
const markdown = renderStructuredNote(note);
const body = renderToStaticMarkup(<Markdown skipHtml>{markdown}</Markdown>);
const directory = await mkdtemp(path.join(os.tmpdir(), 'kb03-preview-'));
const file = path.join(directory, 'structured-note.html');
await writeFile(
  file,
  `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>KB03 R1 静态渲染验收</title><style>body{font:17px/1.8 system-ui,"Microsoft YaHei",sans-serif;color:#20352f;background:#f2f5f2;margin:0}main{max-width:880px;margin:36px auto;padding:36px 44px;background:white;border:1px solid #d6e2db}h1,h2,h3{line-height:1.4;color:#205d49}h2{border-bottom:2px solid #d6e2db;padding-bottom:12px;margin-top:36px}li,p{overflow-wrap:anywhere;white-space:pre-wrap}li{margin:10px 0}aside{padding:16px;background:#e8f0eb}small{color:#50685e}@media(max-width:700px){main{margin:0;padding:20px}}</style><main><aside><strong>KB03 第一轮：独立静态预览</strong><br><small>表格采用行级列名列表；路径采用节点和箭头关系列表。产品阅读器适配尚未实施。</small></aside>${body}</main></html>`,
  'utf8',
);
console.log(file);
