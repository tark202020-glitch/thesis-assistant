import { GoogleGenerativeAI } from '@google/generative-ai';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '');

// Google gemini-embedding-001 모델 (3072차원 → outputDimensionality: 768로 축소)
const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
const EMBEDDING_DIMENSIONS = 768;

// Rate Limit 재시도 지연 (ms)
async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 단일 텍스트의 임베딩 벡터 생성 (재시도 포함)
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await embeddingModel.embedContent({
        content: { role: 'user', parts: [{ text }] },
        outputDimensionality: EMBEDDING_DIMENSIONS,
      } as any);
      return result.embedding.values;
    } catch (err: any) {
      if (err.status === 429 && attempt < 2) {
        const waitTime = (attempt + 1) * 5000;
        console.log(`[Embedding] Rate Limit — ${waitTime / 1000}초 대기 후 재시도...`);
        await sleep(waitTime);
      } else {
        throw err;
      }
    }
  }
  throw new Error('임베딩 생성 실패: 최대 재시도 초과');
}

/**
 * 여러 텍스트의 임베딩 벡터를 순차 생성 (Rate Limit 방지)
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i++) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await embeddingModel.embedContent({
          content: { role: 'user', parts: [{ text: texts[i] }] },
          outputDimensionality: EMBEDDING_DIMENSIONS,
        } as any);
        embeddings.push(result.embedding.values);
        break;
      } catch (err: any) {
        if (err.status === 429 && attempt < 2) {
          const waitTime = (attempt + 1) * 5000;
          console.log(`[Embedding] Rate Limit (${i + 1}/${texts.length}) — ${waitTime / 1000}초 대기 후 재시도...`);
          await sleep(waitTime);
        } else {
          throw err;
        }
      }
    }

    // 매 3개마다 1초 대기 (Rate Limit 예방)
    if ((i + 1) % 3 === 0 && i < texts.length - 1) {
      await sleep(1000);
    }

    // 진행 상황 로그 (10개마다)
    if ((i + 1) % 10 === 0) {
      console.log(`[Embedding] 진행: ${i + 1}/${texts.length}`);
    }
  }
  return embeddings;
}

/**
 * 텍스트를 청크로 분할
 */
export async function splitTextIntoChunks(
  text: string,
  chunkSize: number = 800,
  chunkOverlap: number = 200
): Promise<string[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators: ['\n\n', '\n', '。', '.', '!', '?', ';', ',', ' ', ''],
  });

  const docs = await splitter.createDocuments([text]);
  return docs.map(doc => doc.pageContent);
}

/**
 * PostgreSQL에서 허용하지 않는 유니코드 문자를 제거/치환
 * - \u0000 (null 문자): PostgreSQL text 타입에서 허용 안됨
 * - 잘못된 서로게이트 쌍 (orphaned surrogates)
 * - 기타 비표준 제어 문자
 */
function sanitizeTextForPostgres(text: string): string {
  return text
    // 1. null 문자 제거 (PostgreSQL에서 가장 흔한 오류 원인)
    .replace(/\u0000/g, '')
    // 2. 잘못된 유니코드 이스케이프 시퀀스 제거 (서로게이트 쌍)
    .replace(/[\uD800-\uDFFF]/g, '')
    // 3. 기타 제어 문자 제거 (탭, 줄바꿈, 캐리지 리턴은 유지)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // 4. 백슬래시 뒤에 u가 오는 리터럴 이스케이프 시퀀스 처리
    .replace(/\\u[0-9a-fA-F]{0,3}(?![0-9a-fA-F])/g, '')
    .replace(/\\u0000/g, '');
}

/**
 * 파일 Buffer에서 텍스트 추출
 */
export async function extractTextFromBuffer(
  buffer: Buffer,
  fileName: string
): Promise<string> {
  const ext = fileName.toLowerCase().split('.').pop();

  let text: string;
  if (ext === 'pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const pdfData = await pdfParse(buffer);
    text = pdfData.text;
  } else {
    text = buffer.toString('utf-8');
  }

  // PostgreSQL 호환을 위한 텍스트 정리
  const sanitized = sanitizeTextForPostgres(text);
  console.log(`[Ingest] 텍스트 정리 완료: ${text.length}자 → ${sanitized.length}자 (${text.length - sanitized.length}자 제거)`);
  return sanitized;
}
