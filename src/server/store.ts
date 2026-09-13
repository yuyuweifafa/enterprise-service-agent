import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * 极简 JSON 文件存储层。
 *
 * 为什么不用 SQLite：第一阶段目标是「clone 下来就能跑」，JSON 文件零依赖、
 * 零 native 编译、diff 可读，非常适合 Demo 与面试演示。
 *
 * 所有读写都走这一层，且对外只暴露 Repository 接口（见 src/server/repositories/*），
 * 后续换成 SQLite / Prisma / 真实企业接口时，只需要替换 Repository 的实现。
 */

const SEED_DIR = path.join(process.cwd(), 'data', 'seed');
const RUNTIME_DIR = path.join(process.cwd(), 'data', 'runtime');

export type CollectionName =
  | 'employees'
  | 'permissions'
  | 'tickets'
  | 'knowledge-gaps'
  | 'agent-logs'
  | 'conversation-messages'
  | 'metrics-history';

/** 只读集合直接从 seed 读，不落 runtime，避免无意义的文件拷贝 */
const READONLY: CollectionName[] = ['employees', 'permissions', 'metrics-history'];

function seedPath(name: CollectionName) {
  return path.join(SEED_DIR, `${name}.json`);
}

function runtimePath(name: CollectionName) {
  return path.join(RUNTIME_DIR, `${name}.json`);
}

function resolveReadPath(name: CollectionName) {
  if (READONLY.includes(name)) return seedPath(name);
  const rt = runtimePath(name);
  if (!fs.existsSync(rt)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.copyFileSync(seedPath(name), rt);
  }
  return rt;
}

// ── 写锁：同一集合的写操作串行化，避免并发请求互相覆盖 ────────────────────

const locks = globalThis as unknown as { __esaLocks?: Map<string, Promise<unknown>> };
if (!locks.__esaLocks) locks.__esaLocks = new Map();

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const map = locks.__esaLocks!;
  const prev = map.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  map.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

// ── 读写 API ─────────────────────────────────────────────────────────────

export async function readCollection<T>(name: CollectionName): Promise<T[]> {
  const raw = await fsp.readFile(resolveReadPath(name), 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export async function readDoc<T>(name: CollectionName): Promise<T> {
  const raw = await fsp.readFile(resolveReadPath(name), 'utf8');
  return JSON.parse(raw) as T;
}

export async function writeCollection<T>(name: CollectionName, items: T[]): Promise<void> {
  if (READONLY.includes(name)) {
    throw new Error(`集合 ${name} 是只读的（mock 主数据），不支持写入`);
  }
  await fsp.mkdir(RUNTIME_DIR, { recursive: true });
  const target = runtimePath(name);
  const tmp = `${target}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
  await fsp.rename(tmp, target);
}

/** 读-改-写事务，串行执行 */
export async function mutate<T, R>(
  name: CollectionName,
  fn: (items: T[]) => Promise<{ items: T[]; result: R }> | { items: T[]; result: R },
): Promise<R> {
  return withLock(name, async () => {
    const items = await readCollection<T>(name);
    const { items: next, result } = await fn(items);
    await writeCollection(name, next);
    return result;
  });
}

/** 生成形如 TK-20260826-0011 的业务单号 */
export function nextSequentialId(prefix: string, existingIds: string[]): string {
  const d = new Date();
  const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
  const maxSeq = existingIds.reduce((max, id) => {
    const m = /-(\d+)$/.exec(id);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return `${prefix}-${stamp}-${String(maxSeq + 1).padStart(4, '0')}`;
}

export function randomId(prefix: string, len = 6): string {
  const chars = 'abcdef0123456789';
  let out = '';
  for (let i = 0; i < len; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}${out}`;
}
