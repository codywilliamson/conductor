import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Store } from './store.js';

describe('Store bridge persistence', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  describe('api key records', () => {
    it('creates, finds, and lists active api keys', () => {
      store.createApiKey({
        id: 'key_01',
        name: 'claude-ai',
        key_hash: 'hash-1',
        key_prefix: 'rk_live_a1b2',
        scopes: ['tasks:read', 'tasks:write'],
        expires_at: null,
        created_at: '2026-03-30T10:00:00.000Z',
        revoked_at: null,
      });

      const found = store.getApiKeyByHash('hash-1');
      expect(found?.name).toBe('claude-ai');
      expect(found?.scopes).toEqual(['tasks:read', 'tasks:write']);

      const listed = store.listApiKeys();
      expect(listed).toHaveLength(1);
      expect(listed[0].key_hash).toBe('hash-1');
    });

    it('updates last_used and revokes keys', () => {
      store.createApiKey({
        id: 'key_01',
        name: 'claude-ai',
        key_hash: 'hash-1',
        key_prefix: 'rk_live_a1b2',
        scopes: ['tasks:read'],
        expires_at: null,
        created_at: '2026-03-30T10:00:00.000Z',
        revoked_at: null,
      });

      store.touchApiKey('key_01', '2026-03-30T11:00:00.000Z');
      store.revokeApiKey('key_01', '2026-03-30T12:00:00.000Z');

      const found = store.getApiKeyByHash('hash-1');
      expect(found?.last_used).toBe('2026-03-30T11:00:00.000Z');
      expect(found?.revoked_at).toBe('2026-03-30T12:00:00.000Z');
      expect(store.listApiKeys()).toEqual([]);
    });

    it('supports rotating to a new active key with the same name', () => {
      store.createApiKey({
        id: 'key_01',
        name: 'claude-ai',
        key_hash: 'hash-1',
        key_prefix: 'rk_live_old',
        scopes: ['tasks:read'],
        expires_at: null,
        created_at: '2026-03-30T10:00:00.000Z',
        revoked_at: '2026-03-30T11:00:00.000Z',
      });

      store.createApiKey({
        id: 'key_02',
        name: 'claude-ai',
        key_hash: 'hash-2',
        key_prefix: 'rk_live_new',
        scopes: ['tasks:read'],
        expires_at: null,
        created_at: '2026-03-30T12:00:00.000Z',
        revoked_at: null,
      });

      const active = store.listApiKeys();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('key_02');
      expect(store.getApiKeyByHash('hash-1')?.revoked_at).not.toBeNull();
    });
  });

  describe('bridge request log', () => {
    it('stores and filters authenticated bridge requests', () => {
      store.logBridgeRequest({
        key_name: 'claude-ai',
        method: 'POST',
        path: '/api/v1/hooks/ingest',
        ip: '203.0.113.10',
        status_code: 201,
        created_at: '2026-03-30T10:00:00.000Z',
      });
      store.logBridgeRequest({
        key_name: 'github-actions',
        method: 'GET',
        path: '/api/v1/hooks/status',
        ip: '203.0.113.11',
        status_code: 200,
        created_at: '2026-03-30T10:05:00.000Z',
      });

      expect(store.countBridgeRequestsSince('claude-ai', '2026-03-30T09:59:00.000Z')).toBe(1);
      expect(store.countBridgeRequestsSince('claude-ai', '2026-03-30T10:00:01.000Z')).toBe(0);

      const filtered = store.listBridgeRequests({ keyName: 'github-actions', limit: 10 });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].path).toBe('/api/v1/hooks/status');

      const latest = store.getLatestBridgeRequest();
      expect(latest?.key_name).toBe('github-actions');
    });
  });

  describe('bridge state', () => {
    it('tracks paused state and runtime url', () => {
      expect(store.getBridgeState()).toMatchObject({
        paused: false,
        public_url: null,
        tunnel: null,
      });

      store.setBridgeState({
        paused: true,
        public_url: 'https://riff-abc123.trycloudflare.com',
        tunnel: 'cloudflare',
        updated_at: '2026-03-30T10:00:00.000Z',
      });

      expect(store.getBridgeState()).toEqual({
        paused: true,
        public_url: 'https://riff-abc123.trycloudflare.com',
        tunnel: 'cloudflare',
        updated_at: '2026-03-30T10:00:00.000Z',
      });
    });
  });
});
