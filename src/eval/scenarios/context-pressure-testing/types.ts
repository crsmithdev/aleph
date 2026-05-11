export type Priority = "low" | "medium" | "high" | "critical";
export type Status = "open" | "in_progress" | "review" | "done" | "archived";

export interface Project {
  id: number;
  name: string;
  slug: string;
  description: string;
  createdAt: string;
}

export interface Task {
  id: number;
  projectId: number;
  title: string;
  description: string;
  priority: Priority;
  status: Status;
  assignee: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  dueDate: string | null;
}

export interface TaskFilter {
  projectId?: number;
  status?: Status;
  priority?: Priority;
  assignee?: string;
  tag?: string;
  dueBefore?: string;
}

export interface TaskStats {
  total: number;
  byStatus: Record<Status, number>;
  byPriority: Record<Priority, number>;
  overdue: number;
  unassigned: number;
}

export interface CreateTaskInput {
  projectId: number;
  title: string;
  description?: string;
  priority?: Priority;
  assignee?: string;
  tags?: string[];
  dueDate?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  priority?: Priority;
  status?: Status;
  assignee?: string | null;
  tags?: string[];
  dueDate?: string | null;
}
