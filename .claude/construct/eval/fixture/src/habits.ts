// construct-eval: dummy habits module
// Purpose: realistic enough to trigger FULL depth + skill eval when refactored

export interface Habit {
  id: string
  name: string
  frequency: 'daily' | 'weekly'
  completions: string[] // ISO dates
}

export interface HabitLog {
  habitId: string
  date: string
  completed: boolean
}

export function getStreak(habit: Habit): number {
  // naive streak — no timezone handling, no gap detection
  const sorted = [...habit.completions].sort()
  let streak = 0
  let cursor = new Date()
  for (let i = sorted.length - 1; i >= 0; i--) {
    const d = new Date(sorted[i])
    const diff = Math.floor((cursor.getTime() - d.getTime()) / 86400000)
    if (diff <= 1) { streak++; cursor = d }
    else break
  }
  return streak
}

export function isCompleted(habit: Habit, date: string): boolean {
  return habit.completions.includes(date)
}

export function markComplete(habit: Habit, date: string): Habit {
  if (isCompleted(habit, date)) return habit
  return { ...habit, completions: [...habit.completions, date] }
}
