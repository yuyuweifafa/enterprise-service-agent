import { NextResponse } from 'next/server';
import { ZodError, type TypeOf, type ZodTypeAny } from 'zod';

/** 统一的成功响应：{ data, meta? } */
export function ok<T>(data: T, meta?: Record<string, unknown>, status = 200) {
  return NextResponse.json(meta ? { data, meta } : { data }, { status });
}

/** 统一的错误响应：{ error: { code, message, details? } } */
export function fail(code: string, message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

/**
 * 解析并校验请求体。
 * 泛型取 schema 的 output 类型（而不是 input），这样 z.default() 之后的字段是必填的。
 */
export async function parseBody<S extends ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<{ ok: true; data: TypeOf<S> } | { ok: false; response: ReturnType<typeof fail> }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: fail('INVALID_JSON', '请求体不是合法 JSON', 400) };
  }
  try {
    return { ok: true, data: schema.parse(raw) };
  } catch (err) {
    if (err instanceof ZodError) {
      return {
        ok: false,
        response: fail('INVALID_REQUEST', '请求参数校验未通过', 400, err.flatten()),
      };
    }
    throw err;
  }
}

/** 把 handler 包一层，避免任何未捕获异常直接抛出 500 HTML */
export function withErrorHandling<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>,
) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      console.error('[api]', err);
      return fail('INTERNAL_ERROR', (err as Error).message ?? '服务内部错误', 500);
    }
  };
}
