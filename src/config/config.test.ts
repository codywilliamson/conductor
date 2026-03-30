import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  let rootDir: string;
  let homeDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'riff-config-root-'));
    homeDir = mkdtempSync(join(tmpdir(), 'riff-config-home-'));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  it('returns defaults when no config file exists', () => {
    const config = loadConfig({ cwd: rootDir, homeDir });

    expect(config.port).toBe(7400);
    expect(config.bridge.enabled).toBe(false);
    expect(config.bridge.rate_limit.default).toBe(60);
    expect(config.bridge.cors.origins).toEqual([]);
    expect(config.log.bridge_requests).toBe(true);
  });

  it('loads project config and resolves relative paths from the config file location', () => {
    writeFileSync(
      join(rootDir, 'riff.config.yaml'),
      [
        'port: 7500',
        'store: ./data/riff.db',
        'bridge:',
        '  enabled: true',
        '  tunnel: cloudflare',
        '  hostname: riff.example.com',
        '  rate_limit:',
        '    default: 120',
        '    per_key:',
        '      github-actions: 240',
        '  cors:',
        '    origins:',
        '      - https://claude.ai',
      ].join('\n'),
    );

    const config = loadConfig({ cwd: rootDir, homeDir });

    expect(config.port).toBe(7500);
    expect(config.store).toBe(join(rootDir, 'data', 'riff.db'));
    expect(config.bridge.enabled).toBe(true);
    expect(config.bridge.hostname).toBe('riff.example.com');
    expect(config.bridge.rate_limit.default).toBe(120);
    expect(config.bridge.rate_limit.per_key['github-actions']).toBe(240);
    expect(config.bridge.cors.origins).toEqual(['https://claude.ai']);
    expect(config.bridge.max_body_size).toBe('1mb');
  });

  it('falls back to the global config when no project config exists', () => {
    const configDir = join(homeDir, '.config', 'riff');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'config.yaml'),
      ['bridge:', '  enabled: true', '  tunnel: none', '  ip_allowlist:', '    - 203.0.113.10'].join(
        '\n',
      ),
    );

    const config = loadConfig({ cwd: rootDir, homeDir });

    expect(config.bridge.enabled).toBe(true);
    expect(config.bridge.tunnel).toBe('none');
    expect(config.bridge.ip_allowlist).toEqual(['203.0.113.10']);
  });
});
