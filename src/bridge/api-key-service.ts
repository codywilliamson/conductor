import { createHash, randomBytes as defaultRandomBytes } from 'node:crypto';
import { ulid } from 'ulid';
import type { Store } from '../store/store.js';
import type { ApiKeyRecord, ApiKeyScope } from '../types.js';

const VALID_SCOPES = new Set<ApiKeyScope>([
  'tasks:read',
  'tasks:write',
  'tasks:claim',
  'status:write',
  'result:write',
  'feedback:read',
  'feedback:write',
  'events:read',
  'admin',
]);

interface ApiKeyServiceOptions {
  now?: () => Date;
  randomBytes?: (size: number) => Buffer;
}

interface CreateApiKeyInput {
  name: string;
  scopes: string[];
  expiresIn?: string;
}

interface IssueApiKeyInput {
  name: string;
  scopes: ApiKeyScope[];
  expiresAt: string | null;
}

export interface CreatedApiKey {
  plaintext: string;
  key: ApiKeyRecord;
}

export class ApiKeyService {
  private readonly now: () => Date;
  private readonly randomBytes: (size: number) => Buffer;

  constructor(
    private readonly store: Store,
    options: ApiKeyServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.randomBytes = options.randomBytes ?? defaultRandomBytes;
  }

  create(input: CreateApiKeyInput): CreatedApiKey {
    const name = input.name.trim();
    if (!name) {
      throw new Error('name is required');
    }

    if (this.store.getActiveApiKeyByName(name)) {
      throw new Error(`api key "${name}" already exists`);
    }

    return this.issue({
      name,
      scopes: this.normalizeScopes(input.scopes),
      expiresAt: this.parseExpiry(input.expiresIn),
    });
  }

  list(): ApiKeyRecord[] {
    return this.store.listApiKeys();
  }

  revoke(name: string): boolean {
    const existing = this.store.getActiveApiKeyByName(name);
    if (!existing) {
      return false;
    }

    return this.store.revokeApiKey(existing.id, this.now().toISOString());
  }

  rotate(name: string): CreatedApiKey {
    const existing = this.store.getActiveApiKeyByName(name);
    if (!existing) {
      throw new Error(`api key "${name}" not found`);
    }

    this.store.revokeApiKey(existing.id, this.now().toISOString());
    return this.issue({
      name: existing.name,
      scopes: existing.scopes,
      expiresAt: existing.expires_at,
    });
  }

  authenticate(plaintext: string): ApiKeyRecord | null {
    const key = this.store.getApiKeyByHash(this.hash(plaintext));
    if (!key) {
      return null;
    }

    if (key.revoked_at) {
      return null;
    }

    if (key.expires_at && new Date(key.expires_at).getTime() <= this.now().getTime()) {
      return null;
    }

    return key;
  }

  hasScope(key: ApiKeyRecord, scope: ApiKeyScope): boolean {
    return key.scopes.includes('admin') || key.scopes.includes(scope);
  }

  touch(id: string): void {
    this.store.touchApiKey(id, this.now().toISOString());
  }

  private issue(input: IssueApiKeyInput): CreatedApiKey {
    const plaintext = `rk_live_${ulid().toLowerCase()}${this.randomBytes(12).toString('hex')}`;
    const key = this.store.createApiKey({
      id: ulid(),
      name: input.name,
      key_hash: this.hash(plaintext),
      key_prefix: plaintext.slice(0, 16),
      scopes: input.scopes,
      expires_at: input.expiresAt,
      last_used: null,
      created_at: this.now().toISOString(),
      revoked_at: null,
    });

    return { plaintext, key };
  }

  private normalizeScopes(scopes: string[]): ApiKeyScope[] {
    const normalized = scopes.map((scope) => scope.trim()).filter(Boolean);
    if (normalized.length === 0) {
      throw new Error('at least one scope is required');
    }

    for (const scope of normalized) {
      if (!VALID_SCOPES.has(scope as ApiKeyScope)) {
        throw new Error(`invalid scope: ${scope}`);
      }
    }

    return normalized as ApiKeyScope[];
  }

  private parseExpiry(expiresIn?: string): string | null {
    if (!expiresIn) {
      return null;
    }

    const match = /^(\d+)([mhdw])$/.exec(expiresIn.trim());
    if (!match) {
      throw new Error(`invalid expiry: ${expiresIn}`);
    }

    const amount = Number(match[1]);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
      w: 604_800_000,
    };

    return new Date(this.now().getTime() + amount * multipliers[unit]).toISOString();
  }

  private hash(plaintext: string): string {
    return createHash('sha256').update(plaintext).digest('hex');
  }
}
