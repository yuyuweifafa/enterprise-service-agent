import { ok, withErrorHandling } from '@/server/http';
import { listKnowledgeDocs } from '@/server/knowledge';

/** GET /api/knowledge — 列出知识库文档与章节结构（用于知识运营页） */
export const GET = withErrorHandling(async () => {
  const docs = listKnowledgeDocs();
  return ok(
    docs.map((d) => ({
      docId: d.docId,
      title: d.title,
      domain: d.domain,
      owner: d.owner,
      version: d.version,
      updatedAt: d.updatedAt,
      tags: d.tags,
      keywords: d.keywords,
      filePath: d.filePath,
      sections: d.sections.map((s) => ({ refId: s.refId, section: s.section, chars: s.content.length })),
    })),
    { totalDocs: docs.length, totalSections: docs.reduce((s, d) => s + d.sections.length, 0) },
  );
});
