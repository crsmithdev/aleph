import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export interface Monitor {
  id: string;
  session_id: string | null;
  title: string;
  status: 'active' | 'paused' | 'archived';
  queries: string[];
  fetch_urls: string[];
  schedule: string;
  match_criteria: Record<string, unknown>;
  model: string;
  created_at: string;
  updated_at: string;
}

export interface MonitorSnapshot {
  id: string;
  monitor_id: string;
  cycle_number: number;
  result_hash: string;
  item_count: number;
  cost_usd: number;
  created_at: string;
}

export interface MonitorAlert {
  id: string;
  monitor_id: string;
  alert_type: string;
  title: string;
  content: string;
  source_url: string | null;
  severity: string;
  status: string;
  created_at: string;
}

export function useMonitors(status?: string) {
  const params = status ? `?status=${status}` : '';
  return useQuery({
    queryKey: ['monitors', status],
    queryFn: () => api.get<Monitor[]>(`/research/monitors${params}`),
  });
}

export function useMonitor(id: string) {
  return useQuery({
    queryKey: ['monitors', id],
    queryFn: () => api.get<Monitor>(`/research/monitors/${id}`),
    enabled: !!id,
  });
}

export function useCreateMonitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string; queries: string[]; session_id?: string; schedule?: string }) =>
      api.post<Monitor>('/research/monitors', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitors'] }),
  });
}

export function useUpdateMonitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; status?: string; title?: string }) =>
      api.patch<Monitor>(`/research/monitors/${id}`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['monitors'] });
      qc.invalidateQueries({ queryKey: ['monitors', vars.id] });
    },
  });
}

export function useMonitorSnapshots(monitorId: string) {
  return useQuery({
    queryKey: ['monitor-snapshots', monitorId],
    queryFn: () => api.get<MonitorSnapshot[]>(`/research/monitors/${monitorId}/snapshots`),
    enabled: !!monitorId,
  });
}

export function useMonitorAlerts(monitorId: string, opts?: { severity?: string }) {
  const params = new URLSearchParams();
  if (opts?.severity) params.set('severity', opts.severity);
  const qs = params.toString();
  return useQuery({
    queryKey: ['monitor-alerts', monitorId, opts],
    queryFn: () => api.get<MonitorAlert[]>(`/research/monitors/${monitorId}/alerts${qs ? `?${qs}` : ''}`),
    enabled: !!monitorId,
  });
}

export function useRunMonitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ monitorId, api_key }: { monitorId: string; api_key?: string }) =>
      api.post(`/research/monitors/${monitorId}/run`, { api_key }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['monitor-snapshots', vars.monitorId] });
      qc.invalidateQueries({ queryKey: ['monitor-alerts', vars.monitorId] });
    },
  });
}
