'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DomainBadge, EmptyState, ErrorNote } from '@/components/ui';
import { useIdentity } from '@/components/identity';
import { apiGet, apiPost } from '@/lib/client';
import { cn, relativeTime, shortDateTime } from '@/lib/format';
import type { AgentLog, ConversationMessage, Domain, Employee } from '@/lib/types';

type QueueFilter = 'handoff' | 'closed' | 'all';
type ConversationStatus = 'pending' | 'active' | 'resolved' | 'auto_closed';

interface KnowledgeFollowupDraft {
  category: Domain;
  title: string;
  body: string;
}

const QUICK_LINKS: Record<Domain | 'DEFAULT', Array<{ label: string; hint: string }>> = {
  IT: [
    { label: '账号权限后台', hint: '账号、VPN、软件授权' },
    { label: '设备台账', hint: '电脑与维修记录' },
    { label: 'IT 知识库', hint: '补充排查口径' },
  ],
  ADMIN: [
    { label: '会议室系统', hint: '预定与投屏设备' },
    { label: '门禁工牌', hint: '门禁卡、工牌状态' },
    { label: '行政物资', hint: '领用与库存查询' },
  ],
  HR: [],
  FINANCE: [],
  UNKNOWN: [
    { label: '员工档案', hint: '确认人和部门' },
    { label: '知识库', hint: '查相似处理口径' },
    { label: '转派规则', hint: '确认接入团队' },
  ],
  DEFAULT: [
    { label: '员工档案', hint: '查看基础信息' },
    { label: '知识库', hint: '查历史口径' },
    { label: 'IM 联系', hint: '回到原会话沟通' },
  ],
};

