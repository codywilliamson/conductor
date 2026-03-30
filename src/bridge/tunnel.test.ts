import { describe, it, expect } from 'vitest';
import { buildTunnelCommand, extractCloudflareUrl } from './tunnel.js';

describe('tunnel helpers', () => {
  it('builds a quick cloudflare tunnel command', () => {
    expect(buildTunnelCommand('cloudflare', 7400)).toEqual({
      command: 'cloudflared',
      args: ['tunnel', '--url', 'http://localhost:7400'],
    });
  });

  it('returns no command for manual bridge exposure', () => {
    expect(buildTunnelCommand('none', 7400)).toBeNull();
  });

  it('extracts the public url from quick tunnel output', () => {
    expect(
      extractCloudflareUrl(
        'INF Requesting new quick Tunnel on trycloudflare.com... https://riff-abc123.trycloudflare.com',
      ),
    ).toBe('https://riff-abc123.trycloudflare.com');
  });
});
