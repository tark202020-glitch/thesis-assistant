import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ status: 'Auth Failed', error: authError });
    }

    // 테스트 1: 대화 목록 조회
    const { data, error: dbError } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', user.id)
      .limit(1);

    if (dbError) {
      return NextResponse.json({ status: 'DB Read Failed', error: dbError, user_id: user.id });
    }

    // 테스트 2: 가짜 대화 생성 시도
    const { data: insertData, error: insertError } = await supabase
      .from('conversations')
      .insert({ title: 'Debug Test', user_id: user.id })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ status: 'DB Insert Failed', error: insertError, user_id: user.id });
    }

    // 생성된 가짜 대화 롤백(삭제)
    await supabase.from('conversations').delete().eq('id', insertData.id);

    return NextResponse.json({ status: 'All Good', user_id: user.id });
  } catch (err: any) {
    return NextResponse.json({ status: 'Exception', error: err.message });
  }
}
