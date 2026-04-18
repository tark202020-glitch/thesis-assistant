'use client';

import { useChat } from 'ai/react';
import { useEffect, useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { logout } from './login/actions';
import { createClient } from '@/utils/supabase/client';

// ===================== TYPES =====================
interface LearnedDocument {
  id: string;
  docName: string;
  source: string;
  gcsUri: string;
  indexed: boolean;
  indexTime: string | null;
  docType?: 'script' | 'reference';
}

type DocType = 'script' | 'reference';

interface Assistant {
  id: string;
  name: string;
  specialty: string;
  persona: string | null;
  data_store_id: string | null;
  gcs_folder: string | null;
  created_at: string;
}

interface Conversation {
  id: string;
  title: string;
  assistant_id: string | null;
  created_at: string;
  updated_at: string;
}

interface DBMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

type UploadStep = 'idle' | 'uploading-gcs' | 'importing-ai' | 'complete' | 'error';
type SidebarTab = 'conversations' | 'shared' | 'assistants';

// ===================== MAIN =====================
export default function Home() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserEmail(user.email ?? '연구자');
    });
  }, [supabase]);

  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null);

  // ---- 대화 기록 ----
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const activeConvIdRef = useRef<string | null>(null);
  useEffect(() => { activeConvIdRef.current = activeConversationId; }, [activeConversationId]);

  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [dbMessageMap, setDbMessageMap] = useState<Map<string, string>>(new Map()); // chatMsgId → dbMsgId

  const { messages, input, handleInputChange, handleSubmit: originalHandleSubmit, isLoading, setMessages } = useChat({
    body: { assistantId: activeAssistantId },
    onFinish: async (message) => {
      const currentConvId = activeConvIdRef.current;
      // assistant 응답 완료 후 DB에 저장
      if (currentConvId && message.content) {
        try {
          const res = await fetch(`/api/conversations/${currentConvId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'assistant', content: message.content }),
          });
          const data = await res.json();
          if (data.success && data.message) {
            setDbMessageMap(prev => {
              const next = new Map(prev);
              next.set(message.id, data.message.id);
              return next;
            });
          }
        } catch (e) {
          console.error('Assistant 메시지 저장 실패:', e);
        }
      }
    },
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const assistantFileInputRef = useRef<HTMLInputElement>(null);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('conversations');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversationFilter, setConversationFilter] = useState<'all' | 'shared' | 'assistant'>('all');

  // ---- 레벨1: 공유 학술자료 ----
  const [files, setFiles] = useState<File[]>([]);
  const [uploadStep, setUploadStep] = useState<UploadStep>('idle');
  const [uploadMessage, setUploadMessage] = useState('');
  const [documents, setDocuments] = useState<LearnedDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [deleteStep, setDeleteStep] = useState<'idle' | 'deleting' | 'complete' | 'error'>('idle');
  const [deleteMessage, setDeleteMessage] = useState('');
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);

  // ---- 레벨2: 보조연구원 ----
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [loadingAssistants, setLoadingAssistants] = useState(false);
  const [selectedAssistant, setSelectedAssistant] = useState<Assistant | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSpecialty, setNewSpecialty] = useState('');
  const [newPersona, setNewPersona] = useState('');
  const [creating, setCreating] = useState(false);
  const [assistantDocs, setAssistantDocs] = useState<LearnedDocument[]>([]);
  const [loadingAssistantDocs, setLoadingAssistantDocs] = useState(false);
  const [assistantFiles, setAssistantFiles] = useState<File[]>([]);
  const [assistantUploadStep, setAssistantUploadStep] = useState<UploadStep>('idle');
  const [assistantUploadMessage, setAssistantUploadMessage] = useState('');
  const [assistantDocType, setAssistantDocType] = useState<DocType>('script');

  // ===================== 대화 기록 함수들 =====================
  const fetchConversations = useCallback(async () => {
    setLoadingConversations(true);
    try {
      const res = await fetch('/api/conversations');
      const data = await res.json();
      if (data.conversations) setConversations(data.conversations);
    } catch (e) { console.error('대화 목록 조회 실패:', e); }
    finally { setLoadingConversations(false); }
  }, []);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  const loadConversationMessages = useCallback(async (conversationId: string) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`);
      const data = await res.json();
      if (data.messages) {
        const loaded = data.messages.map((m: DBMessage) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: new Date(m.created_at),
        }));
        setMessages(loaded);
        // DB ID 매핑 구축
        const map = new Map<string, string>();
        for (const m of data.messages) {
          map.set(m.id, m.id);
        }
        setDbMessageMap(map);
      }
    } catch (e) { console.error('메시지 로드 실패:', e); }
    finally { setLoadingMessages(false); }
  }, [setMessages]);

  const handleNewConversation = async () => {
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '새 대화', assistantId: activeAssistantId }),
      });
      const data = await res.json();
      if (data.success && data.conversation) {
        setActiveConversationId(data.conversation.id);
        setMessages([]);
        setDbMessageMap(new Map());
        fetchConversations();
      }
    } catch (e) { console.error('대화 생성 실패:', e); }
  };

  const handleSelectConversation = async (conv: Conversation) => {
    if (conv.id === activeConversationId) return;
    setActiveConversationId(conv.id);
    setActiveAssistantId(conv.assistant_id || null);
    await loadConversationMessages(conv.id);
  };

  const handleDeleteConversation = async (convId: string) => {
    if (!confirm('이 대화를 삭제하시겠습니까?')) return;
    try {
      const res = await fetch('/api/conversations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: convId }),
      });
      const data = await res.json();
      if (data.success) {
        if (activeConversationId === convId) {
          setActiveConversationId(null);
          setMessages([]);
          setDbMessageMap(new Map());
        }
        fetchConversations();
      }
    } catch (e) { console.error('대화 삭제 실패:', e); }
  };

  const handleDeleteMessage = async (chatMsgId: string) => {
    if (!activeConversationId) return;
    const dbMsgId = dbMessageMap.get(chatMsgId) || chatMsgId;
    try {
      const res = await fetch(`/api/conversations/${activeConversationId}/messages`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: dbMsgId }),
      });
      const data = await res.json();
      if (data.success) {
        setMessages(messages.filter(m => m.id !== chatMsgId));
        setDbMessageMap(prev => {
          const next = new Map(prev);
          next.delete(chatMsgId);
          return next;
        });
      }
    } catch (e) { console.error('메시지 삭제 실패:', e); }
  };

  // 커스텀 submit: user 메시지를 먼저 DB에 저장하고 대화 제목 자동 생성
  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    let convId = activeConversationId;

    // 대화가 없으면 자동 생성
    if (!convId) {
      try {
        const res = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: input.slice(0, 30) + (input.length > 30 ? '...' : ''), assistantId: activeAssistantId }),
        });
        const data = await res.json();
        if (data.success && data.conversation) {
          convId = data.conversation.id;
          setActiveConversationId(convId);
          activeConvIdRef.current = convId; // 즉시 ref 업데이트
          fetchConversations();
        }
      } catch (err) {
        console.error('대화 자동 생성 실패:', err);
      }
    }

    // user 메시지 DB 저장
    if (convId) {
      try {
        const res = await fetch(`/api/conversations/${convId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'user', content: input }),
        });
        const data = await res.json();
        // 첫 메시지일 때 대화 제목 업데이트
        if (data.success && messages.length === 0) {
          const titleText = input.slice(0, 30) + (input.length > 30 ? '...' : '');
          fetch(`/api/conversations/${convId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: titleText }),
          }).then(() => fetchConversations());
        }
        // user 메시지의 DB ID를 저장하기 위해, onFinish와 함께 처리
        // useChat이 메시지 ID를 자체 생성하므로 이 시점에서 매핑은 어려움
        // → 대화 전환 시 DB에서 재로드하여 동기화
      } catch (err) {
        console.error('User 메시지 저장 실패:', err);
      }
    }

    // 실제 AI 호출
    originalHandleSubmit(e);
  };

  // ===================== 레벨1 함수들 =====================
  const fetchDocuments = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      if (data.documents) setDocuments(data.documents);
    } catch (e) { console.error('문서 목록 조회 실패:', e); }
    finally { setLoadingDocs(false); }
  }, []);

  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

  const handleDeleteDocument = async (doc: LearnedDocument) => {
    if (!confirm(`"${doc.source}" 문서를 삭제하시겠습니까?`)) return;
    setDeletingDocId(doc.id || doc.source);
    setDeleteStep('deleting');
    setDeleteMessage('삭제 처리 중...');
    try {
      const res = await fetch('/api/documents', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: doc.source, gcsUri: doc.gcsUri, docName: doc.docName }),
      });
      const data = await res.json();
      if (data.success) {
        setDeleteStep('complete');
        setDeleteMessage(`"${doc.source}" 삭제 완료!`);
        fetchDocuments();
        setTimeout(() => { setDeleteStep('idle'); setDeleteMessage(''); setDeletingDocId(null); }, 3000);
      } else {
        setDeleteStep('error');
        setDeleteMessage(`삭제 실패: ${data.error}`);
        setTimeout(() => { setDeleteStep('idle'); setDeleteMessage(''); setDeletingDocId(null); }, 5000);
      }
    } catch (e) {
      setDeleteStep('error');
      setDeleteMessage('삭제 중 오류 발생');
      setTimeout(() => { setDeleteStep('idle'); setDeleteMessage(''); setDeletingDocId(null); }, 5000);
    }
  };

  const handleFileUpload = async () => {
    if (files.length === 0) return;
    const total = files.length;
    let successCount = 0;
    let failCount = 0;
    const failedNames: string[] = [];

    for (let i = 0; i < total; i++) {
      const currentFile = files[i];
      setUploadStep('uploading-gcs');
      setUploadMessage(`(${i + 1}/${total}) "${currentFile.name}" 저장소에 업로드 중...`);
      try {
        const formData = new FormData();
        formData.append('file', currentFile);
        const res = await fetch('/api/ingest', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
          setUploadStep('importing-ai');
          setUploadMessage(`(${i + 1}/${total}) "${currentFile.name}" 인덱싱 중...`);
          successCount++;
        } else {
          failCount++;
          failedNames.push(currentFile.name);
        }
      } catch (e) {
        failCount++;
        failedNames.push(currentFile.name);
      }
    }

    if (failCount === 0) {
      setUploadStep('complete');
      setUploadMessage(`✅ ${successCount}개 파일 학습 등록 완료!`);
    } else {
      setUploadStep(successCount > 0 ? 'complete' : 'error');
      setUploadMessage(`${successCount}개 성공, ${failCount}개 실패 (${failedNames.join(', ')})`);
    }
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    fetchDocuments();
    setTimeout(() => { setUploadStep('idle'); setUploadMessage(''); }, 5000);
  };

  // ===================== 레벨2 함수들 =====================
  const fetchAssistants = useCallback(async () => {
    setLoadingAssistants(true);
    try {
      const res = await fetch('/api/assistants');
      const data = await res.json();
      if (data.assistants) setAssistants(data.assistants);
    } catch (e) { console.error('보조연구원 목록 조회 실패:', e); }
    finally { setLoadingAssistants(false); }
  }, []);

  useEffect(() => { fetchAssistants(); }, [fetchAssistants]);

  const fetchAssistantDocs = useCallback(async (assistantId: string) => {
    setLoadingAssistantDocs(true);
    try {
      const res = await fetch(`/api/assistants/${assistantId}/documents`);
      const data = await res.json();
      if (data.documents) setAssistantDocs(data.documents);
    } catch (e) { console.error('보조연구원 문서 조회 실패:', e); }
    finally { setLoadingAssistantDocs(false); }
  }, []);

  const handleCreateAssistant = async () => {
    if (!newName || !newSpecialty) return;
    setCreating(true);
    try {
      const res = await fetch('/api/assistants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, specialty: newSpecialty, persona: newPersona || null }),
      });
      const data = await res.json();
      if (data.success) {
        setNewName(''); setNewSpecialty(''); setNewPersona('');
        setShowCreateForm(false);
        fetchAssistants();
      } else { alert(`생성 실패: ${data.error}`); }
    } catch (e) { alert('보조연구원 생성 중 오류 발생'); }
    finally { setCreating(false); }
  };

  const handleDeleteAssistant = async (id: string, name: string) => {
    if (!confirm(`"${name}" 보조연구원을 삭제하시겠습니까?\n\n전용 데이터와 학습자료도 함께 삭제됩니다.`)) return;
    try {
      const res = await fetch('/api/assistants', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (data.success) {
        if (activeAssistantId === id) setActiveAssistantId(null);
        if (selectedAssistant?.id === id) setSelectedAssistant(null);
        fetchAssistants();
      } else { alert(`삭제 실패: ${data.error}`); }
    } catch (e) { alert('보조연구원 삭제 중 오류 발생'); }
  };

  const handleAssistantFileUpload = async () => {
    if (assistantFiles.length === 0 || !selectedAssistant) return;
    const total = assistantFiles.length;
    const typeLabel = assistantDocType === 'reference' ? '참고자료' : '논문';
    let successCount = 0;
    let failCount = 0;
    const failedNames: string[] = [];

    for (let i = 0; i < total; i++) {
      const currentFile = assistantFiles[i];
      setAssistantUploadStep('uploading-gcs');
      setAssistantUploadMessage(`(${i + 1}/${total}) "${currentFile.name}" ${typeLabel} 저장소에 업로드 중...`);
      try {
        const formData = new FormData();
        formData.append('file', currentFile);
        formData.append('docType', assistantDocType);
        const res = await fetch(`/api/assistants/${selectedAssistant.id}/ingest`, { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
          setAssistantUploadStep('importing-ai');
          setAssistantUploadMessage(`(${i + 1}/${total}) "${currentFile.name}" ${typeLabel} 인덱싱 중...`);
          successCount++;
        } else { failCount++; failedNames.push(currentFile.name); }
      } catch (e) { failCount++; failedNames.push(currentFile.name); }
    }

    if (failCount === 0) {
      setAssistantUploadStep('complete');
      setAssistantUploadMessage(`✅ ${successCount}개 ${typeLabel} 학습 등록 완료!`);
    } else {
      setAssistantUploadStep(successCount > 0 ? 'complete' : 'error');
      setAssistantUploadMessage(`${successCount}개 성공, ${failCount}개 실패 (${failedNames.join(', ')})`);
    }
    setAssistantFiles([]);
    if (assistantFileInputRef.current) assistantFileInputRef.current.value = '';
    fetchAssistantDocs(selectedAssistant.id);
    setTimeout(() => { setAssistantUploadStep('idle'); setAssistantUploadMessage(''); }, 5000);
  };

  const handleDeleteAssistantDoc = async (doc: LearnedDocument) => {
    if (!selectedAssistant || !confirm(`"${doc.source}" 문서를 삭제하시겠습니까?`)) return;
    try {
      const res = await fetch(`/api/assistants/${selectedAssistant.id}/documents`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: doc.source, gcsUri: doc.gcsUri, docName: doc.docName }),
      });
      const data = await res.json();
      if (data.success) { fetchAssistantDocs(selectedAssistant.id); }
      else { alert(`삭제 실패: ${data.error}`); }
    } catch (e) { alert('문서 삭제 중 오류 발생'); }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ===================== 프로그레스 바 =====================
  const renderProgress = (step: UploadStep, message: string, onClose?: () => void) => {
    if (step === 'idle') return null;
    const steps = [
      { key: 'uploading-gcs', label: '저장소', icon: '☁️' },
      { key: 'importing-ai', label: '인덱싱', icon: '🤖' },
      { key: 'complete', label: '완료', icon: '✅' },
    ];
    return (
      <div className="mx-3 mb-2 p-2.5 rounded-lg bg-background/80 border border-border">
        <div className="flex items-center gap-1 mb-1.5">
          {steps.map((s, i) => {
            const isActive = s.key === step;
            const isPast = steps.findIndex(x => x.key === step) > i;
            const isErr = step === 'error';
            return (
              <div key={s.key} className="flex items-center gap-0.5">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  isPast ? 'bg-emerald-500 text-white' : isActive && !isErr ? 'bg-sky-500 text-white animate-pulse' : isErr && isActive ? 'bg-red-500 text-white' : 'bg-muted text-muted-foreground'
                }`}>{isPast ? '✓' : s.icon}</div>
                <span className={`text-[10px] ${isActive ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{s.label}</span>
                {i < steps.length - 1 && <div className={`w-3 h-0.5 ${isPast ? 'bg-emerald-500' : 'bg-muted'}`} />}
              </div>
            );
          })}
        </div>
        <p className={`text-xs ${step === 'error' ? 'text-red-400' : step === 'complete' ? 'text-emerald-400' : 'text-muted-foreground'}`}>{message}</p>
        {step === 'error' && onClose && <button onClick={onClose} className="mt-1 text-xs text-sky-400 hover:underline">닫기</button>}
      </div>
    );
  };

  const activeAssistant = assistants.find(a => a.id === activeAssistantId) || null;

  // 대화 날짜 포맷팅
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '방금 전';
    if (diffMins < 60) return `${diffMins}분 전`;
    if (diffHours < 24) return `${diffHours}시간 전`;
    if (diffDays < 7) return `${diffDays}일 전`;
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="flex h-screen bg-background">
      {/* ===== 좌측 사이드바 ===== */}
      <aside className={`${sidebarOpen ? 'w-80' : 'w-0'} transition-all duration-300 overflow-hidden border-r border-border flex-shrink-0`}>
        <div className="w-80 h-full flex flex-col bg-muted/20">
          <div className="flex border-b border-border">
            <button
              onClick={() => setSidebarTab('conversations')}
              className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${
                sidebarTab === 'conversations' ? 'text-foreground border-b-2 border-primary bg-background/50' : 'text-muted-foreground hover:text-foreground'
              }`}
            >💬 대화</button>
            <button
              onClick={() => setSidebarTab('shared')}
              className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${
                sidebarTab === 'shared' ? 'text-foreground border-b-2 border-primary bg-background/50' : 'text-muted-foreground hover:text-foreground'
              }`}
            >📖 연구원</button>
            <button
              onClick={() => setSidebarTab('assistants')}
              className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${
                sidebarTab === 'assistants' ? 'text-foreground border-b-2 border-primary bg-background/50' : 'text-muted-foreground hover:text-foreground'
              }`}
            >🎓 교수님
              {assistants.length > 0 && (
                <span className="ml-1 bg-sky-500/20 text-sky-400 text-xs px-1.5 py-0.5 rounded-full">{assistants.length}</span>
              )}
            </button>
            <button onClick={() => setSidebarOpen(false)} className="px-2 text-muted-foreground hover:text-foreground">✕</button>
          </div>

          {/* ===== 탭0: 대화 기록 ===== */}
          {sidebarTab === 'conversations' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-3 border-b border-border">
                <button onClick={handleNewConversation}
                  className="w-full py-2.5 rounded-lg font-bold text-sm bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-500 hover:to-purple-500 hover:shadow-lg hover:shadow-violet-500/25 active:scale-[0.98] transition-all flex items-center justify-center gap-2 mb-3"
                >✨ 새 대화</button>
                <div className="flex bg-muted rounded-lg p-1">
                  <button onClick={() => setConversationFilter('all')} className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-all ${conversationFilter === 'all' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>전체</button>
                  <button onClick={() => setConversationFilter('shared')} className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-all ${conversationFilter === 'shared' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>📖 연구원</button>
                  <button onClick={() => setConversationFilter('assistant')} className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-all ${conversationFilter === 'assistant' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>🎓 교수님</button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {loadingConversations ? (
                  <div className="p-6 text-center text-sm text-muted-foreground animate-pulse">대화 목록 로딩 중...</div>
                ) : conversations.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground text-sm">
                    <p>아직 대화 기록이 없습니다.</p>
                    <p className="text-xs mt-1 opacity-60">새 대화를 시작하거나 바로 메시지를 보내보세요.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 p-2">
                    {(conversationFilter === 'all' || conversationFilter === 'shared') && conversations.filter(c => !c.assistant_id).length > 0 && (
                      <div>
                        <div className="px-2 pb-1.5 text-xs font-bold text-muted-foreground flex items-center gap-1.5">
                          <span>📖</span> 연구원 대화 기록
                        </div>
                        <div className="divide-y divide-border/50 border border-border/30 rounded-lg overflow-hidden bg-background shadow-sm">
                          {conversations.filter(c => !c.assistant_id).map((conv) => (
                            <div
                              key={conv.id}
                              onClick={() => handleSelectConversation(conv)}
                              className={`px-3 py-3 cursor-pointer transition-all group hover:bg-muted/50 ${
                                activeConversationId === conv.id ? 'bg-violet-500/10 border-l-2 border-violet-500' : ''
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-foreground truncate">
                                    💬 {conv.title}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground mt-0.5">
                                    {formatDate(conv.updated_at)}
                                  </p>
                                </div>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conv.id); }}
                                  className="opacity-0 group-hover:opacity-100 text-xs text-red-400 hover:bg-red-500/10 px-2 py-1 rounded transition-all shrink-0"
                                >🗑️</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {(conversationFilter === 'all' || conversationFilter === 'assistant') && conversations.filter(c => c.assistant_id).length > 0 && (
                      <div>
                        <div className="px-2 pb-1.5 text-xs font-bold text-muted-foreground flex items-center gap-1.5">
                          <span>🎓</span> 교수님 대화 기록
                        </div>
                        <div className="divide-y divide-border/50 border border-border/30 rounded-lg overflow-hidden bg-background shadow-sm">
                          {conversations.filter(c => c.assistant_id).map((conv) => (
                            <div
                              key={conv.id}
                              onClick={() => handleSelectConversation(conv)}
                              className={`px-3 py-3 cursor-pointer transition-all group hover:bg-muted/50 ${
                                activeConversationId === conv.id ? 'bg-sky-500/10 border-l-2 border-sky-500' : ''
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-foreground truncate">
                                    💬 {conv.title}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground mt-0.5">
                                    {formatDate(conv.updated_at)}
                                    <span className="ml-1.5 bg-sky-500/15 text-sky-400 px-1 py-0.5 rounded text-[9px]">
                                      {assistants.find(a => a.id === conv.assistant_id)?.name || '교수님'}
                                    </span>
                                  </p>
                                </div>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conv.id); }}
                                  className="opacity-0 group-hover:opacity-100 text-xs text-red-400 hover:bg-red-500/10 px-2 py-1 rounded transition-all shrink-0"
                                >🗑️</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="p-2 border-t border-border text-center">
                <button onClick={fetchConversations} disabled={loadingConversations} className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">🔄 새로고침</button>
              </div>
            </div>
          )}

          {/* ===== 탭1: 연구원 (논문 분석/요약) ===== */}
          {sidebarTab === 'shared' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-3 border-b border-border bg-background/50">
                <input ref={fileInputRef} type="file" accept=".txt,.pdf" multiple onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
                  className="w-full text-xs text-muted-foreground file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-muted file:text-foreground hover:file:bg-muted/80 file:cursor-pointer mb-2"
                />
                {files.length > 0 && (
                  <p className="text-xs text-muted-foreground mb-1.5">📎 {files.length}개 파일 선택됨: {files.map(f => f.name).join(', ')}</p>
                )}
                <button onClick={handleFileUpload} disabled={files.length === 0 || uploadStep !== 'idle'}
                  className="w-full py-2.5 rounded-lg font-bold text-sm bg-gradient-to-r from-sky-600 to-teal-600 text-white hover:from-sky-500 hover:to-teal-500 hover:shadow-lg hover:shadow-sky-500/25 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >{uploadStep !== 'idle' && uploadStep !== 'error' ? '⏳ 학습 진행 중...' : '🚀 학습하기'}</button>
              </div>
              {renderProgress(uploadStep, uploadMessage, () => { setUploadStep('idle'); setUploadMessage(''); })}
              {deleteStep !== 'idle' && (
                <div className="mx-3 mb-2 p-2 rounded-lg bg-background/80 border border-border">
                  <p className={`text-xs ${deleteStep === 'error' ? 'text-red-400' : deleteStep === 'complete' ? 'text-emerald-400' : 'text-muted-foreground animate-pulse'}`}>{deleteMessage}</p>
                </div>
              )}
              <div className="flex-1 overflow-y-auto">
                {loadingDocs ? (
                  <div className="p-6 text-center text-sm text-muted-foreground animate-pulse">문서 목록 로딩 중...</div>
                ) : documents.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground text-sm">등록된 논문이 없습니다.</div>
                ) : (
                  <div className="divide-y divide-border/50">
                    {documents.map((doc) => (
                      <div key={doc.id || doc.source} className={`px-3 py-3 hover:bg-muted/50 transition-all group ${deletingDocId === (doc.id || doc.source) ? 'opacity-50' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">📄 {doc.source}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{doc.indexed ? '✅ 인덱싱 완료' : '⏳ 대기 중'}{doc.indexTime ? ` · ${doc.indexTime}` : ''}</p>
                          </div>
                          <button onClick={() => handleDeleteDocument(doc)} className="opacity-0 group-hover:opacity-100 text-xs text-red-400 hover:bg-red-500/10 px-2 py-1 rounded transition-all">🗑️</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="p-2 border-t border-border text-center">
                <button onClick={fetchDocuments} disabled={loadingDocs} className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">🔄 새로고침</button>
              </div>
            </div>
          )}

          {/* ===== 탭2: 교수님 (논문 조언) ===== */}
          {sidebarTab === 'assistants' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {!showCreateForm && !selectedAssistant && (
                <div className="p-3 border-b border-border">
                  <button onClick={() => setShowCreateForm(true)}
                    className="w-full py-2.5 rounded-lg font-bold text-sm bg-gradient-to-r from-sky-600 to-cyan-600 text-white hover:from-sky-500 hover:to-cyan-500 hover:shadow-lg hover:shadow-sky-500/25 active:scale-[0.98] transition-all"
                  >✨ 새 교수님 만들기</button>
                </div>
              )}

              {showCreateForm && (
                <div className="p-3 border-b border-border bg-background/50 space-y-2">
                  <h3 className="text-sm font-bold text-foreground">🎓 교수님 생성</h3>
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="이름 (예: 김교수님)" 
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:ring-2 focus:ring-sky-500 focus:outline-none" />
                  <input value={newSpecialty} onChange={(e) => setNewSpecialty(e.target.value)} placeholder="전문 분야 (예: 한국어 정보구조)" 
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:ring-2 focus:ring-sky-500 focus:outline-none" />
                  <textarea value={newPersona} onChange={(e) => setNewPersona(e.target.value)} placeholder="커스텀 페르소나 (선택사항)" rows={2}
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:ring-2 focus:ring-sky-500 focus:outline-none resize-none" />
                  <div className="flex gap-2">
                    <button onClick={handleCreateAssistant} disabled={!newName || !newSpecialty || creating}
                      className="flex-1 py-2 rounded-lg font-semibold text-sm bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-40 transition-all"
                    >{creating ? '⏳ 생성 중...' : '생성'}</button>
                    <button onClick={() => setShowCreateForm(false)} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors">취소</button>
                  </div>
                </div>
              )}

              {selectedAssistant && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="p-3 border-b border-border bg-background/50">
                    <div className="flex items-center justify-between mb-2">
                      <button onClick={() => { setSelectedAssistant(null); setAssistantDocs([]); }} className="text-xs text-muted-foreground hover:text-foreground">← 목록으로</button>
                      <button onClick={() => { 
                          setActiveAssistantId(selectedAssistant.id); 
                          setActiveConversationId(null); // 교수 활성화 시 기존 대화 연결을 끊음 -> 새 대화 생성 유도
                          setMessages([]);
                        }} 
                        className={`text-xs px-2 py-1 rounded-lg font-semibold transition-all ${
                          activeAssistantId === selectedAssistant.id 
                            ? 'bg-emerald-500/20 text-emerald-400' 
                            : 'bg-sky-500/20 text-sky-400 hover:bg-sky-500/30'
                        }`}
                      >{activeAssistantId === selectedAssistant.id ? '✅ 활성' : '🎯 채팅에 활성화'}</button>
                    </div>
                    <h3 className="text-base font-bold text-foreground">🎓 {selectedAssistant.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1">📌 {selectedAssistant.specialty}</p>
                    {selectedAssistant.data_store_id && <p className="text-[10px] text-emerald-500/70 mt-1">✅ 데이터 스토어 연결됨</p>}
                  </div>

                  <div className="p-3 border-b border-border">
                    <p className="text-xs text-muted-foreground mb-2">📎 논문/자료 업로드</p>
                    <div className="flex gap-1 mb-2">
                      <button onClick={() => setAssistantDocType('script')}
                        className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                          assistantDocType === 'script'
                            ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
                            : 'bg-muted/50 text-muted-foreground hover:bg-muted border border-transparent'
                        }`}
                      >📄 논문</button>
                      <button onClick={() => setAssistantDocType('reference')}
                        className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                          assistantDocType === 'reference'
                            ? 'bg-teal-500/20 text-teal-400 border border-teal-500/40'
                            : 'bg-muted/50 text-muted-foreground hover:bg-muted border border-transparent'
                        }`}
                      >📚 참고자료</button>
                    </div>
                    <input ref={assistantFileInputRef} type="file" accept=".txt,.pdf" multiple onChange={(e) => setAssistantFiles(e.target.files ? Array.from(e.target.files) : [])}
                      className="w-full text-xs text-muted-foreground file:mr-2 file:py-1 file:px-2 file:rounded-lg file:border-0 file:text-xs file:bg-muted file:text-foreground hover:file:bg-muted/80 file:cursor-pointer mb-2" />
                    {assistantFiles.length > 0 && (
                      <p className="text-xs text-muted-foreground mb-1.5">📎 {assistantFiles.length}개 파일 선택됨</p>
                    )}
                    <button onClick={handleAssistantFileUpload} disabled={assistantFiles.length === 0 || assistantUploadStep !== 'idle'}
                      className={`w-full py-2 rounded-lg font-bold text-xs text-white disabled:opacity-40 transition-all ${
                        assistantDocType === 'script'
                          ? 'bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500'
                          : 'bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500'
                      }`}
                    >{assistantUploadStep !== 'idle' && assistantUploadStep !== 'error'
                      ? '⏳ 학습 중...'
                      : assistantDocType === 'script' ? '📄 논문 학습' : '📚 자료 학습'
                    }</button>
                  </div>
                  {renderProgress(assistantUploadStep, assistantUploadMessage, () => { setAssistantUploadStep('idle'); setAssistantUploadMessage(''); })}

                  <div className="flex-1 overflow-y-auto">
                    {loadingAssistantDocs ? (
                      <div className="p-4 text-center text-xs text-muted-foreground animate-pulse">문서 로딩 중...</div>
                    ) : assistantDocs.length === 0 ? (
                      <div className="p-4 text-center text-xs text-muted-foreground">아직 자료가 없습니다.</div>
                    ) : (
                      <div className="divide-y divide-border/50">
                        {assistantDocs.filter(d => (d as any).docType !== 'reference').length > 0 && (
                          <div className="px-3 pt-2 pb-1">
                            <p className="text-[10px] font-bold text-sky-400/80 uppercase tracking-wider">📄 논문</p>
                          </div>
                        )}
                        {assistantDocs.filter(d => (d as any).docType !== 'reference').map((doc) => (
                          <div key={doc.id || doc.source} className="px-3 py-2 hover:bg-muted/50 group flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-foreground truncate">📄 {doc.source}</p>
                              <p className="text-[10px] text-muted-foreground">{doc.indexed ? '✅ 완료' : '⏳ 대기'}</p>
                            </div>
                            <button onClick={() => handleDeleteAssistantDoc(doc)} className="opacity-0 group-hover:opacity-100 text-xs text-red-400 hover:bg-red-500/10 px-1.5 py-0.5 rounded">🗑️</button>
                          </div>
                        ))}
                        {assistantDocs.filter(d => (d as any).docType === 'reference').length > 0 && (
                          <div className="px-3 pt-2 pb-1">
                            <p className="text-[10px] font-bold text-teal-400/80 uppercase tracking-wider">📚 참고자료</p>
                          </div>
                        )}
                        {assistantDocs.filter(d => (d as any).docType === 'reference').map((doc) => (
                          <div key={doc.id || doc.source} className="px-3 py-2 hover:bg-muted/50 group flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-foreground truncate">📚 {doc.source}</p>
                              <p className="text-[10px] text-muted-foreground">{doc.indexed ? '✅ 완료' : '⏳ 대기'}</p>
                            </div>
                            <button onClick={() => handleDeleteAssistantDoc(doc)} className="opacity-0 group-hover:opacity-100 text-xs text-red-400 hover:bg-red-500/10 px-1.5 py-0.5 rounded">🗑️</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {!selectedAssistant && !showCreateForm && (
                <div className="flex-1 overflow-y-auto">
                  {loadingAssistants ? (
                    <div className="p-6 text-center text-sm text-muted-foreground animate-pulse">교수님 목록 로딩 중...</div>
                  ) : assistants.length === 0 ? (
                    <div className="p-6 text-center">
                      <p className="text-muted-foreground text-sm">등록된 교수님이 없습니다.</p>
                      <p className="text-muted-foreground/60 text-xs mt-1">새 교수님을 만들어 논문 조언을 받아보세요.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-border/50">
                      {assistants.map((a) => (
                        <div key={a.id} 
                          className={`px-3 py-3 hover:bg-muted/50 transition-all cursor-pointer group ${activeAssistantId === a.id ? 'bg-sky-500/10 border-l-2 border-sky-500' : ''}`}
                          onClick={() => { setSelectedAssistant(a); fetchAssistantDocs(a.id); }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                                🎓 {a.name}
                                {activeAssistantId === a.id && <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1 py-0.5 rounded">활성</span>}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">📌 {a.specialty}</p>
                              {!a.data_store_id && <p className="text-[10px] text-yellow-500 mt-0.5">⚠ 데이터 스토어 미연결</p>}
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteAssistant(a.id, a.name); }}
                              className="opacity-0 group-hover:opacity-100 text-xs text-red-400 hover:bg-red-500/10 px-2 py-1 rounded transition-all shrink-0"
                            >🗑️</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!selectedAssistant && (
                <div className="p-2 border-t border-border text-center">
                  <button onClick={fetchAssistants} disabled={loadingAssistants} className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">🔄 새로고침</button>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* ===== 우측 메인 채팅 ===== */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="py-3 px-6 border-b border-border flex items-center gap-3">
          {!sidebarOpen && (
            <button onClick={() => setSidebarOpen(true)} className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted">📚</button>
          )}
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Thesis Assistant 📝</h1>
            {activeAssistant ? (
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs bg-sky-500/20 text-sky-400 px-2 py-0.5 rounded-full font-semibold">🎓 {activeAssistant.name}</span>
                <span className="text-xs text-muted-foreground">{activeAssistant.specialty}</span>
                <button onClick={() => setActiveAssistantId(null)} className="text-[10px] text-muted-foreground hover:text-red-400 transition-colors">[해제]</button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5">기본 모드 · 공유 논문자료 기반</p>
            )}
          </div>

          {userEmail && (
            <div className="flex items-center gap-3 border-l border-border pl-4 ml-2">
              <span className="text-sm font-medium text-foreground">🧑‍🎓 {userEmail}</span>
              <button 
                onClick={() => logout()} 
                className="text-xs font-semibold bg-red-500/10 text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded-lg transition-colors border border-red-500/20"
              >
                로그아웃
              </button>
            </div>
          )}
        </header>

        <section className="flex-1 overflow-y-auto py-4 px-6 space-y-6">
          {loadingMessages ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-muted-foreground animate-pulse">대화 기록 불러오는 중...</div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <p className="text-lg">{activeAssistant ? `${activeAssistant.name}에게 질문해보세요!` : '논문 작성, 학술 연구, 무엇이든 물어보세요!'}</p>
              <p className="text-sm mt-2 opacity-70">{activeAssistant ? `전문 분야: ${activeAssistant.specialty}` : '"연구 방법론을 어떻게 설계하면 좋을까?"'}</p>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} group`}>
                <div className={`relative max-w-[80%] p-4 rounded-xl ${
                  m.role === 'user' ? 'bg-primary text-primary-foreground rounded-tr-none' : 'bg-muted text-muted-foreground rounded-tl-none border border-border'
                }`}>
                  <span className="font-semibold text-xs block mb-1 opacity-70">
                    {m.role === 'user' ? '연구자' : (activeAssistant ? `🎓 ${activeAssistant.name}` : 'Thesis 연구원')}
                  </span>
                  {m.role === 'user' ? (
                    <p className="whitespace-pre-wrap leading-relaxed break-words">{m.content}</p>
                  ) : (
                    <div className="markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                    </div>
                  )}
                  {/* 메시지 삭제 버튼 */}
                  {activeConversationId && !isLoading && (
                    <button
                      onClick={() => handleDeleteMessage(m.id)}
                      className={`absolute -top-2 ${m.role === 'user' ? '-left-8' : '-right-8'} opacity-0 group-hover:opacity-100 text-xs text-red-400 hover:bg-red-500/10 w-6 h-6 rounded-full flex items-center justify-center transition-all`}
                      title="이 메시지 삭제"
                    >✕</button>
                  )}
                </div>
              </div>
            ))
          )}
          {isLoading && (
            <div className="flex justify-start">
              <div className="max-w-[80%] p-4 rounded-xl bg-muted text-muted-foreground rounded-tl-none border border-border">
                <span className="animate-pulse">{activeAssistant ? `${activeAssistant.name}이(가)` : 'Thesis가'} 답변을 작성 중입니다...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </section>

        <form onSubmit={handleChatSubmit} className="px-6 py-4 border-t border-border flex gap-2">
          <input
            className="flex-1 border border-border rounded-full px-6 py-4 bg-background focus:outline-none focus:ring-2 focus:ring-primary shadow-sm"
            value={input}
            placeholder={activeAssistant ? `${activeAssistant.name}에게 메시지 보내기...` : 'Thesis에게 메시지 보내기...'}
            onChange={handleInputChange}
            disabled={isLoading}
          />
          <button type="submit" disabled={isLoading || !input.trim()}
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-4 rounded-full font-semibold transition-colors disabled:opacity-50"
          >전송</button>
        </form>
      </main>
    </div>
  );
}
