import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

const APP_ID = process.env.APP_ID || 'thesis_assistant';

// GET: 대화 목록 조회
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, title, assistant_id, created_at, updated_at')
      .eq('app_id', APP_ID)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ conversations: data || [] });
  } catch (err: any) {
    console.error('[Conversations] 목록 조회 실패:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: 새 대화 생성
export async function POST(req: Request) {
  try {
    const { title, assistantId } = await req.json();

    const { data, error } = await supabase
      .from('conversations')
      .insert({
        title: title || '새 대화',
        assistant_id: assistantId || null,
        app_id: APP_ID,
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`[Conversations] 새 대화 생성: ${data.id} — "${data.title}"`);
    return NextResponse.json({ success: true, conversation: data });
  } catch (err: any) {
    console.error('[Conversations] 생성 실패:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE: 대화 삭제 (CASCADE로 메시지도 삭제)
export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();

    if (!id) {
      return NextResponse.json({ error: '삭제할 대화 ID가 필요합니다.' }, { status: 400 });
    }

    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', id)
      .eq('app_id', APP_ID);

    if (error) throw error;

    console.log(`[Conversations] 대화 삭제: ${id}`);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[Conversations] 삭제 실패:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
