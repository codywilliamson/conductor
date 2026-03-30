import { describe, it, expect } from 'vitest';
import { parseManifest } from './manifest.js';

describe('parseManifest', () => {
  it('parses a valid manifest', () => {
    const yaml = `
project: my-project
tasks:
  - title: First task
    priority: 1
    description: Do the thing
  - title: Second task
    dependencies:
      - First task
    context:
      repo: test
`;
    const result = parseManifest(yaml);

    expect(result.project).toBe('my-project');
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]).toEqual({
      title: 'First task',
      priority: 1,
      description: 'Do the thing',
    });
    expect(result.tasks[1]).toEqual({
      title: 'Second task',
      dependencies: ['First task'],
      context: { repo: 'test' },
    });
  });

  it('throws if project field is missing', () => {
    const yaml = `
tasks:
  - title: A task
`;
    expect(() => parseManifest(yaml)).toThrow('manifest must include a "project" field');
  });

  it('throws if tasks array is missing', () => {
    const yaml = `
project: my-project
`;
    expect(() => parseManifest(yaml)).toThrow('manifest must include at least one task');
  });

  it('throws if tasks array is empty', () => {
    const yaml = `
project: my-project
tasks: []
`;
    expect(() => parseManifest(yaml)).toThrow('manifest must include at least one task');
  });

  it('throws if a task has no title', () => {
    const yaml = `
project: my-project
tasks:
  - description: no title here
`;
    expect(() => parseManifest(yaml)).toThrow('each task must have a title');
  });

  it('throws if a task has empty title', () => {
    const yaml = `
project: my-project
tasks:
  - title: "   "
`;
    expect(() => parseManifest(yaml)).toThrow('each task must have a title');
  });

  it('handles minimal task (title only)', () => {
    const yaml = `
project: minimal
tasks:
  - title: Just a title
`;
    const result = parseManifest(yaml);

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toEqual({ title: 'Just a title' });
  });

  it('parses manifest with dependencies separately', () => {
    const yaml = `
project: dep-test
tasks:
  - title: Setup database
  - title: Build API
    dependencies:
      - Setup database
`;
    const result = parseManifest(yaml);
    expect(result.tasks[0].dependencies).toBeUndefined();
    expect(result.tasks[1].dependencies).toEqual(['Setup database']);
  });

  it('parses manifest with context separately', () => {
    const yaml = `
project: ctx-test
tasks:
  - title: Deploy service
    context:
      env: production
      region: us-east-1
`;
    const result = parseManifest(yaml);
    expect(result.tasks[0].context).toEqual({ env: 'production', region: 'us-east-1' });
  });
});
