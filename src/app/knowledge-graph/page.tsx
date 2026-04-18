'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface GraphNode {
  id: string;
  label: string;
  type: 'assistant' | 'document' | 'knowledge_base';
  docType?: string;
  specialty?: string;
  chunkCount?: number;
  group: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphEdge {
  source: string;
  target: string;
  type: 'owns' | 'similar';
  weight: number;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    totalDocuments: number;
    totalAssistants: number;
    totalEdges: number;
    similarityThreshold: number;
  };
}

const GROUP_COLORS: Record<string, string> = {};
const COLOR_PALETTE = [
  '#0ea5e9', '#06b6d4', '#14b8a6', '#22c55e', '#3b82f6',
  '#6366f1', '#8b5cf6', '#0891b2', '#0d9488', '#2563eb',
];

function getGroupColor(group: string): string {
  if (!GROUP_COLORS[group]) {
    const idx = Object.keys(GROUP_COLORS).length % COLOR_PALETTE.length;
    GROUP_COLORS[group] = COLOR_PALETTE[idx];
  }
  return GROUP_COLORS[group];
}

function getNodeRadius(node: GraphNode): number {
  if (node.type === 'assistant') return 28;
  if (node.type === 'knowledge_base') return 24;
  return 14 + Math.min((node.chunkCount || 1) * 0.5, 10);
}

