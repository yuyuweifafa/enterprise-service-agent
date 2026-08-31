import type { SlotDef } from '@/server/config';

/**
 * 槽位抽取（规则版）。
 * 换成大模型后，这一层由 function calling 的结构化输出替代，
 * 但 extractSlots 的返回结构保持不变，pipeline 无需改动。
 */

const SOFTWARE_DICT = [
  'Office',
  'Microsoft 365',
  'Excel',
  'Word',
  'PowerPoint',
  'Outlook',
  'IDEA',
  'IntelliJ',
  'IDEA Ultimate',
  'WebStorm',
  'PyCharm',
  'DataGrip',
  'GoLand',
  'JetBrains',
  'VS Code',
  'Photoshop',
  'Illustrator',
  'Acrobat',
  'Figma',
  'Sketch',
  'Notion',
  'Zoom',
  'Docker',
  'Navicat',
  'Postman',
  'Tableau',
  'MATLAB',
  'AutoCAD',
];

const SYSTEM_DICT = [
  '生产数据库',
  '生产库',
  '线上库',
  '订单库',
  '用户库',
  '数据仓库',
  '数仓',
  '堡垒机',
  '配置中心',
  '密钥管理',
  'CRM',
  'ERP',
  'OA',
  'VPN',
  '邮箱',
  '域账号',
  'Wi-Fi',
  '测试环境',
  '预发环境',
  '生产环境',
];

const WEEKDAYS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0,
};

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function extractAmount(text: string): number | null {
  // ¥1200 / 1200元 / 1,200 元 / 1.2万 / 8万元 / 报销 3500
  const patterns = [
    /(\d+(?:[.,]\d+)?)\s*万\s*(?:元|块|人民币)?/,
    /[¥￥]\s*(\d+(?:[.,]\d+)?)/,
    /(\d+(?:[.,]\d+)?)\s*(?:元|块钱|块|人民币|RMB)/i,
  ];
  for (let i = 0; i < patterns.length; i += 1) {
    const m = patterns[i].exec(text);
    if (m) {
      const n = Number(m[1].replace(/,/g, ''));
      if (Number.isNaN(n)) continue;
      return i === 0 ? n * 10000 : n;
    }
  }
  return null;
}

function extractDate(text: string, now = new Date()): string | null {
  // 2026-09-07 / 2026/9/7
  const iso = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(text);
  if (iso) {
    return toISODate(new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  }
  // 9月7日 / 9月7号
  const cn = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/.exec(text);
  if (cn) {
    const month = Number(cn[1]) - 1;
    const day = Number(cn[2]);
    const year = month < now.getMonth() ? now.getFullYear() + 1 : now.getFullYear();
    return toISODate(new Date(year, month, day));
  }
  // 相对日期
  const add = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return toISODate(d);
  };
  if (/今天|今日/.test(text)) return add(0);
  if (/明天|明日/.test(text)) return add(1);
  if (/后天/.test(text)) return add(2);
  if (/下个?月/.test(text)) {
    const d = new Date(now);
    d.setMonth(d.getMonth() + 1, 1);
    return toISODate(d);
  }
  const week = /(下下|下|这|本)\s*(?:个)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天])?/.exec(text);
  if (week) {
    const offsetWeeks = week[1] === '下' ? 1 : week[1] === '下下' ? 2 : 0;
    const targetDow = week[2] ? WEEKDAYS[week[2]] : 1;
    const d = new Date(now);
    const currentDow = d.getDay();
    const mondayDelta = (currentDow === 0 ? -6 : 1 - currentDow) + offsetWeeks * 7;
    d.setDate(d.getDate() + mondayDelta);
    const dowDelta = targetDow === 0 ? 6 : targetDow - 1;
    d.setDate(d.getDate() + dowDelta);
    return toISODate(d);
  }
  return null;
}

function extractDays(text: string): number | null {
  // 先把日期表达式抠掉，否则「9 月 7 日请 3 天年假」里的「7 日」会被当成天数
  const cleaned = text
    .replace(/\d{4}\s*[-/年]\s*\d{1,2}\s*[-/月]\s*\d{1,2}\s*[日号]?/g, ' ')
    .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g, ' ')
    .replace(/\d{1,2}\s*月\s*\d{1,2}(?![\d.])/g, ' ');

  // 优先「天」与「工作日」，最后才认单独的「日」
  const m =
    /(\d+(?:\.\d+)?)\s*(?:个)?\s*天/.exec(cleaned) ??
    /(\d+(?:\.\d+)?)\s*(?:个)?\s*工作日/.exec(cleaned) ??
    /(\d+(?:\.\d+)?)\s*日(?!期)/.exec(cleaned);
  if (m) return Number(m[1]);
  const text2 = cleaned;
  const cnNum: Record<string, number> = { 半: 0.5, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const cn = /([半一两二三四五六七八九十])\s*(?:天|日)/.exec(text2);
  if (cn) return cnNum[cn[1]] ?? null;
  return null;
}

function extractNumber(text: string): number | null {
  const m = /(\d+)\s*(?:人|个人|位|个)/.exec(text);
  return m ? Number(m[1]) : null;
}

function extractFromDict(text: string, dict: string[]): string | null {
  const lower = text.toLowerCase();
  // 优先匹配更长的词条，避免「生产库」被「库」类短词抢先
  const sorted = [...dict].sort((a, b) => b.length - a.length);
  for (const item of sorted) {
    if (lower.includes(item.toLowerCase())) return item;
  }
  return null;
}

export interface SlotExtractionResult {
  slots: Record<string, unknown>;
  missing: Array<{ name: string; label: string }>;
}

export function extractSlots(
  text: string,
  defs: SlotDef[],
  now = new Date(),
): SlotExtractionResult {
  const slots: Record<string, unknown> = {};
  const missing: Array<{ name: string; label: string }> = [];

  for (const def of defs) {
    let value: unknown = null;
    switch (def.type) {
      case 'amount':
        value = extractAmount(text);
        break;
      case 'date':
        value = extractDate(text, now);
        break;
      case 'days':
        value = extractDays(text);
        break;
      case 'number':
        value = extractNumber(text);
        break;
      case 'enum':
        value = extractFromDict(text, def.options ?? []);
        break;
      case 'text':
        if (def.name === 'software') value = extractFromDict(text, SOFTWARE_DICT);
        else if (def.name === 'system') value = extractFromDict(text, SYSTEM_DICT);
        else if (def.name === 'item' || def.name === 'city' || def.name === 'reason') {
          value = null; // 自由文本槽位交给人工/大模型补全，不做过度猜测
        }
        break;
      default:
        value = null;
    }

    if (value !== null && value !== undefined && value !== '') {
      slots[def.name] = value;
    } else if (def.required) {
      missing.push({ name: def.name, label: def.label });
    }
  }

  return { slots, missing };
}

export const __testDict = { SOFTWARE_DICT, SYSTEM_DICT };
