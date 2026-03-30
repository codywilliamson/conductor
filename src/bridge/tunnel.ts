import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { BridgeTunnel } from '../types.js';

export interface TunnelHandle {
  publicUrl: string | null;
  stop: () => void;
}

export function buildTunnelCommand(
  tunnel: BridgeTunnel,
  port: number,
): { command: string; args: string[] } | null {
  switch (tunnel) {
    case 'cloudflare':
      return {
        command: 'cloudflared',
        args: ['tunnel', '--url', `http://localhost:${port}`],
      };
    case 'ngrok':
      return {
        command: 'ngrok',
        args: ['http', String(port)],
      };
    case 'tailscale':
      return {
        command: 'tailscale',
        args: ['funnel', String(port)],
      };
    case 'none':
      return null;
  }
}

export function extractCloudflareUrl(line: string): string | null {
  const match = /(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/i.exec(line);
  return match?.[1] ?? null;
}

export async function startTunnel(options: {
  tunnel: BridgeTunnel;
  port: number;
  hostname?: string;
}): Promise<TunnelHandle | null> {
  if (options.tunnel === 'none' || options.hostname) {
    return null;
  }

  const command = buildTunnelCommand(options.tunnel, options.port);
  if (!command) {
    return null;
  }

  const child = spawn(command.command, command.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let publicUrl: string | null = null;
  if (options.tunnel === 'cloudflare') {
    publicUrl = await waitForCloudflareUrl(child.stdout, child.stderr);
  }

  return {
    publicUrl,
    stop: () => {
      if (!child.killed) {
        child.kill();
      }
    },
  };
}

async function waitForCloudflareUrl(
  stdout: NodeJS.ReadableStream | null,
  stderr: NodeJS.ReadableStream | null,
): Promise<string | null> {
  const readers = [stdout, stderr].filter(Boolean) as NodeJS.ReadableStream[];

  return new Promise((resolve) => {
    let settled = false;

    const finish = (url: string | null) => {
      if (!settled) {
        settled = true;
        resolve(url);
      }
    };

    readers.forEach((stream) => {
      const lines = createInterface({ input: stream });
      lines.on('line', (line) => {
        const url = extractCloudflareUrl(line);
        if (url) {
          lines.close();
          finish(url);
        }
      });
      lines.on('close', () => finish(null));
    });

    setTimeout(() => finish(null), 5_000);
  });
}
