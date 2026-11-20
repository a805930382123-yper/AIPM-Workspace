import { execFile } from 'node:child_process';
import { addAbortListener } from 'node:events';
import { promisify } from 'node:util';
import type { ReminderKind } from './reminders.ts';

export type DesktopNotice =
  | { kind: ReminderKind; itemTitle: string; count?: number }
  | { kind: 'summary'; count: number }
  | { kind: 'test' };

export type DesktopDeliveryResult = {
  deliveryStatus: 'delivered' | 'suppressed_non_windows' | 'failed';
  deliveryError?: string;
};

export interface DesktopNotifier {
  send(notice: DesktopNotice, signal: AbortSignal): Promise<DesktopDeliveryResult>;
}

const windowsPowerShellAppId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';
const invoke = promisify(execFile);
const xmlCharacters: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

export function desktopToastXml(notice: DesktopNotice): string {
  let title: string, detail: string;
  if (notice.kind === 'test') {
    title = 'AIPM Workspace 通知测试';
    detail = '这是一条桌面通知测试。';
  } else if (notice.kind === 'summary') {
    title = 'AIPM Workspace 事项提醒';
    detail = '另有 ' + notice.count + ' 条待跟进事项。';
  } else {
    title = notice.itemTitle;
    if (notice.kind === 'due_follow_up') detail = notice.count ? '跟进已逾期 ' + notice.count + ' 天' : '今日到期跟进';
    else if (notice.kind === 'stale_item') detail = '久未推进';
    else detail = '有 ' + notice.count + ' 条新资料待分析';
  }
  const escape = (label: string) => Array.from(label.replace(/[\u0000-\u001f\u007f\uFFFE\uFFFF\p{Cs}]/gu, ' ').trim())
    .slice(0, 120).join('').replace(/[&<>"']/gu, value => xmlCharacters[value]!);
  return '<toast><visual><binding template="ToastGeneric"><text>' + escape(title)
    + '</text><text>' + escape(detail) + '</text></binding></visual></toast>';
}

export function createDesktopNotifier(platform = process.platform, env = process.env): DesktopNotifier {
  if (platform !== 'win32' || env.NODE_ENV === 'test' || env.NODE_TEST_CONTEXT || env.CI === 'true' || env.CI === '1') {
    return { send: async () => ({ deliveryStatus: 'suppressed_non_windows' }) };
  }
  return {
    async send(notice, signal) {
      const xml = Buffer.from(desktopToastXml(notice), 'utf8').toString('base64');
      const command = [
        "$ErrorActionPreference = 'Stop'",
        'try {',
        '  $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]',
        '  $null = [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType=WindowsRuntime]',
        '  $null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime]',
        "  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument",
        "  $xml.LoadXml([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + xml + "')))",
        "  $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('" + windowsPowerShellAppId + "')",
        '  $setting = [string]$notifier.Setting',
        "  if ($setting -in @('DisabledForApplication', 'DisabledForUser', 'DisabledByGroupPolicy', 'DisabledByManifest')) { [Console]::WriteLine('disabled:' + $setting); exit 2 }",
        '  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)',
        '  $notifier.Show($toast)',
        "  [Console]::WriteLine('delivered')",
        "} catch { [Console]::WriteLine('winrt_error:' + $_.Exception.HResult.ToString('X8')); exit 1 }",
      ].join('\n');
      try {
        const { stdout } = await invoke('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
          Buffer.from(command, 'utf16le').toString('base64')], { signal, windowsHide: true, timeout: 5000, maxBuffer: 4096 });
        if (stdout.trim() === 'delivered') return { deliveryStatus: 'delivered' };
      } catch (error) {
        const stdout = (error as { stdout?: string }).stdout?.trim() ?? '';
        const disabled = /^disabled:(DisabledForApplication|DisabledForUser|DisabledByGroupPolicy|DisabledByManifest)$/u.exec(stdout);
        if (disabled) return { deliveryStatus: 'failed', deliveryError: 'Windows 已禁用通知（' + disabled[1] + '）。' };
        if (signal.aborted) throw error;
        if ((error as { killed?: boolean }).killed) return { deliveryStatus: 'failed', deliveryError: '桌面通知超时。' };
        const winrt = /^winrt_error:([A-F0-9]{8})$/u.exec(stdout);
        if (winrt) return { deliveryStatus: 'failed', deliveryError: 'Windows 通知调用失败（HRESULT 0x' + winrt[1] + '）。' };
      }
      return { deliveryStatus: 'failed', deliveryError: 'Windows 通知调用失败。' };
    },
  };
}

export async function sendDesktopNotice(notifier: DesktopNotifier, notice: DesktopNotice, signal?: AbortSignal, timeoutMs = 5000): Promise<DesktopDeliveryResult> {
  const timeout = new AbortController();
  const bounded = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  let listener: Disposable | undefined;
  try {
    bounded.throwIfAborted();
    const stopped = new Promise<DesktopDeliveryResult>(resolve => {
      listener = addAbortListener(bounded, () => resolve({
        deliveryStatus: 'failed', deliveryError: timeout.signal.aborted ? '桌面通知超时。' : '桌面通知已取消。',
      }));
    });
    return await Promise.race([stopped, notifier.send(notice, bounded)]);
  } catch {
    return { deliveryStatus: 'failed', deliveryError: signal?.aborted ? '桌面通知已取消。' : '桌面通知调用失败。' };
  } finally {
    clearTimeout(timer);
    listener?.[Symbol.dispose]();
  }
}
