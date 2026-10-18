/** Helpers to turn Zod errors into the engine's ValidationIssue shape with readable messages. */
import type { z } from 'zod';
import type { ValidationIssue } from './domain/results';

export function zodIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
    message: issue.message,
  }));
}

/** Format issues for display, e.g. "people.0.retirementAge: Retirement age is after planning age". */
export function formatIssues(issues: readonly ValidationIssue[]): string[] {
  return issues.map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message));
}
