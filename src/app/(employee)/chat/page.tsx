'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentInspector } from '@/components/AgentInspector';
import { useIdentity } from '@/components/identity';
import { ErrorNote } from '@/components/ui';
import { apiGet, apiPatch, apiPost } from '@/lib/client';
import { cn } from '@/lib/format';
import type { AgentLog, AgentTurnResult, ConversationMessage, ResolvedIntent } from '@/lib/types';

interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'human';
  text: string;
  result?: AgentTurnResult;
  at: string;
}

const INPUT_PLACEHOLDER = '例如：明天我要和客户评审，帮我准备一下事项';
const ASSISTANT_AVATAR = '/service-assistant-avatar.png?v=2';

const DRAWER_DEFAULT_WIDTH = 520;
const DRAWER_MIN_WIDTH = 400;
const DRAWER_MAX_WIDTH = 880;

const CAPABILITY_HINTS = ['陪我理一下', '查公司制度', '客户评审准备', 'IT / 行政人工'];

const QUICK_QUESTIONS = [
  '明天我要和客户评审，帮我准备一下事项',
  '电脑登陆不上怎么办',
  '会议室怎么约',
  '年假怎么算',
  '报销标准是什么',
  '我今天有点烦，帮我理一下先做什么',
];

const SCOPE_CARDS = [
  {
    title: '非服务类对话',
    text: '闲聊能自然接住，超范围功能请求会说明暂不支持。',
    prompt: '你好可爱啊',
    tag: '不需要接口',
    accent: 'from-[#fff1f2] to-[#eef7ff]',
  },
  {
    title: '知识库问答',
    text: 'VPN、电脑登录、会议室、门禁卡、报销标准、年假规则。',
    prompt: 'VPN 怎么开',
    tag: '引用制度',
    accent: 'from-[#eef7ff] to-[#f5f0ff]',
  },
  {
    title: '客户评审准备',
    text: '查日程、会议室、历史资料，再推联系客户提醒和会前建议。',
    prompt: '明天我要和客户评审，帮我准备一下事项',
    tag: '深度场景',
    accent: 'from-[#ecfeff] to-[#fff7ed]',
  },
  {
    title: '转 IT / 行政人工',
    text: '知识库答不上或员工不满意时，带历史对话进线给对应同事。',
    prompt: '电脑还是登不上，帮我转 IT',
    tag: '仅 IT / 行政',
    accent: 'from-[#f8fafc] to-[#eff6ff]',
  },
];

const CUSTOMER_REVIEW_STEPS = [
  { title: '识别目标', text: '判断这是客户评审准备，不拆成普通工单。' },
  { title: '拆解任务', text: '会议室、资料、客户确认、天气和会前建议。' },
  { title: '调用 mock 能力', text: '日程空闲、会议室、历史文档、提醒。' },
  { title: '输出清单', text: '告诉员工已准备什么，还需要确认什么。' },
];

const FLOW_ENTRIES = [
  { title: '请假流程', text: '可查询余额，提交仍回到企业 OA。', prompt: '我想请假' },
  { title: '报销流程', text: '可解释标准，提交仍回到财务系统。', prompt: '我要报销客户招待费' },
];

const CUSTOMER_REVIEW_THINKING_STEPS = [
  { title: '正在理解目标', text: '识别这是客户评审准备，不当作普通问答处理。' },
  { title: '正在查日程和会议室', text: '读取明天可用时间，并匹配支持投屏的会议室。' },
  { title: '正在读取历史资料', text: '查看客户上次关注点、材料完整度和风险预案。' },
  { title: '正在生成会前清单', text: '整理提醒、天气着装建议和需要你确认的事项。' },
];

function isCustomerReviewPrompt(text: string): boolean {
  return /客户评审|方案评审|客户会议|客户拜访|评审会|准备事项|会前准备|客户.*准备/.test(text);
}

function artifactIds(intent: ResolvedIntent): string[] {
  return [intent.artifacts.gapId, intent.artifacts.ticketId, intent.artifacts.flowEntry].filter(Boolean) as string[];
}

function intentDisplayTitle(intent: ResolvedIntent): string {
  if (intent.id === 'agent.goal_customer_review') return '客户评审准备';
  if (intent.id === 'companion.work_chat') return '工作陪伴';
  if (intent.id === 'it.vpn_access') return 'VPN 远程访问';
  return intent.label.replace(' / ', '与');
}

