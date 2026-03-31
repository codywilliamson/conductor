import type { Store } from '../store/store.js';
import type { Project, CreateProjectInput, ProjectStatus } from '../types.js';

export class ProjectService {
  constructor(private store: Store) {}

  create(input: CreateProjectInput): Project {
    if (!input.name?.trim()) {
      throw new Error('name is required');
    }
    if (this.store.getProjectByName(input.name)) {
      throw new Error(`project "${input.name}" already exists`);
    }
    return this.store.createProject(input);
  }

  get(id: string): Project | null {
    return this.store.getProject(id);
  }

  getByName(name: string): Project | null {
    return this.store.getProjectByName(name);
  }

  list(filter?: { includeArchived?: boolean }): Project[] {
    return this.store.listProjects(filter);
  }

  update(id: string, input: { name?: string; description?: string; status?: ProjectStatus }): Project {
    const result = this.store.updateProject(id, input);
    if (!result) throw new Error('project not found');
    return result;
  }

  getOrCreateByName(name: string): Project {
    return this.store.getProjectByName(name) ?? this.store.createProject({ name });
  }

  resolveProjectId(name?: string): string {
    if (!name) {
      return this.store.getProjectByName('default')!.id;
    }
    const project = this.store.getProjectByName(name);
    if (!project) throw new Error(`project "${name}" not found`);
    return project.id;
  }
}
