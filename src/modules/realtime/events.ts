import { EventEmitter } from "node:events";
import type { Response } from "express";

const emitter = new EventEmitter();
emitter.setMaxListeners(500);

export function publish(organizationId: string, event: object) {
  emitter.emit(organizationId, { ...event, at: new Date().toISOString() });
}

export function subscribe(organizationId: string, res: Response) {
  const listener = (event: object) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  emitter.on(organizationId, listener);
  return () => emitter.off(organizationId, listener);
}
