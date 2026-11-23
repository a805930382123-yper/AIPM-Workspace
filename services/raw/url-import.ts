import { lookup } from 'node:dns/promises';
import http, { type IncomingHttpHeaders } from 'node:http';
import https from 'node:https';
import { BlockList, isIP, isIPv4 } from 'node:net';
import type { Readable } from 'node:stream';
import { JSDOM, VirtualConsole } from 'jsdom';
import { MAX_BODY_CHARS } from './limits.ts';

export const MAX_WEB_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const WEB_TIMEOUT_MS = 12_000;
const FALLBACK = '请改用上传文件或粘贴正文。';
type Address = { address: string; family: number };
type WebResponse = { status: number; headers: IncomingHttpHeaders; body: Readable };
export type WebOptions = {
  resolve?: (hostname: string) => Promise<Address[]>;
  request?: (url: URL, address: Address, signal: AbortSignal, accept: string) => Promise<WebResponse>;
  timeoutMs?: number;
  images?: boolean;
};

export type WebImageCandidate = {
  marker: string;
  url: string;
  label: string;
  context: string;
  width: number;
  height: number;
  explicit: boolean;
};
export type ImportedWebText = {
  body: string;
  title: string;
  finalUrl: string;
  fetchedAt: string;
  parser: string;
  note: string;
  images?: WebImageCandidate[];
};

class RawUrlError extends Error {
  constructor(
    public code: string,
    reason: string,
    public status: number,
  ) {
    super(`${reason}${FALLBACK}`);
  }
}

const nonPublic = new BlockList();
const ipv4Reserved: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
];
for (const [address, prefix] of ipv4Reserved) nonPublic.addSubnet(address, prefix, 'ipv4');
nonPublic.addSubnet('2001::', 23, 'ipv6');
nonPublic.addSubnet('2001:db8::', 32, 'ipv6');
nonPublic.addSubnet('2002::', 16, 'ipv6');
nonPublic.addSubnet('3fff::', 20, 'ipv6');
const ipv6Global = new BlockList();
ipv6Global.addSubnet('2000::', 3, 'ipv6');

function publicAddress({ address, family }: Address): boolean {
  if (isIP(address) !== family) return false;
  if (family === 4) return !nonPublic.check(address, 'ipv4');
  return family === 6 && ipv6Global.check(address, 'ipv6') && !nonPublic.check(address, 'ipv6');
}

function webUrl(value: string, base?: URL): URL {
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    throw new RawUrlError('URL_INVALID', '网页地址无效。', 400);
  }
  if (value.length > 2048 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw new RawUrlError('URL_FETCH_BLOCKED', '仅支持无凭据、使用默认端口的公开 HTTP(S) 网页。', 400);
  }
  url.hash = '';
  return url;
}

function ipv4Number(ip: string): number {
  return ip.split('.').reduce((number, octet) => number * 256 + Number(octet), 0);
}

