'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DomainBadge, EmptyState, ErrorNote, Spinner } from '@/components/ui';
import { apiGet } from '@/lib/client';
import { cn, relativeTime, shortDateTime } from '@/lib/format';
import type { AgentLog, Domain, Employee } from '@/lib/types';

type DomainFilter = Domain | 'ALL';

interface ConversationRow {
  id: string;
  employeeId: string;
  employeeName: string;
  domain: Domain;
  intent: string;
  question: string;
  assignee: string;
  assigneeTeam: string;
  status: 'AI_CLOSED' | 'WAITING_HUMAN' | 'IN_FLOW';
  createdAt: string;
  summary: string;
  aiRead: string;
  nextStep: string;
  subTasks: string[];
}

const DEMO_ROWS: ConversationRow[] = [
  {
    id: 'CV-DEMO-001',
    employeeId: 'E1001',
    employeeName: '林知远',
    domain: 'IT',
    intent: '电脑登录问题',
    question: '电脑还是登录不上，我已经按你说的重置过密码了。',
    assignee: '王磊',
    assigneeTeam: 'IT Helpdesk',
    status: 'WAITING_HUMAN',
    createdAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
    summary: '自助重置后仍失败，建议人工核查账号锁定、设备登录域和多因子认证。',
    aiRead: 'IT 问题，知识库已给过自助方案，员工反馈无效。',
    nextStep: '分配给 IT 权限同事继续核查账号与设备状态。',
    subTasks: ['识别为账号登录问题', '引用自助重置知识', '记录员工反馈未解决', '转 IT 人工接入'],
  },
  {
    id: 'CV-DEMO-002',
    employeeId: 'E1001',
    employeeName: '林知远',
    domain: 'ADMIN',
    intent: '会议室预定',
    question: '明天客户评审的会议室投屏设备能提前帮我确认一下吗？',
    assignee: '钱佳',
    assigneeTeam: '行政前台',
    status: 'WAITING_HUMAN',
    createdAt: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
    summary: '已锁定会议室和客户提醒，需行政确认投屏设备是否可用。',
    aiRead: '客户评审准备中出现行政协同点，需要确认现场设备。',
    nextStep: '分配给行政前台确认会议室投屏和接待物料。',
    subTasks: ['识别客户评审准备目标', '查会议室与投屏设备', '生成客户联系提醒', '转行政确认现场资源'],
  },
  {
    id: 'CV-DEMO-003',
    employeeId: 'E1001',
    employeeName: '林知远',
    domain: 'HR',
    intent: '请假流程入口',
    question: '我下周三想请一天年假。',
    assignee: '企业 OA',
    assigneeTeam: 'HR 流程入口',
    status: 'IN_FLOW',
    createdAt: new Date(Date.now() - 1000 * 60 * 75).toISOString(),
    summary: '小助查询假期余额后引导进入企业已有请假流程，不进入人工队列。',
    aiRead: 'HR 流程型问题，适合走企业已有 OA。',
    nextStep: '保留流程入口，不进入后台人工队列。',
    subTasks: ['识别请假目标', '查询年假 / 调休余额', '展示请假流程入口'],
  },
  {
    id: 'CV-DEMO-004',
    employeeId: 'E1001',
    employeeName: '林知远',
    domain: 'FINANCE',
    intent: '报销流程入口',
    question: '帮我看一下这次客户餐费怎么报销。',
    assignee: '财务系统',
    assigneeTeam: '财务流程入口',
    status: 'IN_FLOW',
    createdAt: new Date(Date.now() - 1000 * 60 * 110).toISOString(),
    summary: '小助解释制度口径，并提供报销流程入口，不模拟财务系统后续审批。',
    aiRead: '财务制度 + 流程入口，不需要后台人工接入。',
    nextStep: '引导员工去报销入口，并记录是否命中知识。',
    subTasks: ['识别报销咨询', '检索报销制度口径', '展示报销流程入口'],
  },
];

const CURRENT_INTENT_IDS = new Set([
  'companion.work_chat',
  'agent.goal_customer_review',
  'it.account_login',
  'it.vpn_access',
  'it.device_issue',
  'admin.meeting_room',
  'admin.access_card',
  'admin.supplies_seat',
  'hr.leave_policy',
  'hr.leave_apply',
  'fin.reimburse_policy',
  'fin.reimburse_submit',
]);

