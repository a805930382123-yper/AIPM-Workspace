import { useState } from 'react';
import files from '../source-logo-files.json';

const platforms = {
  youtube: 'M8 5v14l12-7z',
  x: 'M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l8.1-9.3L2.7 2h6.5l4.4 6.7L18.9 2Zm-1.1 18h1.7L8.3 3.9H6.5L17.8 20Z',
  github: 'M12 0a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.4 11.4 0 0 1 6 0C17.3 5.2 18.3 5.5 18.3 5.5c.6 1.6.2 2.9.1 3.2.7.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v2.8c0 .3.2.7.8.6A12 12 0 0 0 12 0Z',
  blog: 'M5 2h9l5 5v15H5V2Zm8 2v5h4l-4-5Zm-5 8v2h8v-2H8Zm0 4v2h8v-2H8Z',
};

type Source = { icon: keyof typeof files; names: string[]; portrait?: boolean; platform?: keyof typeof platforms };

const sources: Record<string, Source> = {
  aihot: { icon: 'aihot', names: ['AIHOT'] },
  'openai-cookbook': { icon: 'openai', names: ['OpenAI Cookbook', 'OpenAI'] },
  'anthropic-engineering': { icon: 'anthropic', names: ['Anthropic Engineering', 'Anthropic'] },
  'huggingface-blog': { icon: 'huggingface', names: ['Hugging Face 官方博客', 'Hugging Face Blog', 'Hugging Face'] },
  'simon-prompt-engineering': { icon: 'simonw', names: ['Simon Willison 提示词专题', 'Simon Willison', 'simonw'], portrait: true },
  'karpathy-github': { icon: 'karpathy', names: ['Karpathy · GitHub'], portrait: true, platform: 'github' },
  'karpathy-blog': { icon: 'karpathy', names: ['Karpathy · Bear Blog', 'Karpathy Blog'], portrait: true, platform: 'blog' },
  'karpathy-youtube': { icon: 'karpathy', names: ['Karpathy · YouTube'], portrait: true, platform: 'youtube' },
  'karpathy-x': { icon: 'karpathy', names: ['Karpathy · X 公开帖', 'Karpathy X'], portrait: true, platform: 'x' },
  worldpanel: { icon: 'worldpanel', names: ['Worldpanel by Numerator', 'Worldpanel'] },
  niq: { icon: 'niq', names: ['NIQ', 'NielsenIQ'] },
  nbs: { icon: 'nbs', names: ['国家统计局', 'NBS'] },
  pwc: { icon: 'pwc', names: ['PwC', '普华永道'] },
  kpmg: { icon: 'kpmg', names: ['KPMG', '毕马威'] },
  mintel: { icon: 'mintel', names: ['Mintel', '英敏特'] },
};

const normalizeName = (name: string) => name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const byName = new Map(Object.values(sources).flatMap(source => source.names.map(name => [normalizeName(name), source] as const)));
const palette = ['#6651a3', '#355f93', '#257267', '#8b452e', '#9a4364'];

function remoteLogo(officialUrl?: string) {
  if (!officialUrl || !URL.canParse(officialUrl)) return;
  const url = new URL(officialUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
  const hostname = url.hostname.toLowerCase();
  const owner = hostname === 'github.com' && /^\/([a-z\d][a-z\d-]{0,38})(?:\/|$)/i.exec(url.pathname)?.[1];
  return owner
    ? `https://github.com/${owner}.png?size=64`
    : `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`;
}

export function SourceLogo({ sourceId, sourceName, officialUrl, size = 'sm', className }: {
  sourceId?: string;
  sourceName: string;
  officialUrl?: string;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}) {
  const nameKey = normalizeName(sourceName);
  const source = (sourceId && Object.hasOwn(sources, sourceId) ? sources[sourceId] : undefined) ?? byName.get(nameKey);
  const src = source ? `/icons/sources/${files[source.icon].file}` : remoteLogo(officialUrl);
  const [failedSrc, setFailedSrc] = useState<string>();
  const words = sourceName.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [];
  const initials = words.length === 1 && /^[a-z\d]{2,3}$/i.test(words[0])
    ? words[0]
    : words.slice(0, 2).map(word => Array.from(word)[0]).join('').toUpperCase() || '?';
  const hash = Array.from(nameKey || sourceId || '').reduce((value, letter) => (value * 31 + letter.codePointAt(0)!) >>> 0, 0);
  return <span className={`source-logo source-logo-${size}${source?.portrait ? ' source-logo-portrait' : ''}${className ? ` ${className}` : ''}`} aria-hidden="true">
    {src && src !== failedSrc
      ? <img key={src} className="source-logo-image" src={src} loading="lazy" decoding="async" alt="" onError={() => setFailedSrc(src)} />
      : <span className="source-logo-fallback" style={{
        backgroundColor: palette[hash % palette.length],
        fontSize: initials.length > 2 ? 'calc(var(--source-logo-size) * .33)' : undefined,
      }}>{initials}</span>}
    {source?.platform && <span className={`source-logo-platform source-logo-platform-${source.platform}`}>
      <svg viewBox="0 0 24 24" focusable="false"><path d={platforms[source.platform]} fill="currentColor" /></svg>
    </span>}
  </span>;
}
