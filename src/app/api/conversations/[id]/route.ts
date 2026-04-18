import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

const APP_ID = process.env.APP_ID || 'thesis_assistant';

// PATCH: 대화 제목 업데이트
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { title } = await req.json();

    if (!title) {
      return NextResponse.json({ error: '제목이 필요합니다.' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('conversations')
      .update({ title, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('app_id', APP_ID)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, conversation: data });
  } catch (err: any) {
    console.error('[Conversations] 제목 업데이트 실패:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
