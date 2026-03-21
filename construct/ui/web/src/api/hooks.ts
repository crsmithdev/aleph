import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// --- Types (inlined from @construct/goals) ---

interface Goal {
  id: string;
  title: string;
  priority: string;
  state: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Category {
  id: string;
  name: string;
  color: string | null;
  createdAt: string;
}

interface Note {
  id: string;
  goalId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface Todo {
  id: string;
  title: string;
  done: boolean;
  note: string | null;
  dueDate: string | null;
  goalId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RecurringTodo {
  id: string;
  title: string;
  frequency: string;
  goalId: string | null;
  endDate: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface HistoryLog {
  id: string;
  goalId: string;
  eventType: import('../types').HistoryEvent;
  details: Record<string, unknown>;
  createdAt: string;
}

// --- Goals ---

export function useGoals(filters?: { state?: string; priority?: string; category?: string; archived?: boolean }) {
  const params = new URLSearchParams();
  if (filters?.state) params.set('state', filters.state);
  if (filters?.priority) params.set('priority', filters.priority);
  if (filters?.category) params.set('category', filters.category);
  if (filters?.archived !== undefined) params.set('archived', String(filters.archived));
  const qs = params.toString();
  return useQuery({
    queryKey: ['goals', filters],
    queryFn: () => api.get<Goal[]>(`/goals${qs ? `?${qs}` : ''}`),
  });
}

export function useGoal(id: string) {
  return useQuery({
    queryKey: ['goals', id],
    queryFn: () => api.get<Goal & { categories: Category[]; latestNote?: Note }>(`/goals/${id}`),
    enabled: !!id,
  });
}

export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string; priority?: string; state?: string }) =>
      api.post<Goal>('/goals', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });
}

export function useUpdateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; title?: string; priority?: string; state?: string; archived?: boolean }) =>
      api.patch<Goal>(`/goals/${id}`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['goals'] });
      qc.invalidateQueries({ queryKey: ['goals', vars.id] });
    },
  });
}

export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/goals/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });
}

// --- Categories ---

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<Category[]>('/categories'),
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; color?: string }) =>
      api.post<Category>('/categories', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; color?: string }) =>
      api.patch<Category>(`/categories/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/categories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

// --- Goal Categories ---

export function useGoalCategories(goalId: string) {
  return useQuery({
    queryKey: ['goals', goalId, 'categories'],
    queryFn: async () => {
      const goal = await api.get<Goal & { categories: Category[] }>(`/goals/${goalId}`);
      return goal.categories;
    },
    enabled: !!goalId,
  });
}

export function useSetGoalCategories(goalId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categoryIds: string[]) =>
      api.put<void>(`/goals/${goalId}/categories`, { categoryIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goals', goalId] });
      qc.invalidateQueries({ queryKey: ['goals', goalId, 'categories'] });
      qc.invalidateQueries({ queryKey: ['goals'] });
    },
  });
}

// --- Notes ---

export function useNotes(goalId: string) {
  return useQuery({
    queryKey: ['goals', goalId, 'notes'],
    queryFn: () => api.get<Note[]>(`/goals/${goalId}/notes`),
    enabled: !!goalId,
  });
}

export function useCreateNote(goalId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { content: string }) =>
      api.post<Note>(`/goals/${goalId}/notes`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goals', goalId, 'notes'] });
      qc.invalidateQueries({ queryKey: ['goals', goalId] });
    },
  });
}

export function useUpdateNote(goalId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, ...data }: { noteId: string; content: string }) =>
      api.patch<Note>(`/goals/${goalId}/notes/${noteId}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goals', goalId, 'notes'] });
      qc.invalidateQueries({ queryKey: ['goals', goalId] });
    },
  });
}

export function useDeleteNote(goalId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) =>
      api.delete(`/goals/${goalId}/notes/${noteId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goals', goalId, 'notes'] });
      qc.invalidateQueries({ queryKey: ['goals', goalId] });
    },
  });
}

// --- History ---

export function useHistory(goalId: string) {
  return useQuery({
    queryKey: ['goals', goalId, 'history'],
    queryFn: () => api.get<HistoryLog[]>(`/goals/${goalId}/history`),
    enabled: !!goalId,
  });
}

// --- Todos ---

interface TodoDayResponse {
  overdue: (Todo & { goalTitle?: string })[];
  todos: (Todo & { goalTitle?: string })[];
  completed: (Todo & { goalTitle?: string })[];
}

export function useTodos(date?: string) {
  const effectiveDate = date ?? new Date().toISOString().slice(0, 10);
  return useQuery({
    queryKey: ['todos', effectiveDate],
    queryFn: () => api.get<TodoDayResponse>(`/todos/day/${effectiveDate}`),
  });
}

export function useCreateTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string; date: string; goalId?: string; order?: number }) =>
      api.post<Todo>('/todos', data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['todos', vars.date] });
    },
  });
}

export function useUpdateTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; title?: string; completed?: boolean; date?: string; order?: number; goalId?: string | null }) =>
      api.patch<Todo>(`/todos/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todos'] });
    },
  });
}

export function useDeleteTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/todos/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todos'] });
    },
  });
}

// --- Recurring Todos ---

export function useRecurringTodos() {
  return useQuery({
    queryKey: ['recurring-todos'],
    queryFn: () => api.get<RecurringTodo[]>('/recurring-todos'),
  });
}

export function useCreateRecurringTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string; recurrence: string; goalId?: string }) =>
      api.post<RecurringTodo>('/recurring-todos', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring-todos'] }),
  });
}

export function useUpdateRecurringTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; title?: string; recurrence?: string; goalId?: string | null; active?: boolean }) =>
      api.patch<RecurringTodo>(`/recurring-todos/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring-todos'] }),
  });
}

export function useDeleteRecurringTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/recurring-todos/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring-todos'] }),
  });
}

export function useCompleteRecurringTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, periodKey }: { id: string; periodKey: string }) =>
      api.post<void>(`/recurring-todos/${id}/complete`, { periodKey }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring-todos'] });
      qc.invalidateQueries({ queryKey: ['todos'] });
    },
  });
}

export function useUncompleteRecurringTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, periodKey }: { id: string; periodKey: string }) =>
      api.post<void>(`/recurring-todos/${id}/uncomplete`, { periodKey }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring-todos'] });
      qc.invalidateQueries({ queryKey: ['todos'] });
    },
  });
}

// --- Summary ---

export function useSummary(startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['summary', startDate, endDate],
    queryFn: () => api.get<unknown>(`/summary?start=${startDate}&end=${endDate}`),
    enabled: !!startDate && !!endDate,
  });
}

// --- Webhooks ---

type Webhook = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
};

export function useWebhooks() {
  return useQuery({
    queryKey: ['webhooks'],
    queryFn: () => api.get<Webhook[]>('/webhooks'),
  });
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { url: string; events: string[] }) =>
      api.post<Webhook>('/webhooks', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });
}

export function useUpdateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; url?: string; events?: string[]; active?: boolean }) =>
      api.patch<Webhook>(`/webhooks/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/webhooks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });
}
