#!/usr/bin/env node
import path from 'node:path';
import { RawStore } from '../services/raw/store.ts';
import { WikiLint } from '../services/audit/lint.ts';
import { AuditService } from '../services/audit/service.ts';
import { WikiStore } from '../services/wiki/store.ts';

const root = path.resolve(process.argv[2] ?? process.env.FMCG_DATA_DIR ?? path.join(process.cwd(), 'workspace'));
// Read-only CLI: deliberately does not call initialize() on any store and cannot rebuild Index.
const raws = new RawStore(root);
const wiki = new WikiStore(root, raws);
const audits = new AuditService(root, wiki, raws);
const result = await new WikiLint(root, raws, audits).inspect();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.findings.length) process.exitCode = 1;
