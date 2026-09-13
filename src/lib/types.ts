/**
 * 全项目共享的领域类型。这个文件不允许 import 任何 node 内置模块，
 * 因为它同时被 Server Component / API Route / 浏览器端组件引用。
 */

export type Domain = 'IT' | 'HR' | 'FINANCE' | 'ADMIN' | 'UNKNOWN';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type AgentActionType =
  | 'answer'
  | 'clarify'
  | 'flow_entry'
  | 'record_gap'
  | 'handoff';

export type TicketStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'PENDING_REVIEW'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REJECTED';

export type GapStatus = 'OPEN' | 'DRAFTING' | 'PUBLISHED' | 'IGNORED';

export type EmployeeStatus = 'ACTIVE' | 'PROBATION' | 'LEFT';

export type PermissionStatus = 'GRANTED' | 'NONE' | 'EXPIRED' | 'PENDING';

// ── 员工与权限 ───────────────────────────────────────────────────────────

export interface Employee {
  id: string;
  name: string;
  department: string;
  title: string;
  level: string;
  status: EmployeeStatus;
  hireDate: string;
  managerId: string | null;
  managerName: string | null;
  location: string;
  email: string;
  phone: string;
  costCenter: string;
  annualLeaveTotal: number;
  annualLeaveUsed: number;
  compTimeDays: number;
}

