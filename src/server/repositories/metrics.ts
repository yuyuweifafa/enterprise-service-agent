import type {
  AgentLog,
  Approval,
  Domain,
  KnowledgeGap,
  MetricsSummary,
  RiskLevel,
  Ticket,
  TicketStatus,
} from '@/lib/types';
import { domainLabel, getConfig } from '../config';
import { readCollection, readDoc } from '../store';

interface DailyRow {
  date: string;
  conversations: number;
  autoResolved: number;
  knowledgeHit: number;
  escalated: number;
  ticketsCreated: number;
  approvalsCreated: number;
  avgLatencyMs: number;
  byDomain: Record<string, number>;
}

interface MetricsHistoryFile {
  daily: DailyRow[];
}

const DOMAINS: Domain[] = ['IT', 'HR', 'FINANCE', 'ADMIN', 'UNKNOWN'];

function emptyRow(date: string): DailyRow {
  return {
    date,
    conversations: 0,
    autoResolved: 0,
    knowledgeHit: 0,
    escalated: 0,
    ticketsCreated: 0,
    approvalsCreated: 0,
    avgLatencyMs: 0,
    byDomain: { IT: 0, HR: 0, FINANCE: 0, ADMIN: 0, UNKNOWN: 0 },
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/**
 * 看板口径：
 * - 历史部分来自 data/seed/metrics-history.json（模拟已上线一段时间的服务台数据）
 * - 实时部分来自 data/runtime/agent-logs.json（你在对话页每聊一次就会累加）
 * 两者按自然日合并，所以演示时「先看看板 → 去聊一句 → 回来刷新」能看到数字变化。
 */
export async function computeMetrics(days = 14): Promise<MetricsSummary> {
  const { metrics: cfg } = getConfig().app;
  const history = await readDoc<MetricsHistoryFile>('metrics-history');
  const allLogs = await readCollection<AgentLog>('agent-logs');

  // 闲聊不计入服务请求口径：否则员工说几句「你好」就能把自助解决率刷上去，
  // 这个指标就失去意义了。日志本身仍然保留，可观测性不受影响。
  // 闲聊与域外请求都不算服务请求。前者会刷高解决率，后者（天气、写代码）
  // 根本不是服务台该处理的事，算进去等于把「拒答」也统计成「服务」。
  const logs = cfg.excludeSmallTalkFromMetrics
    ? allLogs.filter((l) => l.kind !== 'smalltalk' && l.kind !== 'out_of_scope')
    : allLogs;
  const smallTalkCount = allLogs.length - logs.length;
  const tickets = await readCollection<Ticket>('tickets');
  const approvals = await readCollection<Approval>('approvals');
  const gaps = await readCollection<KnowledgeGap>('knowledge-gaps');

  // ── 1. 合并每日聚合 ────────────────────────────────────────────────────
  const buckets = new Map<string, DailyRow>();
  for (const row of history.daily) {
    buckets.set(row.date, { ...row, byDomain: { ...row.byDomain } });
  }

  const liveLatency = new Map<string, number[]>();
  for (const log of logs) {
    const date = log.createdAt.slice(0, 10);
    const row = buckets.get(date) ?? emptyRow(date);
    row.conversations += 1;
    if (!log.escalated) row.autoResolved += 1;
    if (log.knowledgeHit) row.knowledgeHit += 1;
    if (log.escalated) row.escalated += 1;
    const primaryDomain = log.intents[0]?.domain ?? 'UNKNOWN';
    row.byDomain[primaryDomain] = (row.byDomain[primaryDomain] ?? 0) + 1;
    buckets.set(date, row);

    const arr = liveLatency.get(date) ?? [];
    arr.push(log.latencyMs);
    liveLatency.set(date, arr);
  }

  for (const t of tickets) {
    const date = t.createdAt.slice(0, 10);
    const row = buckets.get(date);
    if (row && t.source === 'AGENT') row.ticketsCreated += 1;
  }
  for (const a of approvals) {
    const date = a.createdAt.slice(0, 10);
    const row = buckets.get(date);
    if (row) row.approvalsCreated += 1;
  }

  // 用实时日志修正当日平均耗时
  for (const [date, arr] of liveLatency) {
    const row = buckets.get(date);
    if (!row || arr.length === 0) continue;
    const liveAvg = arr.reduce((s, v) => s + v, 0) / arr.length;
    row.avgLatencyMs = row.avgLatencyMs
      ? Math.round((row.avgLatencyMs + liveAvg) / 2)
      : Math.round(liveAvg);
  }

  const sorted = Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
  const window = sorted.slice(-days);
  const from = window[0]?.date ?? '';
  const to = window[window.length - 1]?.date ?? '';

  // ── 2. 汇总 ───────────────────────────────────────────────────────────
  const totals = window.reduce(
    (acc, r) => ({
      conversations: acc.conversations + r.conversations,
      autoResolved: acc.autoResolved + r.autoResolved,
      escalated: acc.escalated + r.escalated,
      knowledgeHit: acc.knowledgeHit + r.knowledgeHit,
      ticketsCreated: acc.ticketsCreated + r.ticketsCreated,
      approvalsCreated: acc.approvalsCreated + r.approvalsCreated,
    }),
    {
      conversations: 0,
      autoResolved: 0,
      escalated: 0,
      knowledgeHit: 0,
      ticketsCreated: 0,
      approvalsCreated: 0,
    },
  );

  const safeDiv = (a: number, b: number) => (b === 0 ? 0 : Number((a / b).toFixed(4)));

  // ── 3. 响应时间 ───────────────────────────────────────────────────────
  const latencyWeighted = window.reduce((s, r) => s + r.avgLatencyMs * r.conversations, 0);
  const avgLatencyMs = totals.conversations ? Math.round(latencyWeighted / totals.conversations) : 0;
  const windowDates = new Set(window.map((r) => r.date));
  const logLatencies = logs
    .filter((l) => windowDates.has(l.createdAt.slice(0, 10)))
    .map((l) => l.latencyMs);
  const p90LatencyMs = logLatencies.length
    ? percentile(logLatencies, 90)
    : Math.round(Math.max(...window.map((r) => r.avgLatencyMs), 0));

  // ── 4. 节省工时：按职能域的人工单次处理时长折算 ──────────────────────────
  let savedMinutes = 0;
  for (const row of window) {
    if (row.conversations === 0) continue;
    const autoRatio = row.autoResolved / row.conversations;
    for (const d of DOMAINS) {
      const count = row.byDomain[d] ?? 0;
      const perCase = cfg.manualHandlingMinutes[d] ?? cfg.manualHandlingMinutes.UNKNOWN ?? 12;
      savedMinutes += count * autoRatio * perCase;
    }
  }
  const savedHours = Number((savedMinutes / 60).toFixed(1));
  const savedCostCNY = Math.round(savedHours * cfg.hourlyCostCNY);
  const workdays = Math.max(1, Math.round((window.length * 5) / 7));
  const fteEquivalent = Number((savedHours / (workdays * 8)).toFixed(2));

  // ── 5. 分布类指标 ──────────────────────────────────────────────────────
  const domainTotals = new Map<Domain, number>();
  for (const row of window) {
    for (const d of DOMAINS) {
      domainTotals.set(d, (domainTotals.get(d) ?? 0) + (row.byDomain[d] ?? 0));
    }
  }
  const domainTicketCount = new Map<Domain, number>();
  for (const t of tickets) {
    domainTicketCount.set(t.domain, (domainTicketCount.get(t.domain) ?? 0) + 1);
  }
  const domainSum = Array.from(domainTotals.values()).reduce((s, v) => s + v, 0);
  const byDomain = DOMAINS.map((d) => ({
    domain: d,
    label: domainLabel(d),
    conversations: domainTotals.get(d) ?? 0,
    share: safeDiv(domainTotals.get(d) ?? 0, domainSum),
    tickets: domainTicketCount.get(d) ?? 0,
  })).filter((d) => d.conversations > 0 || d.tickets > 0);

  const riskCounts: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  for (const t of tickets) riskCounts[t.riskLevel] += 1;
  for (const l of logs) riskCounts[l.risk.level] += 1;
  const riskSum = riskCounts.LOW + riskCounts.MEDIUM + riskCounts.HIGH;
  const riskDistribution = (['LOW', 'MEDIUM', 'HIGH'] as RiskLevel[]).map((level) => ({
    level,
    count: riskCounts[level],
    share: safeDiv(riskCounts[level], riskSum),
  }));

  const statusCounts: Record<TicketStatus, number> = {
    OPEN: 0,
    IN_PROGRESS: 0,
    PENDING_REVIEW: 0,
    RESOLVED: 0,
    CLOSED: 0,
    REJECTED: 0,
  };
  for (const t of tickets) statusCounts[t.status] += 1;

  return {
    range: { from, to, days: window.length },
    totals,
    rates: {
      resolutionRate: safeDiv(totals.autoResolved, totals.conversations),
      knowledgeHitRate: safeDiv(totals.knowledgeHit, totals.conversations),
      escalationRate: safeDiv(totals.escalated, totals.conversations),
    },
    responseTime: {
      avgLatencyMs,
      p90LatencyMs,
      baselineMinutes: cfg.baseline.avgFirstResponseMinutes,
    },
    savings: { savedHours, savedCostCNY, fteEquivalent },
    targets: {
      resolutionRate: cfg.targetResolutionRate,
      knowledgeHitRate: cfg.targetKnowledgeHitRate,
      escalationRate: cfg.targetEscalationRate,
      firstResponseMs: cfg.targetFirstResponseMs,
    },
    trend: window.map((r) => ({
      date: r.date,
      conversations: r.conversations,
      autoResolved: r.autoResolved,
      escalated: r.escalated,
      knowledgeHit: r.knowledgeHit,
      resolutionRate: safeDiv(r.autoResolved, r.conversations),
      avgLatencyMs: r.avgLatencyMs,
    })),
    byDomain,
    riskDistribution,
    ticketStatus: (Object.keys(statusCounts) as TicketStatus[]).map((status) => ({
      status,
      count: statusCounts[status],
    })),
    topGaps: gaps
      .filter((g) => g.status !== 'IGNORED')
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 5)
      .map((g) => ({
        id: g.id,
        question: g.question,
        domain: g.domain,
        occurrences: g.occurrences,
        status: g.status,
      })),
    pendingReview: approvals.filter((a) => a.status === 'PENDING').length,
    smallTalkExcluded: smallTalkCount,
  };
}
