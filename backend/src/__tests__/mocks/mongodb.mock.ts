/**
 * MongoDB Mock
 * Provides in-memory MongoDB-like behavior for unit tests
 */

import { vi } from 'vitest';

interface MockDocument {
  _id?: string;
  [key: string]: unknown;
}

export class MockCollection {
  private documents: MockDocument[] = [];
  
  async insertOne(doc: MockDocument) {
    const _id = doc._id ?? `${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const newDoc = { ...doc, _id };
    this.documents.push(newDoc);
    return { acknowledged: true, insertedId: _id };
  }

  async insertMany(docs: MockDocument[]) {
    const insertedIds: Record<number, string> = {};
    docs.forEach((doc, index) => {
      const result = this.insertOne(doc);
      insertedIds[index] = doc._id ?? `inserted_${index}`;
    });
    return { acknowledged: true, insertedCount: docs.length, insertedIds };
  }

  async find(query: Record<string, unknown> = {}) {
    const results = this.documents.filter(doc => this.matchesQuery(doc, query));
    return {
      toArray: async () => results,
      limit: () => ({ toArray: async () => results }),
      sort: () => ({ toArray: async () => results, limit: () => ({ toArray: async () => results }) }),
    };
  }

  async findOne(query: Record<string, unknown> = {}) {
    return this.documents.find(doc => this.matchesQuery(doc, query)) ?? null;
  }

  async countDocuments(query: Record<string, unknown> = {}) {
    return this.documents.filter(doc => this.matchesQuery(doc, query)).length;
  }

  async deleteMany(query: Record<string, unknown> = {}) {
    const initialCount = this.documents.length;
    this.documents = this.documents.filter(doc => !this.matchesQuery(doc, query));
    return { acknowledged: true, deletedCount: initialCount - this.documents.length };
  }

  async updateOne(query: Record<string, unknown>, update: Record<string, unknown>) {
    const doc = this.documents.find(d => this.matchesQuery(d, query));
    if (doc && update.$set) {
      Object.assign(doc, update.$set);
      return { acknowledged: true, modifiedCount: 1, matchedCount: 1 };
    }
    return { acknowledged: true, modifiedCount: 0, matchedCount: 0 };
  }

  async bulkWrite(operations: Array<{ insertOne?: { document: MockDocument } }>) {
    let insertedCount = 0;
    for (const op of operations) {
      if (op.insertOne) {
        await this.insertOne(op.insertOne.document);
        insertedCount++;
      }
    }
    return { ok: 1, insertedCount, modifiedCount: 0, deletedCount: 0, upsertedCount: 0 };
  }

  aggregate(pipeline: Array<Record<string, unknown>>) {
    let results = [...this.documents];
    
    for (const stage of pipeline) {
      if (stage.$match) {
        results = results.filter(doc => this.matchesQuery(doc, stage.$match as Record<string, unknown>));
      }
      if (stage.$group) {
        results = this.groupDocuments(results, stage.$group as Record<string, unknown>);
      }
      if (stage.$sort) {
        const sortFields = stage.$sort as Record<string, number>;
        results.sort((a, b) => {
          for (const [field, order] of Object.entries(sortFields)) {
            const aVal = a[field];
            const bVal = b[field];
            if (aVal < bVal) return -order;
            if (aVal > bVal) return order;
          }
          return 0;
        });
      }
      if (stage.$limit) {
        results = results.slice(0, stage.$limit as number);
      }
    }
    
    return { toArray: async () => results };
  }

  createIndex(_spec: Record<string, unknown>) {
    return Promise.resolve('index_created');
  }

  private matchesQuery(doc: MockDocument, query: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(query)) {
      if (key === '$or') {
        const orConditions = value as Array<Record<string, unknown>>;
        if (!orConditions.some(cond => this.matchesQuery(doc, cond))) {
          return false;
        }
        continue;
      }
      
      const docValue = doc[key];
      
      if (typeof value === 'object' && value !== null) {
        const ops = value as Record<string, unknown>;
        if ('$gte' in ops && docValue < ops.$gte) return false;
        if ('$lte' in ops && docValue > ops.$lte) return false;
        if ('$regex' in ops) {
          const regex = new RegExp(ops.$regex as string, ops.$options as string ?? '');
          if (!regex.test(String(docValue))) return false;
        }
        continue;
      }
      
      if (docValue !== value) return false;
    }
    return true;
  }

  private groupDocuments(docs: MockDocument[], groupStage: Record<string, unknown>): MockDocument[] {
    const groups = new Map<string, MockDocument[]>();
    const idField = groupStage._id as string;
    
    for (const doc of docs) {
      const groupKey = idField?.startsWith('$') ? String(doc[idField.substring(1)]) : 'all';
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(doc);
    }
    
    const results: MockDocument[] = [];
    for (const [key, groupDocs] of groups.entries()) {
      const result: MockDocument = { _id: key === 'all' ? null : key };
      
      for (const [field, expr] of Object.entries(groupStage)) {
        if (field === '_id') continue;
        
        if (typeof expr === 'object' && expr !== null) {
          const op = expr as Record<string, unknown>;
          if ('$sum' in op) {
            result[field] = groupDocs.length;
          }
          if ('$max' in op) {
            const srcField = (op.$max as string).substring(1);
            result[field] = Math.max(...groupDocs.map(d => d[srcField] as number));
          }
          if ('$addToSet' in op) {
            const srcField = (op.$addToSet as string).substring(1);
            result[field] = [...new Set(groupDocs.map(d => d[srcField]))];
          }
        }
      }
      
      results.push(result);
    }
    
    return results;
  }

  // Test helpers
  clear(): void {
    this.documents = [];
  }

  getDocuments(): MockDocument[] {
    return [...this.documents];
  }
}

export class MockMongoDatabase {
  private collections: Map<string, MockCollection> = new Map();

  collection(name: string): MockCollection {
    if (!this.collections.has(name)) {
      this.collections.set(name, new MockCollection());
    }
    return this.collections.get(name)!;
  }

  admin() {
    return {
      ping: async () => ({ ok: 1 }),
    };
  }

  clear(): void {
    for (const collection of this.collections.values()) {
      collection.clear();
    }
  }
}

export const mockDatabase = new MockMongoDatabase();

export const createMockMongoModule = () => ({
  getMongoDatabase: vi.fn(() => mockDatabase),
  createMongoClient: vi.fn(() => ({
    db: () => mockDatabase,
    close: vi.fn(),
  })),
  closeMongoClient: vi.fn(),
});
