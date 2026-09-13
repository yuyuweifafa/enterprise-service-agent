import { z } from 'zod';
import { fail, ok, parseBody, withErrorHandling } from '@/server/http';
import {
  appendConversationMessage,
  listConversationMessages,
} from '@/server/repositories/conversation-messages';

export const GET = withErrorHandling(async (req: Request) => {
  const sessionId = new URL(req.url).searchParams.get('sessionId');
  if (!sessionId) return fail('SESSION_ID_REQUIRED', '缺少 sessionId', 400);
  const messages = await listConversationMessages(sessionId);
  return ok(messages, { total: messages.length });
});

const messageSchema = z.object({
  sessionId: z.string().min(1),
  traceId: z.string().min(1).nullable().optional(),
  employeeId: z.string().min(1),
  role: z.enum(['employee', 'agent', 'human']),
  authorName: z.string().min(1).max(80),
  text: z.string().min(1).max(4000),
});

export const POST = withErrorHandling(async (req: Request) => {
  const parsed = await parseBody(req, messageSchema);
  if (!parsed.ok) return parsed.response;
  const message = await appendConversationMessage({
    ...parsed.data,
    traceId: parsed.data.traceId ?? null,
  });
  return ok(message, undefined, 201);
});
