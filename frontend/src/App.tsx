import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, ReferenceLine } from 'recharts';
import './App.css';

// --- Types ---
interface Candidate {
  rank: number;
  score: string;
  move: string;
}

interface GraphPoint {
  move: number;
  eval: number;
  quality?: 'brilliant' | 'great' | 'best' | 'mistake' | 'miss' | 'blunder' | 'normal';
}

interface MoveStats {
  brilliant: number;
  great: number;
  best: number;
  excellent: number;
  good: number;
  inaccuracy: number;
  mistake: number;
  miss: number;
  blunder: number;
}

const INITIAL_STATS: MoveStats = { 
  brilliant: 0, great: 0, best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, miss: 0, blunder: 0 
};

// --- Sub-Components ---

const EvaluationBar = memo(({ evaluation }: { evaluation: string | null }) => {
  const getEvalPercentage = () => {
    if (!evaluation) return 50;
    if (evaluation.startsWith('M')) return evaluation.includes('-') ? 0 : 100;
    const score = parseFloat(evaluation);
    const percent = 50 + (score / 10) * 50;
    return Math.max(0, Math.min(100, percent));
  };

  return (
    <div className="evaluation-bar">
      <div className="evaluation-bar-fill" style={{ height: `${getEvalPercentage()}%` }}></div>
    </div>
  );
});

const CustomDot = (props: any) => {
  const { cx, cy, payload } = props;
  if (!payload) return null;
  const colors: Record<string, string> = {
    brilliant: '#26c2a3',
    great: '#5c8d4d',
    best: '#85a94e',
    mistake: '#ffa459',
    miss: '#ff3b3b',
    blunder: '#ca3431',
    normal: '#4caf50'
  };
  const q = payload.quality || 'normal';
  const color = colors[q] || colors.normal;
  const radius = (q === 'brilliant' || q === 'blunder' || q === 'miss') ? 4 : (q === 'normal' ? 1.5 : 3);
  return <circle cx={cx} cy={cy} r={radius} fill={color} stroke="none" />;
};

