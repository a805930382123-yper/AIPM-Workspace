import { RawStore } from '../../services/raw/store.ts';
import { RawTranslationService } from '../../services/raw/translations.ts';

const [root, rawId] = process.argv.slice(2);
const raws = new RawStore(root);
const service = new RawTranslationService({
  root,
  raws,
  provider: async () => ({
    name: 'fake',
    model: 'fixture-translation',
    complete: async (request) => {
      const input = JSON.parse(request.user) as { index: number };
      if (input.index === 1) {
        process.send?.({ held: input.index });
        await new Promise<void>(() => {
          /* The parent stops this process after the durable request count. */
        });
      }
      const text = JSON.stringify({ translation: '子进程已保存首段。' });
      return { text, bytes: Buffer.byteLength(text), finishReason: 'stop' };
    },
  }),
});
setInterval(() => {}, 1000);
await service.start(rawId);
