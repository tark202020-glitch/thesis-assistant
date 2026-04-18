import { NextResponse } from 'next/server';
import { getStorage } from '@/lib/gcp-auth';
import { createClient } from '@supabase/supabase-js';
import { generateEmbeddings, splitTextIntoChunks, extractTextFromBuffer } from '@/lib/embeddings';

export const maxDuration = 300;

const storage = getStorage();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'story_ai_helper';
const APP_ID = process.env.APP_ID || 'thesis_assistant';
const GCS_PREFIX = process.env.GCS_PATH_PREFIX || 'thesis_assistant';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: '파일이 제공되지 않았습니다.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileName = file.name;

    const gcsPath = `${GCS_PREFIX}/database/${fileName}`;
    const gcsUri = `gs://${BUCKET_NAME}/${gcsPath}`;

    console.log(`[Ingest] GCS 업로드 시작: ${gcsUri}`);

    const bucket = storage.bucket(BUCKET_NAME);
    const gcsFile = bucket.file(gcsPath);

    await gcsFile.save(buffer, {
      metadata: {
        contentType: file.type || 'application/octet-stream',
      },
    });

    console.log(`[Ingest] GCS 업로드 완료: ${gcsUri}`);

    console.log(`[Ingest] 텍스트 추출 시작...`);
    const text = await extractTextFromBuffer(buffer, fileName);
    console.log(`[Ingest] 텍스트 추출 완료: ${text.length}자`);

    if (!text || text.trim().length === 0) {
      return NextResponse.json({
        success: true,
        warning: 'GCS 업로드는 성공했지만, 파일에서 텍스트를 추출할 수 없습니다.',
        gcsUri,
      });
    }

    console.log(`[Ingest] 텍스트 청킹 시작...`);
    const chunks = await splitTextIntoChunks(text);
    console.log(`[Ingest] 청킹 완료: ${chunks.length}개 청크`);

    console.log(`[Ingest] 임베딩 생성 시작... (${chunks.length}개)`);
    const embeddings = await generateEmbeddings(chunks);
    console.log(`[Ingest] 임베딩 생성 완료`);

    console.log(`[Ingest] pgvector 저장 시작...`);
    const rows = chunks.map((chunk, i) => ({
      content: chunk,
      metadata: { fileName, chunkIndex: i, totalChunks: chunks.length },
      embedding: JSON.stringify(embeddings[i]),
      assistant_id: null,
      doc_type: 'script',
      source_file: fileName,
      gcs_uri: gcsUri,
      app_id: APP_ID,
    }));

    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error: insertErr } = await supabase.from('documents').insert(batch);
      if (insertErr) {
        console.error(`[Ingest] pgvector 저장 실패 (배치 ${i}):`, insertErr.message);
        throw new Error(`벡터 저장 실패: ${insertErr.message}`);
      }
    }

    console.log(`[Ingest] pgvector 저장 완료: ${rows.length}개 벡터`);

    return NextResponse.json({
      success: true,
      message: `"${fileName}" 업로드 및 벡터 인덱싱 완료. ${chunks.length}개 청크가 저장되었습니다.`,
      gcsUri,
      chunksCount: chunks.length,
    });

  } catch (err: any) {
    console.error('[Ingest Exception]', err);
    return NextResponse.json({ error: `업로드 실패: ${err.message}` }, { status: 500 });
  }
}
