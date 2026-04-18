import { Storage } from '@google-cloud/storage';

let _storage: Storage | null = null;

export function getStorage(): Storage {
  if (_storage) return _storage;

  // 1. 프로덕션 환경 (Vercel 등): Base64 환경변수 사용
  if (process.env.GCP_SERVICE_ACCOUNT_BASE64) {
    try {
      const decoded = Buffer.from(process.env.GCP_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8');
      const credentials = JSON.parse(decoded);
      _storage = new Storage({
        credentials,
        projectId: process.env.GCP_PROJECT_ID,
      });
      console.log('[GCP Config] Base64 환경변수로 Storage 초기화 완료');
    } catch (e: any) {
      console.error('[GCP Config Error] Base64 자격 증명 파싱 실패:', e.message);
      // fallback
      _storage = new Storage({ projectId: process.env.GCP_PROJECT_ID });
    }
  }
  // 2. 로컬 개발 환경: JSON 파일 사용
  else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    _storage = new Storage({
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      projectId: process.env.GCP_PROJECT_ID,
    });
    console.log('[GCP Config] 로컬 JSON 파일로 Storage 초기화 완료');
  }
  // 3. 그 외 (Cloud Run 기본 인증 등)
  else {
    _storage = new Storage({
      projectId: process.env.GCP_PROJECT_ID,
    });
    console.log('[GCP Config] 기본 인증으로 Storage 초기화 완료');
  }

  return _storage;
}
