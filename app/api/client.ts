/** Error carrying the server's machine-readable code and optional details. */
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type Stats = {
  rawCount: number;
  wikiCount: number;
  thisWeekNewCount: number;
  pendingConfirmationCount: number;
  openAuditCount: number;
  promptCount: number;
  weekStartsOn: string;
  recentChanges?: Array<{
    time: string;
    action: string;
    id: string;
    title: string;
    type: string;
    revision: number;
    isDemo?: boolean;
  }>;
};

/** totalIssues counts known issues; partial scans only establish a lower bound. */
export type RecoveryScan = {
  scanned: boolean;
  partial?: boolean;
  overflow: boolean;
  truncated?: boolean;
  totalIssues?: number;
  hiddenIssues?: number;
  scannedFiles?: number;
  scannedBytes?: number;
  items: Array<{ id: string; kind: string; reason: string }>;
};

async function readResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }
  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    const details = error?.details as { category?: unknown } | undefined;
    if (
      details?.category === 'recovery' ||
      ['STORAGE_CORRUPT', 'STORAGE_READ_FAILED', 'RECOVERY_SECRET_BLOCKED'].includes(error?.code ?? '')
    )
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('storage-recovery-discovered'));
    throw new ApiError(
      error?.message || '请求失败，请稍后重试。',
      error?.code || 'REQUEST_FAILED',
      response.status,
      error?.details,
    );
  }
  if (data && typeof data === 'object' && (data as { needsRecovery?: unknown }).needsRecovery === true)
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('storage-recovery-discovered'));
  return data as T;
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  return readResponse<T>(
    await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } }),
  );
}

/** Multipart upload: the browser sets its own Content-Type with the boundary. */
export async function apiForm<T>(url: string, form: FormData): Promise<T> {
  return readResponse<T>(await fetch(url, { method: 'POST', body: form }));
}

/** Reads plain-text payloads (e.g. markdown exports), delegating error handling to `readResponse`. */
export async function apiText(url: string, init?: RequestInit): Promise<string> {
  const response = await fetch(url, init);
  return response.ok ? response.text() : readResponse<string>(response);
}

export const dateText = (value?: string) =>
  value
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    : '未填写';

export const bytesText = (value?: number) =>
  typeof value === 'number'
    ? value < 1024
      ? `${value} B`
      : value < 1024 * 1024
        ? `${(value / 1024).toFixed(1)} KiB`
        : `${(value / 1024 / 1024).toFixed(2)} MiB`
    : '未记录';
