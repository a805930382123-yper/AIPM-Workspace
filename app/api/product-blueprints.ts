import { api, apiText } from './client';
import type { Blueprint, BlueprintDetail } from '../../services/product-blueprints/types';

const url = (id: string) => `/api/product-blueprints/${encodeURIComponent(id)}`;
export const listBlueprints = () =>
  api<{ items: Blueprint[]; errors: { id: string; message: string }[] }>('/api/product-blueprints');
export const createBlueprint = (title: string, oneLiner: string) =>
  api<BlueprintDetail>('/api/product-blueprints', { method: 'POST', body: JSON.stringify({ title, oneLiner }) });
export const getBlueprint = (id: string) => api<BlueprintDetail>(url(id));
export const saveBlueprint = (id: string, baseRevision: number, section: string, data: unknown) =>
  api<BlueprintDetail & { idMap: Record<string, string> }>(url(id), {
    method: 'PUT',
    body: JSON.stringify({ baseRevision, section, data }),
  });
export const deleteBlueprint = (id: string, baseRevision: number) =>
  api<void>(url(id), { method: 'DELETE', body: JSON.stringify({ baseRevision }) });
export const exportBlueprint = (id: string) => apiText(`${url(id)}/export`);
