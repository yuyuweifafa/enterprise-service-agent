import type {
  AgentActionType,
  AgentTurnResult,
  Citation,
  ResolvedIntent,
  RiskLevel,
  ToolCallRecord,
  TraceStep,
} from '@/lib/types';
import { getConfig, getSkill, getTool, type SkillDef } from '@/server/config';
import { peekTopScore } from '@/server/knowledge';
import { getEmployee } from '@/server/repositories/employees';
import { appendLog } from '@/server/repositories/logs';
import { randomId } from '@/server/store';
import { buildAnswer, buildSuggestedAction, renderTemplate } from './compose';
import { recognizeIntents, type IntentCandidate } from './intent';
import { LlmError } from './llm/client';
import { composeReplyLlm } from './llm/compose';
import { recognizeIntentsLlm } from './llm/intent';
import { actionsForLevel, assessRisk } from './risk';
import { classifyInput } from './prefilter';
import { extractSlots } from './slots';
import { executeTool, type ToolContext } from './tools';

/**
 * Agent 主编排管线。
 *
 * 固定六段式：意图识别 → 槽位抽取 → 知识检索 → 风险分级 → 工具调用 → 回复合成，
 * 每一段都会往 trace 里写一条可视化步骤，对话侧栏直接渲染这个 trace。
 *
 * 两种引擎共用这一个骨架，差别只在两段的实现：
 *   - 意图识别 + 槽位抽取：mock=关键词正则打分 / llm=function calling 结构化输出
 *   - 回复合成：mock=模板拼装 / llm=System Prompt + 检索片段驱动生成
 *
 * **风险分级、动作编排、工具调用在两种引擎下都是规则驱动的，不交给模型。**
 * 企业内部服务场景要的是可审计、可解释、可回归测试：员工问「这笔钱能不能报」，
 * 答错了要能查出是哪条制度、哪条规则导致的。让模型自由决定要不要开生产库权限，
 * 出问题时无法定位，也没法写回归测试。
 */

const ACTION_ORDER: Record<AgentActionType, number> = {
  answer: 0,
  clarify: 0,
  record_gap: 1,
  create_ticket: 2,
  create_approval: 3,
  handoff: 4,
};

const RISK_ORDER: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH'];

/** Skill.defaultAction 声明的兜底动作 → 实际要执行的动作集合 */
const SKILL_DEFAULT_ACTIONS: Record<SkillDef['defaultAction'], AgentActionType[]> = {
  answer: ['answer'],
  create_ticket: ['answer', 'create_ticket'],
  human_review: ['answer', 'create_ticket', 'create_approval', 'handoff'],
  handoff: ['answer', 'create_ticket', 'handoff'],
};

export interface RunAgentInput {
  message: string;
  employeeId: string;
  sessionId?: string;
}