const DEMO_SESSIONS: AgentLog[] = [
  {
    id: 'LOG-DEMO-1',
    traceId: 'tr_demo_it',
    sessionId: 'sess_demo_it',
    employeeId: 'E1001',
    question: '电脑还是登录不上，我已经按你说的重置过密码了。',
    kind: 'service',
    intents: [{ id: 'it.account_login', domain: 'IT', label: '电脑登录问题', confidence: 0.91 }],
    knowledgeHit: true,
    citationCount: 1,
    risk: { level: 'LOW', matchedRules: [] },
    toolCalls: [
      { toolId: 'kb.search', status: 'OK', durationMs: 8, summary: '引用账号密码与登录问题处理指引' },
      { toolId: 'hr.get_employee', status: 'OK', durationMs: 2, summary: '林知远 / 技术中心 / 平台研发部 / P6' },
    ],
    actions: ['answer', 'handoff'],
    resolvedBy: 'HUMAN',
    escalated: true,
    latencyMs: 1320,
    feedback: 'down',
    createdAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
    escalation: {
      ticketId: 'CHAT-tr_demo_it',
      reason: 'negative_feedback',
      team: 'IT Helpdesk',
      note: '员工已尝试自助重置密码仍未解决，需要人工查看账号锁定、设备登录域和多因子认证状态。',
      at: new Date(Date.now() - 1000 * 60 * 16).toISOString(),
    },
  },
  {
    id: 'LOG-DEMO-2',
    traceId: 'tr_demo_admin',
    sessionId: 'sess_demo_admin',
    employeeId: 'E1001',
    question: '明天客户评审的会议室投屏设备能提前帮我确认一下吗？',
    kind: 'service',
    intents: [{ id: 'admin.meeting_room', domain: 'ADMIN', label: '会议室 / 场地', confidence: 0.86 }],
    knowledgeHit: true,
    citationCount: 1,
    risk: { level: 'MEDIUM', matchedRules: [] },
    toolCalls: [
      { toolId: 'meeting.find_rooms', status: 'OK', durationMs: 12, summary: '湖畔会议室明天 15:00-16:00 可用' },
      { toolId: 'reminder.create', status: 'OK', durationMs: 6, summary: '已提醒用户今天 18:00 前确认客户时间' },
    ],
    actions: ['answer', 'handoff'],
    resolvedBy: 'HUMAN',
    escalated: true,
    latencyMs: 1588,
    feedback: null,
    createdAt: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
    escalation: {
      ticketId: 'CHAT-tr_demo_admin',
      reason: 'user_request',
      team: '行政前台',
      note: '客户评审前需要人工确认会议室投屏设备、到访安排和现场准备情况，AI 已完成时间与提醒整理。',
      at: new Date(Date.now() - 1000 * 60 * 40).toISOString(),
    },
  },
  {
    id: 'LOG-DEMO-3',
    traceId: 'tr_demo_it_device',
    sessionId: 'sess_demo_it_device',
    employeeId: 'E1001',
    question: '新电脑连不上公司 Wi-Fi，VPN 也提示设备未绑定。',
    kind: 'service',
    intents: [{ id: 'it.device_issue', domain: 'IT', label: '设备网络故障', confidence: 0.88 }],
    knowledgeHit: false,
    citationCount: 0,
    risk: { level: 'MEDIUM', matchedRules: [] },
    toolCalls: [
      { toolId: 'kb.search', status: 'OK', durationMs: 7, summary: '未找到设备绑定与 VPN 联合处理口径' },
      { toolId: 'kb.record_gap', status: 'OK', durationMs: 3, summary: '已记录为 IT 知识缺口' },
    ],
    actions: ['record_gap', 'handoff'],
    resolvedBy: 'HUMAN',
    escalated: true,
    latencyMs: 1090,
    feedback: null,
    createdAt: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
    escalation: {
      ticketId: 'CHAT-tr_demo_it_device',
      reason: 'user_request',
      team: 'IT Helpdesk',
      note: '知识库未覆盖新设备绑定与 VPN 联合排查，建议桌面运维接入并沉淀处理口径。',
      at: new Date(Date.now() - 1000 * 60 * 23).toISOString(),
    },
  },
  {
    id: 'LOG-DEMO-4',
    traceId: 'tr_demo_admin_access',
    sessionId: 'sess_demo_admin_access',
    employeeId: 'E1001',
    question: '我的门禁卡丢了，下午客户来访前能补一张临时卡吗？',
    kind: 'service',
    intents: [{ id: 'admin.access_card', domain: 'ADMIN', label: '门禁卡 / 临时卡', confidence: 0.9 }],
    knowledgeHit: true,
    citationCount: 1,
    risk: { level: 'LOW', matchedRules: [] },
    toolCalls: [
      { toolId: 'kb.search', status: 'OK', durationMs: 6, summary: '引用门禁卡挂失与临时卡申请口径' },
      { toolId: 'employee.profile', status: 'OK', durationMs: 4, summary: '确认员工所在办公区为北京海淀' },
    ],
    actions: ['answer', 'handoff'],
    resolvedBy: 'HUMAN',
    escalated: true,
    latencyMs: 980,
    feedback: null,
    createdAt: new Date(Date.now() - 1000 * 60 * 31).toISOString(),
    escalation: {
      ticketId: 'CHAT-tr_demo_admin_access',
      reason: 'user_request',
      team: '行政前台',
      note: '员工需要下午客户来访前补临时卡，AI 已完成挂失口径说明，需行政确认现场制卡资源。',
      at: new Date(Date.now() - 1000 * 60 * 29).toISOString(),
    },
  },
];

function withTimeout<T>(promise: Promise<T>, ms = 1600): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error('接口响应较慢，已切换为演示会话')), ms);
    }),
  ]);
}

const DEMO_EMPLOYEES: Employee[] = [
  {
    id: 'E1001',
    name: '林知远',
    department: '技术中心 / 平台研发部',
    title: '高级后端工程师',
    level: 'P6',
    status: 'ACTIVE',
    hireDate: '2023-04-10',
    managerId: 'E9001',
    managerName: '周明',
    location: '北京 · 海淀',
    email: 'linzhiyuan@example.com',
    phone: '13800000000',
    costCenter: 'TECH-PLATFORM',
    annualLeaveTotal: 15,
    annualLeaveUsed: 7.5,
    compTimeDays: 2,
  },
];

const CURRENT_HANDOFF_INTENT_IDS = new Set([
  'it.account_login',
  'it.vpn_access',
  'it.device_issue',
  'admin.meeting_room',
  'admin.access_card',
  'admin.supplies_seat',
]);

