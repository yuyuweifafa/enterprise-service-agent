'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentInspector } from '@/components/AgentInspector';
import { useIdentity } from '@/components/identity';
import { ErrorNote } from '@/components/ui';
import { apiGet, apiPatch, apiPost } from '@/lib/client';
import { cn } from '@/lib/format';
import type { AgentTurnResult, ResolvedIntent } from '@/lib/types';

interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
  result?: AgentTurnResult;
  at: string;
}

const INPUT_PLACEHOLDER = '输入你的问题或诉求，例如：年假还剩几天、VPN 连不上、帮我提交报销';

/** 概览卡片的数据结构，实际数值来自 GET /api/portal（只返回当前员工自己的数据） */
interface PortalCard {
  key: string;
  title: string;
  value: number;
  hint: string;
}

interface PortalOverview {
  cards: PortalCard[];
  facts: {
    remainingLeave: number;
    compTimeDays: number;
    expiringPermissions: Array<{ system: string; expiresAt: string | null }>;
  };
  recent: Array<{
    id: string;
    title: string;
    status: string;
    assigneeTeam: string;
    lastNote: string;
  }>;
}

/** 加载中的骨架，避免首屏出现写死的假数字 */
const PORTAL_CARDS_SKELETON: PortalCard[] = [
  { key: 'tickets', title: '进行中的工单', value: 0, hint: '加载中…' },
  { key: 'pending', title: '等待人工确认', value: 0, hint: '加载中…' },
  { key: 'systems', title: '已开通系统', value: 0, hint: '加载中…' },
];

/**
 * 抽屉宽度。520 是制度引用能读通的下限（《费用报销管理制度》「差旅标准」这种
 * 长标题加上片段内容，再窄就折行折得很碎）；展开依据看表格时可以拖宽到 880。
 */
const DRAWER_DEFAULT_WIDTH = 520;
const DRAWER_MIN_WIDTH = 400;
const DRAWER_MAX_WIDTH = 880;

const SHORTCUTS = ['年假余额', '报销进度', '会议室', '设备报修', 'VPN 远程访问', '软件授权'];

const QUICK_QUESTIONS = [
  '年假还剩几天？',
  '出差去成都住宿能报多少？',
  'VPN 连不上，顺便帮我申请 Figma 编辑权限',
  '帮我提交一笔报销',
];

function ticketIds(intent: ResolvedIntent): string[] {
  return [intent.artifacts.ticketId, intent.artifacts.approvalId, intent.artifacts.gapId].filter(Boolean) as string[];
}

function intentDisplayTitle(intent: ResolvedIntent): string {
  const software = intent.slots.software ? String(intent.slots.software) : '';
  const system = intent.slots.system ? String(intent.slots.system) : '';

  if (intent.id === 'it.software_install' && software) return `${software} 授权申请`;
  if (intent.id === 'it.vpn_access') return system && system !== 'VPN' ? `${system} 访问` : 'VPN 远程访问';
  return intent.label.replace(' / ', '与');
}

function intentStatus(intent: ResolvedIntent): string {
  if (intent.risk.forcedAction === 'clarify') return '还需要补充信息';
  if (intent.artifacts.approvalId) return '已转人工确认';
  if (intent.artifacts.ticketId) return '已提交处理';
  if (intent.artifacts.gapId) return '已转人工跟进';
  return '已完成答复';
}

function visibleActions(intent: ResolvedIntent): string[] {
  if (intent.risk.forcedAction === 'clarify') return ['请补充信息'];
  if (intent.artifacts.approvalId) return ['待人工确认'];
  if (intent.artifacts.ticketId) return ['已建工单'];
  if (intent.artifacts.gapId) return ['已转人工'];
  return [];
}

