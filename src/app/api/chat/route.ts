import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleGenerativeAIStream, StreamingTextResponse } from 'ai';
import { createClient } from '@supabase/supabase-js';
import { generateEmbedding } from '@/lib/embeddings';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

const APP_ID = process.env.APP_ID || 'thesis_assistant';

// pgvector 유사도 검색
async function searchByVector(
  query: string,
  assistantId?: string | null,
  docTypeFilter?: 'script' | 'reference' | 'all' | null,
  matchCount: number = 10
): Promise<string> {
  console.log(`[RAG] 벡터 검색 시작 | 쿼리: "${query}" | 보조연구원: ${assistantId || '없음'} | 필터: ${docTypeFilter || 'all'} | 검색수: ${matchCount} | 앱: ${APP_ID}`);

  try {
    const queryEmbedding = await generateEmbedding(query);

    // 레벨1 검색 (공유 지식 — assistant_id가 NULL인 문서)
    const { data: level1Results, error: l1Err } = await supabase.rpc('match_documents', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: 0.2,
      match_count: matchCount,
      filter_assistant_id: null,
      filter_doc_type: (docTypeFilter && docTypeFilter !== 'all') ? docTypeFilter : null,
      filter_app_id: APP_ID,
    });

    if (l1Err) console.error('[RAG] 레벨1 검색 오류:', l1Err.message);
    console.log(`[RAG] 레벨1 검색: ${level1Results?.length || 0}개 결과`);

    // 레벨2 검색 (보조연구원 전용 지식)
    let level2Results: any[] = [];
    let assistantName = '';
    if (assistantId) {
      const { data: assistant } = await supabase
        .from('assistants')
        .select('name')
        .eq('id', assistantId)
        .single();
      assistantName = assistant?.name || '';

      const { data: l2Data, error: l2Err } = await supabase.rpc('match_documents', {
        query_embedding: JSON.stringify(queryEmbedding),
        match_threshold: 0.2,
        match_count: matchCount,
        filter_assistant_id: assistantId,
        filter_doc_type: (docTypeFilter && docTypeFilter !== 'all') ? docTypeFilter : null,
        filter_app_id: APP_ID,
      });

      if (l2Err) console.error('[RAG] 레벨2 검색 오류:', l2Err.message);
      level2Results = l2Data || [];
      console.log(`[RAG] 레벨2 검색 (${assistantName}): ${level2Results.length}개 결과`);
    }

    // 결과 합치기 (레벨2 우선)
    const allContexts: string[] = [];

    for (const r of level2Results) {
      const label = `전문자료(${assistantName})`;
      allContexts.push(`[${label} - ${r.source_file}] (유사도: ${(r.similarity * 100).toFixed(1)}%)\n${r.content}`);
    }

    for (const r of (level1Results || [])) {
      allContexts.push(`[공유자료 - ${r.source_file}] (유사도: ${(r.similarity * 100).toFixed(1)}%)\n${r.content}`);
    }

    if (allContexts.length > 0) {
      return allContexts.join('\n---\n');
    }
    return '';

  } catch (err: any) {
    console.error('[RAG] 벡터 검색 실패:', err.message);
    return '';
  }
}

export const maxDuration = 300; // 대용량 논문 처리용

/**
 * 특정 source_file의 전체 청크를 순서대로 복원하여 풀텍스트 반환
 */
async function getFullDocumentText(sourceFile: string, assistantId?: string | null): Promise<string> {
  if (assistantId) {
    const { data, error } = await supabase
      .from('documents')
      .select('content')
      .eq('source_file', sourceFile)
      .eq('assistant_id', assistantId)
      .eq('app_id', APP_ID)
      .order('id', { ascending: true });

    if (!error && data && data.length > 0) {
      console.log(`[FullText] ${sourceFile}: ${data.length}개 청크 복원 (보조연구원)`);
      return data.map(d => d.content).join('\n');
    }
  }

  const { data, error } = await supabase
    .from('documents')
    .select('content')
    .eq('source_file', sourceFile)
    .is('assistant_id', null)
    .eq('app_id', APP_ID)
    .order('id', { ascending: true });

  if (error) {
    console.error(`[FullText] ${sourceFile} 조회 오류:`, error.message);
    return '';
  }

  if (!data || data.length === 0) return '';
  console.log(`[FullText] ${sourceFile}: ${data.length}개 청크 복원 (공유)`);
  return data.map(d => d.content).join('\n');
}

