import type { Raw } from '../../api';

export const isPdfRaw = (raw: Raw) => raw.assetFormat === 'pdf' && !!raw.assetId;
export const isScannedPdf = (raw: Raw) => isPdfRaw(raw) && !raw.body.trim();
