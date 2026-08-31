import type { LlmRuntimeConfig } from '@/server/config';

/**
 * OpenAI 兼容协议的最小客户端。
 *
 * 为什么不用 openai SDK：我们只需要 chat/completions 一个端点 + tool calls，
 * 自己写 40 行 fetch 就够，还能完全控制超时、重试与错误分类，
 * 而且换供应商（智谱 / DeepSeek / 通义 / Moonshot）只改 baseUrl 与 model。
 */

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmMessage {
  role: LlmRole;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface LlmToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmCallResult {
  content: string;
  toolCalls: Array<{ name: string; arguments: string }>;
  usage: LlmUsage;
  durationMs: number;
  model: string;
  finishReason: string | null;
}

export type LlmErrorCode =
  | 'LLM_TIMEOUT'
  | 'LLM_RATE_LIMITED'
  | 'LLM_UNAUTHORIZED'
  | 'LLM_BAD_REQUEST'
  | 'LLM_SERVER_ERROR'
  | 'LLM_NETWORK_ERROR'
  | 'LLM_MALFORMED_RESPONSE';

export class LlmError extends Error {
  code: LlmErrorCode;
  status?: number;
  attempts: number;

  constructor(code: LlmErrorCode, message: string, attempts: number, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.status = status;
    this.attempts = attempts;
  }
}

interface ChatRequest {
  messages: LlmMessage[];
  tools?: LlmToolDef[];
  /** 强制调用某个工具，用于结构化输出 */
  forceTool?: string;
  temperature?: number;
  maxTokens?: number;
}

function classify(status: number): LlmErrorCode {
  if (status === 401 || status === 403) return 'LLM_UNAUTHORIZED';
  if (status === 429) return 'LLM_RATE_LIMITED';
  if (status >= 500) return 'LLM_SERVER_ERROR';
  return 'LLM_BAD_REQUEST';
}

/** 只有这些错误重试才有意义：限流、服务端错误、超时、网络抖动 */
function isRetryable(code: LlmErrorCode): boolean {
  return (
    code === 'LLM_RATE_LIMITED' ||
    code === 'LLM_SERVER_ERROR' ||
    code === 'LLM_TIMEOUT' ||
    code === 'LLM_NETWORK_ERROR'
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function once(
  cfg: LlmRuntimeConfig,
  req: ChatRequest,
  attempt: number,
): Promise<LlmCallResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: req.messages,
    temperature: req.temperature ?? cfg.temperature,
    max_tokens: req.maxTokens ?? cfg.maxTokens,
    stream: false,
    // 供应商私有参数，例如智谱的 thinking:{type:'disabled'}（关思考模式，延迟差好几倍）。
    // 放在 config 里而不是写死，是为了换供应商时不用改代码。
    ...cfg.extraBody,
  };
  if (req.tools?.length) {
    body.tools = req.tools;
    body.tool_choice = req.forceTool
      ? { type: 'function', function: { name: req.forceTool } }
      : 'auto';
  }

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = (err as Error).name === 'AbortError';
    throw new LlmError(
      aborted ? 'LLM_TIMEOUT' : 'LLM_NETWORK_ERROR',
      aborted ? `请求超过 ${cfg.timeoutMs}ms 未返回` : `网络请求失败：${(err as Error).message}`,
      attempt,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new LlmError(
      classify(res.status),
      `供应商返回 HTTP ${res.status}：${text.slice(0, 400)}`,
      attempt,
      res.status,
    );
  }

  let json: {
    model?: string;
    choices?: Array<{
      message?: LlmMessage;
      finish_reason?: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  try {
    json = await res.json();
  } catch {
    throw new LlmError('LLM_MALFORMED_RESPONSE', '响应不是合法 JSON', attempt, res.status);
  }

  const choice = json.choices?.[0];
  if (!choice?.message) {
    throw new LlmError('LLM_MALFORMED_RESPONSE', '响应缺少 choices[0].message', attempt, res.status);
  }

  return {
    content: choice.message.content ?? '',
    toolCalls: (choice.message.tool_calls ?? []).map((t) => ({
      name: t.function.name,
      arguments: t.function.arguments,
    })),
    usage: {
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
      totalTokens: json.usage?.total_tokens ?? 0,
    },
    durationMs: Date.now() - started,
    model: json.model ?? cfg.model,
    finishReason: choice.finish_reason ?? null,
  };
}

/** 带指数退避重试的调用。首次等 500ms，之后翻倍。 */
export async function chatCompletion(
  cfg: LlmRuntimeConfig,
  req: ChatRequest,
): Promise<LlmCallResult> {
  let lastError: LlmError | null = null;

  for (let attempt = 1; attempt <= cfg.maxRetries + 1; attempt += 1) {
    try {
      return await once(cfg, req, attempt);
    } catch (err) {
      const e = err instanceof LlmError ? err : new LlmError('LLM_NETWORK_ERROR', String(err), attempt);
      lastError = e;
      if (!isRetryable(e.code) || attempt > cfg.maxRetries) break;
      await sleep(500 * 2 ** (attempt - 1));
    }
  }

  throw lastError ?? new LlmError('LLM_NETWORK_ERROR', '未知错误', 1);
}

/** 从可能带 markdown 代码围栏的文本里提取 JSON 对象 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // 退一步：截取第一个 { 到最后一个 } 之间的内容
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
