import { getConfig } from '@/server/config';

/**
 * 入口前置过滤：在进入主管线之前把两类输入拦下来。
 *
 * 为什么必须有这一层 —— 主管线的隐含假设是「所有输入都是四个职能域内的服务请求」，
 * 于是它总能找到一个"最接近"的意图。实测踩到的三个坑：
 *
 *   「今天天气怎么样」  → 沉淀知识缺口 + 转人工，回复「将由内容运营补充相关制度」
 *   「帮我写段冒泡排序」→ 识别成薪酬咨询，判 HIGH，建工单 + 建人工确认任务
 *   「推荐个附近的午饭」→ 识别成办公用品领用，自信地答「到一楼行政前台领取」
 *
 * 三类输入必须区别对待，动作完全不同：
 *
 *   smalltalk     闲聊/无实义  → 轻量回复
 *   out_of_scope  域外请求      → 说明服务范围 + 引导，**不建单、不沉淀、不转人工**
 *   in_scope      正常服务请求  → 进主管线（知识缺失时才沉淀 + 转人工）
 *
 * 把 out_of_scope 和「域内但知识缺失」混在一起，就是上面第一个坑的成因：
 * 公司不会有「天气制度」，把它记成待补充知识是污染知识运营的清单。
 */

export type PrefilterType = 'smalltalk' | 'out_of_scope';

export interface PrefilterMatch {
  type: PrefilterType;
  /** 规则 id，例如 chitchat.greeting / scope.weather */
  kind: string;
  label: string;
  reply: string;
  /** 命中方式，写进链路便于排查 */
  matchedBy: string;
}

/** 去掉标点、空白与表情，只留可比较的实义字符 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。！？、；：""''（）【】~…,.!?;:'"()[\]{}<>/\\|`@#$%^&*+=_-]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '');
}

function hasMeaningfulChars(normalized: string): boolean {
  return /[\u4e00-\u9fa5a-z0-9]/.test(normalized);
}

interface GenericRule {
  id: string;
  label: string;
  matchMode: 'full' | 'contains';
  patterns: string[];
  reply: string;
}

function matchRules(normalized: string, rules: GenericRule[]): { rule: GenericRule; by: string } | null {
  for (const rule of rules) {
    for (const p of rule.patterns) {
      const np = normalize(p);
      if (!np) continue;
      if (rule.matchMode === 'contains') {
        if (normalized.includes(np)) return { rule, by: `包含「${p}」` };
      } else if (normalized === np) {
        return { rule, by: `整句等于「${p}」` };
      }
    }
  }
  return null;
}

export function classifyInput(rawText: string): PrefilterMatch | null {
  const { intents } = getConfig();
  const normalized = normalize(rawText);

  // ── 1. 空输入 / 纯标点 / 纯表情 ──────────────────────────────────────
  const st = intents.smallTalk;
  if (st?.enabled) {
    if (!hasMeaningfulChars(normalized)) {
      return {
        type: 'smalltalk',
        kind: 'input.too_short',
        label: '无实义输入',
        matchedBy: '不含中文、字母或数字',
        reply: '没看懂你的意思，能具体说说要办什么吗？比如「年假还剩几天」「帮我申请 VPN 权限」。',
      };
    }
    if (normalized.length < (st.minMeaningfulChars ?? 2)) {
      return {
        type: 'smalltalk',
        kind: 'input.too_short',
        label: '输入过短',
        matchedBy: `实义字符数 ${normalized.length} < ${st.minMeaningfulChars ?? 2}`,
        reply: '能再说具体一点吗？比如「年假还剩几天」「帮我申请 VPN 权限」。',
      };
    }
  }

  // ── 2. 域外请求 ─────────────────────────────────────────────────────
  // 放在闲聊之后、意图识别之前。先判域外是因为「推荐个附近的午饭」这类
  // 既不是闲聊也不是服务请求，如果漏到主管线就会被硬套成某个意图。
  const oos = intents.outOfScope;
  if (oos?.enabled) {
    const hit = matchRules(normalized, oos.rules);
    if (hit) {
      const parts = [oos.replyPrefix, hit.rule.reply, oos.replySuffix].filter(
        (s) => Boolean(s?.trim()),
      );
      return {
        type: 'out_of_scope',
        kind: hit.rule.id,
        label: hit.rule.label,
        matchedBy: hit.by,
        reply: parts.join('\n\n'),
      };
    }
  }

  // ── 3. 闲聊规则 ─────────────────────────────────────────────────────
  if (st?.enabled) {
    const hit = matchRules(normalized, st.rules);
    if (hit) {
      return {
        type: 'smalltalk',
        kind: hit.rule.id,
        label: hit.rule.label,
        reply: hit.rule.reply,
        matchedBy: hit.by,
      };
    }
  }

  return null;
}