const LEGACY_HANDOFF_LABELS = new Set([
  '账号密码重置',
  '电脑登录问题',
  'VPN / 远程访问权限申请',
  '设备故障报修',
  '会议室 / 场地',
  '门禁卡 / 工牌',
  '办公用品领用',
]);

function primaryDomain(log: AgentLog): Domain {
  return log.intents[0]?.domain ?? 'UNKNOWN';
}

function primaryLabel(log: AgentLog): string {
  const label = log.intents[0]?.label ?? '未归类会话';
  if (label === '账号密码重置') return '电脑登录问题';
  if (label === 'VPN / 远程访问权限申请') return 'VPN 远程访问';
  if (label === '设备故障报修') return '设备问题';
  if (label === '会议室 / 场地') return '会议室预定';
  if (label === '门禁卡 / 工牌') return '门禁卡处理';
  return label;
}

function needsHuman(log: AgentLog): boolean {
  return log.resolvedBy === 'HUMAN' || log.escalated || Boolean(log.escalation) || log.feedback === 'down';
}

function canEnterHumanQueue(log: AgentLog): boolean {
  const domain = primaryDomain(log);
  const intent = log.intents[0];
  return (
    (domain === 'IT' || domain === 'ADMIN') &&
    (CURRENT_HANDOFF_INTENT_IDS.has(intent?.id ?? '') || LEGACY_HANDOFF_LABELS.has(intent?.label ?? ''))
  );
}

function handoffTeam(log: AgentLog): string {
  if (log.escalation?.team) return log.escalation.team;
  const domain = primaryDomain(log);
  if (domain === 'IT') return 'IT Helpdesk';
  if (domain === 'ADMIN') return '行政前台';
  return '服务台值班';
}

function assignedStaffName(log: AgentLog): string {
  const domain = primaryDomain(log);
  const label = primaryLabel(log);
  if (domain === 'IT') return label.includes('账号') || label.includes('密码') ? '王磊' : '刘颖';
  if (domain === 'ADMIN') return label.includes('会议室') || label.includes('场地') ? '钱佳' : '周宁';
  return '未分配';
}

function employeeById(employees: Employee[], id: string): Employee | null {
  return employees.find((e) => e.id === id) ?? null;
}

function aiSummary(log: AgentLog): string {
  if (log.escalation?.note) return log.escalation.note;
  if (primaryDomain(log) === 'IT') return 'AI 已给出自助排查步骤。若员工反馈未解决，人工继续核查账号、设备和权限状态。';
  if (primaryDomain(log) === 'ADMIN') return 'AI 已完成基础信息整理。人工只需确认现场资源、设备或行政履约状态。';
  if (primaryDomain(log) === 'HR') return 'AI 已识别为 HR 制度或流程问题。建议引导员工进入企业现有流程入口。';
  if (primaryDomain(log) === 'FINANCE') return 'AI 已识别为财务制度或流程问题。建议引导员工进入企业现有财务系统。';
  return 'AI 已整理用户原始诉求、意图和工具调用记录，等待人工判断下一步。';
}

function suggestedReply(log: AgentLog): string {
  if (primaryDomain(log) === 'IT') return '我接入了，先帮你核查账号状态和设备登录记录。你不用重复描述，我能看到刚才和小助的对话。';
  if (primaryDomain(log) === 'ADMIN') return '我来确认现场情况。刚才小助已经同步了你的需求，我会先核对会议室/设备状态。';
  return '我已接入这次会话，会先看小助整理的上下文，再给你一个明确处理结果。';
}

function defaultKnowledgeDraft(log: AgentLog): KnowledgeFollowupDraft {
  return {
    category: primaryDomain(log) === 'UNKNOWN' ? 'IT' : primaryDomain(log),
    title: `${primaryLabel(log)}处理口径`,
    body: suggestedReply(log),
  };
}

function defaultConversationStatus(log: AgentLog): ConversationStatus {
  return needsHuman(log) && canEnterHumanQueue(log) ? 'pending' : 'resolved';
}

function statusLabel(status: ConversationStatus): string {
  if (status === 'pending') return '待接入';
  if (status === 'active') return '处理中';
  if (status === 'auto_closed') return '自动结束';
  return '已解决';
}

