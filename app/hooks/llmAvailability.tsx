import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ChatTier, LlmAvailability } from '../../services/llm/provider-router';
import { api } from '../api/client';

const Availability = createContext<{ status?: LlmAvailability; unavailable?: string; refresh?: () => void }>({});

export function LlmAvailabilityProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<{ status?: LlmAvailability; unavailable?: string }>({
    unavailable: '正在读取模型可用状态…',
  });
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    void api<LlmAvailability>('/api/llm/availability', { signal: controller.signal })
      .then((status) => {
        if (!controller.signal.aborted) setResult({ status });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ unavailable: '无法读取模型状态，请检查本机服务后重试。' });
      });
  }, []);
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 3000);
    window.addEventListener('focus', refresh);
    return () => {
      request.current?.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);
  return <Availability.Provider value={{ ...result, refresh }}>{children}</Availability.Provider>;
}

const reasons = {
  disabled: '模型已在本机配置中关闭。请启用后再使用此操作。',
  unconfigured: '尚未配置可用的模型。请在设置中补齐 Provider 配置。',
  unavailable: '当前模型连接不可用。恢复网络后，可在设置中手动测试连接。',
  authentication: '模型鉴权失败。请核对 API Key 或模型权限，再在设置中测试连接。',
};

export function useLlmAvailability() {
  return useContext(Availability);
}

export function useLlmDisabled(tier: ChatTier = 'heavy'): string | undefined {
  const { status, unavailable } = useLlmAvailability();
  const reason = status?.[tier]?.reason;
  return reason ? reasons[reason] : unavailable;
}
