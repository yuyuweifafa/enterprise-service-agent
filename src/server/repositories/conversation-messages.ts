import type { ConversationMessage } from '@/lib/types';
import { mutate, readCollection, randomId } from '../store';

export async function listConversationMessages(sessionId: string): Promise<ConversationMessage[]> {
  const all = await readCollection<ConversationMessage>('conversation-messages');
  return all
    .filter((message) => message.sessionId === sessionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function appendConversationMessage(
  message: Omit<ConversationMessage, 'id' | 'createdAt'> & { createdAt?: string },
): Promise<ConversationMessage> {
  return mutate<ConversationMessage, ConversationMessage>('conversation-messages', (items) => {
    const record: ConversationMessage = {
      id: randomId('msg_', 10),
      createdAt: message.createdAt ?? new Date().toISOString(),
      ...message,
    };
    return { items: [...items, record], result: record };
  });
}
