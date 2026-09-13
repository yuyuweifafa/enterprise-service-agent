import type { Domain } from '@/lib/types';
import { getConfig, type IntentRule, type LlmRuntimeConfig, type SlotDef } from '@/server/config';
import type { IntentCandidate } from '../intent';
import { chatCompletion, extractJson, type LlmToolDef, type LlmUsage } from './client';

/**
 * 大模型版多意图识别 + 槽位抽取。
 *
 * 三条硬约束（这是"能上线"和"Demo 玩玩"的分界线）：
 * 1. **意图必须落在白名单内**。模型返回配置里不存在的 intent id 一律丢弃，
 *    不允许它自己发明意图 —— 否则下游的 Skill、风险规则、工单路由全都没有对应配置。
 * 2. **槽位按声明的类型强制校验与转换**。模型把金额写成 "8600元" 也要能变成数字 8600。
 * 3. **规则抽取器兜底**。日期、金额这类结构化信息，正则比模型稳，
 *    所以最终槽位 = 规则抽取结果 ∪ 模型结果（模型优先，规则填空）。
 */

export interface LlmIntentResult {
  candidates: IntentCandidate[];
  usage: LlmUsage;
  durationMs: number;
  /** 模型原始返回，写进 trace 便于排查 */
  rawArguments: string;
  droppedIds: string[];
  /**
   * 模型判定这个诉求根本不属于服务台职责（天气、写代码这类）。
   * 与「域内但目录里没这个意图」不同：后者要沉淀知识缺口 + 转人工，前者只说明范围。
   */
  outOfScope: boolean;
}

/** 模型返回的内容无法解析成意图结构 —— 属于技术故障，应当降级重试，而不是当成「未识别意图」 */
export class LlmIntentParseError extends Error {
  raw: string;

  constructor(message: string, raw: string) {
    super(message);
    this.name = 'LlmIntentParseError';
    this.raw = raw.slice(0, 500);
  }
}

/** 把意图配置压成给模型看的目录（不含正则等实现细节，省 token） */
function buildCatalog(intents: IntentRule[]): string {
  return intents
    .map((i) => {
      const slots = i.slots.length
        ? i.slots
            .map((s) => `${s.name}(${s.type}${s.required ? ',必填' : ''}${s.options ? `,可选值:${s.options.join('/')}` : ''})`)
            .join(' ')
        : '无';
      const examples = i.examples.length ? ` 例:${i.examples.join('；')}` : '';
      return `- ${i.id} | ${i.domain} | ${i.label} | 槽位:${slots}${examples}`;
    })
    .join('\n');
}

function buildTool(intents: IntentRule[], maxIntents: number): LlmToolDef {
  return {
    type: 'function',
    function: {
      name: 'submit_intents',
      description:
        '提交从员工输入中拆解出的意图列表。只能使用给定目录里的 intent id，不得发明新的 id。',
      parameters: {
        type: 'object',
        properties: {
          intents: {
            type: 'array',
            minItems: 0,
            maxItems: maxIntents,
            description: `拆解出的意图，最多 ${maxIntents} 个。一句话里出现「另外/顺便/还有/同时」等连接词时要考虑拆分。`,
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  enum: intents.map((i) => i.id),
                  description: '必须是意图目录中已存在的 id',
                },
                confidence: {
                  type: 'number',
                  minimum: 0,
                  maximum: 1,
                  description: '识别置信度。不确定就给低分，低于 0.35 会自动转人工，这比猜错更安全',
                },
                query: {
                  type: 'string',
                  description: '该意图对应的原文片段（从员工输入里截取，不要改写）',
                },
                slots: {
                  type: 'object',
                  description:
                    '按该意图声明的槽位抽取的值。原文没提到的槽位不要填，不要凭空猜测。金额填数字（元），日期填 YYYY-MM-DD，天数填数字。',
                  additionalProperties: true,
                },
              },
              required: ['id', 'confidence', 'query'],
            },
          },
          unmatched: {
            type: 'boolean',
            description: '员工的诉求不属于目录里任何一个意图时填 true，此时 intents 可以为空数组',
          },
          scope: {
            type: 'string',
            enum: ['in_scope', 'out_of_scope'],
            description:
              'unmatched=true 时必填，用来区分两种完全不同的情况：' +
              'in_scope = 属于企业内部服务（IT/HR/财务/行政）范畴，只是意图目录里还没有这一项，例如「海外参展的清关手续」「员工持股计划」——这类要沉淀成待补充知识；只有 IT/行政可转人工，HR/财务回到流程入口；' +
              'out_of_scope = 根本不属于企业内部服务台的职责，例如查天气、写代码、翻译、股价、推荐餐厅——这类只需说明服务范围，不要建工单也不要记成知识缺口（公司不会为「天气」写制度）。',
          },
        },
        required: ['intents'],
      },
    },
  };
}

/** 内置兜底 prompt：只在 config/intent-prompt.md 缺失或为空时使用 */
const FALLBACK_INTENT_PROMPT = [
  '你是小助的意图识别模块，服务范围是工作陪伴、知识库问答、客户评审准备、IT/行政人工接入，以及 HR/财务流程入口。',
  '任务：把员工的一句话拆成 1 个或多个独立可执行的意图，并抽取每个意图的槽位。',
  '',
  '## 可用意图目录（只能从这里选）',
  '{{catalog}}',
  '',
  '规则：只能用目录里的 intent id；诉求不属于任何已知意图时把 unmatched 设为 true，不要硬套最接近的；',
  `槽位只抽原文明确提到的；今天是 {{today}}，相对日期换算成 YYYY-MM-DD；置信度要诚实。`,
  '只通过 submit_intents 工具返回结果。',
].join('\n');