export default function TicketsPage() {
  const { staff } = useIdentity();
  const [logs, setLogs] = useState<AgentLog[]>(DEMO_SESSIONS);
  const [employees, setEmployees] = useState<Employee[]>(DEMO_EMPLOYEES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilter>('handoff');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [knowledgeDrafts, setKnowledgeDrafts] = useState<Record<string, KnowledgeFollowupDraft>>({});
  const [conversationStatuses, setConversationStatuses] = useState<Record<string, ConversationStatus>>({});
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [logRes, employeeRes] = await Promise.all([
        withTimeout(apiGet<AgentLog[]>('/api/logs?limit=80')),
        withTimeout(apiGet<Employee[]>('/api/employees')),
      ]);
      const merged = [...logRes.data, ...DEMO_SESSIONS].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setLogs(merged);
      setEmployees(employeeRes.data.length > 0 ? employeeRes.data : DEMO_EMPLOYEES);
      setSelectedId((current) => current ?? merged.find(needsHuman)?.traceId ?? merged[0]?.traceId ?? null);
    } catch (err) {
      setError((err as Error).message);
      setLogs((current) => (current.length > 0 ? current : DEMO_SESSIONS));
      setEmployees((current) => (current.length > 0 ? current : DEMO_EMPLOYEES));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const conversationStatus = useCallback(
    (log: AgentLog) => conversationStatuses[log.traceId] ?? defaultConversationStatus(log),
    [conversationStatuses],
  );

  const visibleLogs = useMemo(() => {
    const byDepartment = logs.filter((log) => primaryDomain(log) === staff.domain);
    const byOwner = byDepartment.filter((log) => assignedStaffName(log) === staff.name);
    if (filter === 'handoff') {
      return byOwner.filter((log) => needsHuman(log) && canEnterHumanQueue(log) && !['resolved', 'auto_closed'].includes(conversationStatus(log)));
    }
    if (filter === 'closed') return byOwner.filter((log) => ['resolved', 'auto_closed'].includes(conversationStatus(log)));
    return byOwner;
  }, [conversationStatus, filter, logs, staff.domain, staff.name]);

  const selected = useMemo(() => {
    return visibleLogs.find((l) => l.traceId === selectedId) ?? visibleLogs[0] ?? null;
  }, [selectedId, visibleLogs]);

  const loadSelectedMessages = useCallback(async () => {
    if (!selected) {
      setConversationMessages([]);
      return;
    }
    try {
      const res = await apiGet<ConversationMessage[]>(
        `/api/conversation-messages?sessionId=${encodeURIComponent(selected.sessionId)}`,
      );
      setConversationMessages(res.data);
    } catch {
      setConversationMessages([]);
    }
  }, [selected]);

  useEffect(() => {
    if (selected) setReply(suggestedReply(selected));
  }, [selected]);

  useEffect(() => {
    void loadSelectedMessages();
    if (!selected) return;
    const timer = window.setInterval(() => {
      void loadSelectedMessages();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [loadSelectedMessages, selected]);

  useEffect(() => {
    if (!selected) return;
    setKnowledgeDrafts((current) => {
      if (current[selected.traceId]) return current;
      return { ...current, [selected.traceId]: defaultKnowledgeDraft(selected) };
    });
  }, [selected]);

  useEffect(() => {
    if (visibleLogs.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !visibleLogs.some((log) => log.traceId === selectedId)) {
      setSelectedId(visibleLogs[0].traceId);
    }
  }, [selectedId, visibleLogs]);

  const selectedEmployee = selected ? employeeById(employees, selected.employeeId) : null;
  const selectedDomain = selected ? primaryDomain(selected) : 'UNKNOWN';
  const quickLinks = selected ? QUICK_LINKS[selectedDomain] ?? QUICK_LINKS.DEFAULT : QUICK_LINKS.DEFAULT;
  const handoffCount = logs.filter((log) => needsHuman(log) && canEnterHumanQueue(log) && assignedStaffName(log) === staff.name && !['resolved', 'auto_closed'].includes(conversationStatus(log))).length;
  const selectedKnowledgeDraft = selected ? (knowledgeDrafts[selected.traceId] ?? defaultKnowledgeDraft(selected)) : null;
  const selectedConversationStatus = selected ? conversationStatus(selected) : null;

  const updateSelectedKnowledgeDraft = (patch: Partial<KnowledgeFollowupDraft>) => {
    if (!selected) return;
    setKnowledgeDrafts((current) => {
      const existing = current[selected.traceId] ?? defaultKnowledgeDraft(selected);
      return { ...current, [selected.traceId]: { ...existing, ...patch } };
    });
  };

  const updateSelectedConversationStatus = (status: ConversationStatus) => {
    if (!selected) return;
    setConversationStatuses((current) => ({ ...current, [selected.traceId]: status }));
  };

  const sendHumanReply = async () => {
    if (!selected || !reply.trim()) return;
    if (selectedConversationStatus === 'pending') updateSelectedConversationStatus('active');
    await apiPost<ConversationMessage>('/api/conversation-messages', {
      sessionId: selected.sessionId,
      traceId: selected.traceId,
      employeeId: selected.employeeId,
      role: 'human',
      authorName: staff.name,
      text: reply.trim(),
    });
    await loadSelectedMessages();
  };

  return (
    <div className="min-h-[calc(100vh-96px)] overflow-hidden rounded-2xl border border-[#dbe5ff] bg-white shadow-[0_22px_48px_rgba(51,112,255,0.08)]">
      <div className="flex h-[calc(100vh-128px)] min-h-[720px]">
        <aside className="flex w-80 shrink-0 flex-col border-r border-[#e2e8f0] bg-[#f8fbff]">
          <div className="border-b border-[#e2e8f0] px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-semibold text-[#172033]">人工接入</h1>
                <p className="mt-1 text-xs text-[#64748b]">
                  {staff.name} 当前只看分配给自己的 {staff.domain === 'IT' ? 'IT 支持' : '行政'} 会话
                </p>
              </div>
              <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600">
                我的 {handoffCount} 条
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl border border-[#dbe5ff] bg-white p-1 text-xs font-medium">
              {[
                ['handoff', '待接入'],
                ['closed', 'AI闭环'],
                ['all', '全部'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={cn(
                    'rounded-lg px-2 py-1.5 transition',
                    filter === key ? 'bg-[#3370ff] text-white shadow-sm' : 'text-[#52637a] hover:bg-[#eef4ff]',
                  )}
                  onClick={() => setFilter(key as QueueFilter)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {error ? (
              <div className="space-y-3">
                <ErrorNote message={`${error}，当前先展示本地演示会话。`} />
                <SessionList
                  logs={visibleLogs}
                  employees={employees}
                  selectedId={selected?.traceId ?? null}
                  onSelect={setSelectedId}
                />
              </div>
            ) : loading && visibleLogs.length === 0 ? (
              <EmptyState title="正在同步最新会话" hint="本地演示会话会优先展示，接口慢不会影响切换页面" />
            ) : visibleLogs.length === 0 ? (
              <EmptyState title="当前没有分配给你的会话" hint="切换顶部处理人，或在员工端触发“没用，转人工”后会进入对应岗位" />
            ) : (
              <SessionList
                logs={visibleLogs}
                employees={employees}
                selectedId={selected?.traceId ?? null}
                onSelect={setSelectedId}
              />
            )}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-[#f3f6fb]">
          {selected ? (
            <>
              <div className="border-b border-[#e2e8f0] bg-white px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-lg font-semibold text-[#172033]">{selectedEmployee?.name ?? selected.employeeId}</h2>
                    <DomainBadge domain={selectedDomain} />
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-xs font-semibold',
                        selectedConversationStatus === 'pending' && 'border-rose-200 bg-rose-50 text-rose-600',
                        selectedConversationStatus === 'active' && 'border-blue-200 bg-blue-50 text-blue-600',
                        selectedConversationStatus === 'resolved' && 'border-emerald-200 bg-emerald-50 text-emerald-600',
                        selectedConversationStatus === 'auto_closed' && 'border-slate-200 bg-slate-50 text-slate-500',
                      )}
                    >
                      {selectedConversationStatus ? statusLabel(selectedConversationStatus) : '未选择'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[#64748b]">
                    {shortDateTime(selected.createdAt)} · {primaryLabel(selected)} · {selected.knowledgeHit ? '已命中知识库' : '知识库未命中'}
                  </p>
                </div>
                <div className="hidden rounded-xl border border-[#dbe5ff] bg-[#f8fbff] px-3 py-2 text-right text-xs text-[#64748b] lg:block">
                  <div>当前处理人</div>
                  <div className="mt-0.5 font-semibold text-[#172033]">
                    {staff.name} · {staff.team} · {staff.domain === 'IT' ? 'IT' : '行政'}
                  </div>
                </div>
                <button type="button" className="btn" onClick={load} disabled={loading}>
                  刷新
                </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-6">
                <div className="mx-auto max-w-3xl space-y-5">
                  <div className="flex justify-center">
                    <span className="rounded-full border border-[#dbe5ff] bg-white px-3 py-1 text-xs text-[#64748b]">
                      小助已把原话、判断和处理记录整理好，人工可以直接继续原会话
                    </span>
                  </div>

                  {conversationMessages.length > 0 ? (
                    <ConversationThread messages={conversationMessages} employeeName={selectedEmployee?.name ?? selected.employeeId} />
                  ) : (
                    <>
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#dbeafe] text-sm font-semibold text-[#1d4ed8]">
                          {(selectedEmployee?.name ?? '员').slice(0, 1)}
                        </div>
                        <div>
                          <div className="mb-1 text-xs text-[#64748b]">{selectedEmployee?.name ?? selected.employeeId} · 员工发起</div>
                          <div className="max-w-xl rounded-2xl rounded-tl-md border border-[#e2e8f0] bg-white px-4 py-3 text-sm leading-relaxed text-[#172033] shadow-sm">
                            {selected.question}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-start justify-end gap-3">
                        <div className="flex flex-col items-end">
                          <div className="mb-1 text-xs font-semibold text-[#3370ff]">小助 · 已处理</div>
                          <div className="max-w-xl rounded-2xl rounded-tr-md border border-[#c7d2fe] bg-[linear-gradient(135deg,#eef4ff,#f8fbff)] px-4 py-3 text-sm leading-relaxed text-[#253858] shadow-sm">
                            <p>{aiSummary(selected)}</p>
                          </div>
                        </div>
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#3370ff] text-sm font-semibold text-white shadow-sm">
                          助
                        </div>
                      </div>
                    </>
                  )}

                  {needsHuman(selected) ? (
                    <div className="flex justify-center">
                      <span className="rounded-full border border-rose-200 bg-white px-3 py-1 text-xs font-semibold text-rose-600">
                        员工反馈未解决，已提醒 {handoffTeam(selected)} 人工进线
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="border-t border-[#e2e8f0] bg-white px-5 py-4">
                <div className="mx-auto max-w-3xl">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <span className="text-xs font-semibold text-[#52637a]">人工回复</span>
                      <p className="mt-0.5 text-[11px] text-[#94a3b8]">处理人接入后，直接在原会话里回复员工。</p>
                    </div>
                    <button type="button" className="shrink-0 text-xs font-semibold text-[#3370ff]" onClick={() => setReply(suggestedReply(selected))}>
                      恢复推荐
                    </button>
                  </div>
                  <textarea
                    className="h-24 w-full resize-none rounded-2xl border border-[#d8e2f5] bg-[#f8fbff] px-4 py-3 text-sm leading-relaxed text-[#172033] outline-none transition focus:border-[#3370ff] focus:bg-white"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                  />
                  <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fbff] px-3 py-2 text-xs leading-relaxed text-[#64748b]">
                      <span className="font-semibold text-[#52637a]">会话规则：</span>
                      15 分钟无新消息自动结束，记录仍可追溯。
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        className="rounded-xl bg-[#3370ff] px-6 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#2457d6] disabled:cursor-not-allowed disabled:bg-slate-300"
                        disabled={selectedConversationStatus === 'resolved' || selectedConversationStatus === 'auto_closed'}
                        onClick={() => void sendHumanReply()}
                      >
                        发送回复
                      </button>
                      <button
                        type="button"
                        className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                        disabled={selectedConversationStatus === 'resolved' || selectedConversationStatus === 'auto_closed'}
                        onClick={() => updateSelectedConversationStatus('resolved')}
                      >
                        结束会话
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="p-6">
              <EmptyState title="请选择一条会话" hint="左侧会显示待人工接入和 AI 已闭环的会话" />
            </div>
          )}
        </main>

        <aside className="flex w-[344px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-[#e2e8f0] bg-[#fbfdff] p-4">
          <section className="rounded-xl border border-[#dbe5ff] bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-[#172033]">员工档案</h3>
            <div className="mt-3 space-y-2 text-sm">
              <InfoRow label="姓名" value={selectedEmployee?.name ?? selected?.employeeId ?? '-'} />
              <InfoRow label="部门" value={selectedEmployee?.department ?? '-'} />
              <InfoRow label="职级" value={selectedEmployee ? `${selectedEmployee.title} · ${selectedEmployee.level}` : '-'} />
              <InfoRow label="地点" value={selectedEmployee?.location ?? '-'} />
              <InfoRow label="直属上级" value={selectedEmployee?.managerName ?? '-'} />
            </div>
          </section>

          <section className="rounded-xl border border-[#dbe5ff] bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-[#172033]">快捷工作入口</h3>
            <div className="mt-3 grid gap-2">
              {quickLinks.map((link) => (
                <button key={link.label} type="button" className="rounded-lg border border-[#e2e8f0] bg-[#f8fbff] px-3 py-2 text-left transition hover:border-[#3370ff] hover:bg-white">
                  <div className="text-sm font-semibold text-[#172033]">{link.label}</div>
                  <div className="mt-0.5 text-xs text-[#64748b]">{link.hint}</div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-[#dbe5ff] bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-[#172033]">会话摘要</h3>
            <p className="mt-3 text-sm leading-relaxed text-[#52637a]">{selected ? aiSummary(selected) : '暂无摘要'}</p>
            {selected ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="chip border-[#dbe5ff] bg-[#f8fbff] text-[#52637a]">{primaryLabel(selected)}</span>
                <span className="chip border-[#dbe5ff] bg-[#f8fbff] text-[#52637a]">{selected.citationCount} 条引用</span>
                <span className="chip border-[#dbe5ff] bg-[#f8fbff] text-[#52637a]">{selected.toolCalls.length} 次工具调用</span>
              </div>
            ) : null}
          </section>

          {selectedKnowledgeDraft ? (
            <section className="rounded-xl border border-[#dbe5ff] bg-white p-4 shadow-sm">
              <div>
                <h3 className="text-sm font-semibold text-[#172033]">沉淀知识库</h3>
                <p className="mt-1 text-xs leading-relaxed text-[#94a3b8]">
                  如果这次人工处理口径可复用，可以直接沉淀为知识库草稿。
                </p>
              </div>

              <div className="mt-3 grid gap-2">
                <label className="text-[11px] font-semibold text-[#94a3b8]">
                  分类
                  <select
                    className="mt-1 w-full rounded-lg border border-[#d8e2f5] bg-[#f8fbff] px-3 py-2 text-xs font-medium text-[#172033] outline-none focus:border-[#3370ff] focus:bg-white"
                    value={selectedKnowledgeDraft.category}
                    onChange={(e) => updateSelectedKnowledgeDraft({ category: e.target.value as Domain })}
                  >
                    <option value="IT">IT 支持</option>
                    <option value="ADMIN">行政服务</option>
                    <option value="HR">HR 制度</option>
                    <option value="FINANCE">财务制度</option>
                  </select>
                </label>
                <label className="text-[11px] font-semibold text-[#94a3b8]">
                  标题
                  <input
                    className="mt-1 w-full rounded-lg border border-[#d8e2f5] bg-[#f8fbff] px-3 py-2 text-xs font-medium text-[#172033] outline-none focus:border-[#3370ff] focus:bg-white"
                    value={selectedKnowledgeDraft.title}
                    onChange={(e) => updateSelectedKnowledgeDraft({ title: e.target.value })}
                    placeholder="例如：账号锁定后如何处理"
                  />
                </label>
                <label className="text-[11px] font-semibold text-[#94a3b8]">
                  答案
                  <textarea
                    className="mt-1 h-28 w-full resize-none rounded-lg border border-[#d8e2f5] bg-[#f8fbff] px-3 py-2 text-xs leading-relaxed text-[#172033] outline-none focus:border-[#3370ff] focus:bg-white"
                    value={selectedKnowledgeDraft.body}
                    onChange={(e) => updateSelectedKnowledgeDraft({ body: e.target.value })}
                    placeholder="填写可复用的处理口径"
                  />
                </label>
                <button
                  type="button"
                  className="mt-1 rounded-xl bg-[#3370ff] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#2457d6]"
                >
                  确定沉淀
                </button>
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[#edf2f7] pb-2 last:border-b-0 last:pb-0">
      <span className="shrink-0 text-xs text-[#94a3b8]">{label}</span>
      <span className="text-right text-sm font-medium text-[#253858]">{value}</span>
    </div>
  );
}

function ConversationThread({
  messages,
  employeeName,
}: {
  messages: ConversationMessage[];
  employeeName: string;
}) {
  return (
    <div className="space-y-4">
      {messages.map((message) => {
        const isAgent = message.role === 'agent';
        const isHuman = message.role === 'human';
        const alignRight = isAgent || isHuman;
        const label = message.role === 'employee' ? `${employeeName} · 员工` : isAgent ? '小助 · AI 已处理' : `${message.authorName} · 人工接入`;
        return (
          <div key={message.id} className={cn('flex items-start gap-3', alignRight ? 'justify-end' : 'justify-start')}>
            {!alignRight ? (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#dbeafe] text-sm font-semibold text-[#1d4ed8]">
                {employeeName.slice(0, 1)}
              </div>
            ) : null}
            <div className={cn('flex max-w-xl flex-col', alignRight ? 'items-end' : 'items-start')}>
              <div className={cn('mb-1 text-xs', isHuman ? 'font-semibold text-emerald-600' : isAgent ? 'font-semibold text-[#3370ff]' : 'text-[#64748b]')}>
                {label}
              </div>
              <div
                className={cn(
                  'whitespace-pre-wrap rounded-2xl border px-4 py-3 text-sm leading-relaxed shadow-sm',
                  message.role === 'employee' && 'rounded-tl-md border-[#e2e8f0] bg-white text-[#172033]',
                  isAgent && 'rounded-tr-md border-[#c7d2fe] bg-[linear-gradient(135deg,#eef4ff,#f8fbff)] text-[#253858]',
                  isHuman && 'rounded-tr-md border-emerald-200 bg-emerald-50 text-emerald-900',
                )}
              >
                {message.text}
              </div>
            </div>
            {alignRight ? (
              <div
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm',
                  isHuman ? 'bg-emerald-600' : 'bg-[#3370ff]',
                )}
              >
                {isHuman ? '人' : '助'}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function SessionList({
  logs,
  employees,
  selectedId,
  onSelect,
}: {
  logs: AgentLog[];
  employees: Employee[];
  selectedId: string | null;
  onSelect: (traceId: string) => void;
}) {
  if (logs.length === 0) {
    return <EmptyState title="当前没有分配给你的会话" hint="换一个处理人或状态筛选看看" />;
  }

  return (
    <div className="space-y-2">
      {logs.map((log) => {
        const active = selectedId === log.traceId;
        const employee = employeeById(employees, log.employeeId);
        const domain = primaryDomain(log);
        return (
          <button
            key={`${log.id}-${log.traceId}`}
            type="button"
            className={cn(
              'w-full rounded-xl border px-3 py-3 text-left transition',
              active
                ? 'border-[#3370ff] bg-white shadow-[0_12px_28px_rgba(51,112,255,0.10)]'
                : 'border-transparent bg-white/70 hover:border-[#dbe5ff] hover:bg-white',
            )}
            onClick={() => onSelect(log.traceId)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {needsHuman(log) ? <span className="h-2 w-2 rounded-full bg-rose-500" /> : null}
                  <p className="truncate text-sm font-semibold text-[#172033]">
                    {employee?.name ?? log.employeeId}
                  </p>
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-[#64748b]">{log.question}</p>
              </div>
              <span className="shrink-0 text-[10px] text-[#94a3b8]">{relativeTime(log.createdAt)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <DomainBadge domain={domain} />
              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', needsHuman(log) ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600')}>
                {assignedStaffName(log)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