function intentStatus(intent: ResolvedIntent): string {
  if (intent.id === 'agent.goal_customer_review') return '已拆解准备事项并完成会前检查';
  if (intent.id === 'companion.work_chat') return '已完成陪伴式回复';
  if (intent.id === 'hr.leave_apply' || intent.id === 'fin.reimburse_submit') return '已给出企业流程入口';
  if (intent.risk.forcedAction === 'clarify') return '还需要补充信息';
  if (intent.artifacts.gapId) return '已记录知识缺口';
  if (intent.artifacts.ticketId) return '已转人工接入';
  return '已完成答复';
}

function visibleActions(intent: ResolvedIntent): string[] {
  if (intent.id === 'agent.goal_customer_review') return ['已查日程', '已查资料', '已推提醒'];
  if (intent.id === 'companion.work_chat') return ['自然回复', '优先级梳理'];
  if (intent.id === 'hr.leave_apply' || intent.id === 'fin.reimburse_submit') return ['流程入口'];
  if (intent.risk.forcedAction === 'clarify') return ['请补充信息'];
  if (intent.artifacts.gapId) return ['知识缺口'];
  if (intent.citations.length > 0) return ['知识库回答'];
  return [];
}

function ResultReceipt({ result }: { result: AgentTurnResult }) {
  if (result.prefilter || result.intents.length === 0) {
    return (
      <div className="rounded-xl border border-[#d9e2f2] bg-white px-4 py-3 shadow-sm">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{result.reply}</p>
      </div>
    );
  }

  const citationCount = result.intents.reduce((sum, intent) => sum + intent.citations.length, 0);

  return (
    <div className="space-y-3">
      {result.intents.map((intent, index) => {
        const ids = artifactIds(intent);
        return (
          <article key={`${intent.id ?? 'unknown'}-${index}`} className="rounded-xl border border-[#d9e2f2] bg-white px-4 py-3 shadow-sm">
            {result.intents.length > 1 || ids.length > 0 ? (
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-ink">
                    {result.intents.length > 1 ? `${index + 1}. ${intentDisplayTitle(intent)}` : intentDisplayTitle(intent)}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-faint">{intentStatus(intent)}</div>
                </div>
                {ids[0] ? (
                  <span className="shrink-0 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                    {ids[0]}
                  </span>
                ) : null}
              </div>
            ) : null}

            <div
              className={cn(
                'whitespace-pre-wrap text-sm leading-relaxed text-ink-soft',
                intent.id === 'agent.goal_customer_review' && 'rounded-2xl bg-[#f8fbff] px-3 py-3 text-[#253858]',
              )}
            >
              {intent.id === 'agent.goal_customer_review' ? (
                <div className="mb-2 text-xs font-semibold text-[#172033]">准备结果</div>
              ) : null}
              {intent.answer}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {visibleActions(intent).map((action) => (
                <span key={action} className="rounded-full bg-surface-2 px-2 py-1 text-[11px] text-ink-muted">
                  {action}
                </span>
              ))}
            </div>
          </article>
        );
      })}

      <details className="group rounded-xl border border-[#d9e2f2] bg-[#f8fafc]">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-xs text-ink-muted transition hover:text-ink">
          <span aria-hidden className="transition group-open:rotate-90">
            ›
          </span>
          依据与处理过程
          <span className="ml-auto text-[11px] text-ink-faint">{citationCount} 条制度引用</span>
        </summary>
        <div className="border-t border-line p-3">
          <AgentInspector result={result} variant="compact" />
        </div>
      </details>
    </div>
  );
}

