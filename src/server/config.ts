import fs from 'node:fs';
import path from 'node:path';
import type { Domain, RiskLevel, AgentActionType } from '@/lib/types';

const CONFIG_DIR = path.join(process.cwd(), 'config');

// ── 配置文件结构（与 config/*.json 一一对应）─────────────────────────────

export interface LlmRuntimeConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  maxRetries: number;
  /** LLM 失败时是否降级到规则引擎（降级会在结果里如实标记，不会伪装成 llm） */
  fallbackToRules: boolean;
  intentStrategy: 'llm-first' | 'rules-first-escalate';
  intentEscalationThreshold: number;
  extraBody: Record<string, unknown>;
}

export interface AppConfig {
  app: { name: string; shortName: string; tagline: string; defaultEmployeeId: string };
  agent: {
    engine: 'mock' | 'llm';
    maxIntentsPerTurn: number;
    maxToolCallsPerTurn: number;
    clarifyWhenSlotMissing: boolean;
    recordGapWhenNoHit: boolean;
  };
  llm: {
    /** 默认参数，可被同名环境变量覆盖 */
    baseUrl: string;
    model: string;
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
    maxRetries: number;
    fallbackToRules: boolean;
    /**
     * 意图识别策略：
     *   'llm-first'            总是调用大模型识别意图（最准，但每轮多一次调用）
     *   'rules-first-escalate' 先跑规则引擎（0 成本），置信度够高就直接用，
     *                          不够才升级到大模型。省一次调用、省 token、省一半延迟。
     */
    intentStrategy: 'llm-first' | 'rules-first-escalate';
    /** rules-first-escalate 下，规则置信度低于该值才升级到大模型 */
    intentEscalationThreshold: number;
    /** 原样合并进请求体的供应商私有参数（换供应商时按需清空） */
    extraBody: Record<string, unknown>;
  };
  retrieval: {
    topK: number;
    scoreThreshold: number;
    snippetMaxChars: number;
    titleWeight: number;
    keywordWeight: number;
    tagWeight: number;
    bodyWeight: number;
    /** 文档级字段（文档标题 / keywords / tags）在总分中的折扣系数 */
    docBonusRatio: number;
    /** 命中意图所属职能域的加成 */
    domainMatchBonus: number;
    /** 跨职能域章节的降权幅度 */
    crossDomainPenalty: number;
    /** 知识库中不存在的查询词，按中位 idf 的多少倍计入归一化分母 */
    oovWeight: number;
    /** 只有正文命中（标题与 keywords/tags 都没命中）时的降权幅度 */
    bodyOnlyPenalty: number;
  };
  metrics: {
    manualHandlingMinutes: Record<string, number>;
    hourlyCostCNY: number;
    targetResolutionRate: number;
    targetKnowledgeHitRate: number;
    targetEscalationRate: number;
    targetFirstResponseMs: number;
    /** 上线前人工服务台基线，用于看板对比（口径参数，非运行数据） */
    baseline: {
      avgFirstResponseMinutes: number;
      avgResolveHours: number;
      monthlyTicketVolume: number;
      helpdeskHeadcount: number;
      satisfactionScore: number;
    };
    /** 闲聊是否从服务请求口径中剔除 */
    excludeSmallTalkFromMetrics: boolean;
  };
  sla: Record<RiskLevel, { responseHours: number; resolveHours: number }>;
}

export interface SlotDef {
  name: string;
  label: string;
  type: 'amount' | 'date' | 'days' | 'number' | 'enum' | 'text';
  required: boolean;
  options?: string[];
}

export interface IntentRule {
  id: string;
  domain: Domain;
  label: string;
  skill: string;
  keywords: string[];
  patterns?: string[];
  negativeKeywords?: string[];
  slots: SlotDef[];
  knowledgeTags: string[];
  examples: string[];
}

export interface SmallTalkRule {
  id: string;
  label: string;
  matchMode: 'full' | 'contains';
  patterns: string[];
  reply: string;
}

export interface SmallTalkConfig {
  enabled: boolean;
  minMeaningfulChars: number;
  rules: SmallTalkRule[];
}

export interface OutOfScopeConfig {
  enabled: boolean;
  /** 拼在每条 reply 之前的统一开头 */
  replyPrefix?: string;
  /** 拼在每条 reply 之后的能力引导 */
  replySuffix?: string;
  rules: SmallTalkRule[];
}

export interface IntentRulesConfig {
  version: string;
  splitConnectors: string[];
  domains: Record<string, { label: string; owner: string; color: string }>;
  intents: IntentRule[];
  smallTalk?: SmallTalkConfig;
  outOfScope?: OutOfScopeConfig;
}

