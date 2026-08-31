import type { AgentActionType, Domain, EmployeeStatus, RiskAssessment, RiskLevel } from '@/lib/types';
import { getConfig, type RiskRule, type RiskRuleCondition } from '@/server/config';

export interface RiskInput {
  text: string;
  intentId: string | null;
  domain: Domain;
  skillId: string;
  baseLevel: RiskLevel;
  confidence: number;
  slots: Record<string, unknown>;
  knowledgeHit: boolean;
  missingRequiredSlot: boolean;
  employeeStatus: EmployeeStatus | null;
}

const ORDER: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH'];

function levelIndex(level: RiskLevel): number {
  return Math.max(0, ORDER.indexOf(level));
}

function raise(level: RiskLevel, steps: number): RiskLevel {
  return ORDER[Math.min(ORDER.length - 1, levelIndex(level) + steps)];
}

function maxLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return levelIndex(a) >= levelIndex(b) ? a : b;
}

function numericSlot(slots: Record<string, unknown>, key: string): number | null {
  const v = slots[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

export function evaluateCondition(
  when: RiskRuleCondition,
  input: RiskInput,
  currentLevel: RiskLevel,
): boolean {
  const lower = input.text.toLowerCase();

  if (when.keywordsAny && !when.keywordsAny.some((k) => lower.includes(k.toLowerCase()))) {
    return false;
  }
  if (when.intentIn && (!input.intentId || !when.intentIn.includes(input.intentId))) return false;
  if (when.domainIn && !when.domainIn.includes(input.domain)) return false;
  if (when.skillIn && !when.skillIn.includes(input.skillId)) return false;
  if (
    when.employeeStatusIn &&
    (!input.employeeStatus || !when.employeeStatusIn.includes(input.employeeStatus))
  ) {
    return false;
  }
  if (when.amountGte !== undefined) {
    const amount = numericSlot(input.slots, 'amount');
    if (amount === null || amount < when.amountGte) return false;
  }
  if (when.daysGte !== undefined) {
    const days = numericSlot(input.slots, 'days');
    if (days === null || days < when.daysGte) return false;
  }
  if (when.confidenceLt !== undefined && input.confidence >= when.confidenceLt) return false;
  if (when.noKnowledgeHit === true && input.knowledgeHit) return false;
  if (when.missingRequiredSlot === true && !input.missingRequiredSlot) return false;
  if (when.currentLevelIn && !when.currentLevelIn.includes(currentLevel)) return false;

  return true;
}

function describeEffect(rule: RiskRule): string {
  const parts: string[] = [];
  if (rule.effect.setLevel) parts.push(`置为 ${rule.effect.setLevel}`);
  if (rule.effect.minLevel) parts.push(`不低于 ${rule.effect.minLevel}`);
  if (rule.effect.escalate) parts.push(`上调 ${rule.effect.escalate} 级`);
  if (rule.effect.forceAction) parts.push(`强制动作 ${rule.effect.forceAction}`);
  return parts.join(' + ') || '无';
}

export function assessRisk(input: RiskInput): RiskAssessment {
  const { risk } = getConfig();
  let level: RiskLevel = input.baseLevel;
  let forcedAction: AgentActionType | null = null;
  const reasons: RiskAssessment['reasons'] = [];

  for (const rule of risk.rules) {
    if (!evaluateCondition(rule.when, input, level)) continue;

    if (rule.effect.setLevel) level = rule.effect.setLevel;
    if (rule.effect.minLevel) level = maxLevel(level, rule.effect.minLevel);
    if (rule.effect.escalate) level = raise(level, rule.effect.escalate);
    if (rule.effect.forceAction) forcedAction = rule.effect.forceAction;

    reasons.push({
      ruleId: rule.id,
      name: rule.name,
      reason: rule.reason,
      effect: describeEffect(rule),
    });
  }

  return {
    level,
    baseLevel: input.baseLevel,
    policy: risk.levels[level]?.policy ?? '',
    reasons,
    forcedAction,
  };
}

export function actionsForLevel(level: RiskLevel, forcedAction: AgentActionType | null): AgentActionType[] {
  if (forcedAction) return [forcedAction];
  return getConfig().risk.levels[level]?.actions ?? ['answer'];
}
