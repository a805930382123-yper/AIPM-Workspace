import type files from '../source-logo-files.json';

export type Platform = 'youtube' | 'x' | 'github' | 'blog';

type LogoIdentity = { icon: keyof typeof files; portrait?: boolean };
type PlatformChannel = { name: string; names: string[]; platform: Platform; homepage: string };
type SourceDisplay = LogoIdentity &
  (
    | { kind: 'single'; names: string[] }
    | { kind: 'persona_group'; name: string; channels: Record<string, PlatformChannel> }
  );

const sourceDisplays: Record<string, SourceDisplay> = {
  aihot: { kind: 'single', icon: 'aihot', names: ['AIHOT'] },
  'openai-cookbook': { kind: 'single', icon: 'openai', names: ['OpenAI Cookbook', 'OpenAI'] },
  'anthropic-engineering': { kind: 'single', icon: 'anthropic', names: ['Anthropic Engineering', 'Anthropic'] },
  'huggingface-blog': {
    kind: 'single',
    icon: 'huggingface',
    names: ['Hugging Face 官方博客', 'Hugging Face Blog', 'Hugging Face'],
  },
  'simon-prompt-engineering': {
    kind: 'single',
    icon: 'simonw',
    names: ['Simon Willison 提示词专题', 'Simon Willison', 'simonw'],
    portrait: true,
  },
  karpathy: {
    kind: 'persona_group',
    name: 'Andrej Karpathy',
    icon: 'karpathy',
    portrait: true,
    channels: {
      'karpathy-youtube': {
        name: 'YouTube',
        names: ['Karpathy · YouTube'],
        platform: 'youtube',
        homepage: 'https://www.youtube.com/channel/UCXUPKJO5MZQN11PqgIvyuvQ',
      },
      'karpathy-x': {
        name: 'X',
        names: ['Karpathy · X 公开帖', 'Karpathy X'],
        platform: 'x',
        homepage: 'https://x.com/karpathy',
      },
      'karpathy-github': {
        name: 'GitHub',
        names: ['Karpathy · GitHub'],
        platform: 'github',
        homepage: 'https://github.com/karpathy?tab=repositories',
      },
      'karpathy-blog': {
        name: 'Bear Blog',
        names: ['Karpathy · Bear Blog', 'Karpathy Blog'],
        platform: 'blog',
        homepage: 'https://karpathy.bearblog.dev/blog/',
      },
    },
  },
  worldpanel: { kind: 'single', icon: 'worldpanel', names: ['Worldpanel by Numerator', 'Worldpanel'] },
  niq: { kind: 'single', icon: 'niq', names: ['NIQ', 'NielsenIQ'] },
  nbs: { kind: 'single', icon: 'nbs', names: ['国家统计局', 'NBS'] },
  pwc: { kind: 'single', icon: 'pwc', names: ['PwC', '普华永道'] },
  kpmg: { kind: 'single', icon: 'kpmg', names: ['KPMG', '毕马威'] },
  mintel: { kind: 'single', icon: 'mintel', names: ['Mintel', '英敏特'] },
};

export const newsSourceIdentities = new Map<
  string,
  LogoIdentity & { names: string[] } & (
      { channel: PlatformChannel; persona: { id: string; name: string } } | { channel?: undefined; persona?: undefined }
    )
>();

for (const [id, display] of Object.entries(sourceDisplays)) {
  if (display.kind === 'single') {
    newsSourceIdentities.set(id, display);
  } else {
    const { icon, portrait, name } = display;
    const persona = { id, name };
    newsSourceIdentities.set(id, { icon, portrait, names: [name] });
    for (const [channelId, channel] of Object.entries(display.channels)) {
      newsSourceIdentities.set(channelId, { icon, portrait, names: channel.names, channel, persona });
    }
  }
}