function ThinkingProgress({
  mode,
  step,
}: {
  mode: 'customer-review' | 'default' | null;
  step: number;
}) {
  if (mode === 'customer-review') {
    const activeStep = CUSTOMER_REVIEW_THINKING_STEPS[step] ?? CUSTOMER_REVIEW_THINKING_STEPS[0];
    return (
      <div className="rounded-2xl border border-[#c7d5ff] bg-white p-3 text-xs shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-[#3370ff]">
          <span aria-hidden className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#3370ff]" />
          <span className="font-semibold">{activeStep.title}</span>
          <span className="text-[#94a3b8]">{activeStep.text}</span>
        </div>
        <div className="grid gap-2">
          {CUSTOMER_REVIEW_THINKING_STEPS.map((item, index) => (
            <div key={item.title} className="flex items-center gap-2">
              <span
                className={cn(
                  'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold',
                  index <= step ? 'bg-[#3370ff] text-white' : 'bg-[#eef4ff] text-[#94a3b8]',
                )}
              >
                {index < step ? '✓' : index + 1}
              </span>
              <span className={cn('text-[11px]', index <= step ? 'text-[#172033]' : 'text-[#94a3b8]')}>
                {item.title}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-[#dbe5ff] bg-white px-3 py-2 text-xs text-[#475569] shadow-sm">
      <span aria-hidden className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-line border-t-brand" />
      正在理解你的问题并选择处理方式...
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
  const [handoffNotice, setHandoffNotice] = useState<Record<string, { tone: 'success' | 'muted' | 'error'; text: string }>>({});
  const [humanMode, setHumanMode] = useState(false);
  const [thinkingMode, setThinkingMode] = useState<'customer-review' | 'default' | null>(null);
  const [thinkingStep, setThinkingStep] = useState(0);
  const [drawerWidth, setDrawerWidth] = useState(DRAWER_DEFAULT_WIDTH);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = drawerWidth;

      const onMove = (ev: PointerEvent) => {
        const next = startWidth + (startX - ev.clientX);
        setDrawerWidth(Math.min(DRAWER_MAX_WIDTH, Math.max(DRAWER_MIN_WIDTH, next)));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.userSelect = '';
      };

      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [drawerWidth],
  );

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const lastMessage = messages[messages.length - 1];
    const firstExchangeComplete = messages.length <= 2 && lastMessage?.role === 'agent';
    list.scrollTo({ top: firstExchangeComplete ? 0 : list.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const syncHumanMessages = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await apiGet<ConversationMessage[]>(
        `/api/conversation-messages?sessionId=${encodeURIComponent(sessionId)}`,
      );
      const humanMessages: ChatMessage[] = res.data
        .filter((message) => message.role === 'human')
        .map((message) => ({
          id: message.id,
          role: 'human',
          text: message.text,
          at: message.createdAt,
        }));
      if (humanMessages.length === 0) return;
      setMessages((prev) => {
        const existing = new Set(prev.map((message) => message.id));
        const next = humanMessages.filter((message) => !existing.has(message.id));
        return next.length > 0 ? [...prev, ...next] : prev;
      });
    } catch {
      // 轮询失败不打断员工当前对话
    }
  }, [sessionId]);

  useEffect(() => {
    if (!open || !sessionId) return;
    void syncHumanMessages();
    const timer = window.setInterval(() => {
      void syncHumanMessages();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [open, sessionId, syncHumanMessages]);

  useEffect(() => {
    if (!busy || thinkingMode !== 'customer-review') {
      setThinkingStep(0);
      return;
    }
    const timer = window.setInterval(() => {
      setThinkingStep((current) => Math.min(CUSTOMER_REVIEW_THINKING_STEPS.length - 1, current + 1));
    }, 900);
    return () => window.clearInterval(timer);
  }, [busy, thinkingMode]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setOpen(true);
      setError(null);
      setBusy(true);
      setThinkingMode(isCustomerReviewPrompt(trimmed) ? 'customer-review' : 'default');
      setThinkingStep(0);
      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        text: trimmed,
        at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');

      if (humanMode && sessionId) {
        try {
          await apiPost<ConversationMessage>('/api/conversation-messages', {
            sessionId,
            employeeId,
            role: 'employee',
            authorName: employee?.name ?? '员工',
            text: trimmed,
          });
          await syncHumanMessages();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
          setThinkingMode(null);
        }
        return;
      }

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
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
        setThinkingMode(null);
      }
    },
    [busy, employee?.name, employeeId, humanMode, sessionId, syncHumanMessages],
  );

  const rate = useCallback(async (traceId: string, feedback: 'up' | 'down') => {
    setFeedbackGiven((prev) => ({ ...prev, [traceId]: feedback }));
    setHandoffNotice((prev) => {
      if (feedback === 'up') {
        const next = { ...prev };
        delete next[traceId];
        return next;
      }
      return {
        ...prev,
        [traceId]: { tone: 'muted', text: '正在判断是否需要进入人工接入...' },
      };
    });
    try {
      const res = await apiPatch<AgentLog>('/api/logs', { traceId, feedback });
      if (feedback === 'down') {
        const escalation = res.data.escalation;
        setHandoffNotice((prev) => ({
          ...prev,
          [traceId]: escalation
            ? {
                tone: 'success',
                text: `已转 ${escalation.team} 人工接入，后台同事可以看到这段对话和小助的判断。`,
              }
            : {
                tone: 'muted',
                text: '已记录“没用”反馈。这类问题当前不会进入人工队列，后台会用于优化服务范围。',
              },
        }));
        if (escalation) setHumanMode(true);
      }
    } catch {
      if (feedback === 'down') {
        setHandoffNotice((prev) => ({
          ...prev,
          [traceId]: { tone: 'error', text: '转人工反馈提交失败，请稍后再试。' },
        }));
      }
    }
  }, []);

  return (
    <div className="relative min-h-[calc(100vh-8rem)] pb-28 text-[#475569]">
      <section className="relative mb-5 overflow-hidden rounded-[32px] border border-[#dbe5ff] bg-white px-6 py-7 shadow-[0_28px_76px_rgba(51,112,255,0.12)] lg:px-10 lg:py-10">
        <div aria-hidden className="absolute inset-x-0 top-0 h-40 bg-[linear-gradient(105deg,rgba(51,112,255,0.14),rgba(168,85,247,0.12),rgba(20,184,166,0.10),transparent)]" />

        <div className="relative mx-auto max-w-5xl text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-white shadow-[0_20px_48px_rgba(51,112,255,0.20)]">
            <img src={ASSISTANT_AVATAR} alt="" className="h-full w-full object-cover object-center" />
          </div>
          <p className="mt-5 text-sm font-semibold text-[#3370ff]">
            你好，{employee?.name ?? '同事'}
          </p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight text-[#172033] lg:text-5xl">
            今天想完成什么？
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-[#5f6f89]">
            直接说目标，小助会先理解意图，再判断是自然陪伴、知识库回答、客户评审准备，还是带着上下文转给 IT / 行政同事。
          </p>

          <form
            className="mx-auto mt-8 max-w-3xl rounded-[28px] border border-[#c7d5ff] bg-white p-2 text-left shadow-[0_24px_64px_rgba(51,112,255,0.16)]"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <label htmlFor="home-agent-input" className="sr-only">
              输入今天想完成的事
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="home-agent-input"
                className="min-h-14 flex-1 rounded-[22px] border-0 bg-[#f8fbff] px-5 text-base font-medium text-[#172033] outline-none placeholder:text-[#94a3b8] focus:bg-white focus:ring-2 focus:ring-[#b8c8ff]"
                placeholder={INPUT_PLACEHOLDER}
                value={input}
                disabled={busy}
                onChange={(e) => setInput(e.target.value)}
              />
              <button
                type="submit"
                className="rounded-[22px] bg-[linear-gradient(135deg,#3370ff,#7c3aed)] px-6 py-3 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(51,112,255,0.28)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy || !input.trim()}
              >
                交给小助
              </button>
            </div>
            <div className="flex flex-wrap gap-2 px-2 pb-2 pt-3">
              {CAPABILITY_HINTS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="rounded-full bg-[#eef4ff] px-3 py-1.5 text-xs font-semibold text-[#3370ff] transition hover:bg-[#dbe7ff]"
                  onClick={() => setInput(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </form>
        </div>
      </section>

      <section className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {SCOPE_CARDS.map((item) => (
          <button
            key={item.title}
            type="button"
            className="group rounded-3xl border border-[#e6ecfa] bg-white p-5 text-left shadow-[0_14px_36px_rgba(51,112,255,0.06)] transition hover:-translate-y-0.5 hover:border-[#c7d5ff] hover:shadow-[0_22px_54px_rgba(51,112,255,0.12)]"
            onClick={() => {
              setInput(item.prompt);
              setOpen(true);
            }}
          >
            <div className={cn('mb-4 h-2 rounded-full bg-gradient-to-r', item.accent)} />
            <span className="rounded-full bg-[#f8fbff] px-3 py-1 text-xs font-semibold text-[#3370ff]">{item.tag}</span>
            <h2 className="mt-4 text-base font-semibold text-[#172033]">{item.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#64748b]">{item.text}</p>
            <span className="mt-4 inline-flex text-xs font-semibold text-[#3370ff] opacity-0 transition group-hover:opacity-100">
              试一下
            </span>
          </button>
        ))}
      </section>

      <section className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-3xl border border-[#e6ecfa] bg-white p-5 shadow-[0_14px_36px_rgba(51,112,255,0.06)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[#172033]">客户评审准备怎么跑</h2>
              <p className="mt-1 text-sm text-[#64748b]">这是当前 Demo 唯一做深的个人工作助手场景。</p>
            </div>
            <button
              type="button"
              className="rounded-full bg-[#3370ff] px-4 py-2 text-xs font-semibold text-white shadow-[0_12px_26px_rgba(51,112,255,0.24)]"
              onClick={() => void send('明天我要和客户评审，帮我准备一下事项')}
            >
              跑一遍
            </button>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            {CUSTOMER_REVIEW_STEPS.map((step, index) => (
              <article key={step.title} className="rounded-2xl bg-[#f8fbff] p-4">
                <span className="text-xs font-semibold text-[#3370ff]">0{index + 1}</span>
                <h3 className="mt-2 text-sm font-semibold text-[#172033]">{step.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-[#71819a]">{step.text}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-[#e6ecfa] bg-white p-5 shadow-[0_14px_36px_rgba(51,112,255,0.06)]">
          <h2 className="text-base font-semibold text-[#172033]">流程入口</h2>
          <p className="mt-1 text-sm text-[#64748b]">HR / 财务不进人工后台，只保留企业既有流程入口。</p>
          <div className="mt-4 space-y-3">
            {FLOW_ENTRIES.map((item) => (
              <button
                key={item.title}
                type="button"
                className="block w-full rounded-2xl bg-[#f8fbff] px-4 py-3 text-left transition hover:bg-[#eef4ff]"
                onClick={() => void send(item.prompt)}
              >
                <span className="text-sm font-semibold text-[#172033]">{item.title}</span>
                <span className="mt-1 block text-xs leading-relaxed text-[#71819a]">{item.text}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-[#e6ecfa] bg-white p-5 shadow-[0_14px_36px_rgba(51,112,255,0.06)]">
        <h2 className="text-base font-semibold text-[#172033]">最近可以试的问题</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {QUICK_QUESTIONS.map((item) => (
            <button
              key={item}
              type="button"
              className="rounded-full bg-[#f8fbff] px-4 py-2 text-sm font-medium text-[#52637a] transition hover:bg-[#eef4ff] hover:text-[#3370ff]"
              onClick={() => {
                setInput(item);
                setOpen(true);
              }}
            >
              {item}
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        className="group fixed bottom-7 right-7 z-40 flex items-end gap-3"
        aria-label="打开 AI 助手"
        onClick={() => setOpen(true)}
      >
        <span className="pointer-events-none hidden rounded-2xl bg-white px-4 py-3 text-left shadow-[0_22px_54px_rgba(51,112,255,0.24)] ring-1 ring-[#b8c8ff] transition group-hover:-translate-y-1 sm:block">
          <span className="block text-sm font-semibold text-[#3370ff]">小助 AI 助手</span>
          <span className="mt-1 block text-xs font-medium text-[#475569]">工作陪伴、知识问答、客户评审准备</span>
          <span className="mt-2 inline-flex rounded-full bg-[#eef4ff] px-2.5 py-1 text-[10px] font-bold text-[#3370ff]">
            点击开始体验
          </span>
        </span>
        <span className="relative block h-28 w-28 overflow-hidden rounded-full bg-white shadow-[0_30px_78px_rgba(51,112,255,0.42)] transition group-hover:-translate-y-1 group-hover:scale-105">
          <img src={ASSISTANT_AVATAR} alt="" className="h-full w-full object-cover object-center" />
          <span className="absolute bottom-2 right-2 rounded-full bg-[#3370ff] px-2 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm">
            AI
          </span>
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="AI 服务助手"
          className="fixed inset-y-0 right-0 z-50 flex max-w-[calc(100vw-2rem)] flex-col border-l border-[#dbe5ff] bg-white shadow-[0_0_80px_rgba(51,112,255,0.20)]"
          style={{ width: drawerWidth }}
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="拖拽调整助手宽度"
            title="拖拽调整宽度"
            onPointerDown={startResize}
            className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize bg-transparent transition hover:bg-brand/30"
          />
          <header className="border-b border-[#dbe5ff] bg-[linear-gradient(135deg,#3370ff,#7c3aed)] px-5 py-4 text-white">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="block h-14 w-14 shrink-0 overflow-hidden rounded-full bg-white shadow-sm">
                  <img src={ASSISTANT_AVATAR} alt="" className="h-full w-full object-cover object-center" />
                </span>
                <div>
                  <h2 className="text-lg font-semibold text-white">小助工作助手</h2>
                  <p className="mt-1 text-xs text-blue-100/80">先理解目标，再选择回答、工具或 IT / 行政人工</p>
                </div>
              </div>
              <button
                type="button"
                className="h-8 w-8 rounded-lg text-base text-blue-100 transition hover:bg-white/15 hover:text-white"
                aria-label="关闭 AI 助手"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
          </header>

          <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto bg-[#f4f7ff] px-4 py-4">
            {messages.length === 0 ? (
              <div className="rounded-3xl border border-[#dbe5ff] bg-white p-4 text-sm leading-relaxed text-[#475569] shadow-[0_12px_28px_rgba(51,112,255,0.08)]">
                <div className="flex items-center gap-3">
                  <span className="block h-14 w-14 shrink-0 overflow-hidden rounded-full bg-white shadow-sm">
                    <img src={ASSISTANT_AVATAR} alt="" className="h-full w-full object-cover object-center" />
                  </span>
                  <div>
                    <p className="font-semibold text-[#0f172a]">你好，我是小助</p>
                    <p className="mt-1 text-xs text-[#64748b]">一句话说目标，我会判断该陪你梳理、查知识库、跑评审准备，还是转 IT / 行政。</p>
                  </div>
                </div>

                <div className="mt-4">
                  <p className="mb-2 text-xs font-semibold text-[#3370ff]">试试这些说法</p>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_QUESTIONS.map((question) => (
                      <button
                        key={question}
                        type="button"
                        className="rounded-xl border border-[#d8e2f5] bg-[#f8fbff] px-2.5 py-1.5 text-left text-xs font-medium text-[#334155] transition hover:border-[#3370ff] hover:bg-[#eef4ff] hover:text-[#3370ff]"
                        onClick={() => setInput(question)}
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {messages.map((m) => (
              <div key={m.id} className={cn('flex items-start gap-2', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                {m.role !== 'user' ? (
                  <span className="mt-1 block h-9 w-9 shrink-0 overflow-hidden rounded-full bg-white shadow-sm">
                    {m.role === 'agent' ? (
                      <img src={ASSISTANT_AVATAR} alt="" className="h-full w-full object-cover object-center" />
                    ) : (
                      <span className="grid h-full w-full place-items-center bg-[#3370ff] text-xs font-semibold text-white">人</span>
                    )}
                  </span>
                ) : null}
                <div
                  className={cn(
                    'text-sm leading-relaxed',
                    m.role === 'user'
                      ? 'max-w-[82%] rounded-2xl bg-[#3370ff] px-3.5 py-2.5 text-white shadow-[0_12px_28px_rgba(51,112,255,0.22)]'
                      : m.result
                        ? 'w-full max-w-full text-ink'
                        : cn(
                            'max-w-[92%] rounded-2xl border px-3.5 py-2.5 text-[#0f172a] shadow-sm',
                            m.role === 'human'
                              ? 'border-[#bfdbfe] bg-[#eff6ff]'
                              : 'border-[#dbe5ff] bg-white',
                          ),
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
                          {handoffNotice[m.result.traceId]?.tone === 'success' ? '已转人工' : '没用，转人工'}
                        </button>
                      </div>
                      {handoffNotice[m.result.traceId] ? (
                        <div
                          className={cn(
                            'mt-2 rounded-xl border px-3 py-2 text-xs leading-relaxed',
                            handoffNotice[m.result.traceId].tone === 'success' &&
                              'border-emerald-200 bg-emerald-50 text-emerald-700',
                            handoffNotice[m.result.traceId].tone === 'muted' &&
                              'border-slate-200 bg-slate-50 text-slate-600',
                            handoffNotice[m.result.traceId].tone === 'error' &&
                              'border-red-200 bg-red-50 text-red-700',
                          )}
                        >
                          {handoffNotice[m.result.traceId].text}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="whitespace-pre-wrap">{m.text}</div>
                  )}
                </div>
              </div>
            ))}

            {busy ? (
              <ThinkingProgress mode={thinkingMode} step={thinkingStep} />
            ) : null}
            {humanMode ? (
              <div className="rounded-2xl border border-[#bfdbfe] bg-[#eff6ff] px-3 py-2 text-xs leading-relaxed text-[#1d4ed8]">
                已进入人工接入中。你接下来发送的消息会同步给后台处理人，小助不会重新抢答。
              </div>
            ) : null}
          </div>

          <form
            className="border-t border-[#dbe5ff] bg-white p-4 shadow-[0_-16px_45px_rgba(51,112,255,0.08)]"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
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