export interface SkillDef {
  id: string;
  name: string;
  domain: Domain;
  description: string;
  baseRisk: RiskLevel;
  defaultAction: 'answer' | 'flow_entry' | 'human_review' | 'handoff';
  tools: string[];
  knowledgeRequired: boolean;
  handoffTeam: string;
  /** 规则引擎（engine=mock）用的回复骨架，支持 {{answer}} {{ticketId}} 等占位符 */
  replyTemplate: string;
  /** 大模型（engine=llm）用的独立 Skill prompt 文件，相对 config/ 目录 */
  promptFile?: string;
  /** 大模型（engine=llm）用的 Skill 级追加指令。这里写「这类诉求回复时要注意什么」 */
  prompt?: string;
}

export interface SkillsConfig {
  version: string;
  skills: SkillDef[];
}

export interface RiskRuleCondition {
  keywordsAny?: string[];
  intentIn?: string[];
  domainIn?: Domain[];
  skillIn?: string[];
  employeeStatusIn?: string[];
  amountGte?: number;
  daysGte?: number;
  confidenceLt?: number;
  noKnowledgeHit?: boolean;
  missingRequiredSlot?: boolean;
  /** 只在当前累计等级落在给定集合内时才生效，用于避免低优先规则覆盖高风险判定 */
  currentLevelIn?: RiskLevel[];
}

export interface RiskRule {
  id: string;
  name: string;
  when: RiskRuleCondition;
  effect: {
    setLevel?: RiskLevel;
    minLevel?: RiskLevel;
    escalate?: number;
    forceAction?: AgentActionType;
  };
  reason: string;
}

export interface RiskRulesConfig {
  version: string;
  levels: Record<RiskLevel, { label: string; policy: string; description: string; actions: AgentActionType[] }>;
  rules: RiskRule[];
  escalationOrder: RiskLevel[];
}

export interface ToolArgDef {
  name: string;
  type: string;
  required: boolean;
  from: 'slot' | 'context' | 'const';
  slot?: string;
  path?: string;
  value?: unknown;
}

export interface ToolDef {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  sideEffect: 'read' | 'write';
  requiresApproval: boolean;
  args: ToolArgDef[];
}

export interface ToolRegistryConfig {
  version: string;
  tools: ToolDef[];
}

// ── 加载器（带进程级缓存，dev 下 HMR 也复用）─────────────────────────────

type ConfigBundle = {
  app: AppConfig;
  intents: IntentRulesConfig;
  skills: SkillsConfig;
  risk: RiskRulesConfig;
  tools: ToolRegistryConfig;
  /** config/system-prompt.md —— 回复生成阶段的 system message */
  systemPrompt: string;
  /** config/intent-prompt.md —— 意图识别阶段的 system message，支持 {{catalog}} / {{today}} 占位符 */
  intentPrompt: string;
  /** engine=llm 时必然有值；engine=mock 时为 null */
  llm: LlmRuntimeConfig | null;
};

const globalCache = globalThis as unknown as { __esaConfig?: ConfigBundle };

function readJson<T>(file: string): T {
  const full = path.join(CONFIG_DIR, file);
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8')) as T;
  } catch (err) {
    throw new Error(`无法加载配置文件 ${file}: ${(err as Error).message}`);
  }
}

/** 当前代码里真正实现了的推理引擎 */
const IMPLEMENTED_ENGINES = ['mock', 'llm'] as const;

function resolveEngine(configured: AppConfig['agent']['engine']): AppConfig['agent']['engine'] {
  const envEngine = process.env.AGENT_ENGINE;
  const requested = envEngine === 'mock' || envEngine === 'llm' ? envEngine : configured;

  if (!(IMPLEMENTED_ENGINES as readonly string[]).includes(requested)) {
    throw new Error(
      `推理引擎 "${requested}" 尚未实现，已实现的引擎：${IMPLEMENTED_ENGINES.join(', ')}。`,
    );
  }
  if (envEngine && envEngine !== requested) {
    console.warn(`[config] 忽略非法的 AGENT_ENGINE="${envEngine}"，回退到 "${requested}"`);
  }
  return requested;
}

function numFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 解析 LLM 运行配置。
 *
 * 关键约束：engine=llm 但缺少 API Key 时**直接抛错终止**，而不是静默退回规则引擎。
 * 界面上的「引擎」标签取自配置值，静默降级会导致演示时标称大模型而实际跑规则。
 * （运行期单次调用失败是另一回事，那种降级会在结果里如实标记，见 pipeline 的 degraded 字段。）
 */
