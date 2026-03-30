import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Store } from '../store/store.js';
import { ApiKeyService } from './api-key-service.js';

describe('ApiKeyService', () => {
  let store: Store;
  let service: ApiKeyService;

  beforeEach(() => {
    store = new Store(':memory:');
    service = new ApiKeyService(store, {
      now: () => new Date('2026-03-30T10:00:00.000Z'),
      randomBytes: (size) => Buffer.alloc(size, 7),
    });
  });

  afterEach(() => {
    store.close();
  });

  it('creates a plaintext key once and stores only hashed metadata', () => {
    const created = service.create({
      name: 'claude-ai',
      scopes: ['tasks:write', 'tasks:read'],
    });

    expect(created.plaintext).toMatch(/^rk_live_/);
    expect(created.key.name).toBe('claude-ai');
    expect(created.key.scopes).toEqual(['tasks:write', 'tasks:read']);
    expect(created.key.key_hash).not.toBe(created.plaintext);
    expect(store.listApiKeys()[0].key_hash).toBe(created.key.key_hash);
  });

  it('authenticates valid keys and rejects revoked or expired keys', () => {
    const created = service.create({
      name: 'claude-ai',
      scopes: ['tasks:read'],
      expiresIn: '1d',
    });

    expect(service.authenticate(created.plaintext)?.name).toBe('claude-ai');

    const expiredService = new ApiKeyService(store, {
      now: () => new Date('2026-04-01T10:00:01.000Z'),
      randomBytes: (size) => Buffer.alloc(size, 8),
    });
    expect(expiredService.authenticate(created.plaintext)).toBeNull();

    const rotated = service.rotate('claude-ai');
    expect(service.authenticate(created.plaintext)).toBeNull();
    expect(service.authenticate(rotated.plaintext)?.name).toBe('claude-ai');
  });

  it('reuses scopes and expiry when rotating a key', () => {
    const created = service.create({
      name: 'github-actions',
      scopes: ['tasks:write'],
      expiresIn: '30d',
    });

    const rotated = service.rotate('github-actions');

    expect(rotated.key.name).toBe('github-actions');
    expect(rotated.key.scopes).toEqual(['tasks:write']);
    expect(rotated.key.expires_at).toBe(created.key.expires_at);
  });

  it('validates scopes and admin wildcard access', () => {
    const created = service.create({
      name: 'remote-worker',
      scopes: ['admin'],
    });

    const auth = service.authenticate(created.plaintext);
    expect(auth).not.toBeNull();
    expect(service.hasScope(auth!, 'tasks:read')).toBe(true);
    expect(service.hasScope(auth!, 'result:write')).toBe(true);
  });

  it('rejects invalid scope names and malformed expiry strings', () => {
    expect(() =>
      service.create({
        name: 'bad-scope',
        scopes: ['not:a:scope'],
      }),
    ).toThrow('invalid scope');

    expect(() =>
      service.create({
        name: 'bad-expiry',
        scopes: ['tasks:read'],
        expiresIn: 'tomorrow',
      }),
    ).toThrow('invalid expiry');
  });

  it('updates last_used when a key is touched after an authenticated request', () => {
    const created = service.create({
      name: 'claude-ai',
      scopes: ['tasks:read'],
    });

    service.touch(created.key.id);

    expect(store.listApiKeys()[0].last_used).toBe('2026-03-30T10:00:00.000Z');
  });
});