const LEGACY_CURRENT_LABELS = new Set([
  '账号密码重置',
  '电脑登录问题',
  'VPN / 远程访问权限申请',
  '设备故障报修',
  '会议室 / 场地',
  '门禁卡 / 工牌',
  '办公用品领用',
  '假期制度咨询',
  '请假 / 调休申请',
  '报销制度咨询',
  '提交报销单',
  '客户评审准备工作流',
  '客户评审准备目标',
]);

function employeeName(employees: Employee[], id: string): string {
  return employees.find((e) => e.id === id)?.name ?? id;
}

function displayIntentLabel(label: string | undefined): string {
  if (!label) return '未归类会话';
  if (label === '账号密码重置') return '电脑登录问题';
  if (label === 'VPN / 远程访问权限申请') return 'VPN 远程访问';
  if (label === '设备故障报修') return '设备问题';
  if (label === '会议室 / 场地') return '会议室预定';
  if (label === '门禁卡 / 工牌') return '门禁卡处理';
  if (label === '假期制度咨询') return '年假规则';
  if (label === '请假 / 调休申请') return '请假流程入口';
  if (label === '报销制度咨询') return '报销标准';
  if (label === '提交报销单') return '报销流程入口';
  if (label === '客户评审准备工作流' || label === '客户评审准备目标') return '客户评审准备';
  return label;
}

function isCurrentScopeLog(log: AgentLog): boolean {
  if (log.kind === 'out_of_scope') return false;
  if (log.kind === 'smalltalk') return true;
  const intent = log.intents[0];
  if (!intent) return false;
  return CURRENT_INTENT_IDS.has(intent.id ?? '') || LEGACY_CURRENT_LABELS.has(intent.label);
}

function routeByDomain(domain: Domain): { assignee: string; assigneeTeam: string; status: ConversationRow['status'] } {
  if (domain === 'IT') return { assignee: '王磊', assigneeTeam: 'IT Helpdesk', status: 'WAITING_HUMAN' };
  if (domain === 'ADMIN') return { assignee: '钱佳', assigneeTeam: '行政前台', status: 'WAITING_HUMAN' };
  if (domain === 'HR') return { assignee: '企业 OA', assigneeTeam: 'HR 流程入口', status: 'AI_CLOSED' };
  if (domain === 'FINANCE') return { assignee: '财务系统', assigneeTeam: '财务流程入口', status: 'AI_CLOSED' };
  return { assignee: '未分配', assigneeTeam: '待归类', status: 'AI_CLOSED' };
}

function isFlowEntryConversation(log: AgentLog): boolean {
  const intent = log.intents[0];
  if (intent?.id === 'hr.leave_apply' || intent?.id === 'fin.reimburse_submit') return true;
  if (log.actions.includes('flow_entry')) return true;
  return intent?.label === '请假 / 调休申请' || intent?.label === '提交报销单';
}

