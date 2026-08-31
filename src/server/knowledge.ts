import fs from 'node:fs';
import path from 'node:path';
import type { Citation, Domain, KnowledgeDoc, KnowledgeSection } from '@/lib/types';
import { getConfig } from './config';

/**
 * 本地知识库：knowledge/**\/*.md
 *
 * 检索用「中文二元组 + 拉丁词」切分 + 字段加权 TF-IDF 打分。
 * 这是一个可解释、零依赖、零冷启动的基线检索器，命中结果带来源标识与相似度分数，
 * 数据契约与真实向量库一致 —— 后续把 searchKnowledge 换成向量检索即可，
 * 上层 Agent 与前端不需要任何改动。
 */

const KNOWLEDGE_DIR = path.join(process.cwd(), 'knowledge');

// ── Markdown frontmatter 解析（够用即可，不引第三方库）─────────────────────

interface Frontmatter {
  [key: string]: string | string[];
}

function parseFrontmatter(raw: string): { data: Frontmatter; body: string } {
  if (!raw.startsWith('---')) return { data: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: raw };
  const head = raw.slice(4, end);
  const body = raw.slice(end + 4).replace(/^\s*\n/, '');
  const data: Frontmatter = {};
  for (const line of head.split('\n')) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const [, key, valueRaw] = m;
    const value = valueRaw.trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      data[key] = value.replace(/^["']|["']$/g, '');
    }
  }
  return { data, body };
}

function asString(v: string | string[] | undefined, fallback = ''): string {
  if (Array.isArray(v)) return v.join(', ');
  return v ?? fallback;
}

function asArray(v: string | string[] | undefined): string[] {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

/** 按二级标题切段；标题前的内容归入「概述」 */
function splitSections(body: string): Array<{ section: string; content: string }> {
  const lines = body.split('\n');
  const out: Array<{ section: string; content: string[] }> = [];
  let current = { section: '概述', content: [] as string[] };
  for (const line of lines) {
    const m = /^##\s+(.*)$/.exec(line);
    if (m) {
      if (current.content.join('').trim()) out.push(current);
      current = { section: m[1].trim(), content: [] };
    } else {
      current.content.push(line);
    }
  }
  if (current.content.join('').trim()) out.push(current);
  return out.map((s) => ({ section: s.section, content: s.content.join('\n').trim() }));
}

// ── 分词与打分 ───────────────────────────────────────────────────────────

/**
 * 停用词。除了常规虚词，还刻意加入了企业语境里的高频无信息量词
 *（「公司」「员工」这类词在内部知识库里几乎每篇都有，留着它们会让任何提问都能"命中"一点，
 * 未命中兜底就失效了）。
 */
const STOPWORDS = new Set([
  // 虚词 / 语气词
  '的', '了', '和', '是', '在', '我', '有', '就', '不', '也', '还', '要', '吗', '呢', '吧',
  '的话', '是不', '不是', '有没', '没有', '能不', '不能', '可不',
  // 提问套话
  '怎么', '怎样', '如何', '什么', '哪些', '哪个', '可以', '需要', '一下', '请问', '帮我',
  '我们', '你们', '麻烦', '想问',
  // 企业语境高频无信息量词
  '公司', '员工', '我司', '本人',
  // 英文虚词
  'the', 'a', 'an', 'is', 'are', 'to', 'of', 'and', 'for', 'how', 'what', 'can', 'i', 'my',
]);

export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = [];

  // 拉丁字母 / 数字词
  for (const m of lower.matchAll(/[a-z0-9][a-z0-9+._-]*/g)) {
    if (m[0].length >= 2 && !STOPWORDS.has(m[0])) tokens.push(m[0]);
  }

  // 中文：连续汉字串 → 单字 + 二元组
  for (const m of lower.matchAll(/[\u4e00-\u9fa5]+/g)) {
    const seg = m[0];
    if (seg.length === 1) {
      if (!STOPWORDS.has(seg)) tokens.push(seg);
      continue;
    }
    for (let i = 0; i < seg.length - 1; i += 1) {
      const bigram = seg.slice(i, i + 2);
      if (!STOPWORDS.has(bigram)) tokens.push(bigram);
    }
  }

  return tokens;
}

function termFreq(text: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of tokenize(text)) map.set(t, (map.get(t) ?? 0) + 1);
  return map;
}

interface IndexedSection extends KnowledgeSection {
  owner: string;
  updatedAt: string;
  tf: {
    /** 章节级：二级标题文本 */
    heading: Map<string, number>;
    /** 章节级：正文 */
    body: Map<string, number>;
    /** 文档级：文档标题 */
    docTitle: Map<string, number>;
    /** 文档级：frontmatter keywords */
    keywords: Map<string, number>;
    /** 文档级：frontmatter tags */
    tags: Map<string, number>;
  };
}

interface KnowledgeIndex {
  docs: KnowledgeDoc[];
  sections: IndexedSection[];
  idf: Map<string, number>;
  /** 语料中 idf 的中位数，用于给「查询里根本不存在于知识库的词」估一个代价 */
  medianIdf: number;
  builtAt: number;
}

