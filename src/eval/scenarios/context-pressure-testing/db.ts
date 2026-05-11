import type { Project, Task, TaskFilter, TaskStats, CreateTaskInput, UpdateTaskInput, Priority, Status } from "./types.ts";

let nextProjectId = 1;
let nextTaskId = 1;
const projects: Project[] = [];
const tasks: Task[] = [];

// ── Seed data ──────────────────────────────────────────────────

export function seed() {
  projects.length = 0;
  tasks.length = 0;
  nextProjectId = 1;
  nextTaskId = 1;

  createProject("Backend API", "backend-api", "Core REST API services");
  createProject("Frontend", "frontend", "React web application");
  createProject("Infrastructure", "infra", "CI/CD and deployment");

  // Seed tasks across projects
  const seedTasks: Omit<CreateTaskInput, "projectId">[] = [
    { title: "Fix auth middleware", priority: "critical", assignee: "alice", tags: ["security", "auth"], dueDate: "2026-04-15" },
    { title: "Add rate limiting", priority: "high", assignee: "bob", tags: ["security"], dueDate: "2026-04-20" },
    { title: "Refactor user service", priority: "medium", assignee: "alice", tags: ["refactor"] },
    { title: "Add pagination to list endpoints", priority: "medium", tags: ["api"], dueDate: "2026-04-18" },
    { title: "Write API documentation", priority: "low", assignee: "carol", tags: ["docs"] },
  ];
  for (const t of seedTasks) createTask({ ...t, projectId: 1 });

  const frontendTasks: Omit<CreateTaskInput, "projectId">[] = [
    { title: "Fix dashboard chart rendering", priority: "high", assignee: "dave", tags: ["charts", "bug"], dueDate: "2026-04-14" },
    { title: "Implement dark mode", priority: "low", assignee: "eve", tags: ["ui", "theme"] },
    { title: "Add form validation", priority: "medium", tags: ["forms", "ux"] },
  ];
  for (const t of frontendTasks) createTask({ ...t, projectId: 2 });

  const infraTasks: Omit<CreateTaskInput, "projectId">[] = [
    { title: "Set up staging environment", priority: "high", assignee: "frank", tags: ["devops"], dueDate: "2026-04-16" },
    { title: "Configure monitoring alerts", priority: "medium", tags: ["observability"] },
  ];
  for (const t of infraTasks) createTask({ ...t, projectId: 3 });

  // Move some tasks to non-open states
  const authTask = tasks.find(t => t.title === "Fix auth middleware")!;
  authTask.status = "in_progress";
  authTask.updatedAt = new Date().toISOString();

  const chartTask = tasks.find(t => t.title === "Fix dashboard chart rendering")!;
  chartTask.status = "review";
  chartTask.updatedAt = new Date().toISOString();
}

// ── Projects ───────────────────────────────────────────────────

export function createProject(name: string, slug: string, description: string): Project {
  const project: Project = {
    id: nextProjectId++,
    name,
    slug,
    description,
    createdAt: new Date().toISOString(),
  };
  projects.push(project);
  return project;
}

export function listProjects(): Project[] {
  return [...projects];
}

export function getProject(id: number): Project | undefined {
  return projects.find(p => p.id === id);
}

export function getProjectBySlug(slug: string): Project | undefined {
  return projects.find(p => p.slug === slug);
}

// ── Tasks ──────────────────────────────────────────────────────

