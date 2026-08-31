import type { AgentLog } from '@/lib/types';
import { mutate, readCollection } from '../store';

export async function listLogs(limit = 50): Promise<AgentLog[]> {
  const all = await readCollection<AgentLog>('agent-logs');
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

export async function appendLog(log: Omit<AgentLog, 'id'>): Promise<AgentLog> {
  return mutate<AgentLog, AgentLog>('agent-logs', (items) => {
    const maxSeq = items.reduce((max, l) => {
      const m = /LOG-(\d+)/.exec(l.id);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
    const record: AgentLog = { id: `LOG-${String(maxSeq + 1).padStart(4, '0')}`, ...log };
    return { items: [...items, record], result: record };
  });
}

export async function setFeedback(
  traceId: string,
  feedback: 'up' | 'down' | null,
): Promise<AgentLog | null> {
  return mutate<AgentLog, AgentLog | null>('agent-logs', (items) => {
    const idx = items.findIndex((l) => l.traceId === traceId);
    if (idx === -1) return { items, result: null };
    const next = { ...items[idx], feedback };
    const copy = [...items];
    copy[idx] = next;
    return { items: copy, result: next };
  });
}