export async function runAgentTurn(input: RunAgentInput): Promise<AgentTurnResult> {
  const startedAt = Date.now();
  const cfg = getConfig();
  const traceId = randomId('tr_');
  const sessionId = input.sessionId ?? randomId('sess_', 8);
  const question = input.message.trim();
  const trace: TraceStep[] = [];
  let step = 0;

  const pushTrace = (
    stage: TraceStep['stage'],
    title: string,
    detail: string,
    status: TraceStep['status'],
    durationMs: number,
  ) => {
    step += 1;
    trace.push({ step, stage, title, detail, status, durationMs });
  };

  // ── 引擎与降级状态 ──────────────────────────────────────────────────
  const requestedEngine = cfg.app.agent.engine;
  const llmCfg = cfg.llm;
  /** 本次实际用到的引擎；LLM 任一环节失败并降级后会被改成 mock */
  let effectiveEngine: 'mock' | 'llm' = requestedEngine;
  let degradedReason: string | null = null;
  const llmStats = { calls: 0, promptTokens: 0, completionTokens: 0, durationMs: 0 };

  const recordLlmUsage = (u: { promptTokens: number; completionTokens: number }, ms: number) => {
    llmStats.calls += 1;
    llmStats.promptTokens += u.promptTokens;
    llmStats.completionTokens += u.completionTokens;
    llmStats.durationMs += ms;
  };

  /** 统一的降级处理：如实记录原因并把引擎标回 mock，绝不伪装成大模型输出 */
  const degrade = (where: string, err: unknown): string => {
    const detail =
      err instanceof LlmError
        ? `${err.code}${err.status ? ` HTTP ${err.status}` : ''}，重试 ${err.attempts} 次：${err.message}`
        : String((err as Error)?.message ?? err);
    effectiveEngine = 'mock';
    degradedReason = `${where}调用大模型失败（${detail}），已降级到规则引擎`;
    return degradedReason;
  };

  // ── 0. 员工上下文 ──────────────────────────────────────────────────────
  const employee = await getEmployee(input.employeeId);

  // ── 0.5 前置过滤：闲聊 + 域外请求（在主管线之前短路）────────────────────
  // 不这么做的后果（三个都实测过）：
  //   「你好」          → 识别不出意图 → 建工单 + 记知识缺口
  //   「今天天气怎么样」→ 被当成「公司还没写天气制度」→ 沉淀知识缺口 + 转人工
  //   「帮我写段排序」  → 硬套成薪酬咨询 → 判 HIGH → 建工单 + 建人工确认任务
  // 主管线假设「所有输入都是四个职能域内的服务请求」，所以总能找到最接近的意图。
  const t05 = Date.now();
  const pre = classifyInput(question);
  if (pre) {
    const isOutOfScope = pre.type === 'out_of_scope';
    pushTrace(
      'prefilter',
      `${isOutOfScope ? '域外请求拦截' : '闲聊拦截'} · ${pre.label}`,
      `命中规则 ${pre.kind}（${pre.matchedBy}）→ 直接回复，不检索、不建单、不沉淀知识缺口、不调大模型` +
        (isOutOfScope ? '。域外请求不算知识缺口 —— 公司不会为它写制度' : ''),
      'OK',
      Date.now() - t05,
    );

    const latency = Date.now() - startedAt;
    await appendLog({
      traceId,
      sessionId,
      employeeId: input.employeeId,
      question,
      kind: pre.type,
      prefilterKind: pre.kind,
      intents: [],
      knowledgeHit: false,
      citationCount: 0,
      risk: { level: 'LOW', matchedRules: [] },
      toolCalls: [],
      actions: ['answer'],
      resolvedBy: 'AGENT',
      escalated: false,
      latencyMs: latency,
      feedback: null,
      createdAt: new Date().toISOString(),
    });
    pushTrace(
      'log',
      '写入处理日志',
      `traceId=${traceId}，标记为 ${pre.type}，不计入服务请求口径`,
      'OK',
      0,
    );

    return {
      traceId,
      sessionId,
      engine: effectiveEngine,
      requestedEngine,
      degraded: false,
      degradedReason: null,
      llm: null,
      employee,
      question,
      reply: pre.reply,
      intents: [],
      overallRisk: 'LOW',
      needsHumanReview: false,
      latencyMs: latency,
      createdAt: new Date().toISOString(),
      trace,
      prefilter: { type: pre.type, kind: pre.kind, label: pre.label, matchedBy: pre.matchedBy },
    };
  }

  // ── 1. 多意图识别 ─────────────────────────────────────────────────────
  const t1 = Date.now();
  let candidates: IntentCandidate[];

  if (requestedEngine === 'llm' && llmCfg) {
    // 级联策略：先跑规则引擎（~1ms、0 成本），置信度够高就直接用，
    // 不够才升级到大模型。省一次调用 = 省一半延迟和一半 token。
    // 这不是偷懒：「OA 密码忘了」这种明确表述，正则的判断和大模型一样准，
    // 花 20 秒等模型确认一遍没有收益。
    let ruleCandidates: IntentCandidate[] | null = null;
    let skipLlmIntent = false;

    if (llmCfg.intentStrategy === 'rules-first-escalate') {
      ruleCandidates = recognizeIntents(question);
      const minConfidence = Math.min(...ruleCandidates.map((c) => c.confidence));
      const allRecognized = ruleCandidates.every((c) => c.id !== null);
      skipLlmIntent = allRecognized && minConfidence >= llmCfg.intentEscalationThreshold;

      if (skipLlmIntent) {
        candidates = ruleCandidates;
        pushTrace(
          'intent',
          '规则引擎已足够确定，跳过大模型意图识别',
          `最低置信度 ${minConfidence.toFixed(3)} ≥ 阈值 ${llmCfg.intentEscalationThreshold}，省下一次模型调用`,
          'OK',
          Date.now() - t1,
        );
      }
    }

    if (skipLlmIntent) {
      candidates = ruleCandidates!;
    } else {
      try {
        const r = await recognizeIntentsLlm(question, llmCfg);
        candidates = r.candidates;
        recordLlmUsage(r.usage, r.durationMs);

        // 模型判定为域外：和前置规则拦截走同一条出口 —— 说明范围，不建单不沉淀。
        // 这是第二层防御，兜住规则黑名单没覆盖到的域外问法。
        if (r.outOfScope) {
          const oosCfg = cfg.intents.outOfScope;
          const reply = [
            oosCfg?.replyPrefix ?? '这个不在企业服务台的范围内。',
            oosCfg?.replySuffix ??
              '我能帮你处理的是 IT、HR、财务、行政四类事情，比如查制度、申请权限、报修设备、提交报销、预定会议室。',
          ]
            .filter(Boolean)
            .join('\n\n');

          pushTrace(
            'prefilter',
            '域外请求拦截 · 大模型判定',
            '模型返回 scope=out_of_scope（规则黑名单未覆盖此问法）→ 说明服务范围，不建单、不沉淀知识缺口',
            'OK',
            r.durationMs,
          );

          const latency = Date.now() - startedAt;
          await appendLog({
            traceId,
            sessionId,
            employeeId: input.employeeId,
            question,
            kind: 'out_of_scope',
            prefilterKind: 'scope.llm_judged',
            intents: [],
            knowledgeHit: false,
            citationCount: 0,
            risk: { level: 'LOW', matchedRules: [] },
            toolCalls: [],
            actions: ['answer'],
            resolvedBy: 'AGENT',
            escalated: false,
            latencyMs: latency,
            feedback: null,
            createdAt: new Date().toISOString(),
          });

          return {
            traceId,
            sessionId,
            engine: effectiveEngine,
            requestedEngine,
            degraded: false,
            degradedReason: null,
            llm: {
              model: llmCfg.model,
              calls: llmStats.calls,
              promptTokens: llmStats.promptTokens,
              completionTokens: llmStats.completionTokens,
              totalTokens: llmStats.promptTokens + llmStats.completionTokens,
              durationMs: llmStats.durationMs,
            },
            employee,
            question,
            reply,
            intents: [],
            overallRisk: 'LOW',
            needsHumanReview: false,
            latencyMs: latency,
            createdAt: new Date().toISOString(),
            trace,
            prefilter: {
              type: 'out_of_scope',
              kind: 'scope.llm_judged',
              label: '大模型判定域外',
              matchedBy: '模型返回 scope=out_of_scope',
            },
          };
        }
        pushTrace(
          'llm',
          `大模型意图识别（${llmCfg.model}）`,
          [
            llmCfg.intentStrategy === 'rules-first-escalate'
              ? `规则置信度不足，已升级到大模型`
              : '策略 llm-first，直接调用大模型',
            `识别到 ${candidates.length} 个意图`,
            `tokens 输入 ${r.usage.promptTokens} / 输出 ${r.usage.completionTokens}`,
            r.droppedIds.length ? `已丢弃不合规内容：${r.droppedIds.join('、')}` : '',
          ]
            .filter(Boolean)
            .join('；'),
          r.droppedIds.length ? 'WARN' : 'OK',
          r.durationMs,
        );
      } catch (err) {
        const reason = degrade('意图识别', err);
        if (!llmCfg.fallbackToRules) throw err;
        candidates = ruleCandidates ?? recognizeIntents(question);
        pushTrace('llm', '大模型意图识别失败，已降级', reason, 'ERROR', Date.now() - t1);
      }
    }
  } else {
    candidates = recognizeIntents(question);
  }

  pushTrace(
    'intent',
    `识别到 ${candidates.length} 个意图`,
    candidates
      .map((c) => `${c.label}（${c.id ?? 'UNKNOWN'} · ${c.domain} · 置信度 ${c.confidence}）`)
      .join(' | '),
    candidates.some((c) => c.id) ? 'OK' : 'WARN',
    Date.now() - t1,
  );

  const resolved: ResolvedIntent[] = [];
  const allToolCalls: ToolCallRecord[] = [];

  for (const candidate of candidates) {
    const skill = getSkill(candidate.skillId);

    // ── 2. 槽位抽取 ─────────────────────────────────────────────────────
    // llm 引擎下：最终槽位 = 规则抽取 ∪ 模型抽取（模型优先）。
    // 保留规则抽取器是因为日期与金额这类结构化信息正则更稳，
    // 而且模型漏抽时还有兜底，不至于因为少一个字段就退化成追问。
    const t2 = Date.now();
    const slotDefs = candidate.rule?.slots ?? [];
    const ruleExtract = extractSlots(candidate.query, slotDefs);
    const slots: Record<string, unknown> = { ...ruleExtract.slots, ...(candidate.llmSlots ?? {}) };
    const missing = slotDefs
      .filter((d) => d.required && (slots[d.name] === undefined || slots[d.name] === ''))
      .map((d) => ({ name: d.name, label: d.label }));

    const llmOnlySlots = Object.keys(candidate.llmSlots ?? {}).filter(
      (k) => ruleExtract.slots[k] === undefined,
    );
    pushTrace(
      'slot',
      `槽位抽取 · ${candidate.label}`,
      [
        Object.keys(slots).length
          ? `已获取 ${Object.entries(slots).map(([k, v]) => `${k}=${String(v)}`).join('，')}`
          : '未抽到槽位',
        llmOnlySlots.length ? `其中来自大模型：${llmOnlySlots.join('、')}` : '',
        missing.length ? `缺失必填 ${missing.map((m) => m.label).join('、')}` : '',
      ]
        .filter(Boolean)
        .join('；'),
      missing.length ? 'WARN' : 'OK',
      Date.now() - t2,
    );

    // ── 3. 知识检索 ─────────────────────────────────────────────────────
    const ctx: ToolContext = {
      employee,
      intent: {
        id: candidate.id,
        label: candidate.label,
        domain: candidate.domain,
        title: candidate.label,
        query: candidate.query,
        slots,
        suggestedAction: '',
        knowledgeTags: candidate.rule?.knowledgeTags ?? [],
        topScore: 0,
      },
      risk: { level: skill.baseRisk, reasons: [] },
      citations: [],
      handoffTeam: skill.handoffTeam,
      toolCalls: [],
      trace: { traceId, sessionId },
    };

    ctx.intent.topScore = peekTopScore(candidate.query, candidate.domain);

    let citations: Citation[] = [];
    if (skill.knowledgeRequired) {
      const t3 = Date.now();
      const { data } = await executeTool('kb.search', ctx);
      citations = (data as Citation[]) ?? [];
      ctx.citations = citations;
      pushTrace(
        'retrieval',
        `知识检索 · ${candidate.label}`,
        citations.length
          ? citations.map((c) => `${c.docId}#${c.section}（${c.score}）`).join(' | ')
          : `未命中，最高分 ${ctx.intent.topScore} < 阈值 ${cfg.app.retrieval.scoreThreshold}`,
        citations.length ? 'OK' : 'WARN',
        Date.now() - t3,
      );
    } else {
      pushTrace(
        'retrieval',
        `跳过知识检索 · ${candidate.label}`,
        `Skill ${skill.id} 声明 knowledgeRequired=false（敏感事项不引用制度细节）`,
        'OK',
        0,
      );
    }
    const knowledgeHit = citations.length > 0;

    // ── 3.5 读取类工具：查员工档案、查权限状态 ───────────────────────────
    // 由 Skill 的 tools 列表驱动（只跑 sideEffect=read 的），
    // 这样「Agent 在判风险之前查了哪些系统」是配置出来的，改 agent-skills.json 就能变。
    for (const toolId of skill.tools) {
      if (toolId === 'kb.search') continue; // 检索在上一步单独处理
      const def = getTool(toolId);
      if (!def || def.sideEffect !== 'read') continue;
      if (ctx.toolCalls.length >= cfg.app.agent.maxToolCallsPerTurn) break;
      const tRead = Date.now();
      const { record } = await executeTool(toolId, ctx);
      pushTrace(
        'tool',
        `查询 ${record.toolName}`,
        record.summary ?? record.error ?? '',
        record.status === 'OK' ? 'OK' : 'WARN',
        Date.now() - tRead,
      );
    }

    // ── 4. 风险分级 ─────────────────────────────────────────────────────
    const t4 = Date.now();
    const risk = assessRisk({
      text: candidate.query,
      intentId: candidate.id,
      domain: candidate.domain,
      skillId: skill.id,
      baseLevel: skill.baseRisk,
      confidence: candidate.confidence,
      slots,
      knowledgeHit: skill.knowledgeRequired ? knowledgeHit : true,
      missingRequiredSlot: missing.length > 0,
      employeeStatus: employee?.status ?? null,
    });
    ctx.risk = { level: risk.level, reasons: risk.reasons.map((r) => `${r.ruleId} ${r.reason}`) };
    pushTrace(
      'risk',
      `风险分级 · ${risk.level}（${risk.policy}）`,
      [
        `基线 ${risk.baseLevel} → 最终 ${risk.level}`,
        risk.reasons.length
          ? risk.reasons.map((r) => `${r.ruleId} ${r.name} → ${r.effect}`).join(' | ')
          : '未命中任何升级规则',
      ].join('；'),
      risk.level === 'HIGH' ? 'WARN' : 'OK',
      Date.now() - t4,
    );

    // ── 5. 动作编排 ─────────────────────────────────────────────────────
    // 动作集 = 风险等级对应的动作 ∪ Skill 声明的兜底动作。
    // 取并集而不是二选一：风险规则负责「不能低于什么强度」，
    // Skill 负责「这类诉求本来就该做什么」，两者都不能被绕过。
    let actions = actionsForLevel(risk.level, risk.forcedAction);
    if (risk.forcedAction === null) {
      actions = Array.from(
        new Set<AgentActionType>([...actions, ...SKILL_DEFAULT_ACTIONS[skill.defaultAction]]),
      );
    }
    if (
      skill.knowledgeRequired &&
      !knowledgeHit &&
      cfg.app.agent.recordGapWhenNoHit &&
      risk.forcedAction !== 'clarify'
    ) {
      actions = Array.from(new Set<AgentActionType>([...actions, 'record_gap', 'handoff']));
    }
    actions = actions.sort((a, b) => ACTION_ORDER[a] - ACTION_ORDER[b]);

    const answer = buildAnswer({
      intentId: candidate.id,
      intentLabel: candidate.label,
      citations,
      employee,
      skill,
      slots,
      missingSlots: missing,
      risk,
    });
    ctx.intent.suggestedAction = buildSuggestedAction({
      intentId: candidate.id,
      intentLabel: candidate.label,
      citations,
      employee,
      skill,
      slots,
      missingSlots: missing,
      risk,
    });

    // ── 6. 工具调用 ─────────────────────────────────────────────────────
    for (const action of actions) {
      if (ctx.toolCalls.length >= cfg.app.agent.maxToolCallsPerTurn) break;
      const t6 = Date.now();
      if (action === 'record_gap') {
        const { record } = await executeTool('kb.record_gap', ctx);
        pushTrace('tool', '沉淀知识缺口', record.summary ?? record.error ?? '', record.status === 'OK' ? 'OK' : 'ERROR', Date.now() - t6);
      } else if (action === 'create_ticket') {
        const { record } = await executeTool('ticket.create', ctx);
        pushTrace('tool', '创建工单', record.summary ?? record.error ?? '', record.status === 'OK' ? 'OK' : 'ERROR', Date.now() - t6);
      } else if (action === 'create_approval') {
        const { record } = await executeTool('approval.create', ctx);
        pushTrace('tool', '创建人工确认任务', record.summary ?? record.error ?? '', record.status === 'OK' ? 'OK' : 'ERROR', Date.now() - t6);
      } else if (action === 'handoff') {
        pushTrace('tool', '转人工', `已交由 ${skill.handoffTeam} 跟进`, 'WARN', Date.now() - t6);
      }
    }

    const approvalId = ctx.toolCalls
      .find((t) => t.toolId === 'approval.create')
      ?.summary?.match(/AP-\d{8}-\d{4}/)?.[0];

    // ── 7. 回复合成 ─────────────────────────────────────────────────────
    const t7 = Date.now();
    const slaHours = cfg.app.sla[risk.level]?.responseHours ?? 8;

    /** 规则版回复：模板拼装，也是 LLM 失败时的兜底 */
    const ruleReply =
      risk.forcedAction === 'clarify'
        ? answer
        : renderTemplate(skill.replyTemplate, {
            answer,
            ticketId: ctx.intent.ticketId,
            ticketStatus: risk.level === 'HIGH' ? '待人工确认' : '待受理',
            sla: `${slaHours} 小时`,
            approvalId,
            gapId: ctx.intent.gapId,
            manager: employee?.managerName ?? '直属上级',
          });

    let replyBody = ruleReply;
    let composedBy: 'rules' | 'llm' = 'rules';

    if (requestedEngine === 'llm' && llmCfg && effectiveEngine === 'llm') {
      try {
        const r = await composeReplyLlm(
          {
            question,
            intentLabel: candidate.label,
            intentId: candidate.id,
            employee,
            skill,
            citations,
            slots,
            missingSlots: missing,
            risk,
            actions,
            artifacts: { ticketId: ctx.intent.ticketId, approvalId, gapId: ctx.intent.gapId },
          },
          llmCfg,
        );
        replyBody = r.reply;
        composedBy = 'llm';
        recordLlmUsage(r.usage, r.durationMs);
        pushTrace(
          'llm',
          `大模型回复合成 · ${candidate.label}`,
          `System Prompt(${cfg.systemPrompt.length} 字) + ${citations.length} 条引用；tokens 输入 ${r.usage.promptTokens} / 输出 ${r.usage.completionTokens}`,
          'OK',
          r.durationMs,
        );
      } catch (err) {
        const reason = degrade('回复合成', err);
        if (!llmCfg.fallbackToRules) throw err;
        pushTrace('llm', '大模型回复合成失败，已降级', reason, 'ERROR', Date.now() - t7);
      }
    }

    pushTrace(
      'compose',
      `回复合成 · ${candidate.label}`,
      composedBy === 'llm'
        ? '由大模型生成，制度依据与已执行动作作为约束传入'
        : `使用 Skill ${skill.id} 的回复骨架（模板拼装）`,
      'OK',
      Date.now() - t7,
    );

    resolved.push({
      id: candidate.id,
      label: candidate.label,
      domain: candidate.domain,
      skillId: skill.id,
      confidence: candidate.confidence,
      query: candidate.query,
      matchedKeywords: candidate.matchedKeywords,
      slots,
      missingSlots: missing,
      citations,
      knowledgeHit,
      topScore: ctx.intent.topScore,
      risk,
      actions,
      toolCalls: ctx.toolCalls,
      answer: replyBody,
      artifacts: {
        ticketId: ctx.intent.ticketId,
        approvalId,
        gapId: ctx.intent.gapId,
      },
    });
    allToolCalls.push(...ctx.toolCalls);
  }

  // ── 8. 汇总回复 ────────────────────────────────────────────────────────
  const reply =
    resolved.length === 1
      ? resolved[0].answer
      : resolved
          .map((r, i) => `【诉求 ${i + 1}｜${r.label}】\n${r.answer}`)
          .join('\n\n---\n\n');

  const overallRisk = resolved.reduce<RiskLevel>((acc, r) => {
    return RISK_ORDER.indexOf(r.risk.level) > RISK_ORDER.indexOf(acc) ? r.risk.level : acc;
  }, 'LOW');
  const needsHumanReview = resolved.some(
    (r) => r.risk.level === 'HIGH' || r.actions.includes('handoff'),
  );
  const latencyMs = Date.now() - startedAt;

  // ── 9. 落日志 ─────────────────────────────────────────────────────────
  const t9 = Date.now();
  await appendLog({
    traceId,
    sessionId,
    employeeId: input.employeeId,
    question,
    intents: resolved.map((r) => ({
      id: r.id,
      domain: r.domain,
      label: r.label,
      confidence: r.confidence,
    })),
    kind: 'service',
    knowledgeHit: resolved.some((r) => r.knowledgeHit),
    citationCount: resolved.reduce((s, r) => s + r.citations.length, 0),
    risk: {
      level: overallRisk,
      matchedRules: Array.from(new Set(resolved.flatMap((r) => r.risk.reasons.map((x) => x.ruleId)))),
    },
    toolCalls: allToolCalls.map((t) => ({
      toolId: t.toolId,
      status: t.status,
      durationMs: t.durationMs,
      summary: t.summary,
    })),
    actions: Array.from(new Set(resolved.flatMap((r) => r.actions))),
    resolvedBy: needsHumanReview ? 'HUMAN' : 'AGENT',
    escalated: needsHumanReview,
    latencyMs,
    feedback: null,
    createdAt: new Date().toISOString(),
  });
  pushTrace('log', '写入处理日志', `traceId=${traceId}，共 ${allToolCalls.length} 次工具调用`, 'OK', Date.now() - t9);

  const llmUsage =
    llmStats.calls > 0 && llmCfg
      ? {
          model: llmCfg.model,
          calls: llmStats.calls,
          promptTokens: llmStats.promptTokens,
          completionTokens: llmStats.completionTokens,
          totalTokens: llmStats.promptTokens + llmStats.completionTokens,
          durationMs: llmStats.durationMs,
        }
      : null;

  return {
    traceId,
    sessionId,
    // 注意：这里是「实际用到的引擎」而不是配置值。
    // 中途降级过就是 mock，界面上不会出现「标称大模型、实际跑规则」的情况。
    engine: effectiveEngine,
    requestedEngine,
    degraded: effectiveEngine !== requestedEngine,
    degradedReason,
    llm: llmUsage,
    employee,
    question,
    reply,
    intents: resolved,
    overallRisk,
    needsHumanReview,
    latencyMs,
    createdAt: new Date().toISOString(),
    trace,
    prefilter: null,
  };
}
