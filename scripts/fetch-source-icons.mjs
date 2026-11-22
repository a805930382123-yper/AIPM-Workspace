import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createCanvas, Image, loadImage } from '@napi-rs/canvas';

const directory = new URL('../public/icons/sources/', import.meta.url);
const manifestPath = new URL('../app/source-logo-files.json', import.meta.url);
const github = (owner) => `https://github.com/${owner}.png?size=128`;
const favicons = (host) => [
  `https://www.google.com/s2/favicons?domain=${host}&sz=128`,
  `https://icons.duckduckgo.com/ip3/${host}.ico`,
];
const sources = {
  aihot: [
    'AI',
    '#6153d3',
    'https://aihot.news/icon.png',
    'https://aihot.news/apple-icon.png',
    ...favicons('aihot.news'),
  ],
  anthropic: ['A', '#a54830', github('anthropics')],
  openai: ['OA', '#171717', github('openai')],
  huggingface: ['HF', '#905600', github('huggingface')],
  simonw: ['SW', '#326994', github('simonw')],
  karpathy: ['AK', '#4c5377', github('karpathy')],
  worldpanel: [
    'WP',
    '#164a43',
    'https://cdn.prod.website-files.com/68265f9b65072c5bc03aff55/68dc4cfcd06d52b1f580e0de_Favi_nobg.png',
    ...favicons('worldpanelbynumerator.com'),
  ],
  niq: [
    'NIQ',
    '#3d2698',
    'https://nielseniq.cn/wp-content/uploads/sites/9/2023/03/cropped-favicon-512x512-1.png?w=192',
    ...favicons('nielseniq.com'),
  ],
  nbs: ['统', '#a81921', 'https://www.stats.gov.cn/favicon.ico', ...favicons('stats.gov.cn')],
  pwc: [
    'PwC',
    '#a23819',
    'https://www.pwccn.com/content/pwc/script/network/apple-touch-icon.png',
    ...favicons('pwccn.com'),
  ],
  kpmg: [
    'KPMG',
    '#00338d',
    'https://kpmg.com/content/experience-fragments/kpmgpublic/cn/zh/site/header/master/_jcr_content/root/header_v2_copy/logo.coreimg.svg/1753669336266/logo.svg',
    ...favicons('kpmg.com'),
  ],
  mintel: [
    'M',
    '#08684a',
    'https://china.mintel.com/app/uploads/2024/08/mintel-favico-300x300.png',
    ...favicons('mintel.com'),
  ],
};

// Generic images returned for a missing domain by Google and DuckDuckGo.
const placeholders = new Set([
  '59bfe9bc385ad69f50793ce4a53397316d7a875a7148a63c16df9b674c6cda64',
  'e5db88ea2322863ca17817b99d60006c625a31cff0dad49cf05d3c6d16a75c17',
]);

async function readIfPresent(path) {
  return readFile(path).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

async function writeChanged(path, bytes) {
  if (!(await readIfPresent(path))?.equals(bytes)) await writeFile(path, bytes);
}

async function decodeImage(bytes) {
  if (!bytes.length || /<\s*(?:!doctype\s+html|html\b)/iu.test(bytes.subarray(0, 512).toString()))
    throw new Error('empty or HTML response');
  if (placeholders.has(createHash('sha256').update(bytes).digest('hex'))) throw new Error('generic favicon');
  const image = await loadImage(bytes);
  if (!image.width || !image.height) throw new Error('invalid dimensions');
  return image;
}

await mkdir(directory, { recursive: true });
const previous = JSON.parse((await readIfPresent(manifestPath))?.toString() ?? '{}');
const refresh = process.argv.includes('--refresh');
const filenames = await Promise.all(
  Object.entries(sources).map(async ([id, [label, color, ...urls]]) => {
    const png = new URL(`${id}.png`, directory);
    const bytes = await readIfPresent(png);
    const existing = bytes && (await decodeImage(bytes).catch(() => undefined));
    if (existing && previous[id]?.url && !refresh) return [id, previous[id]];

    for (const url of urls) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        const contentType = response.headers.get('content-type');
        if (response.status !== 200 || !contentType?.startsWith('image/')) {
          throw new Error(`HTTP ${response.status}, ${contentType ?? 'missing content type'}`);
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        const image = await decodeImage(bytes);
        const vector = contentType.startsWith('image/svg+xml');
        const scale = 128 / Math.max(image.width, image.height);
        const rasterScale = vector ? scale : Math.min(1, scale);
        const width = Math.max(1, Math.round(image.width * rasterScale));
        const height = Math.max(1, Math.round(image.height * rasterScale));
        const canvas = createCanvas(width, height);
        const context = canvas.getContext('2d');
        const rendered = vector ? new Image(width, height) : image;
        if (vector) {
          rendered.src = bytes;
          await rendered.decode();
        }
        context.drawImage(rendered, 0, 0, width, height);
        if (!context.getImageData(0, 0, width, height).data.some((value, index) => index % 4 === 3 && value)) {
          throw new Error('transparent image');
        }
        await writeChanged(png, canvas.toBuffer('image/png'));
        console.log(`${id}: ${image.width}×${image.height} from ${response.url}`);
        return [id, { file: `${id}.png`, url: response.url, width, height }];
      } catch (error) {
        console.warn(`${id}: ${url} — ${error.message}`);
      }
    }

    if (existing && previous[id]?.url) return [id, previous[id]];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="${color}"/><text x="32" y="32" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="${label.length > 3 ? 20 : 25}" font-weight="700" fill="white">${label}</text></svg>\n`;
    await writeChanged(new URL(`${id}.svg`, directory), Buffer.from(svg));
    return [id, { file: `${id}.svg`, url: null, width: 64, height: 64 }];
  }),
);

await writeChanged(manifestPath, Buffer.from(`${JSON.stringify(Object.fromEntries(filenames), null, 2)}\n`));
for (const [id, icon] of filenames) {
  await rm(new URL(`${id}.${icon.url ? 'svg' : 'png'}`, directory), { force: true });
  console.log(`${icon.file} ${icon.width}×${icon.height} ${icon.url ?? 'generated abbreviation'}`);
}
