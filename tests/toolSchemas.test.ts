import * as fs from 'fs';
import * as path from 'path';
import { idSchema, limitSchema, prioritySchema, stepRefSchema } from '../src/utils/toolSchemas';

describe('idSchema', () => {
  it.each([1, 5, 21226, 1002138])('accepts %s', (value) => {
    expect(idSchema.safeParse(value).success).toBe(true);
  });

  it.each([0, -1, -100, 1.5, 0.1, NaN, Infinity, '5', null, undefined])('rejects %s', (value) => {
    expect(idSchema.safeParse(value).success).toBe(false);
  });
});

describe('limitSchema', () => {
  const limit = limitSchema(1000);

  it.each([1, 10, 25, 1000])('accepts %s', (value) => {
    expect(limit.safeParse(value).success).toBe(true);
  });

  it.each([0, -1, 1.5, 1001, 1000000, NaN])('rejects %s', (value) => {
    expect(limit.safeParse(value).success).toBe(false);
  });

  it('uses the maximum it is given', () => {
    expect(limitSchema(200).safeParse(200).success).toBe(true);
    expect(limitSchema(200).safeParse(201).success).toBe(false);
  });

  it('turns the reviewer\'s example, historyTop: -1, into an error instead of an empty history', () => {
    expect(limitSchema(200).safeParse(-1).success).toBe(false);
  });
});

describe('prioritySchema', () => {
  it.each([1, 2, 3, 4])('accepts %s', (value) => {
    expect(prioritySchema.safeParse(value).success).toBe(true);
  });

  it.each([0, 5, -1, 2.5])('rejects %s', (value) => {
    expect(prioritySchema.safeParse(value).success).toBe(false);
  });
});

describe('stepRefSchema', () => {
  it.each([1, 7, 11, '2;1', '3;13', '10;2'])('accepts %s', (value) => {
    expect(stepRefSchema.safeParse(value).success).toBe(true);
  });

  it.each([0, -2, 1.5, '3', '3;', ';5', '3;5;1', 'a;b', '3,5', ' 3;5', '3;5 ', '', '-1;2'])('rejects %s', (value) => {
    expect(stepRefSchema.safeParse(value).success).toBe(false);
  });

  it('explains how a step inside a shared set is written', () => {
    const result = stepRefSchema.safeParse('3-5');
    expect(result.success).toBe(false);
    expect(JSON.stringify((result as { error: unknown }).error)).toContain("parent;child");
  });
});

describe('the test execution tool registrations', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8');
  const start = source.indexOf('// Register Test Execution Tools');
  const end = source.indexOf('// Create a transport');
  const block = source.slice(start, end);

  it('finds the block it checks', () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(block).toContain('server.tool("startTestRun"');
    expect(block).toContain('server.tool("createBugFromTestRun"');
  });

  it('has no bare z.number() left, so a new parameter has to say what kind of number it is', () => {
    expect(block).not.toMatch(/z\.number\(\)/);
  });

  it('bounds the limits and the priority', () => {
    expect(block).toMatch(/historyTop: limitSchema\(200\)/);
    expect(block).toMatch(/top: limitSchema\(1000\)/);
    expect(block).toMatch(/priority: prioritySchema/);
  });

  it('uses the step reference rule wherever a step is named', () => {
    expect(block.match(/stepId: stepRefSchema/g)).toHaveLength(2);
    expect(block).not.toMatch(/stepId: z\.union/);
  });

  it('takes ids and lists of ids as positive whole numbers', () => {
    expect(block).toMatch(/testCaseIds: z\.array\(idSchema\)/);
    expect(block).toMatch(/workItemIds: z\.array\(idSchema\)/);
    expect(block).not.toMatch(/z\.array\(z\.number/);
  });
});