function ResultReceipt({ result }: { result: AgentTurnResult }) {
  if (result.prefilter || result.intents.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface px-4 py-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{result.reply}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3">
        {result.intents.map((intent, index) => (
          <article key={`${intent.id ?? 'unknown'}-${index}`} className="rounded-xl border border-line bg-surface px-4 py-3">
            {result.intents.length > 1 || ticketIds(intent).length > 0 ? (
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-ink">
                    {result.intents.length > 1 ? `${index + 1}. ${intentDisplayTitle(intent)}` : intentDisplayTitle(intent)}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-faint">{intentStatus(intent)}</div>
                </div>
                {ticketIds(intent)[0] ? (
                  <span className="shrink-0 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                    {ticketIds(intent)[0]}
                  </span>
                ) : null}
              </div>
            ) : null}

            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{intent.answer}</p>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {visibleActions(intent).map((action) => (
                <span key={action} className="rounded-full bg-surface-2 px-2 py-1 text-[11px] text-ink-muted">
                  {action}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>

      {/*
        依据与处理过程：默认折叠。
        复用 AgentInspector 的 compact 模式 —— 只显示引用来源（含片段与相似度）、
        风险处理方式、以及产生的工单/审批，隐藏意图 ID、置信度、工具调用、完整链路。
        那些是运维视角的东西，在服务台后台看。两处共用同一个组件，避免两套逻辑。
      */}
      <details className="group rounded-xl border border-line bg-canvas">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-xs text-ink-muted transition hover:text-ink">
          <span aria-hidden className="transition group-open:rotate-90">
            ▸
          </span>
          依据与处理过程
          <span className="ml-auto text-[11px] text-ink-faint">
            {result.intents.reduce((s, i) => s + i.citations.length, 0)} 条制度引用
          </span>
        </summary>
        <div className="border-t border-line p-3">
          <AgentInspector result={result} variant="compact" />
        </div>
      </details>
    </div>
  );
}
export default function ChatPage() {
  const { employeeId, employee } = useIdentity();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [feedbackGiven, setFeedbackGiven] = useState<Record<string, 'up' | 'down'>>({});
  const [portal, setPortal] = useState<PortalOverview | null>(null);
  const [drawerWidth, setDrawerWidth] = useState(DRAWER_DEFAULT_WIDTH);
  const listRef = useRef<HTMLDivElement>(null);

  /** ESC 关闭抽屉 */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  /** 拖拽左边缘调整宽度。用 pointer 事件而不是 mouse，顺便支持触控板与触屏。 */
  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = drawerWidth;

    const onMove = (ev: PointerEvent) => {
      // 抽屉贴右侧，所以往左拖（clientX 变小）是变宽
      const next = startWidth + (startX - ev.clientX);
      setDrawerWidth(Math.min(DRAWER_MAX_WIDTH, Math.max(DRAWER_MIN_WIDTH, next)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
    };

    // 拖拽期间禁止选中文字，否则会一路把页面文本刷蓝
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [drawerWidth]);

  /** 拉当前员工的概览。切换演示身份、或对话产生了新工单之后都要重新拉 */
  const loadPortal = useCallback(async () => {
    if (!employeeId) return;
    try {
      const res = await apiGet<PortalOverview>(`/api/portal?employeeId=${encodeURIComponent(employeeId)}`);
      setPortal(res.data);
    } catch {
      setPortal(null);
    }
  }, [employeeId]);

  useEffect(() => {
    loadPortal();
  }, [loadPortal]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const lastMessage = messages[messages.length - 1];
    const firstExchangeComplete = messages.length <= 2 && lastMessage?.role === 'agent';
    list.scrollTo({ top: firstExchangeComplete ? 0 : list.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setOpen(true);
      setError(null);
      setBusy(true);
      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        text: trimmed,
        at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');

      try {
        const res = await apiPost<AgentTurnResult>('/api/agent/chat', {
          message: trimmed,
          employeeId,
          sessionId,
        });
        const result = res.data;
        setSessionId(result.sessionId);
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${result.traceId}`,
            role: 'agent',
            text: result.reply,
            result,
            at: result.createdAt,
          },

        ]);

        // 这轮如果产生了工单/审批，门户上的数字要跟着变 —— 否则员工刚提交完
        // 却看到「进行中的工单 0」，会以为没提交成功。
        const producedArtifact = result.intents.some(
          (i) => i.artifacts.ticketId || i.artifacts.approvalId,
        );
        if (producedArtifact) void loadPortal();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [busy, employeeId, sessionId, loadPortal],
  );

  const rate = useCallback(async (traceId: string, feedback: 'up' | 'down') => {
    setFeedbackGiven((prev) => ({ ...prev, [traceId]: feedback }));
    try {
      await apiPatch('/api/logs', { traceId, feedback });
    } catch {
      // 打分失败不影响主流程
    }
  }, []);

  return (
    <div className="relative min-h-[calc(100vh-8rem)] pb-24">
      <section className="mb-5 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="p-7">
            <p className="text-xs font-medium uppercase tracking-wider text-brand-ink">员工内网</p>
            <h1 className="mt-3 text-2xl font-semibold text-ink">你好，{employee?.name ?? '同事'}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
              今天可以从这里进入 OA、查制度、看待办，也可以直接呼出右下角 AI 助手处理 IT、HR、财务、行政诉求。
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {SHORTCUTS.map((item) => (
                <button key={item} type="button" className="btn px-3 py-1.5 text-xs">
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-line bg-surface-2/60 p-6 lg:border-l lg:border-t-0">
            <div className="rounded-lg border border-line bg-surface p-4">
              <div className="text-xs text-ink-faint">当前身份</div>
              <div className="mt-2 text-base font-semibold text-ink">{employee?.name ?? '加载中'}</div>
              <div className="mt-1 text-xs leading-relaxed text-ink-muted">
                {employee ? `${employee.department} · ${employee.title} · ${employee.status === 'PROBATION' ? '试用期' : '正式'}` : ''}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {(portal?.cards ?? PORTAL_CARDS_SKELETON).map((card) => (
          <section key={card.key} className="rounded-xl border border-line bg-surface p-5 shadow-card">
            <div className="text-xs text-ink-faint">{card.title}</div>
            <div className="mt-2 text-3xl font-semibold tabular-nums text-ink">{card.value}</div>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">{card.hint}</p>
          </section>
        ))}
      </div>

      <section className="mt-4 rounded-xl border border-line bg-surface p-5 shadow-card">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">最近动态</h2>
            <p className="mt-1 text-xs text-ink-muted">工单、审批和系统通知会汇总在这里。</p>
          </div>
          <span className="chip border-emerald-300 bg-emerald-50 text-emerald-700">服务正常</span>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {['VPN 证书将在 9 月自动续期', 'Figma 授权池剩余 8 个席位', '报销平台今晚 22:00 维护'].map((item) => (
            <div key={item} className="rounded-lg border border-line bg-canvas px-3 py-3 text-sm text-ink-soft">
              {item}
            </div>
          ))}
        </div>
      </section>

      <button
        type="button"
        className="group fixed bottom-7 right-7 z-40"
        aria-label="打开 AI 助手"
        onClick={() => setOpen(true)}
      >
        <span className="pointer-events-none absolute bottom-20 right-0 w-max translate-y-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-soft opacity-0 shadow-card transition group-hover:translate-y-0 group-hover:opacity-100">
          有什么需要我帮你办？
        </span>
        <span className="relative grid h-16 w-16 place-items-center rounded-full border border-brand/30 bg-brand text-white shadow-[0_18px_45px_rgba(45,84,214,0.35)] transition hover:scale-105">
          <span className="absolute -right-1 top-2 h-3 w-3 rounded-full border border-white/70 bg-emerald-300" />
          <span className="relative h-9 w-10 rounded-2xl bg-white/95">
            <span className="absolute left-2 top-3 h-1.5 w-1.5 rounded-full bg-brand" />
            <span className="absolute right-2 top-3 h-1.5 w-1.5 rounded-full bg-brand" />
            <span className="absolute bottom-2 left-1/2 h-1.5 w-4 -translate-x-1/2 rounded-b-full border-b-2 border-brand" />
          </span>
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="AI 服务助手"
          className="fixed inset-y-0 right-0 z-50 flex max-w-[calc(100vw-2rem)] flex-col border-l border-line bg-surface shadow-2xl"
          style={{ width: drawerWidth }}
        >
          {/*
            左边缘拖拽把手：默认 520px 够读常规回复，展开「依据与处理过程」看制度片段时
            520 偏窄，可以拖到 880。刻意不做遮罩层 —— 加了就变成模态，
            员工没法边看门户页边问，抽屉的意义就没了。
          */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="拖拽调整助手宽度"
            title="拖拽调整宽度"
            onPointerDown={startResize}
            className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize bg-transparent transition hover:bg-brand/30"
          />
          <header className="border-b border-line px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-ink">AI 服务助手</h2>
                <p className="mt-1 text-xs text-ink-muted">一句话处理公司内部服务请求</p>
              </div>
              <button type="button" className="btn-ghost btn h-8 w-8 p-0 text-base" aria-label="关闭 AI 助手" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
          </header>

          <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto bg-canvas px-4 py-4">
            {messages.length === 0 ? (
              <div className="rounded-lg border border-line bg-surface p-4 text-sm leading-relaxed text-ink-muted">
                <p className="font-medium text-ink">你可以问制度，也可以直接办事</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {QUICK_QUESTIONS.map((question) => (
                    <button
                      key={question}
                      type="button"
                      className="btn justify-start px-2.5 py-1.5 text-left text-xs"
                      onClick={() => setInput(question)}
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {messages.map((m) => (
              <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'text-sm leading-relaxed',
                    m.role === 'user'
                      ? 'max-w-[82%] rounded-xl bg-brand px-3.5 py-2.5 text-white'
                      : m.result
                        ? 'w-full max-w-full text-ink'
                        : 'max-w-[92%] rounded-xl border border-line bg-surface px-3.5 py-2.5 text-ink',
                  )}
                >
                  {m.role === 'agent' && m.result ? (
                    <>
                      <ResultReceipt result={m.result} />
                      <div className="mt-2 flex items-center justify-end gap-1 border-t border-line pt-2">
                        <button
                          type="button"
                          aria-label="这条回答有用"
                          className={cn(
                            'btn px-2 py-1 text-xs',
                            feedbackGiven[m.result.traceId] === 'up' && 'border-emerald-500 bg-emerald-50 text-emerald-700',
                          )}
                          onClick={() => rate(m.result!.traceId, 'up')}
                        >
                          有用
                        </button>
                        <button
                          type="button"
                          aria-label="这条回答没用"
                          className={cn(
                            'btn px-2 py-1 text-xs',
                            feedbackGiven[m.result.traceId] === 'down' && 'border-red-500 bg-red-50 text-red-700',
                          )}
                          onClick={() => rate(m.result!.traceId, 'down')}
                        >
                          没用
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="whitespace-pre-wrap">{m.text}</div>
                  )}
                </div>
              </div>
            ))}

            {busy ? (
              <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink-muted">
                <span aria-hidden className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-line border-t-brand" />
                正在查制度、判断办理方式...
              </div>
            ) : null}
          </div>

          <form
            className="border-t border-line bg-surface p-4"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            {error ? (
              <div className="mb-2">
                <ErrorNote message={error} />
              </div>
            ) : null}
            <label htmlFor="floating-agent-input" className="sr-only">
              输入你的诉求
            </label>
            <div className="flex gap-2">
              <input
                id="floating-agent-input"
                className="input"
                placeholder={INPUT_PLACEHOLDER}
                value={input}
                disabled={busy}
                onChange={(e) => setInput(e.target.value)}
              />
              <button type="submit" className="btn btn-primary shrink-0" disabled={busy || !input.trim()}>
                发送
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