const EvaluationGraphView = memo(({ data, currentIndex, onJump, boardOrientation }: any) => {
  if (data.length === 0) {
    return <div style={{ height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: '12px' }}>Analyzing...</div>;
  }
  
  // Flip evaluation if orientation is black (black is at bottom)
  const orientedData = data.map((d: any) => ({
    ...d,
    displayEval: boardOrientation === 'black' ? -d.eval : d.eval
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={orientedData} 
        onClick={(d) => d && d.activeTooltipIndex !== undefined && onJump(d.activeTooltipIndex)}
        margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#444" />
        <XAxis dataKey="move" hide />
        <YAxis domain={[-10, 10]} hide />
        <ReferenceLine y={0} stroke="#666" />
        <ReferenceLine x={currentIndex} stroke="#4caf50" strokeWidth={2} strokeDasharray="3 3" />
        <Line type="monotone" dataKey="displayEval" stroke="#4caf50" strokeWidth={2} dot={<CustomDot />} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
});

const formatPgnDate = (date: string, time: string, tz: string) => {
  if (!date) return '';
  const cleanDate = date.replace(/\./g, '-'); // YYYY.MM.DD -> YYYY-MM-DD
  try {
    const dt = new Date(`${cleanDate}T${time || '00:00:00'}Z`); // PGN dates/times are UTC
    return dt.toLocaleString('en-US', { timeZone: tz });
  } catch (e) {
    return `${date} ${time}`;
  }
};

function App() {
  const [fen, setFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [allFens, setAllFens] = useState<string[]>(['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1']);
  const allFensRef = useRef<string[]>(['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1']);
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pgn, setPgn] = useState('');
  const [pgnResult, setPgnResult] = useState<string | null>(null);
  const [chessComGames, setChessComGames] = useState<any[]>([]);
  const [loadingGames, setLoadingGames] = useState(false);
  const [boardOrientation, setBoardOrientation] = useState<'white' | 'black'>('white');
  const [players, setPlayers] = useState({ white: 'White', black: 'Black' });
  const [chessComUsername, setChessComUsername] = useState('mebukichi');
  const [timezone, setTimezone] = useState('America/Los_Angeles');
  const [isPreAnalyzed, setIsPreAnalyzed] = useState<number | false>(false);
  const [analyzedGameIds, setAnalyzedGameIds] = useState<string[]>([]);
  const [localGames, setLocalGames] = useState<any[]>([]);
  const [loadingLocal, setLoadingLocal] = useState(false);

  const [evaluation, setEvaluation] = useState<string | null>(null);

  const [candidates, setCandidates] = useState<any[]>([]);
  const [graphData, setGraphData] = useState<GraphPoint[]>([]);
  const [stats, setStats] = useState<any>({ brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 });
  const [opponentStats, setOpponentStats] = useState<any>({ brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 });
  const [lastMoveSquares, setLastMoveSquares] = useState<any[]>([]);
  const [analysisStartTime, setAnalysisStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState('0.0s');

  const evalRef = useRef<string | null>(null);
  const candidatesRef = useRef<any[]>([]);
  const graphDataRef = useRef<GraphPoint[]>([]);
  const statsRef = useRef<any>({ brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 });
  const opponentStatsRef = useRef<any>({ brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 });
  const userColorRef = useRef<'w' | 'b' | null>(null);
  const originalGameRef = useRef<any>(null);
  
  const socketRef = useRef<WebSocket | null>(null);
  const fenRef = useRef(fen); 
  const scanQueueRef = useRef<{fen: string, index: number}[]>([]);
  const isScanningRef = useRef<number | false>(false);
  const currentMoveQualityRef = useRef<any>(null);
  const lastAnalyzedFenRef = useRef<string | null>(null);

  useEffect(() => {
    fenRef.current = fen;
  }, [fen]);

  const processNextScan = useCallback(() => {
    if (isScanningRef.current !== false || scanQueueRef.current.length === 0) return;
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setTimeout(processNextScan, 500);
      return;
    }
    const next = scanQueueRef.current.shift();
    if (next) {
      isScanningRef.current = next.index;
      currentMoveQualityRef.current = null;
      socketRef.current.send(JSON.stringify({ type: 'scan_position', fen: next.fen, index: next.index }));
    }
  }, []);

  const startMainAnalysis = useCallback(() => {
    const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    if (socketRef.current?.readyState === WebSocket.OPEN && fenRef.current) {
      if (fenRef.current === startFen) {
        console.log('[App] Skipping main analysis for initial position');
        evalRef.current = '0.00';
        setEvaluation('0.00');
        setCandidates([]);
        socketRef.current.send(JSON.stringify({ type: 'stop' }));
        return;
      }
      
      if (evalRef.current === null || lastAnalyzedFenRef.current !== fenRef.current) {
        console.log('[App] Requesting main analysis');
        lastAnalyzedFenRef.current = fenRef.current;
        candidatesRef.current = [];
        evalRef.current = null;
        setAnalysisStartTime(Date.now());
        socketRef.current.send(JSON.stringify({ type: 'stop' }));
        socketRef.current.send(JSON.stringify({ type: 'position', fen: fenRef.current }));
      }
    }
  }, []);

  // Throttled UI Update
  useEffect(() => {
    const interval = setInterval(() => {
      setEvaluation(evalRef.current);
      setCandidates([...candidatesRef.current]);
      setGraphData([...graphDataRef.current]);
      setStats({ ...statsRef.current });
      setOpponentStats({ ...opponentStatsRef.current });
      
      if (analysisStartTime) {
        const elapsed = (Date.now() - analysisStartTime) / 1000;
        const capped = Math.min(300, elapsed);
        setElapsedTime(capped.toFixed(1) + 's');
      } else {
        setElapsedTime('0.0s');
      }
    }, 250);
    return () => clearInterval(interval);
  }, [analysisStartTime]);

  // Initial scan trigger
  useEffect(() => {
    if (scanQueueRef.current.length === 0 && graphDataRef.current.length === 0 && isScanningRef.current === false) {
      graphDataRef.current = [{ move: 0, eval: 0, quality: 'normal' }];
      scanQueueRef.current.push({ fen: allFens[0], index: 0 });
      processNextScan();
    }
  }, [allFens, processNextScan]);

  // WebSocket for Analysis
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use the same host/port as the current page for maximum compatibility
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    socketRef.current = socket;
    socket.onopen = () => {
      console.log('[App] WebSocket Connected');
      socket.send(JSON.stringify({ type: 'uci' }));
      if (scanQueueRef.current.length === 0) {
        startMainAnalysis();
      }
    };
    socket.onclose = () => {
      console.log('WebSocket Disconnected');
    };
    socket.onerror = (err) => {
      console.error('WebSocket Error:', err);
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'error') {
        alert(message.data);
        return;
      }
      if (message.type === 'scan_complete') {
        const q = currentMoveQualityRef.current;
        const idx = isScanningRef.current;
        if (q && typeof idx === 'number' && idx > 0) {
          const playerMoved = (idx % 2 !== 0) ? 'w' : 'b';
          const isUser = userColorRef.current === playerMoved;
          const s = isUser ? statsRef.current : opponentStatsRef.current;
          if (q === 'brilliant') s.brilliant++;
          else if (q === 'great') s.great++;
          else if (q === 'best') s.best++;
          else if (q === 'mistake') s.mistake++;
          else if (q === 'miss') s.miss++;
          else if (q === 'blunder') s.blunder++;
        }
        isScanningRef.current = false;
        if (scanQueueRef.current.length === 0) {
          startMainAnalysis();
        } else {
          setTimeout(processNextScan, 10);
        }
        return;
      }
      if (message.type === 'info') {
        if (message.engine === 'main') {
          const line = message.data;
          const pvMatch = line.match(/multipv\s+(\d+)/);
          if (pvMatch) {
            const rank = parseInt(pvMatch[1]);
            const cpMatch = line.match(/score\s+cp\s+(-?\d+)/);
            const mateMatch = line.match(/score\s+mate\s+(-?\d+)/);
            const pvMoveMatch = line.match(/\spv\s+(\w+)/);
            const pov = fenRef.current.includes(' w ') ? 1 : -1;
            let scoreStr = '';
            if (cpMatch) {
              scoreStr = (pov * parseInt(cpMatch[1]) / 100).toFixed(2);
            } else if (mateMatch) {
              scoreStr = `M${pov * parseInt(mateMatch[1])}`;
            }
            if (scoreStr && pvMoveMatch) {
              const cur = [...candidatesRef.current];
              const idx = cur.findIndex(c => c.rank === rank);
              if (idx >= 0) cur[idx] = { rank, score: scoreStr, move: pvMoveMatch[1] };
              else cur.push({ rank, score: scoreStr, move: pvMoveMatch[1] });
              candidatesRef.current = cur.sort((a, b) => a.rank - b.rank).slice(0, 3);
              if (rank === 1) evalRef.current = scoreStr;
            }
          }
        } else if (message.engine === 'scan') {
          const line = message.data;
          const cpMatch = line.match(/score\s+cp\s+(-?\d+)/);
          const mateMatch = line.match(/score\s+mate\s+(-?\d+)/);
          if (cpMatch || mateMatch) {
            const lastIdx = isScanningRef.current;
            if (typeof lastIdx === 'number' && allFensRef.current[lastIdx]) {
              // Always store score from White's perspective for the graph
              const sideToMove = allFensRef.current[lastIdx].includes(' w ') ? 1 : -1;
              let score = cpMatch ? (sideToMove * parseInt(cpMatch[1]) / 100) : (sideToMove * (parseInt(mateMatch![1]) > 0 ? 10 : -10));
              
              score = Math.max(-10, Math.min(10, score));
              const newData = [...graphDataRef.current];
              while (newData.length <= lastIdx) newData.push({ move: newData.length, eval: 0, quality: 'normal' });
              let quality: any = 'normal';
              if (lastIdx > 0 && newData[lastIdx - 1]) {
                const prevEval = newData[lastIdx - 1].eval;
                const delta = (lastIdx % 2 !== 0) ? (score - prevEval) : (prevEval - score);
                if (delta >= 2.0 && Math.abs(prevEval) < 2.0) quality = 'brilliant';
                else if (delta >= 1.0) quality = 'great';
                else if (delta >= -0.1) quality = 'best';
                else if (delta <= -3.0) quality = 'blunder';
                else if (delta <= -1.5) quality = 'miss';
                else if (delta <= -0.8) quality = 'mistake';
              }
              newData[lastIdx] = { move: lastIdx, eval: score, quality };
              graphDataRef.current = newData;
              currentMoveQualityRef.current = quality;
              
              // Force immediate state update for the graph to ensure real-time rendering
              setGraphData([...newData]);
              console.log(`[App] Received scan result for move ${lastIdx}: ${score}`);
            }
          }
        }
      }
    };
    return () => socket.close();
  }, [processNextScan, startMainAnalysis]);

  useEffect(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN && fen) {
      startMainAnalysis();
    }
  }, [fen, startMainAnalysis]);

  const goToMove = useCallback((index: number, restoreMainLine = false) => {
    if (restoreMainLine && originalGameRef.current) {
      const main = originalGameRef.current;
      setAllFens(main.allFens);
      setMoveHistory(main.moveHistory);
      setLastMoveSquares(main.lastMoveSquares);
      setGraphData([...graphDataRef.current]);
      const safeIndex = Math.max(0, Math.min(index, main.allFens.length - 1));
      setCurrentIndex(safeIndex);
      setFen(main.allFens[safeIndex]);
      return;
    }
    if (index >= 0 && index < allFens.length) {
      setCurrentIndex(index);
      setFen(allFens[index]);
    }
  }, [allFens]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowRight') {
        setCurrentIndex(prev => {
          const next = prev + 1;
          if (next < allFens.length) { setFen(allFens[next]); return next; }
          return prev;
        });
      }
      else if (e.key === 'ArrowLeft') {
        setCurrentIndex(prev => {
          const next = prev - 1;
          if (next >= 0) { setFen(allFens[next]); return next; }
          return prev;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [allFens]);

  const processPgn = (pgnString: string) => {
    if (!pgnString) return;
    try {
      const tempGame = new Chess();
      tempGame.loadPgn(pgnString.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim());
      const whitePlayer = tempGame.header().White;
      const uColor = (whitePlayer?.toLowerCase() === chessComUsername.toLowerCase()) ? 'w' : 'b';
      userColorRef.current = uColor;
      setBoardOrientation(uColor === 'w' ? 'white' : 'black');
      setPlayers({ white: tempGame.header().White || 'White', black: tempGame.header().Black || 'Black' });
      const history = tempGame.history({ verbose: true });
      const fens: string[] = [];
      const moveSqs: any[] = [null];
      const replayGame = new Chess();
      if (tempGame.header().FEN) replayGame.load(tempGame.header().FEN);
      fens.push(replayGame.fen());
      for (const move of history) {
        replayGame.move(move.san);
        fens.push(replayGame.fen());
        moveSqs.push({ from: move.from, to: move.to });
      }

      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'stop' }));
      }
      setAnalysisStartTime(null);
      evalRef.current = null;
      setCandidates([]);
      setEvaluation(null);

      setAllFens(fens);
      allFensRef.current = fens;
      setLastMoveSquares(moveSqs);
      setMoveHistory(history.map(m => m.san));
      setPgnResult(tempGame.header().Result || null);
      originalGameRef.current = { allFens: fens, moveHistory: history.map(m => m.san), lastMoveSquares: moveSqs };
      
      setCurrentIndex(0);
      setFen(fens[0]);
      setPgn(pgnString);

      const gameUrl = tempGame.header().Link || '';
      const gameId = gameUrl.split('/').pop();

      graphDataRef.current = fens.map((_, i) => ({ move: i, eval: 0, quality: 'normal' }));
      statsRef.current = { brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 };
      opponentStatsRef.current = { brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 };

      if (gameId) {
        fetch(`/api/analysis/${gameId}`)
          .then(res => {
            if (res.ok) return res.json();
            throw new Error('No pre-analysis found');
          })
          .then(data => {
            console.log('[App] Using pre-analyzed results from backend');
            setIsPreAnalyzed(data.analysisDepth || 30);
            const preEvalData = data.evaluations.map((e: any) => ({
              move: e.move,
              eval: typeof e.eval === 'string' ? (e.eval.startsWith('M') ? (parseFloat(e.eval.substring(1)) > 0 ? 10 : -10) : parseFloat(e.eval)) : e.eval,
              quality: 'normal' 
            }));

            for (let i = 1; i < preEvalData.length; i++) {
              const score = preEvalData[i].eval;
              const prevEval = preEvalData[i-1].eval;
              const delta = (i % 2 !== 0) ? (score - prevEval) : (prevEval - score);
              let quality = 'normal';
              if (delta >= 2.0 && Math.abs(prevEval) < 2.0) quality = 'brilliant';
              else if (delta >= 1.0) quality = 'great';
              else if (delta >= -0.1) quality = 'best';
              else if (delta <= -3.0) quality = 'blunder';
              else if (delta <= -1.5) quality = 'miss';
              else if (delta <= -0.8) quality = 'mistake';
              preEvalData[i].quality = quality;
              
              const playerMoved = (i % 2 !== 0) ? 'w' : 'b';
              const isUser = userColorRef.current === playerMoved;
              const s = isUser ? statsRef.current : opponentStatsRef.current;
              if (quality === 'brilliant') s.brilliant++;
              else if (quality === 'great') s.great++;
              else if (quality === 'best') s.best++;
              else if (quality === 'mistake') s.mistake++;
              else if (quality === 'miss') s.miss++;
              else if (quality === 'blunder') s.blunder++;
            }

            graphDataRef.current = preEvalData;
            isScanningRef.current = false;
            scanQueueRef.current = [];
            startMainAnalysis();
          })
          .catch(() => {
            setIsPreAnalyzed(false);
            scanQueueRef.current = fens.map((f, i) => ({ fen: f, index: i }));
            isScanningRef.current = false;
            processNextScan();
          });
      } else {
        setIsPreAnalyzed(false);
        scanQueueRef.current = fens.map((f, i) => ({ fen: f, index: i }));
        isScanningRef.current = false;
        processNextScan();
      }
    } catch (e) { console.error(e); }
  };

  const fetchGames = async (usernameOverride?: string) => {
    setLoadingGames(true);
    const targetUsername = usernameOverride || chessComUsername;
    try {
      const [archivesRes, analyzedIdsRes] = await Promise.all([
        fetch(`https://api.chess.com/pub/player/${targetUsername}/games/archives`),
        fetch('/api/analyzed-ids')
      ]);
      
      const archivesData = await archivesRes.json();
      if (analyzedIdsRes.ok) {
        const ids = await analyzedIdsRes.json();
        setAnalyzedGameIds(ids);
      }

      const latest = archivesData.archives[archivesData.archives.length - 1];
      const gRes = await fetch(latest);
      const gData = await gRes.json();
      setChessComGames(gData.games.reverse().slice(0, 10));
    } catch (e) {
      console.error('Failed to fetch games', e);
    }
    setLoadingGames(false);
  };

  const fetchLocalGames = async () => {
    setLoadingLocal(true);
    try {
      const res = await fetch('/api/local-games');
      if (res.ok) {
        const data = await res.json();
        setLocalGames(data);
      }
    } catch (e) {
      console.error('Failed to fetch local games', e);
    }
    setLoadingLocal(false);
  };

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (data.chessComUsername) {
          setChessComUsername(data.chessComUsername);
          if (data.timezone) setTimezone(data.timezone);
          fetchGames(data.chessComUsername);
          fetchLocalGames();
        }
      })
      .catch(e => console.error('Failed to fetch config', e));
  }, []);

  const currentMoveQuality = graphData[currentIndex]?.quality;
  const getQualityLabel = (q: string | undefined) => {
    if (!q) return null;
    const isUser = userColorRef.current === (currentIndex % 2 !== 0 ? 'w' : 'b');
    const colorLabel = (currentIndex % 2 !== 0) ? 'W' : 'B';
    const prefix = isUser ? '' : `(${colorLabel}) `;
    switch(q) {
      case 'brilliant': return { label: `${prefix}Brilliant!!`, icon: '!!' };
      case 'great': return { label: `${prefix}Great!`, icon: '!' };
      case 'best': return { label: `${prefix}Best`, icon: '★' };
      case 'mistake': return { label: `${prefix}Mistake`, icon: '?' };
      case 'miss': return { label: `${prefix}Miss`, icon: 'X' };
      case 'blunder': return { label: `${prefix}Blunder`, icon: '??' };
      default: return null;
    }
  };
  const qualityInfo = getQualityLabel(currentMoveQuality);

  const filteredCandidates = useMemo(() => {
    if (candidates.length === 0) return [];
    return candidates.filter((c, i) => {
      if (i === 0) return true;
      const bestScore = parseFloat(candidates[0].score);
      const currentScore = parseFloat(c.score);
      if (isNaN(bestScore) || isNaN(currentScore)) return true;
      const isWhiteTurn = fen.includes(' w ');
      const diff = isWhiteTurn ? (bestScore - currentScore) : (currentScore - bestScore);
      return diff <= 1.0;
    });
  }, [candidates, fen]);

  const currentStatus = useMemo(() => {
    const game = new Chess(fen);
    if (game.isCheckmate()) return game.turn() === 'w' ? 'Black wins by Checkmate' : 'White wins by Checkmate';
    if (game.isStalemate()) return 'Draw by Stalemate';
    if (game.isThreefoldRepetition()) return 'Draw by Threefold Repetition';
    if (game.isInsufficientMaterial()) return 'Draw by Insufficient Material';
    if (game.isDraw()) return 'Draw';
    
    if (currentIndex === allFens.length - 1 && pgnResult && pgnResult !== '*') {
      if (pgnResult === '1-0') return 'White wins';
      if (pgnResult === '0-1') return 'Black wins';
      if (pgnResult === '1/2-1/2') return 'Draw';
      return `Result: ${pgnResult}`;
    }
    return null;
  }, [fen, currentIndex, allFens.length, pgnResult]);

  return (
    <div className="container">
      <header><h1>Chess Analysis Tool</h1></header>
      <main className="main-content">
        <div className="board-section">
          <div className="board-container">
            <EvaluationBar evaluation={evaluation} />
            <div className="board-wrapper" onContextMenu={(e) => e.preventDefault()}>
              <Chessboard position={fen} boardOrientation={boardOrientation}
                onPieceDrop={(s, t) => {
                  // Only allow moves at the latest position to avoid invalid move errors
                  if (currentIndex !== allFens.length - 1) {
                    return false;
                  }

                  const game = new Chess(fen);
                  try {
                    const move = game.move({ from: s, to: t, promotion: 'q' });
                    if (move) {
                      const newFen = game.fen();
                      
                      setAllFens(prev => {
                        const next = [...prev, newFen];
                        allFensRef.current = next;
                        return next;
                      });

                      setLastMoveSquares(prev => [...prev, { from: s, to: t }]);
                      setMoveHistory(prev => [...prev, move.san]);
                      setCurrentIndex(prev => prev + 1);
                      setFen(newFen);

                      const newIndex = allFens.length; // Length before state update
                      const newPoint = { move: newIndex, eval: graphDataRef.current[newIndex - 1]?.eval || 0, quality: 'normal' };
                      
                      const updatedGraph = [...graphDataRef.current];
                      if (updatedGraph.length <= newIndex) {
                        updatedGraph.push(newPoint);
                        graphDataRef.current = updatedGraph;
                        setGraphData([...updatedGraph]);
                      }
                      
                      scanQueueRef.current.push({ fen: newFen, index: newIndex });
                      processNextScan();

                      return true;
                    }
                  } catch (e: any) {
                    console.error("Move error:", e);
                  }
                  return false;
                }}
                onSquareClick={() => goToMove(currentIndex + 1)}
                onSquareRightClick={() => goToMove(currentIndex - 1)}
                animationDuration={300}
                customArrows={filteredCandidates.map((c: any, i: number) => [c.move.substring(0, 2), c.move.substring(2, 4), ['rgba(0, 255, 0, 0.8)', 'rgba(255, 255, 0, 0.6)', 'rgba(255, 165, 0, 0.4)'][i]])}
                customSquareStyles={{
                  ...(lastMoveSquares[currentIndex] ? {
                    [lastMoveSquares[currentIndex].from]: { backgroundColor: 'rgba(255, 255, 0, 0.4)' },
                    [lastMoveSquares[currentIndex].to]: { backgroundColor: 'rgba(255, 255, 0, 0.4)' }
                  } : {})
                }}
              />
              {currentStatus && (
                <div className="game-over-overlay">
                  <div className="game-over-badge">{currentStatus}</div>
                </div>
              )}
            </div>
          </div>
          <div className="players-footer">
            <span className="player-name">White: {players.white}</span>
            <span className="vs-divider">vs</span>
            <span className="player-name">Black: {players.black}</span>
          </div>
          <div className="navigation-controls">
            <button onClick={() => setBoardOrientation(prev => prev === 'white' ? 'black' : 'white')} className="nav-btn flip-btn">Flip Board</button>
            <button onClick={() => goToMove(0)} className="nav-btn">|&lt;</button>
            <button onClick={() => goToMove(currentIndex - 1)} disabled={currentIndex === 0} className="nav-btn">&lt;</button>
            <button onClick={() => goToMove(currentIndex + 1)} disabled={currentIndex === allFens.length - 1} className="nav-btn">&gt;</button>
            <button onClick={() => goToMove(allFens.length - 1)} className="nav-btn">&gt;|</button>
          </div>
          <div className="move-history">
            <h3>History</h3>
            <div className="history-list">
              <span className={`move-item ${currentIndex === 0 ? 'active-move' : ''}`} onClick={() => goToMove(0)}>Start</span>
              {moveHistory.map((move, index) => (
                <span key={index} className={`move-item ${index + 1 === currentIndex ? 'active-move' : ''}`} onClick={() => goToMove(index + 1)}>
                  {index % 2 === 0 ? `${Math.floor(index / 2) + 1}. ` : ''}{move}{' '}
                </span>
              ))}
            </div>
          </div>
          <div className="eval-bar-container">
            <div className="eval-info">
              {currentStatus ? (
                <p className="game-status-text">Result: <strong>{currentStatus}</strong></p>
              ) : (
                <p>Evaluation: <strong>{evaluation || 'Calculating...'}</strong> <span className="engine-timer">({elapsedTime})</span></p>
              )}
              <p>Move: <strong>{currentIndex} / {allFens.length - 1}</strong></p>
            </div>
            <button onClick={() => {
              const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
              setAllFens([startFen]);
              allFensRef.current = [startFen];
              setMoveHistory([]);
              setCurrentIndex(0);
              setFen(startFen);
              setPgnResult(null);
              setIsPreAnalyzed(false);
              graphDataRef.current = [{ move: 0, eval: 0, quality: 'normal' }];
              statsRef.current = { brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 };
              opponentStatsRef.current = { brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 };
              scanQueueRef.current = [{ fen: startFen, index: 0 }];
              processNextScan();
            }} className="btn-reset">Reset</button>
          </div>
        </div>
        <div className="sidebar">
          <div className="graph-container">
            <div className="graph-header">
              <h3>Evaluation Graph</h3>
              {isPreAnalyzed && <span className="pre-analyzed-badge">Deep Analysis (Depth {isPreAnalyzed})</span>}
              <div className="current-eval-badge">
                {evaluation ? (evaluation.startsWith('M') ? evaluation : (parseFloat(evaluation) > 0 ? `+${evaluation}` : evaluation)) : '0.00'}
              </div>
            </div>
            <div style={{ height: '100px', width: '310px' }}>
              <EvaluationGraphView data={graphData} currentIndex={currentIndex} onJump={(idx: number) => goToMove(idx, true)} boardOrientation={boardOrientation} />
            </div>
            <div className="quality-indicator-wrapper">
              {qualityInfo && (
                <div className={`move-quality-box ${currentMoveQuality}`}>
                  <span className="quality-icon">{qualityInfo.icon}</span>
                  <span className="quality-text">{qualityInfo.label}</span>
                </div>
              )}
            </div>
          </div>
          <div className="game-review">
            <div className="review-grid">
              <div className="review-col">
                <h4 className="user">YOU</h4>
                <div className="stat-row"><span className="badge brilliant">!!</span> {stats.brilliant}</div>
                <div className="stat-row"><span className="badge great">!</span> {stats.great}</div>
                <div className="stat-row"><span className="badge best">★</span> {stats.best}</div>
                <div className="stat-row"><span className="badge mistake">?</span> {stats.mistake}</div>
                <div className="stat-row"><span className="badge miss">X</span> {stats.miss}</div>
                <div className="stat-row"><span className="badge blunder">??</span> {stats.blunder}</div>
              </div>
              <div className="review-col">
                <h4 className="opponent">OPPONENT</h4>
                <div className="stat-row"><span className="badge brilliant">!!</span> {opponentStats.brilliant}</div>
                <div className="stat-row"><span className="badge great">!</span> {opponentStats.great}</div>
                <div className="stat-row"><span className="badge best">★</span> {opponentStats.best}</div>
                <div className="stat-row"><span className="badge mistake">?</span> {opponentStats.mistake}</div>
                <div className="stat-row"><span className="badge miss">X</span> {opponentStats.miss}</div>
                <div className="stat-row"><span className="badge blunder">??</span> {opponentStats.blunder}</div>
              </div>
            </div>
          </div>
          <div className="candidates-list">
            <div className="candidates-header">
              <h3>Top Lines</h3>
              <span className="engine-timer-inline">({elapsedTime})</span>
            </div>
            <div className="arrow-legend">
              <span className="legend-item"><span className="dot best"></span>Best</span>
              <span className="legend-item"><span className="dot second"></span>2nd</span>
              <span className="legend-item"><span className="dot third"></span>3rd</span>
            </div>
            <table>
              <thead><tr><th>#</th><th>Move</th><th>Score</th></tr></thead>
              <tbody>
                {filteredCandidates.map((c: any) => (
                  <tr key={c.rank} onClick={() => goToMove(currentIndex + 1)} style={{cursor: 'pointer'}}>
                    <td>{c.rank}</td><td><strong>{c.move}</strong></td><td>{c.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="chess-com-import">
            <h3>Chess.com Import ({chessComUsername})</h3>
            <div className="import-legend">
              <span className="analyzed-status-dot">●</span> Deep Analysis Available
            </div>
            <button onClick={() => fetchGames()} disabled={loadingGames}>{loadingGames ? '...' : 'Fetch Recent Games'}</button>
            <div className="games-list">
              {chessComGames.map((g, i) => {
                const gameId = g.url.split('/').pop();
                const isAnalyzed = analyzedGameIds.includes(gameId);
                return (
                  <div key={i} className={`game-item ${isAnalyzed ? 'analyzed' : ''}`} onClick={() => processPgn(g.pgn)}>
                    <div className="game-item-info">
                      {g.white.username} vs {g.black.username}
                      <div className="game-date">
                        {new Date(g.end_time * 1000).toLocaleString('en-US', { timeZone: timezone })}
                      </div>
                    </div>
                    {isAnalyzed && <span className="analyzed-status-dot" title="Deep Analysis Available">●</span>}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="local-games-import">
            <h3>Local Saved Games</h3>
            <button onClick={fetchLocalGames} disabled={loadingLocal}>{loadingLocal ? '...' : 'Refresh Local Games'}</button>
            <div className="games-list">
              {localGames.length === 0 ? <div className="no-games">No local games found</div> : 
                localGames.map((g, i) => (
                  <div key={i} className="game-item analyzed" onClick={() => processPgn(g.pgn)}>
                    <div className="game-item-info">
                      {g.white} vs {g.black} ({g.result})
                      <div className="game-date">{formatPgnDate(g.date, g.time, timezone)}</div>
                    </div>
                    <span className="analyzed-status-dot">●</span>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
