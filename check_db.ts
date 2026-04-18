import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const APP_ID = process.env.APP_ID || 'thesis_assistant';

async function main() {
  console.log(`[CheckDB] APP_ID: ${APP_ID}`);

  const { data, error } = await supabase
      .from('documents')
      .select('source_file, gcs_uri, doc_type, created_at, app_id')
      .is('assistant_id', null)
      .eq('app_id', APP_ID)
      .order('created_at', { ascending: false });
      
  console.log(`Total rows fetched: ${data?.length}`);
  
  if (data) {
    const uniqueFiles = new Set(data.map(d => d.source_file));
    console.log(`Unique files:`, Array.from(uniqueFiles));
  }

  // 전체 app_id 분포 확인
  const { data: allData } = await supabase
      .from('documents')
      .select('app_id')
      .is('assistant_id', null);

  if (allData) {
    const appIdCounts: Record<string, number> = {};
    for (const d of allData) {
      const aid = d.app_id || 'null';
      appIdCounts[aid] = (appIdCounts[aid] || 0) + 1;
    }
    console.log(`\n[AppID 분포]`, appIdCounts);
  }
}
main();
