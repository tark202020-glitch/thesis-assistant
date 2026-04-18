import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getStorage } from '@/lib/gcp-auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

const storage = getStorage();

const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'story_ai_helper';
const APP_ID = process.env.APP_ID || 'thesis_assistant';

// GET: 보조연구원 전용 문서 목록 (논문/자료 구분 포함)
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { data: assistant, error: fetchErr } = await supabase
      .from('assistants')
      .select('*')
      .eq('id', id)
      .eq('app_id', APP_ID)
      .single();

    if (fetchErr || !assistant) {
      return NextResponse.json({ error: '보조연구원을 찾을 수 없습니다.' }, { status: 404 });
    }

    const { data, error } = await supabase
      .from('documents')
      .select('source_file, gcs_uri, doc_type, created_at')
      .eq('assistant_id', id)
      .eq('app_id', APP_ID)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const groupedMap = new Map<string, any>();
    for (const row of (data || [])) {
      const key = row.source_file || row.gcs_uri;
      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          id: key,
          docName: '',
          source: row.source_file || '',
          gcsUri: row.gcs_uri || '',
          indexed: true,
          indexTime: row.created_at
            ? new Date(row.created_at).toLocaleString('ko-KR')
            : null,
          docType: row.doc_type || 'script',
          chunkCount: 1,
        });
      } else {
        groupedMap.get(key).chunkCount += 1;
      }
    }

    const docList = Array.from(groupedMap.values());

    if (assistant.gcs_folder) {
      try {
        const bucket = storage.bucket(BUCKET_NAME);
        const [files] = await bucket.getFiles({ prefix: `${assistant.gcs_folder}/` });

        for (const f of files) {
          if (f.name.endsWith('/') || f.name.endsWith('.keep')) continue;
          const fileName = f.name.split('/').pop() || f.name;
          const gcsUri = `gs://${BUCKET_NAME}/${f.name}`;

          const alreadyExists = docList.some(d => d.source === fileName);
          if (!alreadyExists) {
            const isRef = f.name.includes('/references/');
            docList.push({
              id: f.name,
              docName: '',
              source: fileName,
              gcsUri,
              indexed: false,
              indexTime: null,
              docType: isRef ? 'reference' : 'script',
              chunkCount: 0,
            });
          }
        }
      } catch (gcsErr: any) {
        console.error('[Assistant Docs] GCS 조회 실패:', gcsErr.message);
      }
    }

    return NextResponse.json({ documents: docList });
  } catch (err: any) {
    console.error('[Assistant Docs Exception]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE: 보조연구원 전용 문서 삭제
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { source, gcsUri } = await req.json();

    const results: string[] = [];

    if (source) {
      const { error: deleteErr, count } = await supabase
        .from('documents')
        .delete({ count: 'exact' })
        .eq('source_file', source)
        .eq('assistant_id', id)
        .eq('app_id', APP_ID);

      if (deleteErr) {
        console.error('[Assistant Docs] pgvector 삭제 실패:', deleteErr.message);
      } else {
        console.log(`[Assistant Docs] pgvector 삭제 완료: ${count}개 청크`);
        results.push(`벡터 DB에서 ${count}개 청크 삭제됨`);
      }
    }

    if (gcsUri) {
      try {
        const gcsPath = gcsUri.replace(`gs://${BUCKET_NAME}/`, '');
        const bucket = storage.bucket(BUCKET_NAME);
        const file = bucket.file(gcsPath);
        const [exists] = await file.exists();
        if (exists) {
          await file.delete();
          results.push('GCS 파일 삭제됨');
          console.log(`[Assistant Docs] GCS 삭제 완료: ${gcsPath}`);
        }
      } catch (gcsErr: any) {
        console.error('[Assistant Docs] GCS 삭제 실패:', gcsErr.message);
      }
    }

    return NextResponse.json({
      success: true,
      message: `"${source}" 삭제 완료. (${results.join(', ')})`,
    });
  } catch (err: any) {
    console.error('[Assistant Docs Exception]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
