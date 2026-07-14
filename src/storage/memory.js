import { canonicalStringify, cloneJson } from '../domain/canonical.js';
import { operationFingerprint, validateOperation } from '../domain/operations.js';

export class MemoryStore {
  constructor() {
    this.ops = new Map();
    this.meta = new Map();
    this.snapshots = new Map();
  }

  async appendOps(ops) {
    const incoming = new Map();
    for (const op of ops) {
      validateOperation(op);
      const inBatch = incoming.get(op.op_id);
      if (inBatch && operationFingerprint(inBatch) !== operationFingerprint(op)) throw new Error(`Kollision för op_id ${op.op_id}`);
      incoming.set(op.op_id, op);
    }
    for (const op of incoming.values()) {
      const existing = this.ops.get(op.op_id);
      if (existing && operationFingerprint(existing) !== operationFingerprint(op)) throw new Error(`Kollision för op_id ${op.op_id}`);
    }
    let inserted = 0;
    for (const op of incoming.values()) {
      if (this.ops.has(op.op_id)) continue;
      this.ops.set(op.op_id, cloneJson(op));
      inserted += 1;
    }
    return inserted;
  }

  async getAllOps() {
    return [...this.ops.values()].map(cloneJson).sort((a, b) => a.op_id.localeCompare(b.op_id));
  }

  async putMeta(key, value) {
    this.meta.set(String(key), cloneJson(value));
  }

  async getMeta(key) {
    const value = this.meta.get(String(key));
    return value === undefined ? null : cloneJson(value);
  }

  async saveSnapshot(id, snapshot) {
    canonicalStringify(snapshot);
    this.snapshots.set(String(id), cloneJson(snapshot));
  }

  async getSnapshot(id) {
    const value = this.snapshots.get(String(id));
    return value === undefined ? null : cloneJson(value);
  }

  async clear() {
    this.ops.clear();
    this.meta.clear();
    this.snapshots.clear();
  }
}
