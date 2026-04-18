import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

const APP_ID = process.env.APP_ID || 'thesis_assistant';

// 코사인 유사도 계산
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function GET() {
  try {
    const { data: assistants } = await supabase
      .from('assistants')
      .select('id, name, specialty')
      .eq('app_id', APP_ID)
      .order('created_at', { ascending: true });

    const { data: docs, error: docsErr } = await supabase
      .from('documents')
      .select('id, source_file, assistant_id, doc_type, embedding, metadata')
      .eq('app_id', APP_ID)
      .order('id', { ascending: true });

    if (docsErr) throw docsErr;

    const docMap = new Map<string, {
      sourceFile: string;
      assistantId: string | null;
      docType: string;
      embedding: number[];
      chunkCount: number;
    }>();

    for (const doc of (docs || [])) {
      const key = `${doc.assistant_id || 'shared'}_${doc.source_file}`;
      if (!docMap.has(key)) {
        let embedding: number[] = [];
        if (doc.embedding) {
          if (typeof doc.embedding === 'string') {
            embedding = JSON.parse(doc.embedding);
          } else if (Array.isArray(doc.embedding)) {
            embedding = doc.embedding;
          }
        }
        docMap.set(key, {
          sourceFile: doc.source_file,
          assistantId: doc.assistant_id,
          docType: doc.doc_type,
          embedding,
          chunkCount: 1,
        });
      } else {
        docMap.get(key)!.chunkCount += 1;
      }
    }

    const nodes: any[] = [];
    const edges: any[] = [];

    for (const a of (assistants || [])) {
      nodes.push({
        id: `assistant_${a.id}`,
        label: a.name,
        type: 'assistant',
        specialty: a.specialty,
        group: a.id,
      });
    }

    nodes.push({
      id: 'shared_knowledge',
      label: '공유 지식 (레벨1)',
      type: 'knowledge_base',
      group: 'shared',
    });

    const docEntries = Array.from(docMap.entries());
    for (const [key, doc] of docEntries) {
      const nodeId = `doc_${key}`;
      nodes.push({
        id: nodeId,
        label: doc.sourceFile,
        type: 'document',
        docType: doc.docType,
        chunkCount: doc.chunkCount,
        group: doc.assistantId || 'shared',
      });

      if (doc.assistantId) {
        edges.push({
          source: `assistant_${doc.assistantId}`,
          target: nodeId,
          type: 'owns',
          weight: 1,
        });
      } else {
        edges.push({
          source: 'shared_knowledge',
          target: nodeId,
          type: 'owns',
          weight: 1,
        });
      }
    }

    const docsWithEmbeddings = docEntries.filter(([, d]) => d.embedding.length > 0);
    const SIMILARITY_THRESHOLD = 0.5;

    for (let i = 0; i < docsWithEmbeddings.length; i++) {
      for (let j = i + 1; j < docsWithEmbeddings.length; j++) {
        const [keyA, docA] = docsWithEmbeddings[i];
        const [keyB, docB] = docsWithEmbeddings[j];

        const similarity = cosineSimilarity(docA.embedding, docB.embedding);

        if (similarity >= SIMILARITY_THRESHOLD) {
          edges.push({
            source: `doc_${keyA}`,
            target: `doc_${keyB}`,
            type: 'similar',
            weight: parseFloat(similarity.toFixed(3)),
          });
        }
      }
    }

    return NextResponse.json({
      nodes,
      edges,
      stats: {
        totalDocuments: docMap.size,
        totalAssistants: assistants?.length || 0,
        totalEdges: edges.length,
        similarityThreshold: SIMILARITY_THRESHOLD,
      },
    });
  } catch (err: any) {
    console.error('[Knowledge Graph Error]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