export function createTask(input: CreateTaskInput): Task {
  const project = getProject(input.projectId);
  if (!project) throw new Error(`Project ${input.projectId} not found`);

  const task: Task = {
    id: nextTaskId++,
    projectId: input.projectId,
    title: input.title,
    description: input.description ?? "",
    priority: input.priority ?? "medium",
    status: "open",
    assignee: input.assignee ?? null,
    tags: input.tags ?? [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dueDate: input.dueDate ?? null,
  };
  tasks.push(task);
  return task;
}

export function getTask(id: number): Task | undefined {
  return tasks.find(t => t.id === id);
}

export function updateTask(id: number, input: UpdateTaskInput): Task | undefined {
  const task = tasks.find(t => t.id === id);
  if (!task) return undefined;

  if (input.title !== undefined) task.title = input.title;
  if (input.description !== undefined) task.description = input.description;
  if (input.priority !== undefined) task.priority = input.priority;
  if (input.status !== undefined) task.status = input.status;
  if (input.assignee !== undefined) task.assignee = input.assignee;
  if (input.tags !== undefined) task.tags = input.tags;
  if (input.dueDate !== undefined) task.dueDate = input.dueDate;
  task.updatedAt = new Date().toISOString();

  return task;
}

export function deleteTask(id: number): boolean {
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return false;
  tasks.splice(idx, 1);
  return true;
}

// BUG 1: Filtering by priority uses wrong comparison — compares string equality
// against the priority *index* instead of the priority value itself.
const PRIORITY_ORDER: Priority[] = ["low", "medium", "high", "critical"];

export function listTasks(filter?: TaskFilter): Task[] {
  let result = [...tasks];

  if (filter?.projectId !== undefined) {
    result = result.filter(t => t.projectId === filter.projectId);
  }
  if (filter?.status) {
    result = result.filter(t => t.status === filter.status);
  }
  if (filter?.priority) {
    // BUG: compares priority to its index position instead of the string value
    const idx = PRIORITY_ORDER.indexOf(filter.priority);
    result = result.filter(t => PRIORITY_ORDER.indexOf(t.priority) === idx);
  }
  if (filter?.assignee) {
    result = result.filter(t => t.assignee === filter.assignee);
  }
  if (filter?.tag) {
    result = result.filter(t => t.tags.includes(filter.tag!));
  }
  if (filter?.dueBefore) {
    const cutoff = new Date(filter.dueBefore);
    // BUG 2: excludes tasks with no due date, but also inverts the comparison
    // — returns tasks due AFTER the cutoff instead of before
    result = result.filter(t => {
      if (!t.dueDate) return false;
      return new Date(t.dueDate) > cutoff;  // BUG: should be <
    });
  }

  return result;
}

// BUG 3: Stats computation double-counts tasks that appear in multiple
// filter matches, and the overdue calculation uses the wrong date comparison.
export function getTaskStats(projectId?: number): TaskStats {
  const pool = projectId ? tasks.filter(t => t.projectId === projectId) : tasks;

  const byStatus = { open: 0, in_progress: 0, review: 0, done: 0, archived: 0 } as Record<Status, number>;
  const byPriority = { low: 0, medium: 0, high: 0, critical: 0 } as Record<Priority, number>;
  let overdue = 0;
  let unassigned = 0;

  const now = new Date();

  for (const t of pool) {
    byStatus[t.status]++;
    byPriority[t.priority]++;
    if (!t.assignee) unassigned++;
    // BUG: checks dueDate < now but doesn't exclude completed/archived tasks
    // — a done task with a past due date shouldn't count as overdue
    if (t.dueDate && new Date(t.dueDate) < now) {
      overdue++;
    }
  }

  return { total: pool.length, byStatus, byPriority, overdue, unassigned };
}

// ── Bulk operations ────────────────────────────────────────────

export function bulkUpdateStatus(ids: number[], status: Status): number {
  let count = 0;
  for (const id of ids) {
    const task = tasks.find(t => t.id === id);
    if (task) {
      task.status = status;
      task.updatedAt = new Date().toISOString();
      count++;
    }
  }
  return count;
}

export function reassignTasks(fromAssignee: string, toAssignee: string): number {
  let count = 0;
  for (const task of tasks) {
    if (task.assignee === fromAssignee) {
      task.assignee = toAssignee;
      task.updatedAt = new Date().toISOString();
      count++;
    }
  }
  return count;
}