function resolveLlm(app: AppConfig): LlmRuntimeConfig | null {
  if (app.agent.engine !== 'llm') return null;

  const baseUrl = (process.env.LLM_BASE_URL ?? app.llm.baseUrl ?? '').trim().replace(/\/+$/, '');
  const apiKey = (process.env.LLM_API_KEY ?? '').trim();
  const model = (process.env.LLM_MODEL ?? app.llm.model ?? '').trim();

  const missing: string[] = [];
  if (!baseUrl) missing.push('LLM_BASE_URL');
  if (!apiKey) missing.push('LLM_API_KEY');
  if (!model) missing.push('LLM_MODEL');

  if (missing.length > 0) {
    throw new Error(
      [
        `AGENT_ENGINE=llm 但缺少必填配置：${missing.join('、')}。`,
        '智谱（BigModel）示例：',
        '  LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4',
        '  LLM_API_KEY=<你的 API Key>',
        '  LLM_MODEL=glm-4.7-flash',
        '不想接大模型就把 AGENT_ENGINE 设为 mock（或删掉该环境变量）。',
      ].join('\n'),
    );
  }

  const envStrategy = process.env.LLM_INTENT_STRATEGY;
  const intentStrategy =
    envStrategy === 'llm-first' || envStrategy === 'rules-first-escalate'
      ? envStrategy
      : app.llm.intentStrategy;

  return {
    baseUrl,
    apiKey,
    model,
    temperature: numFromEnv('LLM_TEMPERATURE', app.llm.temperature),
    maxTokens: numFromEnv('LLM_MAX_TOKENS', app.llm.maxTokens),
    timeoutMs: numFromEnv('LLM_TIMEOUT_MS', app.llm.timeoutMs),
    maxRetries: numFromEnv('LLM_MAX_RETRIES', app.llm.maxRetries),
    fallbackToRules:
      process.env.LLM_FALLBACK_TO_RULES != null
        ? process.env.LLM_FALLBACK_TO_RULES !== 'false'
        : app.llm.fallbackToRules,
    intentStrategy,
    intentEscalationThreshold: numFromEnv(
      'LLM_INTENT_ESCALATION_THRESHOLD',
      app.llm.intentEscalationThreshold,
    ),
    extraBody: app.llm.extraBody ?? {},
  };
}

function loadBundle(): ConfigBundle {
  const app = readJson<AppConfig>('app.config.json');
  app.agent.engine = resolveEngine(app.agent.engine);

  /** 读 Markdown prompt 文件，去掉 frontmatter 与 HTML 注释，只留给模型看的正文 */
  const readPrompt = (file: string): string => {
    try {
      const raw = fs.readFileSync(path.join(CONFIG_DIR, file), 'utf8');
      return raw
        .replace(/^---\n[\s\S]*?\n---\n/, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .trim();
    } catch {
      return '';
    }
  };

  const systemPrompt = readPrompt('system-prompt.md');
  const intentPrompt = readPrompt('intent-prompt.md');
  const skills = readJson<SkillsConfig>('agent-skills.json');
  skills.skills = skills.skills.map((skill) => {
    if (!skill.promptFile) return skill;
    const filePrompt = readPrompt(skill.promptFile);
    return filePrompt ? { ...skill, prompt: filePrompt } : skill;
  });

  return {
    app,
    intents: readJson<IntentRulesConfig>('intent-rules.json'),
    skills,
    risk: readJson<RiskRulesConfig>('risk-rules.json'),
    tools: readJson<ToolRegistryConfig>('tool-registry.json'),
    systemPrompt,
    intentPrompt,
    llm: resolveLlm(app),
  };
}

export function getConfig(): ConfigBundle {
  if (process.env.NODE_ENV === 'production') {
    if (!globalCache.__esaConfig) globalCache.__esaConfig = loadBundle();
    return globalCache.__esaConfig;
  }
  // 开发环境每次读取，改配置文件后刷新页面即生效
  return loadBundle();
}

export function getSkill(skillId: string): SkillDef {
  const { skills } = getConfig();
  const skill = skills.skills.find((s) => s.id === skillId);
  if (!skill) {
    const fallback = skills.skills.find((s) => s.id === 'fallback.handoff');
    if (!fallback) throw new Error('agent-skills.json 缺少 fallback.handoff 兜底 Skill');
    return fallback;
  }
  return skill;
}

export function getTool(toolId: string): ToolDef | undefined {
  return getConfig().tools.tools.find((t) => t.id === toolId);
}

export function domainLabel(domain: Domain): string {
  return getConfig().intents.domains[domain]?.label ?? domain;
}

export function domainOwner(domain: Domain): string {
  return getConfig().intents.domains[domain]?.owner ?? '服务台值班';
}
