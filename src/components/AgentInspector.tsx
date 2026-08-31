'use client';

import Link from 'next/link';
import type { AgentTurnResult, ResolvedIntent, TraceStep } from '@/lib/types';
import { ACTION_LABEL, RISK_LABEL, cn, ms, pct } from '@/lib/format';
import { DomainBadge, EmptyState, RiskBadge } from './ui';

/**
 * Agent 处理结果侧栏：把「黑箱」摊开给人看。
 * 面试演示的核心资产 —— 每一句回复背后的意图、引用、风险判定、工具调用都可追溯。
 */

const STAGE_LABEL: Record<TraceStep['stage'], string> = {
  intent: '意图识别',
  slot: '槽位抽取',
  retrieval: '知识检索',
  risk: '风险分级',
  tool: '工具调用',
  compose: '回复合成',
  log: '日志落库',
  llm: '大模型',
  prefilter: '前置拦截',
};

const STATUS_CLASS: Record<TraceStep['status'], string> = {
  OK: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  WARN: 'border-amber-300 bg-amber-50 text-amber-700',
  ERROR: 'border-red-300 bg-red-50 text-red-700',
};

function ConfidenceBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn('h-full rounded-full', value >= 0.6 ? 'bg-emerald-500' : value >= 0.35 ? 'bg-amber-500' : 'bg-red-500')}
          style={{ width: `${Math.max(4, value * 100)}%` }}
        />
      </div>
      <span className="tabular-nums text-[11px] text-ink-muted">{value.toFixed(2)}</span>
    </div>
  );
}