/**
 * 업로드된 문서 목록 조회
 */
async function listUploadedDocuments(assistantId?: string | null): Promise<{ assistantFiles: string[]; sharedFiles: string[] }> {
  const assistantFiles: string[] = [];
  const sharedFiles: string[] = [];

  if (assistantId) {
    const { data } = await supabase
      .from('documents')
      .select('source_file')
      .eq('assistant_id', assistantId)
      .eq('app_id', APP_ID)
      .order('source_file', { ascending: true });
    if (data) assistantFiles.push(...[...new Set(data.map(d => d.source_file))]);
  }

  const { data: sharedData } = await supabase
    .from('documents')
    .select('source_file')
    .is('assistant_id', null)
    .eq('app_id', APP_ID)
    .order('source_file', { ascending: true });
  if (sharedData) sharedFiles.push(...[...new Set(sharedData.map(d => d.source_file))]);

  return { assistantFiles, sharedFiles };
}

export async function POST(req: Request) {
  const { messages, assistantId } = await req.json();

  const lastUserMessage = messages.filter((m: any) => m.role === 'user').pop()?.content || '';

  // 보조연구원 정보 조회
  let assistantInfo: any = null;
  if (assistantId) {
    const { data } = await supabase
      .from('assistants')
      .select('*')
      .eq('id', assistantId)
      .single();
    assistantInfo = data;
  }

  // 인텐트(Intent) 라우팅 — 논문/학술 분석 분리
  const routerModel = genAI.getGenerativeModel({ 
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: "application/json" }
  });

  const { assistantFiles, sharedFiles } = await listUploadedDocuments(assistantId);
  const allFiles = [...assistantFiles, ...sharedFiles];
  let fileListStr = '';
  if (assistantId && assistantFiles.length > 0) {
    fileListStr = assistantFiles.join(', ');
  } else {
    fileListStr = allFiles.length > 0 ? allFiles.join(', ') : '없음';
  }

  const routerPrompt = `
  다음 사용자 메시지를 분석하여 6가지 카테고리 중 하나로 분류하세요.
  1. "conversation": 단순한 인사, 일상 대화, 격려 요청, 날씨 등 일반적인 잡담.
  2. "search": 특정 정보를 묻는 질문, 업로드된 문서에 대한 일반적 질문, 학술 자료 검색.
  3. "analyze_paper": 논문/학술 자료 하나에 대한 분석 요청. 예: 연구 방법론, 결과 분석, 논문 구조 평가, 문헌 리뷰.
  4. "analyze_reference": 참고자료에 대한 분석, 요약, 정리 요청.
  5. "review_draft": 사용자가 직접 작성한 논문 초안/섹션/아이디어를 메시지에 포함하여 피드백을 요청하는 경우.
  6. "compare_papers": 두 개 이상의 논문/자료를 비교하는 요청. 예: "A 논문과 B 논문 비교", "두 연구의 방법론 차이", "버전 비교" 등.

  중요 판별 규칙:
  - "비교", "차이점", "달라진", "변경사항", "vs", "VS", "대비" 키워드 → "compare_papers"
  - 두 문서를 언급하며 비교를 요청하면 → "compare_papers"
  - 단일 논문 분석(비교 아님) → "analyze_paper"
  - "자료", "논문", "배경", "참고" 키워드 → "analyze_reference"
  - 사용자가 직접 작성한 텍스트 평가/피드백 → "review_draft"
  
  현재 업로드된 문서 목록:
  ${fileListStr}
  
  compare_papers인 경우 비교할 파일명도 함께 반환하세요.
  ${assistantId ? '중요: 보조연구원이 활성화 상태입니다. 반드시 보조연구원 전용 문서 목록에서 파일을 선택하세요.' : ''}
  응답 형식은 반드시 다음과 같은 JSON 포맷이어야 합니다:
  {"intent": "...", "files": ["file1.pdf", "file2.pdf"]}
  files는 compare_papers일 때만 필수이며, 위 문서 목록에서 가장 유사한 파일명을 선택하세요.
  다른 인텐트에서는 files를 빈 배열([])로 반환하세요.
  
  사용자 메시지: "${lastUserMessage}"
  `;

  let intent = "conversation";
  let compareFiles: string[] = [];
  try {
    const routerResult = await routerModel.generateContent(routerPrompt);
    const routerResponseText = routerResult.response.text();
    const parsedIntent = JSON.parse(routerResponseText);
    if (["conversation", "search", "analyze_paper", "analyze_reference", "review_draft", "compare_papers"].includes(parsedIntent.intent)) {
      intent = parsedIntent.intent;
    }
    if (parsedIntent.files && Array.isArray(parsedIntent.files)) {
      compareFiles = parsedIntent.files;
    }
    console.log("[Intent Router] Classified as:", intent, compareFiles.length > 0 ? `| 비교 파일: ${compareFiles}` : '');
  } catch (error) {
    console.error("[Intent Router] Classification failed, fallback to search", error);
    intent = "search";
  }

  // 보조연구원 페르소나 기반 시스템 프롬프트 구성
  const assistantName = assistantInfo?.name || 'Thesis';
  const assistantPersona = assistantInfo?.persona || '';
  const assistantSpecialty = assistantInfo?.specialty || '';

  const markdownInstruction = `
답변은 반드시 Markdown 형식으로 작성하세요. 다음 규칙을 따르세요:
- 주요 주제는 ### 제목을 사용하세요.
- 핵심 키워드나 중요한 부분은 **볼드체**로 강조하세요.
- 항목을 나열할 때는 번호 목록(1. 2. 3.) 또는 bullet 목록(- 또는 *)을 사용하세요.
- 구분이 필요한 섹션 사이에는 --- 구분선을 사용하세요.
- 인용이 필요할 때는 > 인용 블록을 사용하세요.
- 학술 인용은 (저자, 연도) 형식으로 표시하세요.
`;

  let basePersona = '';
  if (assistantInfo) {
    basePersona = `당신은 "${assistantName}"이라는 전문 보조연구원입니다.
    전문 분야: ${assistantSpecialty}
    ${assistantPersona ? `페르소나: ${assistantPersona}` : ''}
    사용자의 질문에 당신의 전문 분야에 맞는 깊이 있는 학술적 답변을 제공해주세요.
    ${markdownInstruction}`;
  } else {
    basePersona = `당신은 논문 작성과 학술 연구를 돕는 'Thesis Assistant' 보조연구원입니다.
    전공 분야에 관계없이 학술 연구 방법론, 논문 구조, 문헌 리뷰, 통계 분석, 학술 글쓰기에 능통합니다.
    사용자의 연구를 체계적으로 지원하며, 학술적 엄밀성을 유지하면서도 이해하기 쉬운 설명을 제공합니다.
    ${markdownInstruction}`;
  }

  let targetModelName = 'gemini-2.5-flash';
  let systemPrompt = '';

  switch (intent) {
    case 'compare_papers': {
      // 논문 비교: 전체 텍스트 복원 후 비교
      console.log(`[Compare] 논문 비교 시작 | 파일: ${compareFiles.join(', ')}`);

      let validatedFiles = compareFiles;
      if (assistantId && assistantFiles.length > 0) {
        validatedFiles = compareFiles.filter(f => assistantFiles.includes(f));
      }

      let fullTexts: { name: string; text: string }[] = [];

      if (validatedFiles.length >= 2) {
        for (const fileName of validatedFiles.slice(0, 2)) {
          const text = await getFullDocumentText(fileName, assistantId);
          if (text) fullTexts.push({ name: fileName, text });
        }
      }

      if (fullTexts.length < 2) {
        const searchPool = assistantId && assistantFiles.length >= 2 ? assistantFiles : allFiles;
        fullTexts = [];
        for (const fileName of searchPool.slice(0, 2)) {
          const text = await getFullDocumentText(fileName, assistantId);
          if (text) fullTexts.push({ name: fileName, text });
        }
      }

      if (fullTexts.length < 2) {
        systemPrompt = `${basePersona}
        사용자가 논문/자료 비교를 요청했지만, 비교할 수 있는 문서가 2개 이상 업로드되어 있지 않습니다.
        현재 업로드된 문서: ${allFiles.join(', ') || '없음'}
        비교하려면 2개 이상의 논문/자료를 업로드해달라고 안내하세요.`;
      } else {
        console.log(`[Compare] 비교 대상: ${fullTexts[0].name} (${fullTexts[0].text.length}자) vs ${fullTexts[1].name} (${fullTexts[1].text.length}자)`);

        systemPrompt = `${basePersona}
        당신은 학술 논문 비교 분석 전문가입니다.
        아래 두 문서의 **전체 텍스트**가 제공됩니다. 처음부터 끝까지 꼼꼼히 읽고 비교 분석하세요.

        ## 비교 분석 지침
        1. **연구 목적 및 연구 질문 비교**: 각 논문의 핵심 연구 질문과 목적
        2. **이론적 프레임워크**: 적용된 이론, 개념적 토대의 차이
        3. **연구 방법론 비교**: 연구 설계, 데이터 수집 방법, 분석 기법
        4. **주요 발견 및 결과**: 핵심 결과의 유사점과 차이점
        5. **논의 및 시사점**: 해석의 차이, 실무적/이론적 기여도
        6. **한계점 및 후속 연구**: 각 연구의 한계와 향후 연구 방향
        7. 각 차이에 대해 **학술적 의미**를 해석하세요

        ## 출력 형식
        - 비교 항목별로 체계적으로 정리
        - 각 항목마다 두 논문의 내용을 인용하여 대비
        - 마지막에 종합 비교 요약 및 연구 갭(gap) 분석

        ---
        ## 📄 문서 A: ${fullTexts[0].name}
        ${fullTexts[0].text}

        ---
        ## 📄 문서 B: ${fullTexts[1].name}
        ${fullTexts[1].text}`;
      }

      targetModelName = 'gemini-2.5-flash';
      break;
    }

    case 'analyze_paper': {
      // 논문 분석: 전체 텍스트 복원
      let paperFullTexts: { name: string; text: string }[] = [];
      
      const paperPool = assistantId && assistantFiles.length > 0 ? assistantFiles : allFiles;
      for (const fileName of paperPool) {
        const text = await getFullDocumentText(fileName, assistantId);
        if (text) paperFullTexts.push({ name: fileName, text });
      }

      if (paperFullTexts.length > 0) {
        const allPaperText = paperFullTexts
          .map(s => `=== 📄 ${s.name} (${s.text.length}자) ===\n${s.text}`)
          .join('\n\n---\n\n');
        
        console.log(`[Analyze Paper] 전체 논문 ${paperFullTexts.length}개 로드 (총 ${allPaperText.length}자)`);

        systemPrompt = `${basePersona}
        당신은 학술 논문 분석 전문가입니다.
        사용자가 요청한 논문 분석을 수행하세요.
        
        중요: 아래에 논문의 **전체 텍스트**가 제공됩니다.
        처음부터 끝까지 꼼꼼히 읽고, 사용자의 질문에 맞는 정확한 분석을 제공하세요.
        
        분석 시 다음 관점들을 고려하세요:
        - 논문 구조 (서론/문헌리뷰/방법론/결과/논의/결론)
        - 연구 방법론 (연구 설계, 표본, 데이터 수집, 분석 기법)
        - 이론적 프레임워크 및 문헌 리뷰 평가
        - 연구 결과의 타당성 및 신뢰성
        - 논리적 흐름 및 논증 구조
        - 연구의 기여점 및 한계점
        - 인용 및 참고문헌의 적절성
        
        [전체 논문]
        ${allPaperText}`;
      } else {
        const paperContext = await searchByVector(lastUserMessage, assistantId, 'script', 20);
        systemPrompt = `${basePersona}
        사용자가 논문 분석을 요청했지만, 업로드된 논문을 찾을 수 없습니다.
        사용 가능한 참고 자료를 기반으로 최선의 답변을 제공하세요.

        [참고 자료]
        ${paperContext || '검색 결과 없음'}`;
      }

      targetModelName = 'gemini-2.5-flash';
      break;
    }

    case 'analyze_reference': {
      // 참고자료 분석: 전체 텍스트 복원
      let refFullTexts: { name: string; text: string }[] = [];
      
      if (assistantId) {
        const { data: refDocs } = await supabase
          .from('documents')
          .select('source_file')
          .eq('assistant_id', assistantId)
          .eq('doc_type', 'reference')
          .eq('app_id', APP_ID);
        const refFiles = [...new Set((refDocs || []).map(d => d.source_file))];
        
        for (const fileName of refFiles) {
          const text = await getFullDocumentText(fileName, assistantId);
          if (text) refFullTexts.push({ name: fileName, text });
        }
      }
      
      if (refFullTexts.length === 0) {
        for (const fileName of sharedFiles.slice(0, 5)) {
          const text = await getFullDocumentText(fileName, null);
          if (text) refFullTexts.push({ name: fileName, text });
        }
      }

      if (refFullTexts.length > 0) {
        const allRefText = refFullTexts
          .map(s => `=== 📚 ${s.name} (${s.text.length}자) ===\n${s.text}`)
          .join('\n\n---\n\n');

        console.log(`[Analyze Ref] 전체 자료 ${refFullTexts.length}개 로드 (총 ${allRefText.length}자)`);

        systemPrompt = `${basePersona}
        사용자가 업로드한 참고자료를 기반으로 답변하세요.
        
        중요: 아래에 참고자료의 **전체 텍스트**가 제공됩니다.
        처음부터 끝까지 읽고, 사용자의 질문에 정확히 답변하세요.
        
        참고자료 분석 시 다음을 수행하세요:
        - 자료의 핵심 내용을 정확히 파악하고 전달
        - 학술적 맥락에서의 의미를 해석
        - 필요시 요약, 정리, 비교 분석 수행
        - 자료의 출처와 맥락을 명시
        - 연구에 활용할 수 있는 시사점 도출

        [전체 참고 자료]
        ${allRefText}`;
      } else {
        const refContext = await searchByVector(lastUserMessage, assistantId, 'reference', 15);
        systemPrompt = `${basePersona}
        사용자가 자료 분석을 요청했지만, 업로드된 참고자료를 찾을 수 없습니다.
        사용 가능한 정보를 기반으로 최선의 답변을 제공하세요.

        [참고 자료]
        ${refContext || '검색 결과 없음'}`;
      }

      targetModelName = 'gemini-2.5-flash';
      break;
    }

    case 'review_draft':
      systemPrompt = `${basePersona}
      당신은 학술 글쓰기 전문 리뷰어입니다.
      사용자가 제공한 논문 초안, 섹션, 아이디어를 분석하여 건설적인 피드백을 제공하세요.
      
      다음 관점에서 리뷰하세요:
      1. **논리적 흐름**: 주장-근거-결론의 연결이 명확한지
      2. **학술적 글쓰기**: 학술 논문에 적합한 문체와 용어를 사용하는지
      3. **구조**: 섹션 구성이 체계적인지
      4. **인용**: 적절한 인용이 포함되어 있는지, 빠진 인용은 없는지
      5. **명확성**: 연구 질문, 가설, 방법론이 명확히 서술되었는지
      6. **개선 제안**: 구체적이고 실행 가능한 수정 방안 제시
      
      피드백은 체계적이되 격려적인 톤으로, 개선 방향을 구체적으로 제시하세요.`;
      break;

    case 'search': {
      const retrievedContext = await searchByVector(lastUserMessage, assistantId, 'all', 10);

      systemPrompt = `${basePersona}
      사용자의 질문에 대해 하단의 [참고 자료]를 바탕으로 정확히 답변해주세요.
      [참고 자료]에서 찾은 내용이 있다면 반드시 그것을 기반으로 답변하세요.
      [참고 자료]에 질문과 직접적으로 관련된 내용이 없다면, 그 사실을 언급하고 당신이 가진 학술적 지식으로 보충하세요.

      [참고 자료]
      ${retrievedContext ? retrievedContext : '검색 결과 없음'}`;
      break;
    }

    case 'conversation':
    default:
      systemPrompt = `${basePersona}
      사용자의 학술 연구 활동을 격려하고, 연구 과정에서의 어려움에 공감하며 조언과 정서적 지지를 제공하세요.
      필요시 연구 방법론, 학술 자원, 논문 작성 팁 등 실질적인 도움도 함께 제공하세요.`;
      break;
  }
  
  // Gemini startChat() 멀티턴 대화
  const model = genAI.getGenerativeModel({ 
    model: targetModelName,
    systemInstruction: systemPrompt,
  });

  const chatHistory = messages.slice(0, -1).map((m: any) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));

  const chat = model.startChat({ history: chatHistory });

  const response = await chat.sendMessageStream(lastUserMessage);
  const stream = GoogleGenerativeAIStream(response);

  return new StreamingTextResponse(stream);
}
