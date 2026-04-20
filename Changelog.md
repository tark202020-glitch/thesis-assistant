# Thesis Assistant Changelog

## [Alpha V1.002] - 2026-04-20 15:51:25

### 🔄 Build Update
- **Summary**: 채팅 UI 연구원/교수님 모드 전환 토글 추가
- **Detail**:
  - ✅ 채팅 입력창 상단에 직관적인 모드 전환(연구원/교수님) 토글 UI 추가
  - ✅ 토글 변경 시 활성 Assistant 및 대화 ID 초기화 로직 구현 (데이터 꼬임 방지)
  - ✅ 다수의 교수님이 등록된 경우 토글 우측의 선택 드롭다운으로 변경 가능하게 확장
  - ✅ 교수님이 없을 시 교수님 모드 클릭 시 교수님 등록 사이드바 자동 오픈 지원
- **Build Time**: 2026-04-20 15:51:25
## [Alpha V1.001] - 2026-04-13

### 🔄 Build Update
- **Summary**: Thesis Assistant 프로젝트 초기 생성 (Genie Assistant 기반 포크)
- **Detail**:
  - ✅ Genie_Assistant 프로젝트 구조 기반으로 신규 프로젝트 생성
  - ✅ AI 시스템 프롬프트를 논문/학술 연구 도메인으로 전면 교체
  - ✅ 인텐트 라우터 재설계: analyze_paper, review_draft, compare_papers 등
  - ✅ UI 브랜딩 변경: Thesis Assistant 📝
  - ✅ 불필요 기능 제거: 캐릭터 관계도 (/character-graph)
  - ✅ 지식 그래프, RAG 벡터 검색, 보조 연구원 시스템 유지
  - ✅ 기존 Supabase/GCS 인프라 공유 설정
- **Build Time**: 2026-04-13
