import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const prefix = 'docs/reports/FULL-20261010-repair';
async function files(root) { return (await Promise.all((await fs.readdir(root, { withFileTypes: true }).catch(() => [])).filter(e => !e.isSymbolicLink()).map(e => e.isDirectory() ? files(path.join(root, e.name)) : [path.join(root, e.name)]))).flat(); }
async function snap(names) { return Promise.all(names.sort().map(async p => ({ path: p.replaceAll('\\', '/'), sha256: crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex') }))); }
const originals = ['B04-http-evidence.json', 'B04-repair3-merge-payload.json'];
const productFiles = async () => [...(await Promise.all(['app', 'server', 'services', 'rules', 'scripts'].map(files))).flat(), 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'index.html', 'README.md'];
const mode = process.argv[2];
if (mode === 'baseline') {
  const product = await snap(await productFiles());
  const workspace = await snap(await files('workspace'));
  const protectedFiles = [...(await files('docs/reports')).filter(p => !p.includes('FULL-20261010-repair')), ...(await files('tests/acceptance')).filter(p => !p.includes('20261010-repair')), ...(await files('THIRD_PARTY_LICENSES')), 'AGENTS.md', 'docs/product-spec.md', 'docs/architecture.md', 'docs/coordination.md'];
  const history = await snap(protectedFiles);
  await fs.mkdir(prefix + '-baseline', { recursive: true });
  for (const n of originals) await fs.copyFile('docs/reports/' + n, prefix + '-baseline/' + n);
  await fs.writeFile(prefix + '-baseline.json', JSON.stringify({ at: new Date().toISOString(), product, workspace, history }, null, 2));
  console.log(JSON.stringify({ product: product.length, workspace: workspace.length, protected: history.length }));
} else if (mode === 'restore') {
  for (const n of originals) { await fs.copyFile('docs/reports/' + n, prefix + '-generated-' + n); await fs.copyFile(prefix + '-baseline/' + n, 'docs/reports/' + n); }
  console.log('Historical B04 originals restored; this run outputs retained separately');
} else if (mode === 'freeze') {
  await fs.writeFile(prefix + '-frozen.json', JSON.stringify(await snap(await productFiles()), null, 2));
  await fs.writeFile(prefix + '-unit-tests-frozen.json', JSON.stringify(await snap((await files('tests')).filter(p => !p.includes(path.sep + 'acceptance' + path.sep))), null, 2));
  console.log('Product frozen for independent verification');
} else {
  const base = JSON.parse(await fs.readFile(prefix + '-baseline.json', 'utf8'));
  const frozen = JSON.parse(await fs.readFile(prefix + '-frozen.json', 'utf8'));
  const result = {};
  for (const key of ['product', 'workspace', 'history']) {
    const names = key === 'product' ? await productFiles() : key === 'workspace' ? await files('workspace') : base.history.map(f => f.path);
    const current = await snap(names), map = new Map(current.map(f => [f.path, f.sha256]));
    const reference = key === 'product' ? frozen : base[key];
    const changes = reference.filter(f => map.get(f.path) !== f.sha256).map(f => f.path);
    result[key] = { files: current.length, unchanged: !changes.length && current.length === reference.length, changes };
    if (key === 'product') result.product.authorizedChangesFromBaseline = base.product.filter(f => map.get(f.path) !== f.sha256).map(f => f.path);
  }
  const frozenTests = JSON.parse(await fs.readFile(prefix + '-unit-tests-frozen.json', 'utf8'));
  const nowTests = await snap((await files('tests')).filter(p => !p.includes(path.sep + 'acceptance' + path.sep)));
  const testMap = new Map(nowTests.map(f => [f.path, f.sha256]));
  const testChanges = frozenTests.filter(f => testMap.get(f.path) !== f.sha256).map(f => f.path);
  result.unitTests = { files: nowTests.length, unchanged: !testChanges.length && nowTests.length === frozenTests.length, changes: testChanges };
  await fs.writeFile(prefix + '-integrity.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (Object.values(result).some(v => !v.unchanged)) process.exitCode = 1;
}
