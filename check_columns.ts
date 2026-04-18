import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTable() {
  console.log('=== 데이터베이스 테이블 구조 확인 ===');
  const { data, error } = await supabase.from('conversations').select('*').limit(1);
  if (error) {
    console.error('❌ 조회 에러 (아마도 컬럼 문제일 수 있습니다):', error.message);
  } else {
    if (data && data.length > 0) {
      console.log('✅ 구조 정상 확인! (컬럼:', Object.keys(data[0]).join(', '), ')');
    } else {
      console.log('✅ 에러 없음 (하지만 데이터가 비어있습니다)');
    }
  }
}

checkTable();
