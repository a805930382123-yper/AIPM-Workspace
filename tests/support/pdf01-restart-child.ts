import { AssetStore } from '../../services/raw/assets.ts';
import { RawStore } from '../../services/raw/store.ts';
import { OpenAiCompatibleProvider } from '../../services/llm/provider.ts';
import { PdfPageService } from '../../services/raw/pdf-pages.ts';

const [root, rawId, url] = process.argv.slice(2);
const raws = new RawStore(root);
const assets = new AssetStore(root);
const service = new PdfPageService({
  root,
  raws,
  assets,
  provider: async () =>
    new OpenAiCompatibleProvider({
      baseUrl: url,
      model: 'fixture-vision',
      apiKey: 'synthetic-pdf01-test-key',
      source: 'local-file',
    }),
});
await service.start(rawId);
setInterval(() => {}, 1000);
