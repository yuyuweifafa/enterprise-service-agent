#!/usr/bin/env node
/**
 * 用你自己的 Key 列出供应商实际可用的模型，避免把模型名写错。
 *
 *   LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4 LLM_API_KEY=xxx npm run llm:models
 *
 * 也可以直接读 .env.local（如果存在）。
 */
import { readFile } from 'node:fs/promises';

async function loadDotEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      const raw = await readFile(file, 'utf8');
      for (const line of raw.split('\n')) {
        const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
        if (!m) continue;
        const [, k, v] = m;
        if (!process.env[k]) process.env[k] = v.replace(/^["']|["']$/g, '');
      }
    } catch {
      // 文件不存在就算了
    }
  }
}

await loadDotEnv();

const baseUrl = (process.env.LLM_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4').replace(/\/+$/, '');
const apiKey = process.env.LLM_API_KEY;

if (!apiKey) {
  console.error('缺少 LLM_API_KEY。可以写进 .env.local，或直接在命令前面带上：');
  console.error('  LLM_API_KEY=xxx npm run llm:models');
  process.exit(1);
}

console.log(`查询：${baseUrl}/models\n`);

const res = await fetch(`${baseUrl}/models`, {
  headers: { Authorization: `Bearer ${apiKey}` },
});

if (!res.ok) {
  const text = await res.text().catch(() => '');
  console.error(`请求失败 HTTP ${res.status}`);
  console.error(text.slice(0, 600));
  console.error('\n提示：部分供应商不开放 /models 端点，此时直接去控制台的模型列表页查看模型名即可。');
  process.exit(1);
}

const body = await res.json();
const models = body.data ?? body.models ?? [];

if (!Array.isArray(models) || models.length === 0) {
  console.log('返回里没有模型列表，原始响应：');
  console.log(JSON.stringify(body, null, 2).slice(0, 1500));
  process.exit(0);
}

console.log(`可用模型 ${models.length} 个：`);
for (const m of models) {
  const id = typeof m === 'string' ? m : m.id;
  const free = /flash/i.test(String(id)) ? '  ← Flash 系列，通常是免费/低价档' : '';
  console.log(`  ${id}${free}`);
}
console.log('\n把想用的模型名填进 LLM_MODEL 即可。');