function httpProxyFor(address: Address): URL | undefined {
  if (!process.allowedNodeEnvironmentFlags.has('--use-env-proxy')) return;
  const envOptions = process.env.NODE_OPTIONS?.match(/(?:[^\s"]|"(?:[^"\\]|\\.)*")+/gu) ?? [];
  const flag = [...envOptions, ...process.execArgv]
    .reverse()
    .map((option) => option.replace(/^"|"$/gu, '').replaceAll('_', '-'))
    .find((option) => option === '--use-env-proxy' || option === '--no-use-env-proxy');
  if (flag ? flag === '--no-use-env-proxy' : process.env.NODE_USE_ENV_PROXY !== '1') return;

  const proxyUrl = process.env.http_proxy || process.env.HTTP_PROXY;
  if (!proxyUrl) return;
  if (/[\r\n]/u.test(proxyUrl)) throw new Error('Invalid HTTP proxy URL');
  if (!proxyUrl.startsWith('http://') && !proxyUrl.startsWith('https://')) return;
  const proxy = new URL(proxyUrl);

  // Native HTTP proxy bypass rules see the pinned socket hostname and default port.
  const host = address.address.toLowerCase();
  const noProxy = process.env.no_proxy || process.env.NO_PROXY;
  const bypass = noProxy?.split(',').some((value) => {
    const entry = value.trim().toLowerCase();
    if (entry === '*' || entry === host || entry === `${host}:80`) return true;
    if (entry.startsWith('*.')) return host.endsWith(entry.slice(1));
    if (entry.startsWith('.')) {
      const suffix = entry.slice(1);
      // Node 22 accepts any suffix after the dot. Node 24 requires a label boundary.
      return process.versions.node.startsWith('22.') ? host.endsWith(suffix) : host === suffix || host.endsWith(entry);
    }
    if (address.family === 4 && entry.includes('-')) {
      const [start, end] = entry.split('-', 2).map((ip) => ip.trim());
      if (isIPv4(start) && isIPv4(end)) {
        const ip = ipv4Number(host);
        return ip >= ipv4Number(start) && ip <= ipv4Number(end);
      }
    }
    return false;
  });
  return bypass ? undefined : proxy;
}

function requestPinned(url: URL, address: Address, signal: AbortSignal, accept: string): Promise<WebResponse> {
  const secure = url.protocol === 'https:';
  const proxy = secure ? undefined : httpProxyFor(address);
  const secureProxy = proxy?.protocol === 'https:';
  const client = secure || secureProxy ? https : http;
  const hostname = (proxy ?? url).hostname.replace(/^\[|\]$/gu, '');
  const target = address.family === 6 ? `[${address.address}]` : address.address;
  // Node's forward proxy agent requires the HTTP target authority to match Host.
  // Connect directly to the configured proxy to keep the pinned IP and original Host.
  const requestPath = `${proxy ? `http://${target}` : ''}${url.pathname}${url.search}`;
  const proxyAuth =
    proxy && (proxy.username || proxy.password)
      ? Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')
      : undefined;
  return new Promise((resolve, reject) => {
    const request = client.request(
      {
        hostname: proxy ? hostname : address.address,
        port: proxy?.port || undefined,
        path: requestPath,
        signal,
        ...(!secure ? { agent: false } : {}),
        ...(secureProxy ? { servername: isIP(hostname) ? '' : hostname } : {}),
        ...(secure && !isIP(hostname) ? { servername: hostname } : {}),
        headers: {
          Host: url.host,
          Connection: 'close',
          'User-Agent': 'Mozilla/5.0 (compatible; AIPM Workspace/0.1)',
          Accept: accept,
          'Accept-Encoding': 'identity',
          ...(proxy ? { 'Proxy-Connection': 'close' } : {}),
          ...(proxyAuth ? { 'Proxy-Authorization': `Basic ${proxyAuth}` } : {}),
        },
      },
      (response) => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: response }),
    );
    request.once('error', reject);
    request.end();
  });
}

function extractHtml(
  html: string,
  url: URL,
  collectImages: boolean,
): Pick<ImportedWebText, 'title' | 'body' | 'images'> {
  // JSDOM does not execute scripts or load subresources with these options.
  const dom = new JSDOM(html, { virtualConsole: new VirtualConsole() });
  try {
    const document = dom.window.document;
    const title =
      document.title.trim() ||
      document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ||
      document.querySelector('#activity-name')?.textContent?.trim() ||
      '';
    const hasPasswordForm = !!document.querySelector('input[type="password"]');
    const hasMetaRedirect = !!document.querySelector('meta[http-equiv="refresh" i]');
    document
      .querySelectorAll(
        'script, style, noscript, template, iframe, nav, aside, footer, form, svg, canvas, [hidden], [aria-hidden="true"]',
      )
      .forEach((node) => node.remove());
    const article = document.querySelector('#js_content, [itemprop="articleBody"], article');
    const main = document.querySelector('main, [role="main"]');
    const root = article ?? main ?? document.body;
    const gateTitle = /^(?:登录|安全验证|验证码|sign in\b|log in\b|access denied\b|captcha\b)/iu.test(title);
    if (
      hasMetaRedirect ||
      (url.hostname === 'mp.weixin.qq.com' &&
        (url.pathname.includes('wappoc_appmsgcaptcha') ||
          (!article && !!document.querySelector('[id*="captcha"], [class*="captcha"]')))) ||
      (!article && (hasPasswordForm || gateTitle)) ||
      (!article && !main && !root.querySelector('p, pre, blockquote'))
    )
      return { title, body: '' };
    const images: WebImageCandidate[] = [];
    if (collectImages) {
      for (const [index, image] of [...root.querySelectorAll('img')].entries()) {
        const src = image.getAttribute('data-src') || image.getAttribute('data-original') || image.getAttribute('src');
        if (!src) continue;
        const original = URL.parse(src, url);
        const caption = image.closest('figure')?.querySelector('figcaption, caption')?.textContent?.trim() ?? '';
        const label = image.getAttribute('alt')?.trim() || image.getAttribute('title')?.trim() || '';
        let block: Element = image;
        while (block.parentElement && block.parentElement !== root && !block.parentElement.textContent?.trim())
          block = block.parentElement;
        const before = block.previousElementSibling?.textContent?.trim().slice(-180) ?? '';
        const after = block.nextElementSibling?.textContent?.trim().slice(0, 180) ?? '';
        const context = [before, after].filter(Boolean).join('\n');
        const explicit =
          /流程|架构|拓扑|线路|关系图|截图|示意图|图表|表格|如下图|见下图|对照|这张图|评论|示例|样例|例子|看图|diagram|flowchart|architecture|chart|screenshot|illustrat|example|figure|\btable\b/iu.test(
            `${label} ${caption} ${context}`,
          );
        const width = Number.parseFloat(image.getAttribute('data-w') || image.getAttribute('width') || '') || 0;
        const height =
          Number.parseFloat(image.getAttribute('height') || '') ||
          width * (Number.parseFloat(image.getAttribute('data-ratio') || '') || 0);
        if (
          !original ||
          !['http:', 'https:'].includes(original.protocol) ||
          original.username ||
          original.password ||
          original.port ||
          /(?:^|[/_.-])(?:logo|avatar|tracking|pixel|spacer|badge|emoji|qrcode|qr-code|favicon)(?:[/_.-]|$)/iu.test(
            original.pathname,
          ) ||
          /^(?:logo|头像|二维码|扫码关注|装饰|图标|emoji|icon)$/iu.test(label) ||
          (!explicit && ((width > 0 && width < 80) || (height > 0 && height < 40)))
        )
          continue;
        let marker = `⟦网页图片 ${index + 1}⟧`;
        while (root.textContent?.includes(marker)) marker = `⟦${marker}⟧`;
        image.replaceWith(`\n\n${marker}\n\n`);
        images.push({
          marker,
          url: original.href,
          label: (caption || label).slice(0, 240),
          context,
          width,
          height,
          explicit,
        });
      }
    }
    for (const block of root.querySelectorAll(
      'address, blockquote, br, div, h1, h2, h3, h4, h5, h6, li, p, pre, section, tr',
    )) {
      block.before('\n');
      block.after('\n');
    }
    root.querySelectorAll('td, th').forEach((cell) => cell.after('\t'));
    const body = (root.textContent ?? '')
      .replace(/\u00a0/gu, ' ')
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .join('\n')
      .replace(/\n{3,}/gu, '\n\n')
      .trim();
    if (
      /^(?:loading|正在加载|请稍候)[.…。\s]*$/iu.test(body) ||
      (body.length < 300 &&
        /enable javascript|请启用\s*javascript|captcha|安全验证|验证后继续|请先登录|sign in to continue|log in to continue/iu.test(
          `${title}\n${body}`,
        ))
    ) {
      return { title, body: '' };
    }
    return {
      title: title || root.querySelector('h1')?.textContent?.trim() || '',
      body,
      ...(images.length ? { images } : {}),
    };
  } finally {
    dom.window.close();
  }
}

export async function readPublicResource(
  value: string,
  limits: { accept: string; mime: RegExp; bytes: number; label: string },
  options: WebOptions = {},
): Promise<{ bytes: Buffer; type: string; finalUrl: string }> {
  const resolve = options.resolve ?? ((hostname: string) => lookup(hostname, { all: true }));
  const request = options.request ?? requestPinned;
  const controller = new AbortController();
  const signal = controller.signal;
  const timeoutError = new RawUrlError('URL_FETCH_TIMEOUT', '读取网页超时。', 504);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, options.timeoutMs ?? WEB_TIMEOUT_MS);
  });

  const read = async () => {
    let url = webUrl(value);
    const visited = new Set<string>();
    for (let hop = 0; ; hop++) {
      if (visited.has(url.href)) throw new RawUrlError('URL_REDIRECT_LIMIT', '网页重定向形成循环。', 422);
      visited.add(url.href);
      const hostname = url.hostname.replace(/^\[|\]$/gu, '').replace(/\.$/u, '');
      const family = isIP(hostname);
      const addresses = family ? [{ address: hostname, family }] : await resolve(hostname);
      signal.throwIfAborted();
      if (!addresses.length || addresses.some((address) => !publicAddress(address))) {
        throw new RawUrlError('URL_FETCH_BLOCKED', '网页地址解析到内网、回环或保留地址，已停止读取。', 400);
      }
      const response = await request(url, addresses[0], signal, limits.accept);
      const abortBody = () => response.body.destroy();
      signal.addEventListener('abort', abortBody, { once: true });
      try {
        signal.throwIfAborted();
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (hop === MAX_REDIRECTS || typeof response.headers.location !== 'string' || !response.headers.location) {
            throw new RawUrlError('URL_REDIRECT_LIMIT', '网页重定向过多或缺少目标地址。', 422);
          }
          url = webUrl(response.headers.location, url);
          continue;
        }
        if (response.status === 206) throw new RawUrlError('URL_BODY_UNAVAILABLE', '网页只返回了部分正文。', 422);
        if (response.status < 200 || response.status >= 300) {
          throw new RawUrlError(
            'URL_FETCH_FAILED',
            `网页返回 HTTP ${response.status}，可能需要登录或不允许读取。`,
            422,
          );
        }
        const contentType = response.headers['content-type'] ?? '';
        const mime = contentType.split(';', 1)[0].trim().toLowerCase();
        const encoding = response.headers['content-encoding']?.trim().toLowerCase();
        if (!limits.mime.test(mime) || (encoding && encoding !== 'identity')) {
          throw new RawUrlError('URL_CONTENT_UNSUPPORTED', `链接未返回可读取的${limits.label}。`, 422);
        }
        if (Number(response.headers['content-length']) > limits.bytes) {
          throw new RawUrlError(
            'URL_RESPONSE_TOO_LARGE',
            `${limits.label}响应超过 ${limits.bytes / 1024 / 1024} MiB 上限。`,
            413,
          );
        }
        let bytes = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of response.body) {
          signal.throwIfAborted();
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buffer.length;
          if (bytes > limits.bytes)
            throw new RawUrlError(
              'URL_RESPONSE_TOO_LARGE',
              `${limits.label}响应超过 ${limits.bytes / 1024 / 1024} MiB 上限。`,
              413,
            );
          chunks.push(buffer);
        }
        return { bytes: Buffer.concat(chunks, bytes), type: contentType, finalUrl: url.href };
      } finally {
        signal.removeEventListener('abort', abortBody);
        response.body.destroy();
      }
    }
  };

  try {
    return await Promise.race([read(), timedOut]);
  } catch (error) {
    if (signal.aborted) throw timeoutError;
    if (error instanceof RawUrlError) throw error;
    throw new RawUrlError('URL_FETCH_FAILED', '无法读取该网页。', 422);
  } finally {
    clearTimeout(timeout);
  }
}

