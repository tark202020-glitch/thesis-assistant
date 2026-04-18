import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

const APP_ID = process.env.APP_ID || 'thesis_assistant';

// PATCH: 대화 제목 업데이트
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, conversation: data });
  } catch (err: any) {
    console.error('[Conversations] 제목 업데이트 실패:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
