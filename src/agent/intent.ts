import type { Domain } from '@/lib/types';
import { getConfig, type IntentRule } from '@/server/config';

/**
 * 多意图识别（规则版）。
 *
 * 思路：
 * 1. 按配置中的连接词把长句切成若干「诉求片段」；
 * 2. 每个片段对全部意图规则打分（关键词 + 正则 + 否定词）；
 * 3. 片段取最优意图，跨片段去重，按置信度排序，截断到 maxIntentsPerTurn；
 * 4. 全部低于门槛时返回单个 UNKNOWN 意图，交给 fallback.handoff Skill 兜底。
 *
 * 接入大模型后替换本文件的 recognizeIntents 实现即可，返回结构保持不变。
 */

const MIN_CONFIDENCE = 0.2;

export interface IntentCandidate {
  rule: IntentRule | null;
  id: string | null;
  label: string;
  domain: Domain;
  skillId: string;
  confidence: number;
  query: string;
  /** 规则引擎命中的关键词/正则，llm 引擎下为空 */
  matchedKeywords: string[];
  /** llm 引擎抽到的槽位；规则引擎下为 undefined。最终槽位 = 规则抽取 ∪ 这里（这里优先） */
  llmSlots?: Record<string, unknown>;
}

function keywordWeight(kw: string): number {
  return 0.6 + 0.1 * Math.min(kw.length, 6);
}

function scoreRule(rule: IntentRule, segment: string): { score: number; matched: string[] } {
  const lower = segment.toLowerCase();
  let score = 0;
  const matched: string[] = [];

  for (const kw of rule.keywords) {
    if (lower.includes(kw.toLowerCase())) {
      score += keywordWeight(kw);
      matched.push(kw);
    }
  }

  for (const p of rule.patterns ?? []) {
    try {
      if (new RegExp(p, 'i').test(segment)) {
        score += 2;
        matched.push(`/${p}/`);
      }
    } catch {
      // 配置里的正则写错了不应该让整个识别崩掉
    }
  }

  for (const nk of rule.negativeKeywords ?? []) {
    if (lower.includes(nk.toLowerCase())) score -= 1.5;
  }

  return { score: Math.max(0, score), matched };
}

/** 饱和函数：把无上界的原始分压到 0~0.98 的置信度区间 */
function toConfidence(raw: number): number {
  return Number(Math.min(0.98, 1 - Math.exp(-raw / 2)).toFixed(3));
}

export function splitSegments(text: string): string[] {
  const { splitConnectors } = getConfig().intents;
  const escaped = splitConnectors
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length);
  const re = new RegExp(`(?:${escaped.join('|')})`, 'g');
  const parts = text
    .split(re)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  return parts.length > 0 ? parts : [text.trim()];
}

export function recognizeIntents(text: string): IntentCandidate[] {
  const { intents: intentCfg, app } = getConfig();
  const segments = splitSegments(text);
  const candidates: IntentCandidate[] = [];

  for (const segment of segments) {
    const scored = intentCfg.intents
      .map((rule) => ({ rule, ...scoreRule(rule, segment) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) continue;

    const best = scored[0];
    // 同一片段里若第二名分数非常接近，说明确实可能是两个诉求叠在一起
    const runnerUp = scored[1] && scored[1].score >= best.score * 0.75 && scored[1].rule.id !== best.rule.id ? scored[1] : null;

    for (const picked of runnerUp ? [best, runnerUp] : [best]) {
      candidates.push({
        rule: picked.rule,
        id: picked.rule.id,
        label: picked.rule.label,
        domain: picked.rule.domain,
        skillId: picked.rule.skill,
        confidence: toConfidence(picked.score),
        query: segment,
        matchedKeywords: picked.matched,
      });
    }
  }

  // 整句兜底：切片后没识别出东西时，用整句再试一次
  if (candidates.length === 0) {
    const whole = intentCfg.intents
      .map((rule) => ({ rule, ...scoreRule(rule, text) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)[0];
    if (whole) {
      candidates.push({
        rule: whole.rule,
        id: whole.rule.id,
        label: whole.rule.label,
        domain: whole.rule.domain,
        skillId: whole.rule.skill,
        confidence: toConfidence(whole.score),
        query: text,
        matchedKeywords: whole.matched,
      });
    }
  }

  // 去重（同一意图只保留置信度最高的那次）
  const deduped = new Map<string, IntentCandidate>();
  for (const c of candidates) {
    const key = c.id ?? 'unknown';
    const prev = deduped.get(key);
    if (!prev || c.confidence > prev.confidence) deduped.set(key, c);
  }

  const result = Array.from(deduped.values())
    .filter((c) => c.confidence >= MIN_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, app.agent.maxIntentsPerTurn);

  if (result.length === 0) {
    return [
      {
        rule: null,
        id: null,
        label: '未识别意图',
        domain: 'UNKNOWN',
        skillId: 'fallback.handoff',
        confidence: 0.15,
        query: text.trim(),
        matchedKeywords: [],
      },
    ];
  }

  return result;
}
