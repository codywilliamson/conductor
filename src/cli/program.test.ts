import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../store/store.js';
import { ApiKeyService } from '../bridge/api-key-service.js';
import { createProgram } from './program.js';

describe('createProgram', () => {
  let rootDir: string;
  let dataDir: string;
  let output: string[];
  let errorOutput: string[];

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'riff-cli-'));
    dataDir = join(rootDir, 'data');
    mkdirSync(dataDir, { recursive: true });
    output = [];
    errorOutput = [];
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  async function run(args: string[]) {
    const program = createProgram({
      cwd: rootDir,
      homeDir: rootDir,
      writeOut: (line) => output.push(line),
      writeErr: (line) => errorOutput.push(line),
      now: () => new Date('2026-03-30T12:00:00.000Z'),
      startServer: vi.fn().mockResolvedValue({ close: vi.fn() }),
      startTunnel: vi.fn().mockResolvedValue(null),
    });

    await program.parseAsync(args, { from: 'user' });
  }

  it('creates and lists scoped api keys without re-printing plaintext values', async () => {
    await run([
      'keys',
      'create',
      '--name',
      'claude-ai',
      '--scopes',
      'tasks:write,tasks:read',
      '--data-dir',
      dataDir,
    ]);

    expect(output.join('\n')).toContain('Key created: rk_live_');
    expect(output.join('\n')).toContain('Name: claude-ai');

    output = [];

    await run(['keys', 'list', '--data-dir', dataDir]);

    const listOutput = output.join('\n');
    expect(listOutput).toContain('claude-ai');
    expect(listOutput).toContain('tasks:write, tasks:read');
    expect(listOutput).not.toContain('rk_live_');
  });

  it('rotates and revokes keys by name', async () => {
    const store = new Store(join(dataDir, 'riff.db'));
    const apiKeys = new ApiKeyService(store, {
      now: () => new Date('2026-03-30T12:00:00.000Z'),
      randomBytes: (size) => Buffer.alloc(size, 4),
    });
    apiKeys.create({ name: 'claude-ai', scopes: ['tasks:read'] });
    store.close();

    await run(['keys', 'rotate', 'claude-ai', '--data-dir', dataDir]);
    expect(output.join('\n')).toContain('Key rotated: rk_live_');

    output = [];

    await run(['keys', 'revoke', 'claude-ai', '--data-dir', dataDir]);
    expect(output.join('\n')).toContain('Revoked key: claude-ai');
  });

  it('shows bridge status, logs requests, and toggles pause state', async () => {
    const store = new Store(join(dataDir, 'riff.db'));
    const apiKeys = new ApiKeyService(store, {
      now: () => new Date('2026-03-30T12:00:00.000Z'),
      randomBytes: (size) => Buffer.alloc(size, 5),
    });
    apiKeys.create({ name: 'claude-ai', scopes: ['tasks:read'] });
    store.setBridgeState({
      paused: false,
      public_url: 'https://riff.example.com',
      tunnel: 'cloudflare',
      updated_at: '2026-03-30T11:00:00.000Z',
    });
    store.logBridgeRequest({
      key_name: 'claude-ai',
      method: 'GET',
      path: '/api/v1/hooks/status',
      ip: '203.0.113.10',
      status_code: 200,
      created_at: '2026-03-30T11:59:00.000Z',
    });
    store.close();

    await run(['bridge', 'status', '--data-dir', dataDir]);
    const statusOutput = output.join('\n');
    expect(statusOutput).toContain('Bridge: active');
    expect(statusOutput).toContain('URL: https://riff.example.com');
    expect(statusOutput).toContain('Active keys: 1');
    expect(statusOutput).toContain('Requests today: 1');

    output = [];

    await run(['bridge', 'log', '--data-dir', dataDir, '--last', '1']);
    expect(output.join('\n')).toContain('/api/v1/hooks/status');

    output = [];

    await run(['bridge', 'pause', '--data-dir', dataDir]);
    expect(output.join('\n')).toContain('Bridge paused.');

    const pausedStore = new Store(join(dataDir, 'riff.db'));
    expect(pausedStore.getBridgeState().paused).toBe(true);
    pausedStore.close();

    output = [];

    await run(['bridge', 'resume', '--data-dir', dataDir]);
    expect(output.join('\n')).toContain('Bridge resumed.');
  });
});