function IntentCard({
  intent,
  index,
  compact = false,
}: {
  intent: ResolvedIntent;
  index: number;
  /**
   * 精简模式（员工端用）：只展示「凭什么这么答」和「系统做了什么」，
   * 隐藏意图 ID、Skill、置信度、命中特征、工具调用这些内部术语 ——
   * 员工看不懂也不该看到，那是运维视角的东西，放在服务台后台。
   */
  compact?: boolean;
}) {
  return (
    <article className="rounded-lg border border-line bg-canvas p-3">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        {compact ? null : <span className="chip border-line bg-surface-2 text-ink-soft">#{index + 1}</span>}
        <span className="text-sm font-medium text-ink">{intent.label}</span>
        <DomainBadge domain={intent.domain} />
        <RiskBadge level={intent.risk.level} />
        {compact ? null : (
          <div className="ml-auto">
            <ConfidenceBar value={intent.confidence} />
          </div>
        )}
      </header>

      <dl className={cn('space-y-1.5 text-xs', compact && 'hidden')}>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-ink-faint">意图 ID</dt>
          <dd className="font-mono text-ink-soft">{intent.id ?? 'UNKNOWN'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-ink-faint">Skill</dt>
          <dd className="font-mono text-ink-soft">{intent.skillId}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-ink-faint">原文片段</dt>
          <dd className="text-ink-soft">{intent.query}</dd>
        </div>
        {intent.matchedKeywords.length > 0 ? (
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-ink-faint">命中特征</dt>
            <dd className="flex flex-wrap gap-1">
              {intent.matchedKeywords.slice(0, 6).map((k) => (
                <code key={k} className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-soft">
                  {k}
                </code>
              ))}
            </dd>
          </div>
        ) : null}
        {Object.keys(intent.slots).length > 0 ? (
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-ink-faint">槽位</dt>
            <dd className="flex flex-wrap gap-1">
              {Object.entries(intent.slots).map(([k, v]) => (
                <span key={k} className="chip border-brand/35 bg-brand-wash text-brand-ink">
                  {k}={String(v)}
                </span>
              ))}
            </dd>
          </div>
        ) : null}
        {intent.missingSlots.length > 0 ? (
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-ink-faint">缺失</dt>
            <dd className="flex flex-wrap gap-1">
              {intent.missingSlots.map((s) => (
                <span key={s.name} className="chip border-amber-300 bg-amber-50 text-amber-700">
                  {s.label}
                </span>
              ))}
            </dd>
          </div>
        ) : null}
      </dl>

      {/* 知识引用 */}
      <section className="mt-3 border-t border-line pt-3">
        <h4 className="label mb-2">知识库引用来源</h4>
        {intent.citations.length === 0 ? (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-xs text-amber-600">
            未命中（最高分 {intent.topScore}）→ 已按规则沉淀知识缺口并转人工
          </p>
        ) : (
          <ol className="space-y-2">
            {intent.citations.map((c) => (
              <li key={c.refId} className="rounded-md border border-line bg-surface-2/60 p-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <code className="rounded bg-brand-wash px-1.5 py-0.5 font-mono text-[10px] text-brand-ink">
                    {c.docId}
                  </code>
                  <span className="text-ink-soft">{c.title}</span>
                  <span className="text-ink-faint">›</span>
                  <span className="text-ink-soft">{c.section}</span>
                  <span className="ml-auto tabular-nums text-[11px] text-emerald-600">{c.score}</span>
                </div>
                <p className="mt-1.5 line-clamp-3 text-[11px] leading-relaxed text-ink-muted">{c.snippet}</p>
                <p className="mt-1 text-[10px] text-ink-faint">
                  归属 {c.owner} · 更新于 {c.updatedAt || '未标注'}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* 风险判定 */}
      <section className="mt-3 border-t border-line pt-3">
        <h4 className="label mb-2">{compact ? '为什么这样处理' : '风险分级依据'}</h4>
        <p className={cn('mb-2 text-xs text-ink-soft', compact && 'hidden')}>
          基线 <code className="font-mono text-ink-soft">{intent.risk.baseLevel}</code> → 最终{' '}
          <code className="font-mono text-ink">{intent.risk.level}</code>（{RISK_LABEL[intent.risk.level]}）
        </p>
        {compact ? (
          <p className="mb-2 text-xs leading-relaxed text-ink-soft">{RISK_LABEL[intent.risk.level]}</p>
        ) : null}
        {intent.risk.reasons.length === 0 ? (
          // 精简模式下这行没必要：上面已经给出处理方式，且「Skill 基线」是内部术语
          compact ? null : (
            <p className="text-xs text-ink-faint">未命中任何升级规则，按 Skill 基线处理。</p>
          )
        ) : (
          <ul className="space-y-1.5">
            {intent.risk.reasons.map((r) => (
              <li key={r.ruleId} className="rounded-md border border-line bg-surface-2/60 px-2.5 py-2 text-xs">
                <div className="flex items-center gap-2">
                  {compact ? null : (
                    <code className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-[10px] text-red-700">
                      {r.ruleId}
                    </code>
                  )}
                  <span className="text-ink-soft">{r.name}</span>
                  {compact ? null : <span className="ml-auto text-[10px] text-ink-muted">{r.effect}</span>}
                </div>
                <p className="mt-1 text-[11px] text-ink-muted">{r.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 建议动作与产物 */}
      <section className="mt-3 border-t border-line pt-3">
        <h4 className="label mb-2">{compact ? '系统已为你做的事' : '建议动作与产物'}</h4>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {intent.actions.map((a) => (
            <span key={a} className="chip border-brand/35 bg-brand-wash text-brand-ink">
              {ACTION_LABEL[a] ?? a}
            </span>
          ))}
        </div>
        {/*
          产物在两种模式下都要展示，但落点不同：
          完整模式给运营跳后台处理；精简模式只给员工看单号 ——
          员工没有后台权限，给他一个跳 /console 的链接是把他推到 403。
        */}
        <div className="flex flex-wrap gap-2 text-xs">
          {intent.artifacts.ticketId ? (
            compact ? (
              <span className="rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-[11px] text-ink-soft">
                工单 {intent.artifacts.ticketId}
              </span>
            ) : (
              <Link href={`/console/tickets?q=${intent.artifacts.ticketId}`} className="btn px-2 py-1 text-xs">
                工单 {intent.artifacts.ticketId} →
              </Link>
            )
          ) : null}
          {intent.artifacts.approvalId ? (
            compact ? (
              <span className="rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-[11px] text-ink-soft">
                审批 {intent.artifacts.approvalId}
              </span>
            ) : (
              <Link href={`/console/review?q=${intent.artifacts.approvalId}`} className="btn px-2 py-1 text-xs">
                审核任务 {intent.artifacts.approvalId} →
              </Link>
            )
          ) : null}
          {intent.artifacts.gapId ? (
            compact ? (
              <span className="rounded-md border border-line bg-surface-2 px-2 py-1 text-[11px] text-ink-soft">
                已记录待补充，会有同事跟进
              </span>
            ) : (
              <Link href="/console/knowledge" className="btn px-2 py-1 text-xs">
                知识缺口 {intent.artifacts.gapId} →
              </Link>
            )
          ) : null}
        </div>
      </section>

      {/* 工具调用（仅完整模式）：员工不需要知道调了哪个 API、耗时多少 */}
      {!compact && intent.toolCalls.length > 0 ? (
        <section className="mt-3 border-t border-line pt-3">
          <h4 className="label mb-2">工具调用明细</h4>
          <ul className="space-y-1.5">
            {intent.toolCalls.map((t, i) => (
              <li key={`${t.toolId}-${i}`} className="rounded-md border border-line bg-surface-2/60 px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={cn('chip', STATUS_CLASS[t.status === 'OK' ? 'OK' : t.status === 'ERROR' ? 'ERROR' : 'WARN'])}>
                    {t.status}
                  </span>
                  <code className="font-mono text-[11px] text-ink-soft">{t.toolId}</code>
                  <span className="text-ink-muted">{t.toolName}</span>
                  <span className="ml-auto tabular-nums text-[10px] text-ink-faint">{t.durationMs} ms</span>
                </div>
                <p className="mt-1 font-mono text-[10px] text-ink-faint">{t.endpoint}</p>
                <p className="mt-1 text-[11px] text-ink-muted">{t.summary ?? t.error}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

export function AgentInspector({
  result,
  variant = 'full',
}: {
  result: AgentTurnResult | null;
  /**
   * full    —— 服务台后台 / 调试视角：意图、置信度、工具调用、完整链路、token 用量
   * compact —— 员工端视角：只回答「凭什么这么答」和「系统做了什么」
   *
   * 两处共用同一个组件而不是各写一份，是为了避免出现两套逻辑
   * （之前的教训：同一套颜色在三个文件里各写一遍，改色要改三处）。
   */
  variant?: 'full' | 'compact';
}) {
  const compact = variant === 'compact';

  if (!result) {
    return (
      <div className="p-4">
        <EmptyState
          title="还没有处理结果"
          hint="在左侧提一个问题，这里会展示意图识别、引用来源、风险等级与建议动作"
        />
      </div>
    );
  }

  // 前置过滤命中：在进入主管线之前就被拦下了，没有意图/检索/风险可展示
  if (result.prefilter) {
    const isOutOfScope = result.prefilter.type === 'out_of_scope';
    return (
      <div className="space-y-4 p-4">
        <section className="rounded-lg border border-line bg-canvas p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'chip',
                isOutOfScope
                  ? 'border-amber-300 bg-amber-50 text-amber-700'
                  : 'border-line bg-surface-2 text-ink-soft',
              )}
            >
              {isOutOfScope ? '域外请求' : '闲聊'} · {result.prefilter.label}
            </span>
            <span className="chip border-line bg-surface-2 text-ink-soft">耗时 {ms(result.latencyMs)}</span>
            <span className="chip border-emerald-300 bg-emerald-50 text-emerald-700">未进入主管线</span>
          </div>
          <p className="text-xs leading-relaxed text-ink-muted">
            命中规则 <code className="font-mono text-ink-soft">{result.prefilter.kind}</code>（
            {result.prefilter.matchedBy}），直接返回回复。
          </p>
          <ul className="mt-2 space-y-1 text-[11px] text-ink-faint">
            <li>· 未检索知识库，未建工单，未沉淀知识缺口</li>
            <li>· 未调用大模型（省一轮 token）</li>
            <li>· 已记日志但标记为 {result.prefilter.type}，不计入看板的服务请求口径</li>
            {isOutOfScope ? (
              <li>· 域外请求不算知识缺口 —— 公司不会为「天气」「写代码」这类写制度</li>
            ) : null}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            规则配在 <code className="font-mono">config/intent-rules.json</code> 的{' '}
            <code className="font-mono">{isOutOfScope ? 'outOfScope' : 'smallTalk'}</code> 段，可自行增删。
          </p>
        </section>

        <section>
          <h3 className="label mb-2">处理链路（{result.trace.length} 步）</h3>
          <ol className="space-y-1.5">
            {result.trace.map((s) => (
              <li key={s.step} className="rounded-md border border-line bg-canvas px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="w-5 shrink-0 text-center font-mono text-[10px] text-ink-faint">{s.step}</span>
                  <span className={cn('chip', STATUS_CLASS[s.status])}>{STAGE_LABEL[s.stage]}</span>
                  <span className="text-ink-soft">{s.title}</span>
                  <span className="ml-auto tabular-nums text-[10px] text-ink-faint">{s.durationMs} ms</span>
                </div>
                {s.detail ? (
                  <p className="mt-1 pl-7 text-[11px] leading-relaxed text-ink-faint">{s.detail}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', compact ? 'p-0' : 'p-4')}>
      {/* 概览（精简模式下整段省掉：引擎、token、耗时是运维关心的，不是员工） */}
      <section className={cn('rounded-lg border border-line bg-canvas p-3', compact && 'hidden')}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <RiskBadge level={result.overallRisk} />
          <span
            className={cn(
              'chip',
              result.engine === 'llm'
                ? 'border-brand/35 bg-brand-wash text-brand-ink'
                : 'border-line bg-surface-2 text-ink-soft',
            )}
          >
            引擎 {result.engine === 'llm' ? `大模型 ${result.llm?.model ?? ''}` : '规则 mock'}
          </span>
          {result.llm ? (
            <span className="chip border-line bg-surface-2 text-ink-soft">
              tokens {result.llm.promptTokens}↑ / {result.llm.completionTokens}↓ · {result.llm.calls} 次调用
            </span>
          ) : null}
          <span className="chip border-line bg-surface-2 text-ink-soft">耗时 {ms(result.latencyMs)}</span>
          {result.needsHumanReview ? (
            <span className="chip border-red-300 bg-red-50 text-red-700">需人工介入</span>
          ) : (
            <span className="chip border-emerald-300 bg-emerald-50 text-emerald-700">Agent 已闭环</span>
          )}
        </div>

        {/* 降级提示：配置要求大模型但实际跑了规则，必须显式告知 */}
        {result.degraded ? (
          <p className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs leading-relaxed text-amber-800">
            <strong>已降级：</strong>配置要求 {result.requestedEngine === 'llm' ? '大模型' : '规则'} 引擎，
            但本次实际由规则引擎完成。{result.degradedReason}
          </p>
        ) : null}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div className="flex gap-2">
            <dt className="text-ink-faint">trace</dt>
            <dd className="font-mono text-ink-soft">{result.traceId}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-faint">session</dt>
            <dd className="font-mono text-ink-soft">{result.sessionId}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-faint">员工</dt>
            <dd className="text-ink-soft">
              {result.employee ? `${result.employee.name}（${result.employee.id}）` : '未知'}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-faint">意图数</dt>
            <dd className="text-ink-soft">{result.intents.length}</dd>
          </div>
        </dl>
      </section>

      {/* 逐意图明细 */}
      <section>
        {compact ? null : <h3 className="label mb-2">意图识别与处理明细</h3>}
        <div className="space-y-3">
          {result.intents.map((intent, i) => (
            <IntentCard key={`${intent.id ?? 'unknown'}-${i}`} intent={intent} index={i} compact={compact} />
          ))}
        </div>
      </section>

      {/* 处理链路（仅完整模式）：员工不需要看每一步耗时多少毫秒 */}
      {compact ? null : (
        <section>
          <h3 className="label mb-2">处理链路（{result.trace.length} 步）</h3>
          <ol className="space-y-1.5">
            {result.trace.map((s) => (
              <li key={s.step} className="rounded-md border border-line bg-canvas px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="w-5 shrink-0 text-center font-mono text-[10px] text-ink-faint">{s.step}</span>
                  <span className={cn('chip', STATUS_CLASS[s.status])}>{STAGE_LABEL[s.stage]}</span>
                  <span className="text-ink-soft">{s.title}</span>
                  <span className="ml-auto tabular-nums text-[10px] text-ink-faint">{s.durationMs} ms</span>
                </div>
                {s.detail ? <p className="mt-1 pl-7 text-[11px] leading-relaxed text-ink-muted">{s.detail}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      )}

      {compact ? (
        <p className="text-[11px] leading-relaxed text-ink-faint">
          以上依据来自公司制度库。如果和你了解的情况不一致，点回复下方的「没用」告诉我，会转人工核实。
        </p>
      ) : (
        <p className="text-[11px] leading-relaxed text-ink-faint">
          知识命中率、解决率、转人工率等指标由这些 trace 汇总而来，可在效果看板查看
          {result.intents.some((i) => i.citations.length > 0)
            ? `。本次共引用 ${result.intents.reduce((s, i) => s + i.citations.length, 0)} 条制度片段，平均相似度 ${pct(
                result.intents.flatMap((i) => i.citations).reduce((s, c) => s + c.score, 0) /
                  Math.max(1, result.intents.flatMap((i) => i.citations).length),
                0,
              )}。`
            : '。'}
        </p>
      )}
    </div>
  );
}