export default function KnowledgeGraphPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [threshold, setThreshold] = useState(0.5);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [draggedNode, setDraggedNode] = useState<GraphNode | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const animFrameRef = useRef<number>(0);
  const mouseRef = useRef({ x: 0, y: 0, isDown: false, isPanning: false, startX: 0, startY: 0 });
  const transformRef = useRef(transform);

  useEffect(() => {
    fetch('/api/knowledge-graph')
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setError(data.error);
        } else {
          setGraphData(data);
        }
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!graphData || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const width = canvas.parentElement?.clientWidth || 800;
    const height = canvas.parentElement?.clientHeight || 600;
    canvas.width = width * 2;
    canvas.height = height * 2;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const nodes = graphData.nodes.map((n, i) => ({
      ...n,
      x: width / 2 + (Math.random() - 0.5) * 400,
      y: height / 2 + (Math.random() - 0.5) * 400,
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
    }));

    nodesRef.current = nodes;
    edgesRef.current = graphData.edges;
    transformRef.current = { x: 0, y: 0, scale: 1 };
    setTransform({ x: 0, y: 0, scale: 1 });
    startSimulation();

    return () => cancelAnimationFrame(animFrameRef.current);
  }, [graphData]);

  const startSimulation = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width / 2;
    const height = canvas.height / 2;
    let alpha = 1;

    function tick() {
      if (!ctx) return;
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const t = transformRef.current;

      alpha *= 0.995;
      if (alpha < 0.001) alpha = 0;

      for (const node of nodes) {
        if (node.fx !== null && node.fx !== undefined) continue;
        node.vx! += (width / 2 - node.x!) * 0.0005 * (alpha > 0 ? 1 : 0);
        node.vy! += (height / 2 - node.y!) * 0.0005 * (alpha > 0 ? 1 : 0);
      }

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x! - nodes[i].x!;
          const dy = nodes[j].y! - nodes[i].y!;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (150 * 150) / (dist * dist) * (alpha > 0 ? 1 : 0);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          if (nodes[i].fx === null || nodes[i].fx === undefined) { nodes[i].vx! -= fx; nodes[i].vy! -= fy; }
          if (nodes[j].fx === null || nodes[j].fx === undefined) { nodes[j].vx! += fx; nodes[j].vy! += fy; }
        }
      }

      for (const edge of edges) {
        if (edge.type === 'similar' && edge.weight < threshold) continue;
        const source = nodes.find(n => n.id === edge.source);
        const target = nodes.find(n => n.id === edge.target);
        if (!source || !target) continue;
        const dx = target.x! - source.x!;
        const dy = target.y! - source.y!;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const targetDist = edge.type === 'owns' ? 120 : 200;
        const force = (dist - targetDist) * 0.003 * (alpha > 0 ? 1 : 0);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (source.fx === null || source.fx === undefined) { source.vx! += fx; source.vy! += fy; }
        if (target.fx === null || target.fx === undefined) { target.vx! -= fx; target.vy! -= fy; }
      }

      for (const node of nodes) {
        if (node.fx !== null && node.fx !== undefined) {
          node.x = node.fx; node.y = node.fy!; node.vx = 0; node.vy = 0;
        } else {
          node.vx! *= 0.85; node.vy! *= 0.85; node.x! += node.vx!; node.y! += node.vy!;
        }
      }

      ctx.save();
      ctx.scale(2, 2);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#0a0f1a';
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = 'rgba(14, 165, 233, 0.03)';
      ctx.lineWidth = 1;
      for (let x = (t.x % 50); x < width; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
      for (let y = (t.y % 50); y < height; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }

      ctx.translate(t.x, t.y);
      ctx.scale(t.scale, t.scale);

      for (const edge of edges) {
        if (edge.type === 'similar' && edge.weight < threshold) continue;
        const source = nodes.find(n => n.id === edge.source);
        const target = nodes.find(n => n.id === edge.target);
        if (!source || !target) continue;
        ctx.beginPath(); ctx.moveTo(source.x!, source.y!); ctx.lineTo(target.x!, target.y!);
        if (edge.type === 'owns') { ctx.strokeStyle = `rgba(14, 165, 233, 0.25)`; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); }
        else { const b = Math.min(edge.weight * 1.5, 1); ctx.strokeStyle = `rgba(20, 184, 166, ${b * 0.6})`; ctx.lineWidth = edge.weight * 3; ctx.setLineDash([]); }
        ctx.stroke(); ctx.setLineDash([]);
      }

      for (const node of nodes) {
        const r = getNodeRadius(node);
        const color = getGroupColor(node.group);
        const gradient = ctx.createRadialGradient(node.x!, node.y!, r * 0.3, node.x!, node.y!, r * 2.5);
        gradient.addColorStop(0, `${color}40`); gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient; ctx.fillRect(node.x! - r * 3, node.y! - r * 3, r * 6, r * 6);
        ctx.beginPath(); ctx.arc(node.x!, node.y!, r, 0, Math.PI * 2);
        if (node.type === 'assistant') { const grad = ctx.createRadialGradient(node.x! - r * 0.3, node.y! - r * 0.3, 0, node.x!, node.y!, r); grad.addColorStop(0, `${color}ee`); grad.addColorStop(1, `${color}88`); ctx.fillStyle = grad; }
        else if (node.type === 'knowledge_base') { ctx.fillStyle = '#06b6d488'; }
        else { ctx.fillStyle = node.docType === 'reference' ? '#14b8a688' : `${color}66`; }
        ctx.fill(); ctx.strokeStyle = `${color}cc`; ctx.lineWidth = node.type === 'assistant' ? 2.5 : 1.5; ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = `${node.type === 'assistant' ? 'bold 11px' : '9px'} "Pretendard", "Apple SD Gothic Neo", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (node.type === 'assistant') { ctx.fillText('🔬', node.x!, node.y! - 2); }
        else if (node.type === 'knowledge_base') { ctx.fillText('📚', node.x!, node.y! - 2); }
        else { ctx.fillText(node.docType === 'reference' ? '📄' : '📝', node.x!, node.y! - 1); }
        ctx.font = `${node.type === 'assistant' ? 'bold 11px' : '9px'} "Pretendard", "Apple SD Gothic Neo", sans-serif`;
        ctx.fillStyle = '#ffffffcc'; ctx.textAlign = 'center';
        const label = node.label.length > 16 ? node.label.slice(0, 14) + '…' : node.label;
        ctx.fillText(label, node.x!, node.y! + r + 14);
      }

      ctx.restore();
      animFrameRef.current = requestAnimationFrame(tick);
    }
    tick();
  }, [threshold]);

  useEffect(() => {
    if (graphData) { cancelAnimationFrame(animFrameRef.current); startSimulation(); }
  }, [threshold, startSimulation]);

  const getCanvasPos = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current; if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect(); const t = transformRef.current;
    return { x: (e.clientX - rect.left - t.x) / t.scale, y: (e.clientY - rect.top - t.y) / t.scale };
  }, []);

  const findNodeAt = useCallback((x: number, y: number): GraphNode | null => {
    for (const node of [...nodesRef.current].reverse()) {
      const r = getNodeRadius(node); const dx = node.x! - x; const dy = node.y! - y;
      if (dx * dx + dy * dy <= r * r * 2) return node;
    }
    return null;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const pos = getCanvasPos(e); const node = findNodeAt(pos.x, pos.y);
    mouseRef.current.isDown = true; mouseRef.current.startX = e.clientX; mouseRef.current.startY = e.clientY;
    if (node) { setDraggedNode(node); node.fx = node.x; node.fy = node.y; }
    else { mouseRef.current.isPanning = true; }
  }, [getCanvasPos, findNodeAt]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const pos = getCanvasPos(e); const node = findNodeAt(pos.x, pos.y); setHoveredNode(node);
    if (canvasRef.current) { canvasRef.current.style.cursor = node ? 'grab' : 'default'; }
    if (draggedNode && mouseRef.current.isDown) { draggedNode.fx = pos.x; draggedNode.fy = pos.y; if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing'; }
    if (mouseRef.current.isPanning && mouseRef.current.isDown) {
      const dx = e.clientX - mouseRef.current.startX; const dy = e.clientY - mouseRef.current.startY;
      mouseRef.current.startX = e.clientX; mouseRef.current.startY = e.clientY;
      const newT = { ...transformRef.current, x: transformRef.current.x + dx, y: transformRef.current.y + dy };
      transformRef.current = newT; setTransform(newT);
    }
  }, [getCanvasPos, findNodeAt, draggedNode]);

  const handleMouseUp = useCallback(() => {
    if (draggedNode) { draggedNode.fx = null; draggedNode.fy = null; setDraggedNode(null); }
    mouseRef.current.isDown = false; mouseRef.current.isPanning = false;
  }, [draggedNode]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.2, Math.min(3, transformRef.current.scale * delta));
    const rect = canvasRef.current?.getBoundingClientRect(); if (!rect) return;
    const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top;
    const newT = { x: mouseX - (mouseX - transformRef.current.x) * (newScale / transformRef.current.scale), y: mouseY - (mouseY - transformRef.current.y) * (newScale / transformRef.current.scale), scale: newScale };
    transformRef.current = newT; setTransform(newT);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-sky-500/30 border-t-sky-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/70 text-lg">지식 그래프 생성 중...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
        <div className="text-center bg-red-500/10 border border-red-500/20 rounded-xl p-8 max-w-md">
          <p className="text-red-400 text-lg font-medium mb-2">오류 발생</p>
          <p className="text-red-300/70">{error}</p>
          <a href="/" className="inline-block mt-4 text-sky-400 hover:text-sky-300 underline">← 메인으로 돌아가기</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0f1a] flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-[#0a0f1a]/90 backdrop-blur-md z-10">
        <div className="flex items-center gap-4">
          <a href="/" className="text-white/50 hover:text-white/80 transition text-sm">← 돌아가기</a>
          <h1 className="text-xl font-bold bg-gradient-to-r from-sky-400 to-teal-400 bg-clip-text text-transparent">
            📊 지식 그래프
          </h1>
        </div>
        <div className="flex items-center gap-6 text-sm text-white/60">
          <span>문서 <b className="text-sky-400">{graphData?.stats.totalDocuments || 0}</b></span>
          <span>보조연구원 <b className="text-teal-400">{graphData?.stats.totalAssistants || 0}</b></span>
          <span>연결 <b className="text-emerald-400">{graphData?.stats.totalEdges || 0}</b></span>
        </div>
      </header>

      <div className="flex-1 relative">
        <canvas ref={canvasRef} className="w-full h-full"
          onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} onWheel={handleWheel}
        />
        <div className="absolute top-4 left-4 bg-[#0d1225]/90 backdrop-blur-md border border-white/10 rounded-xl p-4 w-64 space-y-4">
          <div>
            <label className="text-white/60 text-xs font-medium block mb-2">유사도 임계값</label>
            <input type="range" min="0.1" max="0.9" step="0.05" value={threshold}
              onChange={e => setThreshold(parseFloat(e.target.value))} className="w-full accent-sky-500" />
            <div className="flex justify-between text-xs text-white/40 mt-1">
              <span>느슨함 0.1</span>
              <span className="text-sky-400 font-medium">{threshold.toFixed(2)}</span>
              <span>엄격함 0.9</span>
            </div>
          </div>
          <div className="border-t border-white/5 pt-3">
            <p className="text-white/50 text-xs font-medium mb-2">범례</p>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-sky-500/60 border border-sky-400/50 inline-block" />
                <span className="text-white/60">보조연구원</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-cyan-400/40 border border-cyan-400/50 inline-block" />
                <span className="text-white/60">공유 지식</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-sky-400/40 border border-sky-300/40 inline-block" />
                <span className="text-white/60">논문 문서</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-teal-400/40 border border-teal-300/40 inline-block" />
                <span className="text-white/60">참고 자료</span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="w-6 border-t border-dashed border-sky-400/40 inline-block" />
                <span className="text-white/60">소유 관계</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-6 border-t-2 border-teal-400/60 inline-block" />
                <span className="text-white/60">유사도 연결</span>
              </div>
            </div>
          </div>
        </div>

        {hoveredNode && (
          <div className="absolute bottom-4 left-4 bg-[#0d1225]/95 backdrop-blur-md border border-white/10 rounded-xl p-4 max-w-xs">
            <p className="text-white font-medium text-sm">{hoveredNode.label}</p>
            <p className="text-white/40 text-xs mt-1">
              {hoveredNode.type === 'assistant' && `보조연구원 · ${hoveredNode.specialty}`}
              {hoveredNode.type === 'knowledge_base' && '공유 지식 베이스'}
              {hoveredNode.type === 'document' && `${hoveredNode.docType === 'reference' ? '참고자료' : '논문'} · ${hoveredNode.chunkCount || 0}개 청크`}
            </p>
          </div>
        )}

        <div className="absolute bottom-4 right-4 text-white/30 text-xs space-y-0.5 text-right">
          <p>마우스 드래그 — 노드 이동</p>
          <p>빈 공간 드래그 — 캔버스 이동</p>
          <p>마우스 휠 — 줌 인/아웃</p>
        </div>
      </div>
    </div>
  );
}
