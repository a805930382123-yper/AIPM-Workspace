import type { NewsSaveDependencies } from '../../services/news/raw-save.ts';

export const newsRawFixture: NewsSaveDependencies = {
  acquire: async (item) => ({
    body: item.excerpt,
    extractionParser: 'url_plain_text',
    extractionNote: `来源网页正文：${item.research?.pdfUrl ?? item.url}`,
    urlImport: { finalUrl: item.url, fetchedAt: item.fetchedAt },
    newsMaterial: { kind: 'article', revision: 0 },
  }),
};
