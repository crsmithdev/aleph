import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

import type { Goal, Category, Note, Todo, Habit, HistoryLog } from '../types';

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

interface TodoActiveResponse {
  active: (Todo & { goalTitle?: string })[];
  completed: (Todo & { goalTitle?: string })[];
}

export function useTodos() {
  return useQuery({
    queryKey: ['todos'],
    queryFn: () => api.get<TodoActiveResponse>('/todos/active'),
  });
}

export function useCreateTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string; goalId?: string }) =>
      api.post<Todo>('/todos', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todos'] });
    },
  });
}

export function useUpdateTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; title?: string; done?: boolean; goalId?: string | null; note?: string | null }) =>
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

// --- Habits ---

export function useHabits() {
  return useQuery({
    queryKey: ['habits'],
    queryFn: () => api.get<Habit[]>('/habits'),
  });
}

export function useCreateHabit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string; frequency: string; goalId?: string }) =>
      api.post<Habit>('/habits', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['habits'] }),
  });
}

export function useUpdateHabit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; title?: string; frequency?: string; goalId?: string | null; active?: boolean }) =>
      api.patch<Habit>(`/habits/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['habits'] }),
  });
}

export function useDeleteHabit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/habits/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['habits'] }),
  });
}

export function useCompleteHabit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, periodKey }: { id: string; periodKey: string }) =>
      api.post<void>(`/habits/${id}/complete`, { periodKey }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits'] });
      qc.invalidateQueries({ queryKey: ['todos'] });
    },
  });
}

export function useUncompleteHabit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, periodKey }: { id: string; periodKey: string }) =>
      api.post<void>(`/habits/${id}/uncomplete`, { periodKey }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits'] });
      qc.invalidateQueries({ queryKey: ['todos'] });
    },
  });
}

// --- Summary ---

export function useSummary(startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['summary', startDate, endDate],
    queryFn: () => api.get<unknown>(`/summary?start=${startDate}&end=${endDate}&tz=${new Date().getTimezoneOffset()}`),
    enabled: !!startDate && !!endDate,
  });
}