const cache = globalThis as unknown as { __esaKb?: KnowledgeIndex };

function walkMarkdown(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function buildIndex(): KnowledgeIndex {
  const files = walkMarkdown(KNOWLEDGE_DIR).sort();
  const docs: KnowledgeDoc[] = [];
  const sections: IndexedSection[] = [];

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const { data, body } = parseFrontmatter(raw);
    const relPath = path.relative(process.cwd(), file);
    const docId = asString(data.id, path.basename(file, '.md'));
    const title = asString(data.title, docId);
    const domain = (asString(data.domain, 'UNKNOWN').toUpperCase() as Domain) ?? 'UNKNOWN';
    const owner = asString(data.owner, '未指定');
    const version = asString(data.version, '0.1');
    const updatedAt = asString(data.updatedAt, '');
    const tags = asArray(data.tags);
    const keywords = asArray(data.keywords);

    const parts = splitSections(body);
    const docSections: KnowledgeSection[] = parts.map((p) => ({
      refId: `${docId}#${p.section}`,
      docId,
      docTitle: title,
      domain,
      section: p.section,
      content: p.content,
    }));

    docs.push({
      docId,
      title,
      domain,
      owner,
      version,
      updatedAt,
      tags,
      keywords,
      filePath: relPath,
      sections: docSections,
    });

    for (const s of docSections) {
      sections.push({
        ...s,
        owner,
        updatedAt,
        tf: {
          heading: termFreq(s.section),
          body: termFreq(s.content),
          docTitle: termFreq(title),
          keywords: termFreq(keywords.join(' ')),
          tags: termFreq(tags.join(' ')),
        },
      });
    }
  }

  // IDF：以「段」为文档单位
  const df = new Map<string, number>();
  for (const s of sections) {
    const seen = new Set<string>([
      ...s.tf.heading.keys(),
      ...s.tf.body.keys(),
      ...s.tf.docTitle.keys(),
      ...s.tf.keywords.keys(),
      ...s.tf.tags.keys(),
    ]);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = Math.max(sections.length, 1);
  const idf = new Map<string, number>();
  for (const [t, n] of df) idf.set(t, Math.log(1 + (N - n + 0.5) / (n + 0.5)));

  const sortedIdf = Array.from(idf.values()).sort((a, b) => a - b);
  const medianIdf = sortedIdf.length > 0 ? sortedIdf[Math.floor(sortedIdf.length / 2)] : 1;

  return { docs, sections, idf, medianIdf, builtAt: Date.now() };
}

export function getKnowledgeIndex(): KnowledgeIndex {
  if (process.env.NODE_ENV === 'production') {
    if (!cache.__esaKb) cache.__esaKb = buildIndex();
    return cache.__esaKb;
  }
  // 开发环境：60 秒内复用，改完 md 刷新页面很快就能看到效果
  if (!cache.__esaKb || Date.now() - cache.__esaKb.builtAt > 60_000) {
    cache.__esaKb = buildIndex();
  }
  return cache.__esaKb;
}

export function invalidateKnowledgeIndex(): void {
  delete cache.__esaKb;
}

/**
 * 从命中的章节里裁出一段最相关的引用文本。
 * 打分用「命中的不同 query token 数」而不是命中总次数，避免某个高频词把整段拉偏；
 * 子标题行额外加权，因为从子标题开始截取读起来最完整（例如「住宿（每人每晚，含税）」+ 下面的表格）。
 */
function buildSnippet(content: string, queryTokens: Set<string>, maxChars: number): string {
  const rawLines = content.split('\n');
  const lines = rawLines
    .map((raw) => ({
      isHeading: /^#{2,4}\s/.test(raw.trim()),
      // markdown 表格行转成「单元格 ｜ 单元格」，比塌成空格可读
      text: raw
        .replace(/\s*\|\s*/g, ' ｜ ')
        .replace(/[#*>`]/g, '')
        .replace(/^\s*｜\s*|\s*｜\s*$/g, '')
        .trim(),
    }))
    .filter((l) => l.text.length > 0);

  if (lines.length === 0) return '';

  let bestIdx = 0;
  let bestScore = -1;
  lines.forEach((line, idx) => {
    const distinct = new Set(tokenize(line.text).filter((t) => queryTokens.has(t))).size;
    const score = distinct + (line.isHeading && distinct > 0 ? 0.5 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });

  const picked: string[] = [];
  let total = 0;
  for (let i = bestIdx; i < lines.length && total < maxChars; i += 1) {
    // 跳过 markdown 表格的分隔行，它对人没有信息量
    if (/^[-\s｜|:]+$/.test(lines[i].text)) continue;
    picked.push(lines[i].text);
    total += lines[i].text.length;
  }
  const text = picked.join(' / ');
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

export interface SearchOptions {
  domain?: Domain;
  topK?: number;
  threshold?: number;
}
/**
 * 注意：这里刻意**不提供**「把额外关键词拼进 query」的入口。
 * 曾经有过一个 tags 参数（把意图配置里的 knowledgeTags 混进查询文本），
 * 结果意图识别错误时，错误的 tags 会把错误文档的所有章节推过相似度阈值，
 * 导致未命中兜底永远不触发。检索只应该基于员工真实说的话。
 */

export function searchKnowledge(query: string, options: SearchOptions = {}): Citation[] {
  const { retrieval } = getConfig().app;
  const topK = options.topK ?? retrieval.topK;
  const threshold = options.threshold ?? retrieval.scoreThreshold;
  const index = getKnowledgeIndex();

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];
  const uniqueQ = Array.from(new Set(queryTokens));
  const tokenSet = new Set(uniqueQ);

  // 归一化分母里，知识库中不存在的查询词也要计入代价（按中位 idf 打折）。
  // 否则「整句只有一个词碰巧在知识库里」也能拿到接近 1 的相似度，
  // 未命中兜底就永远不会触发 —— 这是这类 Demo 最常见的假高分来源。
  // OOV 代价按 sqrt 增长而不是线性：否则问题问得越啰嗦分数越低，
  // 长句正常提问会被判成未命中。
  let inVocabIdfSum = 0;
  let oovCount = 0;
  for (const t of uniqueQ) {
    const w = index.idf.get(t);
    if (w === undefined) oovCount += 1;
    else inVocabIdfSum += w;
  }
  const oovCost = retrieval.oovWeight * index.medianIdf * Math.sqrt(oovCount);
  const denominator = inVocabIdfSum + oovCost || 1;
  const maxFieldWeight = Math.max(
    retrieval.titleWeight,
    retrieval.keywordWeight,
    retrieval.tagWeight,
    retrieval.bodyWeight,
  );

  const scored = index.sections.map((s) => {
    let sectionScore = 0;
    let docScore = 0;
    let matchedHeadingOrDoc = false;

    for (const t of uniqueQ) {
      const w = index.idf.get(t) ?? 0;
      if (w === 0) continue;

      // 章节级信号（二级标题 + 正文）是主分。
      // 每个字段取「命中字段的最高权重」而不是求和，避免同一个词在多字段重复计分。
      let sectionFactor = 0;
      if (s.tf.heading.has(t)) {
        sectionFactor = Math.max(sectionFactor, retrieval.titleWeight);
        matchedHeadingOrDoc = true;
      }
      const bodyTf = s.tf.body.get(t) ?? 0;
      if (bodyTf > 0) {
        const saturation = Math.min(1, 0.8 + 0.2 * (bodyTf - 1));
        sectionFactor = Math.max(sectionFactor, retrieval.bodyWeight * saturation);
      }
      if (sectionFactor > 0) sectionScore += w * (sectionFactor / maxFieldWeight);

      // 文档级信号（文档标题 + keywords + tags）只作为加成。
      // 否则一篇文档的所有章节会拿到同样的高分，引用来源就会指错章节。
      let docFactor = 0;
      if (s.tf.docTitle.has(t)) docFactor = Math.max(docFactor, retrieval.titleWeight);
      if (s.tf.keywords.has(t)) docFactor = Math.max(docFactor, retrieval.keywordWeight);
      if (s.tf.tags.has(t)) docFactor = Math.max(docFactor, retrieval.tagWeight);
      if (docFactor > 0) {
        docScore += w * (docFactor / maxFieldWeight);
        matchedHeadingOrDoc = true;
      }
    }

    let normalized = (sectionScore + retrieval.docBonusRatio * docScore) / denominator;

    // 只在正文里碰到词、标题与 keywords/tags 都没命中 —— 大概率是偶然的字面重合，
    // 而不是这一段真的在回答这个问题。降权拉开「真命中」和「蹭到一个词」的差距。
    if (!matchedHeadingOrDoc) normalized *= 1 - retrieval.bodyOnlyPenalty;

    // 意图识别给出了职能域时，跨域章节降权。
    // 纯词面检索很容易被噪声带偏（例如「社保从上海转到杭州」会命中差旅住宿表里的城市名），
    // 先分域再检索是把命中率做上去最划算的一步。
    if (options.domain && options.domain !== 'UNKNOWN') {
      normalized *=
        s.domain === options.domain ? 1 + retrieval.domainMatchBonus : 1 - retrieval.crossDomainPenalty;
    }

    return { section: s, score: Math.min(1, Number(normalized.toFixed(4))) };
  });

  return scored
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ section, score }) => ({
      refId: section.refId,
      docId: section.docId,
      title: section.docTitle,
      section: section.section,
      domain: section.domain,
      score,
      snippet: buildSnippet(section.content, tokenSet, retrieval.snippetMaxChars),
      owner: section.owner,
      updatedAt: section.updatedAt,
    }));
}

/** 无论是否过阈值都返回最高分，用于「未命中」判定与知识缺口沉淀 */
export function peekTopScore(query: string, domain?: Domain): number {
  const hits = searchKnowledge(query, { domain, threshold: 0, topK: 1 });
  return hits[0]?.score ?? 0;
}

export function listKnowledgeDocs(): KnowledgeDoc[] {
  return getKnowledgeIndex().docs;
}
