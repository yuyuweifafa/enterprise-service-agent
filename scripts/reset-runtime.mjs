#!/usr/bin/env node
/**
 * 把运行时数据重置回 data/seed 的初始状态。
 * 演示前跑一次，保证工单号、审批队列、知识缺口都是干净的。
 *
 *   npm run seed:reset
 */
import { rm, mkdir } from 'node:fs/promises';
import path from 'node:path';

const runtimeDir = path.join(process.cwd(), 'data', 'runtime');

await rm(runtimeDir, { recursive: true, force: true });
await mkdir(runtimeDir, { recursive: true });

console.log('[reset] data/runtime 已清空，下次请求会从 data/seed 重新初始化');
