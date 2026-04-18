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
const GCS_PREFIX = process.env.GCS_PATH_PREFIX || 'thesis_assistant';

// GET: 보조연구원 목록 조회
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('assistants')
      .select('*')
      .eq('app_id', APP_ID)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ assistants: data || [] });
  } catch (err: any) {
    console.error('[Assistants] 목록 조회 실패:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: 새 보조연구원 생성
export async function POST(req: Request) {
  try {
    const { name, specialty, persona } = await req.json();

    if (!name || !specialty) {
      return NextResponse.json({ error: '이름과 전문 분야는 필수입니다.' }, { status: 400 });
    }

    const { data: assistant, error: insertError } = await supabase
      .from('assistants')
      .insert({
        name,
        specialty,
        persona: persona || null,
        app_id: APP_ID,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    const assistantId = assistant.id;
    const gcsFolder = `${GCS_PREFIX}/assistants/${assistantId}`;

    console.log(`[Assistants] 보조연구원 생성: ${name} (${assistantId})`);

    try {
      const bucket = storage.bucket(BUCKET_NAME);
      await bucket.file(`${gcsFolder}/.keep`).save('');
      console.log(`[Assistants] GCS 폴더 생성: gs://${BUCKET_NAME}/${gcsFolder}/`);
    } catch (gcsErr: any) {
      console.error('[Assistants] GCS 폴더 생성 실패:', gcsErr.message);
    }

    const sharedDataStoreId = process.env.GCP_DATA_STORE_ID || '';

    await supabase
      .from('assistants')
      .update({
        data_store_id: sharedDataStoreId,
        gcs_folder: gcsFolder,
      })
      .eq('id', assistantId);

    return NextResponse.json({
      success: true,
      assistant: {
        ...assistant,
        data_store_id: sharedDataStoreId,
        gcs_folder: gcsFolder,
      },
      message: `보조연구원 "${name}" 생성 완료! 전용 폴더가 준비되었습니다.`,
    });
  } catch (err: any) {
    console.error('[Assistants Exception]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT: 보조연구원 정보 수정
export async function PUT(req: Request) {
  try {
    const { id, name, specialty, persona } = await req.json();

    if (!id || !name || !specialty) {
      return NextResponse.json({ error: 'ID, 이름, 전문 분야는 필수입니다.' }, { status: 400 });
    }

    const { data: assistant, error: updateError } = await supabase
      .from('assistants')
      .update({
        name,
        specialty,
        persona: persona || null,
      })
      .eq('id', id)
      .eq('app_id', APP_ID)
      .select()
      .single();

    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      assistant,
      message: `보조연구원 "${name}" 수정 완료!`,
    });
  } catch (err: any) {
    console.error('[Assistants Update Exception]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE: 보조연구원 삭제
export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();

    if (!id) {
      return NextResponse.json({ error: '삭제할 보조연구원 ID가 필요합니다.' }, { status: 400 });
    }

    const { data: assistant, error: fetchErr } = await supabase
      .from('assistants')
      .select('*')
      .eq('id', id)
      .eq('app_id', APP_ID)
      .single();

    if (fetchErr || !assistant) {
      return NextResponse.json({ error: '보조연구원을 찾을 수 없습니다.' }, { status: 404 });
    }

    console.log(`[Assistants] 보조연구원 삭제 시작: ${assistant.name} (${id})`);

    if (assistant.gcs_folder) {
      try {
        const bucket = storage.bucket(BUCKET_NAME);
        const [files] = await bucket.getFiles({ prefix: `${assistant.gcs_folder}/` });
        for (const file of files) {
          await file.delete();
        }
        console.log(`[Assistants] GCS 폴더 삭제 완료: ${assistant.gcs_folder}`);
      } catch (gcsErr: any) {
        console.error('[Assistants] GCS 폴더 삭제 실패:', gcsErr.message);
      }
    }

    const { error: deleteErr } = await supabase
      .from('assistants')
      .delete()
      .eq('id', id);

    if (deleteErr) throw deleteErr;

    return NextResponse.json({
      success: true,
      message: `보조연구원 "${assistant.name}" 삭제 완료.`,
    });
  } catch (err: any) {
    console.error('[Assistants Exception]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
