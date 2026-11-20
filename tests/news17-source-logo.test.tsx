import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SourceLogo } from '../app/pages/SourceLogo';
import files from '../app/source-logo-files.json';

test('来源 Logo 优先使用本地图片，并在远程或本地图片加载失败后显示文字标识', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.getElementById('root')!;
  const root = createRoot(container);
  const render = (props: Parameters<typeof SourceLogo>[0]) => act(async () => root.render(<SourceLogo {...props} />));
  const expectImage = (src: string) => {
    const image = container.querySelector('img');
    assert.ok(image);
    assert.equal(image.getAttribute('src'), src);
    assert.equal(image.getAttribute('alt'), '');
    assert.equal(image.getAttribute('loading'), 'lazy');
    assert.equal(image.getAttribute('decoding'), 'async');
    return image;
  };

  try {
    await render({ sourceId: 'niq', sourceName: 'Unknown', officialUrl: 'https://github.com/example/repo' });
    expectImage(`/icons/sources/${files.niq.file}`);
    await render({ sourceName: '  ＫＡＲＰＡＴＨＹ · YouTube ', size: 'md' });
    const portrait = expectImage(`/icons/sources/${files.karpathy.file}`);
    assert.ok(portrait.closest('.source-logo-md.source-logo-portrait'));
    assert.ok(container.querySelector('.source-logo-platform-youtube svg'));
    await act(async () => portrait.dispatchEvent(new dom.window.Event('error')));
    assert.ok(container.querySelector('.source-logo-portrait .source-logo-fallback'));
    assert.equal(container.querySelector('img'), null);

    await render({ sourceName: 'Example Source', officialUrl: 'https://github.com/owner/project' });
    expectImage('https://github.com/owner.png?size=64');
    await render({ sourceName: 'Example Source', officialUrl: 'https://example.com/about' });
    const remote = expectImage('https://www.google.com/s2/favicons?domain=example.com&sz=64');
    await act(async () => remote.dispatchEvent(new dom.window.Event('error')));
    const fallback = container.querySelector<HTMLElement>('.source-logo-fallback');
    assert.equal(fallback?.textContent, 'ES');
    assert.ok(fallback?.style.backgroundColor);
    assert.equal(container.querySelector('img'), null);

    await render({ sourceName: 'Example Source', officialUrl: 'invalid' });
    assert.equal(container.querySelector<HTMLElement>('.source-logo-fallback')?.style.backgroundColor, fallback.style.backgroundColor);
    assert.equal(container.querySelector('img'), null);

    await render({ sourceName: 'PwC' });
    const known = expectImage(`/icons/sources/${files.pwc.file}`);
    await act(async () => known.dispatchEvent(new dom.window.Event('error')));
    assert.equal(container.querySelector('.source-logo-fallback')?.textContent, 'PwC');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
