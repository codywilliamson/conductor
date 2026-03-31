import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Store } from '../store/store.js';
import { ProjectService } from './project-service.js';

describe('ProjectService', () => {
  let store: Store;
  let service: ProjectService;

  beforeEach(() => {
    store = new Store(':memory:');
    service = new ProjectService(store);
  });

  afterEach(() => {
    store.close();
  });

  describe('create', () => {
    it('creates a project', () => {
      const project = service.create({ name: 'my-app' });
      expect(project.name).toBe('my-app');
      expect(project.id).toMatch(/^proj_/);
    });

    it('creates with description', () => {
      const project = service.create({ name: 'my-app', description: 'a project' });
      expect(project.description).toBe('a project');
    });

    it('throws on empty name', () => {
      expect(() => service.create({ name: '' })).toThrow('name is required');
    });

    it('throws on whitespace-only name', () => {
      expect(() => service.create({ name: '   ' })).toThrow('name is required');
    });

    it('throws on duplicate name', () => {
      service.create({ name: 'dupe' });
      expect(() => service.create({ name: 'dupe' })).toThrow('already exists');
    });
  });

  describe('get', () => {
    it('returns project by id', () => {
      const project = service.create({ name: 'find-me' });
      expect(service.get(project.id)?.name).toBe('find-me');
    });

    it('returns null for nonexistent', () => {
      expect(service.get('proj_nope')).toBeNull();
    });
  });

  describe('getByName', () => {
    it('returns project by name', () => {
      service.create({ name: 'by-name' });
      expect(service.getByName('by-name')).not.toBeNull();
    });

    it('returns null for nonexistent', () => {
      expect(service.getByName('nope')).toBeNull();
    });
  });

  describe('list', () => {
    it('returns active projects including default', () => {
      service.create({ name: 'extra' });
      const projects = service.list();
      expect(projects.length).toBeGreaterThanOrEqual(2);
      expect(projects.some(p => p.name === 'default')).toBe(true);
    });
  });

  describe('update', () => {
    it('updates project fields', () => {
      const project = service.create({ name: 'old' });
      const updated = service.update(project.id, { name: 'new', description: 'updated' });
      expect(updated.name).toBe('new');
      expect(updated.description).toBe('updated');
    });

    it('throws on nonexistent', () => {
      expect(() => service.update('proj_nope', { name: 'x' })).toThrow('not found');
    });
  });

  describe('archive', () => {
    it('archives a project', () => {
      const project = service.create({ name: 'to-archive' });
      const archived = service.update(project.id, { status: 'archived' });
      expect(archived.status).toBe('archived');
    });
  });

  describe('getOrCreateByName', () => {
    it('returns existing project', () => {
      const created = service.create({ name: 'exists' });
      const found = service.getOrCreateByName('exists');
      expect(found.id).toBe(created.id);
    });

    it('creates project if it does not exist', () => {
      const project = service.getOrCreateByName('new-one');
      expect(project.name).toBe('new-one');
      expect(project.id).toMatch(/^proj_/);
    });
  });

  describe('resolveProjectId', () => {
    it('returns default project id when no name given', () => {
      const id = service.resolveProjectId();
      const defaultProject = service.getByName('default')!;
      expect(id).toBe(defaultProject.id);
    });

    it('returns project id by name', () => {
      const project = service.create({ name: 'my-proj' });
      expect(service.resolveProjectId('my-proj')).toBe(project.id);
    });

    it('throws for nonexistent project name', () => {
      expect(() => service.resolveProjectId('nope')).toThrow('not found');
    });
  });
});
