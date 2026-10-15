import { z } from "zod";

/**
 * Parameter rules shared by the test execution tools. A bare z.number() accepts negatives and
 * fractions, which either silently do the wrong thing (historyTop: -1 returns nothing) or reach
 * Azure DevOps and come back as an unclear error, so each kind of number says what it may be.
 */

/** An id (run, result, plan, suite, test case, work item, build...): a positive whole number. */
export const idSchema = z.number().int().positive();

/** A page size or result limit: a positive whole number, no larger than `max`. */
export const limitSchema = (max: number) => z.number().int().positive().max(max);

/** A bug priority. Azure DevOps processes use 1 (highest) to 4. */
export const prioritySchema = z.number().int().min(1).max(4);

/**
 * A step of a test case: its number (5), or "3;5" for step 5 inside the shared step set at step 3,
 * as listed by getTestResult.
 */
export const stepRefSchema = z.union([
  idSchema,
  z.string().regex(/^\d+;\d+$/, "A step inside a shared step set is written as 'parent;child', for example '3;5'"),
]);
