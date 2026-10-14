import { beforeEach, describe, expect, it } from 'vitest';
import { MockStore, newId, type MockStoreState } from './store';
import { DEFAULT_SETTINGS } from './defaults';
import type { Document } from '../api/types';

/** 供测试用的空业务数据。 */
function emptyInitial(): Omit<MockStoreState, 'session' | 'settings'> {
  return {
    documents: [],
    fields: [],
    line_items: [],
    change_logs: [],
    review_records: [],
    archive_records: [],
    operation_logs: [],
    uploads: [],
  };
}

function makeDocument(id: string): Document {
  return {
    id,
    doc_type: 'INVOICE',
    status: 'in_review',
    original_file_uri: '/samples/invoice.svg',
    file_ext: 'pdf',
    source_channel: 'scan',
    upload_user_id: 'u-1',
    enterprise_name: 'ACME',
    doc_number: 'INV-2026-001',
    doc_date: '2026-09-10',
    total_amount: 12500,
    amount_mismatch: false,
    needs_review: false,
    confidence_avg: 0.91,
    created_at: '2026-09-10T09:00:00Z',
    updated_at: '2026-09-10T09:00:00Z',
  };
}

describe('MockStore', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
  });

  it('订阅回调在状态变化时触发，取消订阅后不再触发', () => {
    const store = new MockStore(emptyInitial(), null);
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.mutate((draft) => {
      draft.documents.push(makeDocument('d-1'));
    });
    expect(calls).toBe(1);
    expect(store.getState().documents).toHaveLength(1);

    unsubscribe();
    store.mutate((draft) => {
      draft.documents.push(makeDocument('d-2'));
    });
    expect(calls).toBe(1);
    expect(store.getState().documents).toHaveLength(2);
  });

  it('设置写入持久化存储，新 store 实例（模拟刷新）可读回', () => {
    const first = new MockStore(emptyInitial(), storageLike(storage));
    first.mutate((draft) => {
      draft.settings = { ...draft.settings, export_save_path: 'D:\\Demo\\Exports' };
    });

    // 模拟刷新：同一 storage 新建 store
    const second = new MockStore(emptyInitial(), storageLike(storage));
    expect(second.getState().settings.export_save_path).toBe('D:\\Demo\\Exports');
    // 其余设置回落默认值
    expect(second.getState().settings.review_levels.INVOICE).toBe(DEFAULT_SETTINGS.review_levels.INVOICE);
  });

  it('会话持久化，单据数据不持久化', () => {
    const first = new MockStore(emptyInitial(), storageLike(storage));
    first.mutate((draft) => {
      draft.session = {
        user: { id: 'u-1', username: 'clerk1', display_name: 'Clerk One', roles: ['clerk'] },
        token: 'mock-token',
      };
      draft.documents.push(makeDocument('d-1'));
    });

    const second = new MockStore(emptyInitial(), storageLike(storage));
    expect(second.getState().session?.user.username).toBe('clerk1');
    expect(second.getState().documents).toHaveLength(0);
  });

  it('clearSession 仅清空会话，保留设置', () => {
    const store = new MockStore(emptyInitial(), storageLike(storage));
    store.mutate((draft) => {
      draft.session = {
        user: { id: 'u-1', username: 'clerk1', display_name: 'Clerk One', roles: ['clerk'] },
        token: 'mock-token',
      };
      draft.settings = { ...draft.settings, export_save_path: 'X:\\Y' };
    });
    store.clearSession();
    expect(store.getState().session).toBeNull();
    expect(store.getState().settings.export_save_path).toBe('X:\\Y');
  });

  it('损坏的持久化数据回落默认设置', () => {
    storageLike(storage).setItem('saiflow.web-pc.persisted', '{broken json');
    const store = new MockStore(emptyInitial(), storageLike(storage));
    expect(store.getState().settings).toEqual(DEFAULT_SETTINGS);
    expect(store.getState().session).toBeNull();
  });

  it('newId 返回非空字符串', () => {
    expect(newId().length).toBeGreaterThan(0);
    expect(newId('doc').startsWith('doc-')).toBe(true);
  });
});

/** Map 模拟的 Storage。 */
function storageLike(map: Map<string, string>): Storage {
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}
