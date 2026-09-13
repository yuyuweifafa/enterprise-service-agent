import type { AgentLog } from '@/lib/types';
import { domainOwner } from '../config';
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
    const current = items[idx];
    const primaryDomain = current.intents[0]?.domain ?? 'UNKNOWN';
    const canHandoff = primaryDomain === 'IT' || primaryDomain === 'ADMIN';
    const next: AgentLog =
      feedback === 'down' && canHandoff
        ? {
            ...current,
            feedback,
            resolvedBy: 'HUMAN',
            escalated: true,
            escalation: {
              ticketId: `CHAT-${current.traceId}`,
              reason: 'negative_feedback',
              team: domainOwner(primaryDomain),
              note: '员工反馈回答未解决，已标记对应部门人工介入；处理人可查看历史对话、意图、知识引用与工具调用。',
              at: new Date().toISOString(),
            },
          }
        : { ...current, feedback };
    const copy = [...items];
    copy[idx] = next;
    return { items: copy, result: next };
  });
}
