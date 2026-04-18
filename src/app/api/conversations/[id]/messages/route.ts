import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

const APP_ID = process.env.APP_ID || 'thesis_assistant';

// GET: 특정 대화의 메시지 목록
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    // 대화 소유권 확인
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('app_id', APP_ID)
      .eq('user_id', user.id)
      .single();

    if (convErr || !conv) {
      return NextResponse.json({ error: '대화를 찾을 수 없습니다.' }, { status: 404 });
    }

    const { data, error } = await supabase
      .from('messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return NextResponse.json({ messages: data || [] });
  } catch (err: any) {
    console.error('[Messages] 조회 실패:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: 메시지 저장
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { role, content } = await req.json();

    if (!role || !content) {
      return NextResponse.json({ error: 'role과 content가 필요합니다.' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: id,
        role,
        content,
      })
      .select()
      .single();

    if (error) throw error;

    // 대화 updated_at 갱신 (보안 검증 생략 가능하지만, 확실히 하기 위해 eq 추가해도 됨)
    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id);

    return NextResponse.json({ success: true, message: data });
  } catch (err: any) {
    console.error('[Messages] 저장 실패:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE: 특정 메시지 삭제
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { messageId } = await req.json();

    if (!messageId) {
      return NextResponse.json({ error: '삭제할 메시지 ID가 필요합니다.' }, { status: 400 });
    }

    // 대화 소유권 확인
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('app_id', APP_ID)
      .eq('user_id', user.id)
      .single();

    if (convErr || !conv) {
      return NextResponse.json({ error: '대화를 찾을 수 없습니다.' }, { status: 404 });
    }

    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId)
      .eq('conversation_id', id);

    if (error) throw error;

    console.log(`[Messages] 메시지 삭제: ${messageId} (대화: ${id})`);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[Messages] 삭제 실패:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
