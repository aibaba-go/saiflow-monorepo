import type {
  ArchiveRecord,
  ChangeLog,
  Document,
  ExtractedField,
  LineItem,
  OperationLog,
  ReviewRecord,
  Session,
  Settings,
  UploadQueueItem,
} from '../api/types';
import { DEFAULT_SETTINGS } from './defaults';

/** 持久化条目：仅会话与设置（design.md 决策 3）；单据数据刷新后重置。 */
export interface PersistedState {
  session: Session | null;
  settings: Settings;
}

const STORAGE_KEY = 'saiflow.web-pc.persisted';

export interface MockStoreState {
  session: Session | null;
  settings: Settings;
  documents: Document[];
  fields: ExtractedField[];
  line_items: LineItem[];
  change_logs: ChangeLog[];
  review_records: ReviewRecord[];
  archive_records: ArchiveRecord[];
  operation_logs: OperationLog[];
  uploads: UploadQueueItem[];
}

type Listener = () => void;

/**
 * 内存 mock store（observer 模式）：
 * - 会话/设置写 localStorage（刷新保留）；
 * - 单据等业务数据仅存内存（刷新重置，保证演示数据确定性）。
 */
export class MockStore {
  private state: MockStoreState;
  private readonly listeners = new Set<Listener>();
  private readonly storage: Storage | null;

  constructor(initial: Omit<MockStoreState, 'session' | 'settings'>, storage?: Storage | null) {
    this.storage = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
    const persisted = this.readPersisted();
    this.state = {
      ...initial,
      session: persisted.session,
      settings: persisted.settings,
    };
  }

  /** 订阅状态变化；返回取消订阅函数。 */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 当前状态快照（只读引用，禁止直接修改）。 */
  getState(): MockStoreState {
    return this.state;
  }

  /** 应用一次变更并通知订阅者；persist 为 true 时将可持久化条目写入 localStorage。 */
  mutate(recipe: (draft: MockStoreState) => void, options?: { persist?: boolean }): void {
    recipe(this.state);
    // 每次变更换新快照（顶层、各集合数组、条目对象全部换引用）：
    // useSyncExternalStore 依赖顶层引用感知变化；rc-table 等组件依赖数组/条目引用决定是否重渲染。
    this.state = cloneState(this.state);
    this.notify();
    if (options?.persist !== false) this.persist();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private readPersisted(): PersistedState {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedState>;
        if (parsed && typeof parsed === 'object') {
          return {
            session: parsed.session ?? null,
            // 设置合并默认值，容忍新增字段
            settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
          };
        }
      }
    } catch {
      // 损坏的持久化数据一律回落默认值
    }
    return { session: null, settings: DEFAULT_SETTINGS };
  }

  private persist(): void {
    if (!this.storage) return;
    const persisted: PersistedState = {
      session: this.state.session,
      settings: this.state.settings,
    };
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch {
      // 写入失败（隐私模式/配额）不影响内存运行
    }
  }

  /** 清空持久化数据（退出登录时调用）。 */
  clearSession(): void {
    this.mutate((draft) => {
      draft.session = null;
    });
  }
}

/** 深一层克隆状态快照：集合数组与条目对象均换新引用（recipe 原地修改后调用）。 */
function cloneState(state: MockStoreState): MockStoreState {
  return {
    session: state.session ? { ...state.session, user: { ...state.session.user } } : null,
    settings: { ...state.settings, review_levels: { ...state.settings.review_levels } },
    documents: state.documents.map((doc) => ({ ...doc })),
    fields: state.fields.map((field) => ({ ...field })),
    line_items: state.line_items.map((item) => ({ ...item })),
    change_logs: state.change_logs.map((log) => ({ ...log })),
    review_records: state.review_records.map((record) => ({ ...record })),
    archive_records: state.archive_records.map((record) => ({ ...record })),
    operation_logs: state.operation_logs.map((log) => ({ ...log })),
    uploads: state.uploads.map((item) => ({ ...item })),
  };
}

/** 生成短 uuid（原型足够）。 */
export function newId(prefix = ''): string {
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix ? `${prefix}-${uuid}` : uuid;
}
