import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import YAML from 'yaml';
import type { BridgeTunnel } from '../types.js';

export interface RiffConfig {
  port: number;
  store: string;
  bridge: {
    enabled: boolean;
    tunnel: BridgeTunnel;
    hostname?: string;
    bind?: string;
    rate_limit: {
      default: number;
      per_key: Record<string, number>;
    };
    ip_allowlist: string[];
    max_body_size: string;
    cors: {
      origins: string[];
    };
  };
  log: {
    level: 'debug' | 'info' | 'warn' | 'error';
    bridge_requests: boolean;
  };
  config_path: string | null;
}

interface LoadConfigOptions {
  cwd?: string;
  homeDir?: string;
  defaultStore?: string;
}

const DEFAULT_PORT = 7400;

export function loadConfig(options: LoadConfigOptions = {}): RiffConfig {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? homedir();
  const configPath = resolveConfigPath(cwd, homeDir);
  const rawConfig = configPath ? parseConfig(configPath) : {};
  const baseDir = configPath ? dirname(configPath) : cwd;
  const defaultStore = options.defaultStore ?? join(homeDir, '.riff', 'riff.db');

  return {
    port: typeof rawConfig.port === 'number' ? rawConfig.port : DEFAULT_PORT,
    store: resolveStorePath(rawConfig.store, baseDir, defaultStore),
    bridge: {
      enabled: rawConfig.bridge?.enabled === true,
      tunnel: isBridgeTunnel(rawConfig.bridge?.tunnel) ? rawConfig.bridge.tunnel : 'cloudflare',
      hostname:
        typeof rawConfig.bridge?.hostname === 'string' ? rawConfig.bridge.hostname : undefined,
      bind: typeof rawConfig.bridge?.bind === 'string' ? rawConfig.bridge.bind : '127.0.0.1',
      rate_limit: {
        default:
          typeof rawConfig.bridge?.rate_limit?.default === 'number'
            ? rawConfig.bridge.rate_limit.default
            : 60,
        per_key:
          rawConfig.bridge?.rate_limit?.per_key &&
          typeof rawConfig.bridge.rate_limit.per_key === 'object'
            ? rawConfig.bridge.rate_limit.per_key
            : {},
      },
      ip_allowlist:
        Array.isArray(rawConfig.bridge?.ip_allowlist) &&
        rawConfig.bridge.ip_allowlist.every((value) => typeof value === 'string')
          ? rawConfig.bridge.ip_allowlist
          : [],
      max_body_size:
        typeof rawConfig.bridge?.max_body_size === 'string'
          ? rawConfig.bridge.max_body_size
          : '1mb',
      cors: {
        origins:
          Array.isArray(rawConfig.bridge?.cors?.origins) &&
          rawConfig.bridge.cors.origins.every((value) => typeof value === 'string')
            ? rawConfig.bridge.cors.origins
            : [],
      },
    },
    log: {
      level: isLogLevel(rawConfig.log?.level) ? rawConfig.log.level : 'info',
      bridge_requests:
        typeof rawConfig.log?.bridge_requests === 'boolean' ? rawConfig.log.bridge_requests : true,
    },
    config_path: configPath,
  };
}

function resolveConfigPath(cwd: string, homeDir: string): string | null {
  const projectConfig = join(cwd, 'riff.config.yaml');
  if (existsSync(projectConfig)) {
    return projectConfig;
  }

  const globalConfig = join(homeDir, '.config', 'riff', 'config.yaml');
  return existsSync(globalConfig) ? globalConfig : null;
}

function parseConfig(configPath: string): Record<string, any> {
  const raw = YAML.parse(readFileSync(configPath, 'utf-8'));
  return raw && typeof raw === 'object' ? raw : {};
}

function resolveStorePath(
  configuredPath: unknown,
  baseDir: string,
  defaultStore: string,
): string {
  if (typeof configuredPath !== 'string' || !configuredPath.trim()) {
    return defaultStore;
  }

  return isAbsolute(configuredPath) ? configuredPath : resolve(baseDir, configuredPath);
}

function isBridgeTunnel(value: unknown): value is BridgeTunnel {
  return value === 'cloudflare' || value === 'ngrok' || value === 'tailscale' || value === 'none';
}

function isLogLevel(value: unknown): value is RiffConfig['log']['level'] {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
}
