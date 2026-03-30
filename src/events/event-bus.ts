import type { RiffEvent, EventType } from '../types.js';

type EventListener = (event: RiffEvent) => void;

export class EventBus {
  private listeners = new Map<string, Set<EventListener>>();

  emit(type: EventType, data: Record<string, unknown> = {}): void {
    const event: RiffEvent = {
      type,
      timestamp: new Date().toISOString(),
      data,
    };

    // notify specific listeners
    this.listeners.get(type)?.forEach((fn) => fn(event));
    // notify wildcard listeners
    this.listeners.get('*')?.forEach((fn) => fn(event));
  }

  on(type: EventType | '*', listener: EventListener): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
    return () => this.listeners.get(type)?.delete(listener);
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