export async function readPublicRawUrl(value: string, options: WebOptions = {}): Promise<ImportedWebText> {
  const result = await readPublicResource(
    value,
    {
      accept: 'text/html,application/xhtml+xml,text/plain',
      mime: /^(?:text\/(?:html|plain)|application\/xhtml\+xml)$/u,
      bytes: options.images ? 6 * 1024 * 1024 : MAX_WEB_BYTES,
      label: '网页或纯文本',
    },
    options,
  );
  const html = !/^text\/plain\b/iu.test(result.type);
  const charset =
    /charset\s*=\s*["']?([\w-]+)/iu.exec(result.type)?.[1] ??
    (html
      ? /<meta\b[^>]*\bcharset\s*=\s*["']?([\w-]+)/iu.exec(result.bytes.subarray(0, 4096).toString('ascii'))?.[1]
      : undefined) ??
    'utf-8';
  let text: string;
  try {
    text = new TextDecoder(charset, { fatal: true }).decode(result.bytes);
  } catch {
    throw new RawUrlError('URL_CONTENT_UNSUPPORTED', '网页编码无法可靠解读。', 422);
  }
  const extracted = html
    ? extractHtml(text, new URL(result.finalUrl), options.images ?? false)
    : { title: '', body: text };
  if (!extracted.body.trim())
    throw new RawUrlError('URL_BODY_UNAVAILABLE', '没有取得可保存的静态正文，网页可能需要登录、验证或运行脚本。', 422);
  if (extracted.body.length > MAX_BODY_CHARS)
    throw new RawUrlError('URL_BODY_TOO_LARGE', '网页正文超过 500,000 字符上限。', 413);
  return {
    ...extracted,
    finalUrl: result.finalUrl,
    fetchedAt: new Date().toISOString(),
    parser: html ? 'url_html_text' : 'url_plain_text',
    note: html ? '从静态网页提取正文文本。' : '保存链接响应中的纯文本正文。',
  };
}