export interface PermissionRecord {
  employeeId: string;
  system: string;
  level: string;
  status: PermissionStatus;
  grantedAt: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

// ── 知识库 ───────────────────────────────────────────────────────────────

export interface KnowledgeDoc {
  docId: string;
  title: string;
  domain: Domain;
  owner: string;
  version: string;
  updatedAt: string;
  tags: string[];
  keywords: string[];
  filePath: string;
  sections: KnowledgeSection[];
}

export interface KnowledgeSection {
  /** 稳定的引用标识，形如 IT-KB-002#权限有效期 */
  refId: string;
  docId: string;
  docTitle: string;
  domain: Domain;
  section: string;
  content: string;
}

export interface Citation {
  refId: string;
  docId: string;
  title: string;
  section: string;
  domain: Domain;
  score: number;
  snippet: string;
  owner: string;
  updatedAt: string;
}

// ── 人工接入 / 知识缺口 / 日志 ───────────────────────────────────────────

export interface TicketTimelineEntry {
  at: string;
  actor: string;
  action: string;
  note: string;
}

export interface Ticket {
  id: string;
  employeeId: string;
  employeeName: string;
  domain: Domain;
  intentId: string | null;
  title: string;
  description: string;
  riskLevel: RiskLevel;
  priority: 'P1' | 'P2' | 'P3';
  status: TicketStatus;
  assigneeTeam: string;
  assignee: string | null;
  source: 'AGENT' | 'HUMAN';
  slots: Record<string, unknown>;
  citations: Array<{ docId: string; title: string; section: string }>;
  createdAt: string;
  updatedAt: string;
  slaDueAt: string;
  resolvedAt: string | null;
  linkedGapId?: string | null;
  timeline: TicketTimelineEntry[];
}

export interface KnowledgeGap {
  id: string;
  question: string;
  domain: Domain;
  intentId: string | null;
  employeeId?: string;
  occurrences: number;
  topScore: number;
  status: GapStatus;
  suggestedOwner: string;
  suggestedDoc: string;
  note: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ToolCallRecord {
  toolId: string;
  toolName: string;
  endpoint: string;
  args: Record<string, unknown>;
  status: 'OK' | 'ERROR' | 'SKIPPED';
  durationMs: number;
  summary?: string;
  error?: string;
}

export interface AgentLog {
  id: string;
  traceId: string;
  sessionId: string;
  employeeId: string;
  question: string;
  /**
   * service      = 真实服务请求，计入看板口径
   * smalltalk    = 闲聊 / 无实义输入
   * out_of_scope = 域外请求（天气、写代码这类）
   * 后两者默认不计入服务请求口径：否则说几句「你好」或问几次天气就能刷高自助解决率。
   */
  kind?: 'service' | 'smalltalk' | 'out_of_scope';
  /** 前置过滤命中的规则 id，例如 chitchat.greeting / scope.weather */
  prefilterKind?: string;
  intents: Array<{ id: string | null; domain: Domain; label: string; confidence: number }>;
  knowledgeHit: boolean;
  citationCount: number;
  risk: { level: RiskLevel; matchedRules: string[] };
  toolCalls: Array<{ toolId: string; status: string; durationMs: number; summary?: string }>;
  actions: string[];
  resolvedBy: 'AGENT' | 'HUMAN';
  /** 首次处理时就判定要转人工（高风险 / 未命中 / 置信度低），属于前置闸门 */
  escalated: boolean;
  latencyMs: number;
  feedback: 'up' | 'down' | null;
  createdAt: string;
  /**
   * 事后升级：Agent 首次已给出答复，但没解决问题，之后被转给对应部门。
   * 与 escalated 的区别是时机 —— escalated 是「执行前就知道要转」，
   * 这个是「试过了、没解决」。两者在看板上口径不同：
   * 前者影响自助解决率的分母判定，后者是「首答解决率」与「最终解决率」的差。
   */
  escalation?: {
    ticketId: string;
    reason: EscalationReason;
    team: string;
    note: string | null;
    at: string;
  } | null;
}

export type EscalationReason =
  /** 员工点了「没用」 */
  | 'negative_feedback'
  /** 员工主动要求转人工 */
  | 'user_request'
  /** 自动解决动作执行失败 */
  | 'resolution_failed';

export interface ConversationMessage {
  id: string;
  sessionId: string;
  traceId?: string | null;
  employeeId: string;
  role: 'employee' | 'agent' | 'human';
  authorName: string;
  text: string;
  createdAt: string;
}

// ── Agent 运行结果（对话侧栏的数据契约）───────────────────────────────────

export interface ResolvedIntent {
  id: string | null;
  label: string;
  domain: Domain;
  skillId: string;
  confidence: number;
  query: string;
  matchedKeywords: string[];
  slots: Record<string, unknown>;
  missingSlots: Array<{ name: string; label: string }>;
  citations: Citation[];
  knowledgeHit: boolean;
  topScore: number;
  risk: RiskAssessment;
  actions: AgentActionType[];
  toolCalls: ToolCallRecord[];
  answer: string;
  artifacts: {
    ticketId?: string;
    flowEntry?: string;
    gapId?: string;
  };
}

export interface RiskAssessment {
  level: RiskLevel;
  baseLevel: RiskLevel;
  policy: string;
  reasons: Array<{ ruleId: string; name: string; reason: string; effect: string }>;
  forcedAction: AgentActionType | null;
}

export interface LlmUsageSummary {
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
}

export interface AgentTurnResult {
  traceId: string;
  sessionId: string;
  /** 本次**实际**使用的引擎。LLM 调用失败降级到规则时，这里会是 mock 而不是 llm。 */
  engine: 'mock' | 'llm';
  /** 配置里要求的引擎。与 engine 不一致即说明发生了降级。 */
  requestedEngine: 'mock' | 'llm';
  /** 是否发生了降级 */
  degraded: boolean;
  /** 降级原因（错误码 + 描述），未降级时为 null */
  degradedReason: string | null;
  /** engine=llm 且成功调用时的 token 用量，否则为 null */
  llm: LlmUsageSummary | null;
  employee: Employee | null;
  question: string;
  reply: string;
  intents: ResolvedIntent[];
  overallRisk: RiskLevel;
  needsHumanReview: boolean;
  latencyMs: number;
  createdAt: string;
  /** 处理链路的可视化步骤，用于侧栏展示 */
  trace: TraceStep[];
  /**
   * 非空表示这轮在进入主管线之前就被前置过滤拦下了：
   * 没有检索、没有建单、没有沉淀知识缺口、没有调大模型。
   *   smalltalk    = 闲聊 / 无实义输入
   *   out_of_scope = 域外请求（天气、写代码、点餐这类不属于服务台职责的）
   */
  prefilter: { type: 'smalltalk' | 'out_of_scope'; kind: string; label: string; matchedBy: string } | null;
}

export interface TraceStep {
  step: number;
  stage:
    | 'intent'
    | 'slot'
    | 'retrieval'
    | 'risk'
    | 'tool'
    | 'compose'
    | 'log'
    | 'llm'
    | 'prefilter';
  title: string;
  detail: string;
  status: 'OK' | 'WARN' | 'ERROR';
  durationMs: number;
}

// ── 看板 ─────────────────────────────────────────────────────────────────

export interface MetricsSummary {
  range: { from: string; to: string; days: number };
  totals: {
    conversations: number;
    autoResolved: number;
    escalated: number;
    knowledgeHit: number;
    flowEntries: number;
    humanHandoffs: number;
  };
  rates: {
    resolutionRate: number;
    knowledgeHitRate: number;
    escalationRate: number;
  };
  responseTime: {
    avgLatencyMs: number;
    p90LatencyMs: number;
    baselineMinutes: number;
  };
  savings: {
    savedHours: number;
    savedCostCNY: number;
    fteEquivalent: number;
  };
  targets: {
    resolutionRate: number;
    knowledgeHitRate: number;
    escalationRate: number;
    firstResponseMs: number;
  };
  trend: Array<{
    date: string;
    conversations: number;
    autoResolved: number;
    escalated: number;
    knowledgeHit: number;
    resolutionRate: number;
    avgLatencyMs: number;
  }>;
  byDomain: Array<{
    domain: Domain;
    label: string;
    conversations: number;
    share: number;
    tickets: number;
  }>;
  riskDistribution: Array<{ level: RiskLevel; count: number; share: number }>;
  handoffStatus: Array<{ status: TicketStatus; count: number }>;
  topGaps: Array<{ id: string; question: string; domain: Domain; occurrences: number; status: GapStatus }>;
  pendingReview: number;
  /** 被剔除在服务请求口径之外的闲聊会话数 */
  smallTalkExcluded: number;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