/**
 * 装配意图识别的 system message。
 * 正文来自 config/intent-prompt.md（你可以直接改），{{catalog}} 与 {{today}} 由运行时填充。
 */
function buildSystemPrompt(catalog: string, today: string): string {
  const { intentPrompt } = getConfig();
  const template = intentPrompt.trim().length > 0 ? intentPrompt : FALLBACK_INTENT_PROMPT;
  return template.replaceAll('{{catalog}}', catalog).replaceAll('{{today}}', today);
}

/** 按槽位声明校验并转换模型给的值；不合规的直接丢弃而不是硬塞 */
export function coerceSlots(
  raw: unknown,
  defs: SlotDef[],
): { slots: Record<string, unknown>; rejected: string[] } {
  const slots: Record<string, unknown> = {};
  const rejected: string[] = [];
  if (!raw || typeof raw !== 'object') return { slots, rejected };
  const input = raw as Record<string, unknown>;

  for (const def of defs) {
    if (!(def.name in input)) continue;
    const v = input[def.name];
    if (v === null || v === undefined || v === '') continue;

    switch (def.type) {
      case 'amount':
      case 'days':
      case 'number': {
        // 允许 "8600"、"8600元"、"3 天" 这类写法
        const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.]/g, ''));
        if (Number.isFinite(n) && n >= 0) slots[def.name] = n;
        else rejected.push(`${def.name}=${String(v)}(非数字)`);
        break;
      }
      case 'date': {
        const s = String(v).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))) slots[def.name] = s;
        else rejected.push(`${def.name}=${s}(非 YYYY-MM-DD)`);
        break;
      }
      case 'enum': {
        const s = String(v).trim();
        const hit = (def.options ?? []).find((o) => o === s || o.toLowerCase() === s.toLowerCase());
        if (hit) slots[def.name] = hit;
        else rejected.push(`${def.name}=${s}(不在可选值内)`);
        break;
      }
      default: {
        const s = String(v).trim();
        if (s.length > 0 && s.length <= 200) slots[def.name] = s;
        else rejected.push(`${def.name}(超长或空)`);
      }
    }
  }

  return { slots, rejected };
}

export async function recognizeIntentsLlm(
  text: string,
  cfg: LlmRuntimeConfig,
): Promise<LlmIntentResult> {
  const { intents: intentCfg, app } = getConfig();
  const catalog = buildCatalog(intentCfg.intents);
  const today = new Date().toISOString().slice(0, 10);

  const res = await chatCompletion(cfg, {
    messages: [
      { role: 'system', content: buildSystemPrompt(catalog, today) },
      { role: 'user', content: text },
    ],
    temperature: 0,
  });

  // 使用纯 JSON content 解析。保留 toolCalls 读取只是为了兼容未来切回 function calling。
  const rawArguments = res.toolCalls[0]?.arguments ?? res.content ?? '';
  const parsed = extractJson(rawArguments) as
    | { intents?: unknown[]; unmatched?: boolean; scope?: string }
    | null;

  // 关键区分：
  //   「模型说没有匹配的意图」= 业务结论，走兜底 Skill（转人工 + 沉淀知识缺口）是对的
  //   「模型返回解析不了的东西」= 技术故障，必须抛错让上游降级到规则引擎
  // 混在一起处理会导致：模型抽一次风，就给员工凭空建一张工单 + 记一条知识缺口。
  if (parsed === null || !Array.isArray(parsed.intents)) {
    throw new LlmIntentParseError(
      `模型未返回可解析的意图结构（finish_reason=${res.finishReason ?? 'unknown'}）`,
      rawArguments,
    );
  }

  const candidates: IntentCandidate[] = [];
  const droppedIds: string[] = [];

  for (const item of parsed.intents) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id : '';
    const rule = intentCfg.intents.find((i) => i.id === id);

    // 白名单校验：模型发明的意图直接丢弃
    if (!rule) {
      if (id) droppedIds.push(id);
      continue;
    }

    const rawConfidence = typeof obj.confidence === 'number' ? obj.confidence : 0.5;
    const { slots, rejected } = coerceSlots(obj.slots, rule.slots);
    if (rejected.length > 0) droppedIds.push(...rejected.map((r) => `${id}.${r}`));

    candidates.push({
      rule,
      id: rule.id,
      label: rule.label,
      domain: rule.domain,
      skillId: rule.skill,
      confidence: Number(Math.min(1, Math.max(0, rawConfidence)).toFixed(3)),
      query: typeof obj.query === 'string' && obj.query.trim() ? obj.query.trim() : text,
      matchedKeywords: [],
      llmSlots: slots,
    });
  }

  // 到这里 candidates 为空只有两种可能，都是「业务上确实没匹配」而非技术故障：
  //   1. 模型明确返回 unmatched: true / 空数组
  //   2. 模型给的意图全部不在白名单内，被过滤掉了
  // 两种都应该走兜底 Skill：如实告知 + 沉淀知识缺口 + 转人工。
  if (candidates.length === 0) {
    candidates.push({
      rule: null,
      id: null,
      label: '未识别意图',
      domain: 'UNKNOWN' as Domain,
      skillId: 'fallback.handoff',
      confidence: 0.15,
      query: text.trim(),
      matchedKeywords: [],
      llmSlots: {},
    });
  }

  // 只有在「确实没匹配到任何合法意图」的前提下，scope 才有意义。
  // 如果模型既给了合法意图又说 out_of_scope，以意图为准（避免它自相矛盾时把正常请求拒掉）。
  const outOfScope = candidates.length === 1 && candidates[0].id === null && parsed.scope === 'out_of_scope';

  return {
    candidates: candidates.slice(0, app.agent.maxIntentsPerTurn),
    usage: res.usage,
    durationMs: res.durationMs,
    rawArguments,
    droppedIds,
    outOfScope,
  };
}