function rowsFromLogs(logs: AgentLog[], employees: Employee[]): ConversationRow[] {
  return logs.filter(isCurrentScopeLog).map((log) => {
    const domain = log.intents[0]?.domain ?? 'UNKNOWN';
    const route = routeByDomain(domain);
    const needsHuman = log.resolvedBy === 'HUMAN' || log.escalated || Boolean(log.escalation) || log.feedback === 'down';
    const intent = displayIntentLabel(log.intents[0]?.label ?? (log.kind === 'smalltalk' ? '工作陪伴' : undefined));
    const inFlow = isFlowEntryConversation(log);
    const status: ConversationRow['status'] = needsHuman
      ? route.status === 'WAITING_HUMAN'
        ? 'WAITING_HUMAN'
        : 'AI_CLOSED'
      : inFlow
        ? 'IN_FLOW'
        : 'AI_CLOSED';
    return {
      id: log.escalation?.ticketId ?? log.traceId,
      employeeId: log.employeeId,
      employeeName: employeeName(employees, log.employeeId),
      domain,
      intent,
      question: log.question,
      assignee: status === 'WAITING_HUMAN' || status === 'IN_FLOW' ? route.assignee : '小助',
      assigneeTeam: status === 'WAITING_HUMAN' || status === 'IN_FLOW' ? route.assigneeTeam : 'AI 自助闭环',
      status,
      createdAt: log.createdAt,
      summary: log.escalation?.note ?? `${log.citationCount} 条知识引用，${log.toolCalls.length} 次工具调用。`,
      aiRead: `${intent}，${log.knowledgeHit ? '已找到知识依据' : log.kind === 'smalltalk' ? '不需要知识库' : '知识库未命中'}，${status === 'WAITING_HUMAN' ? '建议人工接入' : status === 'IN_FLOW' ? '展示企业流程入口' : '可由 AI 处理'}。`,
      nextStep: status === 'WAITING_HUMAN'
        ? `进入 ${route.assigneeTeam} 队列，由 ${route.assignee} 继续处理。`
        : status === 'IN_FLOW'
          ? `给员工展示 ${route.assigneeTeam}，不进入人工队列。`
          : '记录处理结果，用于后续效果统计。',
      subTasks: [
        `识别为${intent}`,
        log.knowledgeHit ? `引用 ${log.citationCount} 条知识` : log.kind === 'smalltalk' ? '不调用知识库' : '记录知识缺口',
        log.toolCalls.length > 0 ? `调用 ${log.toolCalls.length} 个能力` : '直接生成回复',
        status === 'WAITING_HUMAN' ? `转 ${route.assigneeTeam} 人工接入` : status === 'IN_FLOW' ? '给出流程入口' : 'AI 闭环回答',
      ],
    };
  });
}

function statusText(status: ConversationRow['status']): string {
  if (status === 'WAITING_HUMAN') return '待人工接入';
  if (status === 'IN_FLOW') return '流程入口';
  return 'AI 已闭环';
}

function statusClass(status: ConversationRow['status']): string {
  if (status === 'WAITING_HUMAN') return 'border-rose-200 bg-rose-50 text-rose-600';
  if (status === 'IN_FLOW') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-emerald-200 bg-emerald-50 text-emerald-600';
}

