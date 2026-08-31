#!/usr/bin/env node
/**
 * 相似度阈值扫描：把「应该命中」和「应该未命中」两组样例的 Top1 原始分打出来，
 * 选一个能把两组分开、且留有余量的 scoreThreshold 写回 config/app.config.json。
 *
 *   node scripts/tune-threshold.mjs [baseUrl]
 */

const BASE = process.argv[2] ?? 'http://localhost:3000';

const POSITIVE = [
  ['出差去成都，住宿一晚最多能报多少钱', 'FINANCE'],
  ['打车费能不能报销', 'FINANCE'],
  ['公司开票信息是什么', 'FINANCE'],
  ['预算外的付款要走什么审批', 'FINANCE'],
  ['年假有多少天', 'HR'],
  ['婚假能休几天', 'HR'],
  ['社保怎么从上海转到杭州', 'HR'],
  ['公积金能提取吗', 'HR'],
  ['转正流程需要准备什么材料', 'HR'],
  ['离职要提前多久通知', 'HR'],
  ['发薪日是哪天', 'HR'],
  ['OA 密码忘了怎么重置', 'IT'],
  ['账号被锁了怎么解锁', 'IT'],
  ['VPN 权限怎么申请', 'IT'],
  ['生产数据库权限怎么申请', 'IT'],
  ['要批量导出客户名单', 'IT'],
  ['笔记本蓝屏了怎么报修', 'IT'],
  ['申请一个 IDEA 正版授权', 'IT'],
  ['工牌丢了怎么补办', 'ADMIN'],
  ['会议室怎么预定', 'ADMIN'],
  ['想领两包打印纸', 'ADMIN'],
  ['下周去北京出差怎么订票', 'ADMIN'],
];

const NEGATIVE = [
  ['带样机去德国参展的清关手续怎么办', null],
  ['公司有没有员工持股计划', null],
  ['海外子公司的税务架构是怎么设计的', null],
  ['公司年会在哪个城市办', null],
  ['能不能帮我订一份下午茶', null],
];

async function top1(q, domain) {
  const url = new URL('/api/knowledge/search', BASE);
  url.searchParams.set('q', q);
  url.searchParams.set('threshold', '0');
  url.searchParams.set('topK', '1');
  if (domain) url.searchParams.set('domain', domain);
  const res = await fetch(url);
  const body = await res.json();
  return { q, domain, score: body.data[0]?.score ?? 0, doc: body.data[0]?.docId ?? '-' };
}

const pos = [];
for (const [q, d] of POSITIVE) pos.push(await top1(q, d));
const neg = [];
for (const [q, d] of NEGATIVE) neg.push(await top1(q, d));

pos.sort((a, b) => a.score - b.score);
neg.sort((a, b) => b.score - a.score);

console.log('应命中（按分数升序，最低的最危险）：');
for (const r of pos) console.log(`  ${r.score.toFixed(4)}  ${r.doc}  ${r.q}`);
console.log('\n应未命中（按分数降序，最高的最危险）：');
for (const r of neg) console.log(`  ${r.score.toFixed(4)}  ${r.doc}  ${r.q}`);

const minPos = pos[0].score;
const maxNeg = neg[0].score;
console.log('\n────────────────────────────────');
console.log(`应命中的最低分：${minPos.toFixed(4)}`);
console.log(`应未命中的最高分：${maxNeg.toFixed(4)}`);
if (minPos > maxNeg) {
  const suggested = Number(((minPos + maxNeg) / 2).toFixed(3));
  console.log(`两组可分。建议 scoreThreshold = ${suggested}（区间 ${maxNeg.toFixed(4)} ~ ${minPos.toFixed(4)}）`);
} else {
  console.log('两组有重叠，单靠阈值分不开。需要给对应文档补 keywords，或调整字段权重。');
  process.exitCode = 1;
}