export default function ConversationsPage() {
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [domain, setDomain] = useState<DomainFilter>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [logRes, employeeRes] = await Promise.all([
        apiGet<AgentLog[]>('/api/logs?limit=120'),
        apiGet<Employee[]>('/api/employees'),
      ]);
      setLogs(logRes.data);
      setEmployees(employeeRes.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const all = [...rowsFromLogs(logs, employees), ...DEMO_ROWS].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return domain === 'ALL' ? all : all.filter((row) => row.domain === domain);
  }, [domain, employees, logs]);

  const selected = useMemo(() => {
    return rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  }, [rows, selectedId]);

  const stats = useMemo(() => {
    return {
      total: rows.length,
      waiting: rows.filter((row) => row.status === 'WAITING_HUMAN').length,
      flow: rows.filter((row) => row.status === 'IN_FLOW').length,
      closed: rows.filter((row) => row.status === 'AI_CLOSED').length,
    };
  }, [rows]);

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-[#dbe5ff] bg-white shadow-[0_18px_42px_rgba(51,112,255,0.08)]">
        <div className="h-1 bg-[linear-gradient(90deg,#3370ff,#14b8a6,#f59e0b)]" />
        <div className="flex flex-wrap items-end justify-between gap-4 px-5 py-5">
          <div>
            <h1 className="text-2xl font-semibold text-[#172033]">对话记录中心</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#5f6f89]">
              按“一个员工目标”沉淀一轮会话。相关事项会作为子任务挂在同一轮里；完全不相关的诉求再拆成新的会话或先向员工确认优先级。
            </p>
          </div>
          <button type="button" className="btn" onClick={load} disabled={loading}>
            刷新
          </button>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-4">
        <Stat label="全部会话" value={stats.total} />
        <Stat label="待人工接入" value={stats.waiting} tone="bad" />
        <Stat label="流程入口" value={stats.flow} tone="warn" />
        <Stat label="AI 闭环" value={stats.closed} tone="good" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="rounded-2xl border border-[#dbe5ff] bg-white shadow-[0_18px_42px_rgba(51,112,255,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6ecfa] px-4 py-4">
            <div className="flex flex-wrap gap-1 rounded-xl border border-[#dbe5ff] bg-[#f8fbff] p-1 text-xs font-medium">
              {[
                ['ALL', '全部'],
                ['IT', 'IT'],
                ['ADMIN', '行政'],
                ['HR', 'HR'],
                ['FINANCE', '财务'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={cn(
                    'rounded-lg px-3 py-1.5 transition',
                    domain === value ? 'bg-[#3370ff] text-white shadow-sm' : 'text-[#52637a] hover:bg-white',
                  )}
                  onClick={() => setDomain(value as DomainFilter)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-[#94a3b8]">近 120 条对话记录</p>
          </div>

          {loading ? (
            <div className="px-4">
              <Spinner label="加载对话" />
            </div>
          ) : error ? (
            <div className="p-4">
              <ErrorNote message={error} />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-4">
              <EmptyState title="暂无对话记录" hint="员工端产生对话后会沉淀到这里" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[940px]">
                <thead className="border-b border-[#dbe5ff] bg-[#f8fbff]">
                  <tr>
                    <th className="table-th">进线时间</th>
                    <th className="table-th">员工</th>
                    <th className="table-th">部门</th>
                    <th className="table-th">主目标 / 拆解</th>
                    <th className="table-th">当前分配</th>
                    <th className="table-th">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={`${row.id}-${row.createdAt}`}
                      className={cn(
                        'cursor-pointer border-b border-[#e6ecfa] transition hover:bg-[#f8fbff]',
                        selected?.id === row.id ? 'bg-[#f8fbff]' : '',
                      )}
                      onClick={() => setSelectedId(row.id)}
                    >
                      <td className="table-td whitespace-nowrap">
                        <div className="text-sm text-[#172033]">{shortDateTime(row.createdAt)}</div>
                        <div className="text-xs text-[#94a3b8]">{relativeTime(row.createdAt)}</div>
                      </td>
                      <td className="table-td whitespace-nowrap">
                        <div className="font-medium text-[#172033]">{row.employeeName}</div>
                        <div className="text-xs text-[#94a3b8]">{row.employeeId}</div>
                      </td>
                      <td className="table-td"><DomainBadge domain={row.domain} /></td>
                      <td className="table-td max-w-[340px]">
                        <div className="font-medium text-[#172033]">{row.intent}</div>
                        <div className="mt-1 line-clamp-1 text-xs text-[#64748b]">{row.question}</div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {row.subTasks.slice(0, 3).map((task) => (
                            <span key={task} className="rounded-full bg-[#f1f5ff] px-2 py-0.5 text-[10px] font-medium text-[#52637a]">
                              {task}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="table-td whitespace-nowrap">
                        <div className="font-medium text-[#172033]">{row.assignee}</div>
                        <div className="text-xs text-[#64748b]">{row.assigneeTeam}</div>
                      </td>
                      <td className="table-td">
                        <span className={cn('chip', statusClass(row.status))}>{statusText(row.status)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-[#dbe5ff] bg-white p-4 shadow-[0_18px_42px_rgba(51,112,255,0.08)]">
            <h2 className="text-sm font-semibold text-[#172033]">切割规则</h2>
            <div className="mt-3 space-y-2 text-sm leading-relaxed text-[#52637a]">
              <p>一个员工目标算一轮会话，例如“客户评审准备”。</p>
              <p>一句话里多个相关事项挂在同一轮里，作为子任务展示。</p>
              <p>如果同一句话包含两个不相关目标，小助会拆成两轮，或先询问员工优先处理哪个。</p>
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}

function Stat({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'good' | 'warn' | 'bad' }) {
  const toneClass = {
    default: 'text-[#172033]',
    good: 'text-emerald-600',
    warn: 'text-amber-600',
    bad: 'text-rose-600',
  }[tone];
  return (
    <div className="rounded-2xl border border-[#dbe5ff] bg-white p-4 shadow-[0_14px_34px_rgba(51,112,255,0.07)]">
      <div className="text-xs font-medium text-[#64748b]">{label}</div>
      <div className={cn('mt-2 text-3xl font-semibold tabular-nums', toneClass)}>{value}</div>
    </div>
  );
}
