import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, ReferenceLine, Tooltip } from 'recharts';
import './App.css';

// --- Types ---
interface GraphPoint {
  move: number;
  eval: number;
  quality?: 'brilliant' | 'great' | 'best' | 'mistake' | 'miss' | 'blunder' | 'normal';
  analyzed?: boolean;
}

// --- Utilities ---

/**
 * Standard Chess Evaluation Parser (Always White-POV)
 * Positive = White advantage, Negative = Black advantage.
 */
const parseStockfishScore = (line: string, turn: 'w' | 'b') => {
  const cpMatch = line.match(/score\s+cp\s+(-?\d+)/);
  const mateMatch = line.match(/score\s+mate\s+(-?\d+)/);
  if (!cpMatch && !mateMatch) return null;

  const side = (turn === 'w') ? 1 : -1;
  let score = 0;
  let label = '';

  if (cpMatch) {
    const cp = parseInt(cpMatch[1]);
    // Stockfish cp is relative to side-to-move. White-POV = cp * side / 100
    score = (side * cp) / 100;
    const sign = score > 0 ? '+' : (score < 0 ? '-' : '');
    label = `${sign}${Math.abs(score).toFixed(2)}`;
    if (Math.abs(score) < 0.001) label = '0.00';
  } else if (mateMatch) {
    const mateIn = parseInt(mateMatch[1]);
    // mateIn > 0 means current side wins. White-POV (+10/-10)
    score = side * (mateIn > 0 ? 10 : -10);
    const mateSym = score > 0 ? '+' : '-';
    label = `M${mateSym}${Math.abs(mateIn)}`;
  }
  return { score, label };
};

const parseEvalValue = (val: string | number) => {
  if (typeof val === 'string') {
    if (val.startsWith('M+')) return 10;
    if (val.startsWith('M-')) return -10;
    const parsed = parseFloat(val);
    return isNaN(parsed) ? 0 : parsed;
  }
  return typeof val === 'number' && !isNaN(val) ? val : 0;
};

const postProcessGraphData = (data: GraphPoint[], fens: string[]) => {
  const processed = data.map(d => ({ ...d }));
  for (let i = fens.length - 1; i >= 0; i--) {
    if (!processed[i]) continue;

    const fen = fens[i];
    try {
      const chessObj = new Chess(fen);
      if (chessObj.isCheckmate()) {
        processed[i].eval = fen.split(' ')[1] === 'w' ? -10 : 10;
        processed[i].analyzed = true;
      } else if (chessObj.isDraw() && chessObj.moves().length === 0) {
        processed[i].eval = 0;
        processed[i].analyzed = true;
      } else if (chessObj.moves().length === 1) {
        if (processed[i + 1] && processed[i + 1].analyzed) {
          processed[i].eval = processed[i + 1].eval;
          processed[i].analyzed = true;
        }
      }
    } catch (e) {
      console.error('Error post-processing FEN:', e);
    }
  }
  return processed;
};

/**
 * Returns 'winning' if the user has the advantage, 'losing' otherwise.
 * Handles both numeric scores and formatted strings (M+1, -1.50, etc.)
 */
const getEvalColorClass = (val: string | number | null, userColor: 'w' | 'b' | null) => {
  if (val === null || !userColor) return '';

  let score = 0;
  if (typeof val === 'string') {
    if (val.startsWith('M')) {
      const isWhiteWinning = val.includes('+');
      const isWinning = (userColor === 'w' && isWhiteWinning) || (userColor === 'b' && !isWhiteWinning);
      const isLosing = (userColor === 'w' && !isWhiteWinning) || (userColor === 'b' && isWhiteWinning);
      return isWinning ? 'winning' : (isLosing ? 'losing' : '');
    }
    score = parseFloat(val);
  } else {
    score = val;
  }

  if (isNaN(score) || Math.abs(score) < 0.001) return '';
  const isWinning = (userColor === 'w' && score > 0) || (userColor === 'b' && score < 0);
  const isLosing = (userColor === 'w' && score < 0) || (userColor === 'b' && score > 0);
  return isWinning ? 'winning' : (isLosing ? 'losing' : '');
};
// --- Sub-Components ---

const CustomTooltip = ({ active, payload, userColor }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const evalNum = data.eval;
    
    const sign = evalNum > 0 ? '+' : (evalNum < 0 ? '-' : '');
    let displayVal = `${sign}${Math.abs(evalNum).toFixed(2)}`;
    if (Math.abs(evalNum) < 0.001) displayVal = '0.00';
    if (Math.abs(evalNum) >= 9.9) displayVal = evalNum > 0 ? 'M+' : 'M-';

    const colorClass = getEvalColorClass(evalNum, userColor);

    return (
      <div className="custom-graph-tooltip-mini">
        M{data.move}: <span className={`tooltip-eval-val ${colorClass}`}>{displayVal}</span>
      </div>
    );
  }
  return null;
};

const EvaluationBar = memo(({ evaluation }: { evaluation: string | null, userColor: 'w' | 'b' | null }) => {
  const getEvalPercentage = () => {
    if (!evaluation) return 50;
    
    let whitePovScore = 0;
    if (evaluation.startsWith('M')) {
      return evaluation.includes('+') ? 100 : 0;
    } else {
      whitePovScore = parseFloat(evaluation);
    }
    
    if (isNaN(whitePovScore)) return 50;
    // White wins = 100%, Black wins = 0%
    const percent = 50 + (whitePovScore / 10) * 50;
    return Math.max(0, Math.min(100, percent));
  };

  return (
    <div className="evaluation-bar" title={`Evaluation: ${evaluation || '0.00'}`}>
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

const EvaluationGraphView = memo(({ data, currentIndex, onJump, branchingPoint, userColor, onHover }: any) => {
  if (data.length === 0) {
    return <div style={{ height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: '12px' }}>Analyzing...</div>;
  }

  // visual orientation is FIXED to White-POV (Up=White, Down=Black)
  const orientedData = data.map((d: any) => ({
    ...d,
    displayEval: Math.max(-10, Math.min(10, d.eval))
  }));

  const handleClick = (d: any) => {
    if (d && d.activeTooltipIndex !== undefined) {
      onJump(d.activeTooltipIndex, true);
      window.focus();
    }
  };

  const handleMouseMove = (d: any) => {
    if (d && d.activeTooltipIndex !== undefined) {
      const idx = d.activeTooltipIndex;
      
      const point = data[idx] || data[0];
      const pEval = point.eval;
      const pSign = pEval > 0 ? '+' : (pEval < 0 ? '-' : '');
      let pLabel = `${pSign}${Math.abs(pEval).toFixed(2)}`;
      if (Math.abs(pEval) < 0.001) pLabel = '0.00';
      if (Math.abs(pEval) >= 9.9) pLabel = pEval > 0 ? 'M+' : 'M-';

      if (onHover) onHover(idx, pLabel);
    } else {
      if (onHover) onHover(null, null);
    }
  };

  return (
    <div className="graph-wrapper-relative" onMouseLeave={() => {
      if (onHover) onHover(null, null);
    }}>
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={orientedData}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          margin={{ top: 10, right: 5, left: 5, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" />
          <XAxis dataKey="move" hide />
          <YAxis domain={[-10, 10]} hide />
          <Tooltip 
            content={<CustomTooltip userColor={userColor} />} 
            isAnimationActive={false} 
            cursor={false}
            active={false}
          />
          <ReferenceLine y={0} stroke="#444" />
          {branchingPoint !== null && (
            <ReferenceLine x={branchingPoint} stroke="#ff9800" strokeWidth={1} strokeDasharray="5 5" />
          )}
          <ReferenceLine x={currentIndex} stroke="#4caf50" strokeWidth={2} strokeDasharray="3 3" />
          <Line 
            type="monotone" 
            dataKey="displayEval" 
            stroke="#4caf50" 
            strokeWidth={2} 
            dot={<CustomDot />} 
            activeDot={false}
            isAnimationActive={false} 
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
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
  const [pgnResult, setPgnResult] = useState<string | null>(null);
  const [chessComGames, setChessComGames] = useState<any[]>([]);
  const [loadingGames, setLoadingGames] = useState(false);
  const [boardOrientation, setBoardOrientation] = useState<'white' | 'black'>('white');
  const [players, setPlayers] = useState({ white: 'White', black: 'Black' });
  const [chessComUsername, setChessComUsername] = useState('mebukichi');
  const [timezone, setTimezone] = useState('America/Los_Angeles');
  const [scanDepth, setScanDepth] = useState<number>(22);
  const [analysisDepth, setAnalysisDepth] = useState<number>(30);
  const [isPreAnalyzed, setIsPreAnalyzed] = useState<number | false>(false);
  const [analyzedGameIds, setAnalyzedGameIds] = useState<string[]>([]);
  const [currentlyAnalyzingGameId, setCurrentlyAnalyzingGameId] = useState<string | null>(null);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState<number | false>(false);
  const [scanQueueLength, setScanQueueLength] = useState(0);
  const [localGames, setLocalGames] = useState<any[]>([]);
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [branchingPoint, setBranchingPoint] = useState<number | null>(null);

  const [evaluation, setEvaluation] = useState<string | null>(null);

  const [showGraphOverlay, setShowGraphOverlay] = useState(false);
  const [graphHoverIdx, setGraphHoverIdx] = useState<number | null>(null);
  const [graphHoverEval, setGraphHoverEval] = useState<string | null>(null);

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
  const currentScanEvalRef = useRef<{ score: number; label: string; quality: any } | null>(null);
  const statsRef = useRef<any>({ brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 });
  const opponentStatsRef = useRef<any>({ brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 });
  const [userColor, setUserColor] = useState<'w' | 'b' | null>(null);
  const userColorRef = useRef<'w' | 'b' | null>(null);
  useEffect(() => { userColorRef.current = userColor; }, [userColor]);
  const originalGameRef = useRef<any>(null);
  const originalGraphDataRef = useRef<GraphPoint[]>([]);
  const currentGameIdRef = useRef<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);

  const fenRef = useRef(fen); 
  const scanQueueRef = useRef<{fen: string, index: number}[]>([]);
  const isScanningRef = useRef<number | false>(false);
  const currentMoveQualityRef = useRef<any>(null);
  const lastAnalyzedFenRef = useRef<string | null>(null);
  const mainAnalysisTurnRef = useRef<'w' | 'b' | null>(null);

  useEffect(() => {
    fenRef.current = fen;
  }, [fen]);

  const scanTimeoutRef = useRef<any>(null);

  const processNextScan = useCallback(() => {
    if (scanQueueRef.current.length === 0) {
      console.log('[App] [DEBUG] processNextScan: queue empty');
      if (isScanningRef.current === false) {
        setIsScanning(false);
        setScanQueueLength(0);
      }
      return;
    }

    if (isScanningRef.current !== false) {
      console.log(`[App] [DEBUG] processNextScan: already scanning move ${isScanningRef.current}`);
      setIsScanning(isScanningRef.current);
      setScanQueueLength(scanQueueRef.current.length);
      return;
    }

    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      console.log('[App] [DEBUG] processNextScan: WS not ready (state=' + (socketRef.current?.readyState ?? 'null') + '), retrying in 500ms');
      setTimeout(() => processNextScan(), 500);
      return;
    }

    const next = scanQueueRef.current.shift();
    if (next) {
      console.log(`[App] [DEBUG] processNextScan: [START] move ${next.index}, remaining=${scanQueueRef.current.length}`);
      isScanningRef.current = next.index;
      setIsScanning(next.index);
      setScanQueueLength(scanQueueRef.current.length);
      currentMoveQualityRef.current = null;
      socketRef.current.send(JSON.stringify({ type: 'scan_position', fen: next.fen, index: next.index }));

      // Watchdog: Reset scanning state if it takes too long (10s)
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = setTimeout(() => {
        console.log(`[App] [DEBUG] Scan watchdog triggered for move ${next.index}. Force resetting scan engine...`);
        
        // 1. Tell backend to respawn the scan engine to discard any stale search process
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: 'respawn_scan_engine' }));
        }

        // 2. Safely capture the best eval we got so far (or default to 0/normal)
        let score = 0;
        let quality: any = 'normal';
        if (currentScanEvalRef.current) {
          score = currentScanEvalRef.current.score;
          quality = currentScanEvalRef.current.quality;
        }
        currentScanEvalRef.current = null; // Clear ref

        // 3. Write it into the graph state and save it
        const idx = next.index;
        if (typeof idx === 'number' && allFensRef.current[idx] && currentGameIdRef.current) {
          const newData = [...graphDataRef.current];
          while (newData.length <= idx) newData.push({ move: newData.length, eval: 0, quality: 'normal' });

          newData[idx] = { move: idx, eval: score, quality: quality, analyzed: true };

          const processedData = postProcessGraphData(newData, allFensRef.current);
          graphDataRef.current = processedData;

          if (branchingPoint === null || idx <= branchingPoint) {
            const mainData = [...originalGraphDataRef.current];
            if (mainData[idx]) {
              mainData[idx] = { ...mainData[idx], eval: score, quality: quality, analyzed: true };
              originalGraphDataRef.current = postProcessGraphData(mainData, allFensRef.current);
            }
          }

          setGraphData([...processedData]);

          const localKey = `analysis_${currentGameIdRef.current}`;
          const evalData = processedData.filter(d => d.analyzed).map(d => ({ move: d.move, eval: d.eval, quality: d.quality }));
          localStorage.setItem(localKey, JSON.stringify({ evaluations: evalData }));

          if (idx % 5 === 0 || scanQueueRef.current.length === 0) {
             fetch('/api/save-analysis', {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({
                 gameId: currentGameIdRef.current,
                 evaluations: evalData,
                 pgn: (window as any).lastPgn,
                 white: players.white,
                 black: players.black,
                 analysisDepth: scanDepth
               })
             }).catch(err => console.error('Failed to save analysis to server', err));
          }
        }

        // 4. Reset scanning state and schedule next scan with a short delay (200ms) to allow backend spawn
        isScanningRef.current = false;
        setIsScanning(false);
        setTimeout(() => {
          processNextScan();
        }, 200);
      }, 10000);
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
        mainAnalysisTurnRef.current = 'w';
        return;
      }
      
      if (evalRef.current === null || lastAnalyzedFenRef.current !== fenRef.current) {
        console.log('[App] Requesting main analysis');
        lastAnalyzedFenRef.current = fenRef.current;
        mainAnalysisTurnRef.current = fenRef.current.split(' ')[1] as 'w' | 'b';
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
      graphDataRef.current = [{ move: 0, eval: 0, quality: 'normal', analyzed: true }];
      scanQueueRef.current.push({ fen: allFens[0], index: 0 });
      setScanQueueLength(scanQueueRef.current.length);
      processNextScan();
    }
  }, [allFens, processNextScan]);

  const [wsStatus, setWsStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');

  // WebSocket for Analysis
  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: any = null;
    let isMounted = true;

    const connect = () => {
      if (!isMounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      console.log(`[App] Connecting to WebSocket via proxy at ${protocol}//${host}/ws`);

      socket = new WebSocket(`${protocol}//${host}/ws`);
      socketRef.current = socket;
      setWsStatus('connecting');

      socket.onopen = () => {
        if (!isMounted) return;
        console.log('[App] WebSocket Connected');
        setWsStatus('open');
        socket?.send(JSON.stringify({ type: 'uci' }));
        if (scanQueueRef.current.length === 0) {
          startMainAnalysis();
        } else {
          processNextScan();
        }
      };

      socket.onclose = () => {
        if (!isMounted) return;
        console.log('[App] WebSocket Disconnected. Retrying in 3s...');
        setWsStatus('closed');
        reconnectTimer = setTimeout(connect, 3000);
      };

      socket.onerror = (err) => {
        console.error('[App] WebSocket Error:', err);
      };

      socket.onmessage = (event) => {
        if (!isMounted) return;
        const message = JSON.parse(event.data);

        // Prioritize scan engine messages
        if (message.engine === 'scan' || message.type === 'scan_complete') {
          if (message.type === 'scan_complete') {
            const idx = message.index !== undefined ? message.index : isScanningRef.current;
            if (idx !== isScanningRef.current || isScanningRef.current === false) {
              console.log('[App] Ignoring stale scan_complete');
              return;
            }
            if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
            
            // Retrieve evaluation and quality from temp Ref
            let score = 0;
            let q: any = 'normal';
            if (currentScanEvalRef.current) {
              score = currentScanEvalRef.current.score;
              q = currentScanEvalRef.current.quality;
            }
            currentScanEvalRef.current = null; // Clear ref

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

            if (typeof idx === 'number' && allFensRef.current[idx] && currentGameIdRef.current) {
              const newData = [...graphDataRef.current];
              while (newData.length <= idx) newData.push({ move: newData.length, eval: 0, quality: 'normal' });

              newData[idx] = { move: idx, eval: score, quality: q, analyzed: true };

              const processedData = postProcessGraphData(newData, allFensRef.current);
              graphDataRef.current = processedData;

              if (branchingPoint === null || idx <= branchingPoint) {
                const mainData = [...originalGraphDataRef.current];
                if (mainData[idx]) {
                  mainData[idx] = { ...mainData[idx], eval: score, quality: q, analyzed: true };
                  originalGraphDataRef.current = postProcessGraphData(mainData, allFensRef.current);
                }
              }

              setGraphData([...processedData]);

              const localKey = `analysis_${currentGameIdRef.current}`;
              const evalData = processedData.filter(d => d.analyzed).map(d => ({ move: d.move, eval: d.eval, quality: d.quality }));
              localStorage.setItem(localKey, JSON.stringify({ evaluations: evalData }));

              if (idx % 5 === 0 || scanQueueRef.current.length === 0) {
                 fetch('/api/save-analysis', {
                   method: 'POST',
                   headers: { 'Content-Type': 'application/json' },
                   body: JSON.stringify({
                     gameId: currentGameIdRef.current,
                     evaluations: evalData,
                     pgn: (window as any).lastPgn,
                     white: players.white,
                     black: players.black,
                     analysisDepth: scanDepth
                   })
                 }).catch(err => console.error('Failed to save analysis to server', err));
              }
            }

            if (scanQueueRef.current.length > 0) {
              setScanQueueLength(scanQueueRef.current.length);
              processNextScan(); 
            } else {
              setIsScanning(false);
              setScanQueueLength(0);
              setCurrentlyAnalyzingGameId(null);
              setIsPreAnalyzed(scanDepth); // Set status to complete after local scan
              
              // Upgrade main engine to 1.0 threads
              if (socketRef.current?.readyState === WebSocket.OPEN) {
                console.log('[App] Scan complete - Upgrading main engine to full power');
                socketRef.current.send(JSON.stringify({ type: 'upgrade_main_engine' }));
              }

              if (currentGameIdRef.current) {
                const localKey = `analysis_${currentGameIdRef.current}`;
                const saved = localStorage.getItem(localKey);
                if (saved) {
                  try {
                    const parsed = JSON.parse(saved);
                    parsed.completed = true;
                    localStorage.setItem(localKey, JSON.stringify(parsed));
                  } catch(e) {}
                }
              }
              startMainAnalysis();
            }
            return;
          }

          if (message.type === 'info') {
            const lastIdx = message.index !== undefined ? message.index : isScanningRef.current;
            if (typeof lastIdx === 'number' && lastIdx === isScanningRef.current && allFensRef.current[lastIdx] && currentGameIdRef.current) {
              const turn = allFensRef.current[lastIdx].split(' ')[1] as 'w' | 'b';
              const parsed = parseStockfishScore(message.data, turn);
              if (parsed) {
                const { score, label } = parsed;
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

                currentScanEvalRef.current = { score, label, quality };
                currentMoveQualityRef.current = quality;
              }
            }
          }
          return;
        }

        // Main engine analysis
        if (message.type === 'info' && message.engine === 'main') {
          const line = message.data;
          const pvMatch = line.match(/multipv\s+(\d+)/);
          if (pvMatch) {
            const rank = parseInt(pvMatch[1]);
            const pvMoveMatch = line.match(/\spv\s+(\w+)/);
            const turn = mainAnalysisTurnRef.current || (fenRef.current.split(' ')[1] as 'w' | 'b');
            const parsed = parseStockfishScore(line, turn);

            if (parsed && pvMoveMatch) {
              const { label } = parsed;
              const cur = [...candidatesRef.current];
              const idx = cur.findIndex(c => c.rank === rank);
              if (idx >= 0) cur[idx] = { rank, score: label, move: pvMoveMatch[1] };
              else cur.push({ rank, score: label, move: pvMoveMatch[1] });
              candidatesRef.current = cur.sort((a, b) => a.rank - b.rank).slice(0, 3);
              if (rank === 1) evalRef.current = label;
            }
          }
        }
      };
    };

    connect();

    return () => {
      isMounted = false;
      if (socket) socket.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [processNextScan, startMainAnalysis]);
  useEffect(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN && fen) {
      startMainAnalysis();
    }
  }, [fen, startMainAnalysis]);

  const goToMove = useCallback((index: number, fromGraph = false) => {
    const targetIndex = Number(index);
    if (isNaN(targetIndex)) return;

    // Hide graph info overlay if navigating manually (not from graph click)
    if (!fromGraph) {
      setShowGraphOverlay(false);
    } else {
      setShowGraphOverlay(true);
    }

    // If going to or before the branch origin, restore main line
    if (branchingPoint !== null && targetIndex <= branchingPoint && originalGameRef.current) {
      const main = originalGameRef.current;
      setAllFens(main.allFens);
      allFensRef.current = main.allFens;
      setMoveHistory(main.moveHistory);
      setLastMoveSquares(main.lastMoveSquares);
      setBranchingPoint(null);

      // Stop and clear any ongoing scan tasks for the branch to prevent evaluation pollution
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'stop_scan' }));
      }
      isScanningRef.current = false;
      setIsScanning(false);
      scanQueueRef.current = [];
      setScanQueueLength(0);

      // Restore graph data to full main line
      const restoredGraph = [...originalGraphDataRef.current];
      graphDataRef.current = restoredGraph;
      setGraphData(restoredGraph);
      
      const safeIndex = Math.max(0, Math.min(targetIndex, main.allFens.length - 1));
      setCurrentIndex(safeIndex);
      setFen(main.allFens[safeIndex]);

      // Restart analysis for missing main line positions
      if (!isPreAnalyzed) {
        const missing = main.allFens.map((f: string, i: number) => ({ fen: f, index: i }))
          .filter((t: any) => t.index !== 0 && (!restoredGraph[t.index] || (restoredGraph[t.index].eval === 0 && restoredGraph[t.index].quality === 'normal')));
        
        if (missing.length > 0) {
          const currentQueueIndices = new Set(scanQueueRef.current.map(q => q.index));
          const toAdd = missing.filter((m: any) => !currentQueueIndices.has(m.index));
          if (toAdd.length > 0) {
            scanQueueRef.current = [...scanQueueRef.current, ...toAdd].sort((a, b) => a.index - b.index);
            processNextScan();
          }
        }
      }
      return;
    }

    if (targetIndex >= 0 && targetIndex < allFens.length) {
      setCurrentIndex(targetIndex);
      setFen(allFens[targetIndex]);
    }
  }, [allFens, branchingPoint, isPreAnalyzed, processNextScan]);

  const onJump = useCallback((idx: number, fromGraph = false) => {
    goToMove(idx, fromGraph);
  }, [goToMove]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowRight') {
        if (currentIndex < allFens.length - 1) {
          goToMove(currentIndex + 1);
        }
      }
      else if (e.key === 'ArrowLeft') {
        if (currentIndex > 0) {
          goToMove(currentIndex - 1);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, allFens.length, goToMove]);

  const clearLocalCache = () => {
    if (window.confirm('Clear all local analysis results from browser memory?')) {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('analysis_')) localStorage.removeItem(key);
      });
      window.location.reload();
    }
  };

  const processPgn = (pgnString: string) => {
    if (!pgnString) return;
    try {
      const tempGame = new Chess();
      tempGame.loadPgn(pgnString.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim());
      const whitePlayer = tempGame.header().White;
      const uColor = (whitePlayer?.toLowerCase() === chessComUsername.toLowerCase()) ? 'w' : 'b';
      setUserColor(uColor);
      setBoardOrientation(uColor === 'w' ? 'white' : 'black');      setPlayers({ white: tempGame.header().White || 'White', black: tempGame.header().Black || 'Black' });
      const history = tempGame.history({ verbose: true });
      const fens: string[] = [];
      const moveSqs: any[] = [null];
      const replayGame = new Chess();
      const fenHeader = tempGame.header().FEN;
      if (fenHeader) replayGame.load(fenHeader);
      fens.push(replayGame.fen());
      for (const move of history) {
        replayGame.move(move.san);
        fens.push(replayGame.fen());
        moveSqs.push({ from: move.from, to: move.to });
      }

      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'stop' }));
        socketRef.current.send(JSON.stringify({ type: 'stop_scan' }));
        socketRef.current.send(JSON.stringify({ type: 'uci' }));
      }
      setAnalysisStartTime(null);
      evalRef.current = null;
      candidatesRef.current = []; // Clear ref immediately
      setCandidates([]);
      setEvaluation(null);

      // Reset scanning state completely for the new game
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
      isScanningRef.current = false;
      setIsScanning(false);
      scanQueueRef.current = [];
      setScanQueueLength(0);

      setAllFens(fens);
      allFensRef.current = fens;
      setLastMoveSquares(moveSqs);
      setMoveHistory(history.map(m => m.san));
      setPgnResult(tempGame.header().Result || null);
      setBranchingPoint(null);
      originalGameRef.current = { allFens: fens, moveHistory: history.map(m => m.san), lastMoveSquares: moveSqs };
      
      setCurrentIndex(0);
      setFen(fens[0]);
      (window as any).lastPgn = pgnString;

      const gameUrl = tempGame.header().Link || '';
      const gameId = gameUrl.split('/').pop() || `temp_${Date.now()}`;
      currentGameIdRef.current = gameId;
      setCurrentlyAnalyzingGameId(gameId); // Set it early
      setSelectedGameId(gameId);

      const initialGraph = fens.map((_, i) => ({ move: i, eval: 0, quality: 'normal' as any, analyzed: i === 0 }));
      graphDataRef.current = initialGraph;
      originalGraphDataRef.current = [...initialGraph];
      statsRef.current = { brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 };
      opponentStatsRef.current = { brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 };
      setStats({ brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 });
      setOpponentStats({ brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 });

      // Load temporary results from localStorage
      const localKey = `analysis_${gameId}`;
      const saved = localStorage.getItem(localKey);
      const savedIndices = new Set<number>();
      savedIndices.add(0);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.evaluations) {
            console.log(`[App] [DEBUG] Loading ${parsed.evaluations.length} evals from localStorage`);
            const loadedData = [...graphDataRef.current];
            const s = { brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 };
            const os = { brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 };

            parsed.evaluations.forEach((e: any) => {
              if (loadedData[e.move]) {
                const quality = e.quality || 'normal';
                loadedData[e.move] = { ...loadedData[e.move], eval: parseEvalValue(e.eval), quality, analyzed: true };
                savedIndices.add(e.move);

                if (quality !== 'normal') {
                  const playerMoved = (e.move % 2 !== 0) ? 'w' : 'b';
                  const isUser = userColor === playerMoved;
                  const target = isUser ? s : os;
                  if (quality === 'brilliant') target.brilliant++;
                  else if (quality === 'great') target.great++;
                  else if (quality === 'best') target.best++;
                  else if (quality === 'mistake') target.mistake++;
                  else if (quality === 'miss') target.miss++;
                  else if (quality === 'blunder') target.blunder++;
                }
              }
            });
            const processedData = postProcessGraphData(loadedData, allFensRef.current);
            graphDataRef.current = processedData;
            originalGraphDataRef.current = [...processedData];
            setGraphData([...processedData]);
            statsRef.current = s;
            opponentStatsRef.current = os;
            setStats(s);
            setOpponentStats(os);
            if (parsed.completed) {
              setIsPreAnalyzed(parsed.analysisDepth || scanDepth);
            }
          }
        } catch (e) { console.error('Failed to load local analysis', e); }
      }

      if (gameUrl) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        fetch(`/api/analysis/${gameId}`, { signal: controller.signal })
          .then(res => {
            clearTimeout(timeoutId);
            if (res.ok) return res.json();
            throw new Error('No pre-analysis found');
          })
          .then(data => {
            if (currentGameIdRef.current !== gameId) return;
            console.log(`[App] [DEBUG] Pre-analysis fetch success: ${data.evaluations.length} positions`);
            setIsPreAnalyzed(data.analysisDepth || analysisDepth);
            
            // Merge backend data with existing (local) data
            const mergedData = [...graphDataRef.current];
            const s = { brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 };
            const os = { brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 };

            const hasDecimals = data.evaluations.some((ev: any) => typeof ev.eval === 'number' && ev.eval % 1 !== 0);
            const isLegacy = !hasDecimals && data.evaluations.some((ev: any) => typeof ev.eval === 'number' && Math.abs(ev.eval) >= 150);

            data.evaluations.forEach((e: any) => {
              if (mergedData[e.move]) {
                let evalVal = parseEvalValue(e.eval);
                if (isLegacy && Math.abs(evalVal) > 0.001 && typeof e.eval !== 'string') {
                  evalVal = evalVal / 100;
                }
                const quality = e.quality || 'normal';
                mergedData[e.move] = { ...mergedData[e.move], eval: evalVal, quality, analyzed: true };
                savedIndices.add(e.move);
              }
            });

            // Post-process to resolve checkmates and forced moves before recalculating qualities
            const processedData = postProcessGraphData(mergedData, fens);

            // Re-calculate all qualities and stats
            for (let i = 1; i < processedData.length; i++) {
              if (!processedData[i].analyzed) continue;
              const score = processedData[i].eval;
              const prevEval = processedData[i-1].eval;
              
              // Only recalculate quality if it's currently 'normal' or if it was never set (safety)
              if (processedData[i].quality === 'normal') {
                const delta = (i % 2 !== 0) ? (score - prevEval) : (prevEval - score);
                let quality: any = 'normal';
                if (delta >= 2.0 && Math.abs(prevEval) < 2.0) quality = 'brilliant';
                else if (delta >= 1.0) quality = 'great';
                else if (delta >= -0.1) quality = 'best';
                else if (delta <= -3.0) quality = 'blunder';
                else if (delta <= -1.5) quality = 'miss';
                else if (delta <= -0.8) quality = 'mistake';
                processedData[i].quality = quality;
              }
              
              const finalQuality = processedData[i].quality;
              if (finalQuality && finalQuality !== 'normal') {
                const playerMoved = (i % 2 !== 0) ? 'w' : 'b';
                const isUser = userColor === playerMoved;
                const target = isUser ? s : os;
                if (finalQuality === 'brilliant') target.brilliant++;
                else if (finalQuality === 'great') target.great++;
                else if (finalQuality === 'best') target.best++;
                else if (finalQuality === 'mistake') target.mistake++;
                else if (finalQuality === 'miss') target.miss++;
                else if (finalQuality === 'blunder') target.blunder++;
              }
            }

            graphDataRef.current = processedData;
            originalGraphDataRef.current = [...processedData];
            setGraphData([...processedData]);
            statsRef.current = s;
            opponentStatsRef.current = os;
            setStats(s);
            setOpponentStats(os);

            const missing = fens.map((f, i) => ({ fen: f, index: i }))
                                .filter(t => !savedIndices.has(t.index) && t.index !== 0);
            
            console.log(`[App] [DEBUG] After backend merge: missing count=${missing.length}`);
            if (missing.length > 0) {
               console.log('[App] [DEBUG] Missing indices:', missing.map(m => m.index));
            }
            if (missing.length === 0) {
              setCurrentlyAnalyzingGameId(null);
              // Backend complete, so we can clear local storage
              localStorage.removeItem(localKey);
            } else {
              setCurrentlyAnalyzingGameId(gameId);
              scanQueueRef.current = missing;
              isScanningRef.current = false;
              processNextScan();
            }
            startMainAnalysis();
          })
          .catch((err) => {
            if (currentGameIdRef.current !== gameId) return;
            clearTimeout(timeoutId);
            console.log('[App] [DEBUG] Pre-analysis fetch failed or timed out:', err.message);
            // Keep existing isPreAnalyzed if set by localStorage
            setIsPreAnalyzed(prev => prev || false);
            const missing = fens.map((f, i) => ({ fen: f, index: i }))
                                .filter(t => !savedIndices.has(t.index) && t.index !== 0);
            
            console.log(`[App] [DEBUG] processPgn (catch): missing count=${missing.length}`);
            if (missing.length === 0) {
              setCurrentlyAnalyzingGameId(null);
            } else {
              setCurrentlyAnalyzingGameId(gameId);
              scanQueueRef.current = missing;
              isScanningRef.current = false;
              processNextScan();
            }
          });
      } else {
        setIsPreAnalyzed(prev => prev || false);
        const missing = fens.map((f, i) => ({ fen: f, index: i }))
                            .filter(t => !savedIndices.has(t.index) && t.index !== 0);
        console.log(`[App] [DEBUG] processPgn (no-url): missing count=${missing.length}`);
        if (missing.length === 0) {
          setCurrentlyAnalyzingGameId(null);
          setIsPreAnalyzed(scanDepth); // Final safety check
        } else {
          setCurrentlyAnalyzingGameId(gameId);
          scanQueueRef.current = missing;
          isScanningRef.current = false;
          processNextScan();
        }
      }
    } catch (e) { console.error(e); }
  };

  const fetchGames = async (usernameOverride?: string, autoLoad = false) => {
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
      
      // Filter for finished games only: 
      // Chess.com games in archives are usually finished, but we check for 'pgn' 
      // and ensure the game isn't explicitly marked as ongoing.
      const finishedGames = gData.games.filter((g: any) => g.pgn && g.end_time).reverse();
      
      setChessComGames(finishedGames.slice(0, 10));
      
      // Auto-load latest finished game if requested and available
      if (autoLoad && finishedGames.length > 0) {
        processPgn(finishedGames[0].pgn);
      }
    } catch (e) {
      console.error('Failed to fetch games', e);
    }
    setLoadingGames(false);
  };

  const fetchLocalGames = async () => {
    setLoadingLocal(true);
    try {
      // Also fetch analyzed IDs to ensure status dots are correct after cache clear
      fetch('/api/analyzed-ids')
        .then(res => res.ok ? res.json() : [])
        .then(ids => setAnalyzedGameIds(ids))
        .catch(() => {});

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
        if (data.scanDepth) setScanDepth(data.scanDepth);
        if (data.analysisDepth) setAnalysisDepth(data.analysisDepth);
        if (data.chessComUsername) {
          setChessComUsername(data.chessComUsername);
          if (data.timezone) setTimezone(data.timezone);
          fetchGames(data.chessComUsername, false);
        } else {
          // If no username in config, still try to fetch local games
          fetchGames(chessComUsername, false);
        }
        fetchLocalGames();
      })
      .catch(e => {
        console.error('Failed to fetch config', e);
        // Fallback: try to fetch anyway
        fetchGames(chessComUsername, false);
        fetchLocalGames();
      });
  }, []);

  const currentMoveQuality = graphData[currentIndex]?.quality;
  const getQualityLabel = (q: string | undefined) => {
    if (!q) return null;
    const isUser = userColor === (currentIndex % 2 !== 0 ? 'w' : 'b');
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

  const materialAdvantage = useMemo(() => {
    const values: Record<string, number> = {
      p: 1, n: 3, b: 3, r: 5, q: 9,
      P: 1, N: 3, B: 3, R: 5, Q: 9
    };
    let white = 0;
    let black = 0;
    const board = fen.split(' ')[0];
    for (const char of board) {
      if (values[char]) {
        if (char === char.toUpperCase()) white += values[char];
        else black += values[char];
      }
    }
    const diff = white - black;
    if (diff === 0) return 'Equal';
    return diff > 0 ? `+${diff}` : `${diff}`;
  }, [fen]);

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

  const currentGraphEval = useMemo(() => {
    const point = graphData[currentIndex];
    if (!point || !point.analyzed) return null;
    const val = point.eval;
    const sign = val > 0 ? '+' : (val < 0 ? '-' : '');
    let label = `${sign}${Math.abs(val).toFixed(2)}`;
    if (Math.abs(val) < 0.001) label = '0.00';
    if (Math.abs(val) >= 9.9) label = val > 0 ? 'M+' : 'M-';
    return label;
  }, [graphData, currentIndex]);

  const displayStats = stats;
  const displayOpponentStats = opponentStats;

  // Final check to ensure dots have analyzed: true
  const chartData = useMemo(() => {
    return graphData.map(d => ({ ...d, analyzed: d.analyzed ?? true }));
  }, [graphData]);

  return (
    <div className="container">      <header><h1>Chess Analysis Tool</h1></header>
      <main className="main-content">
        <div className="board-section">
          <div className="board-container">
          <EvaluationBar evaluation={evaluation} userColor={userColor} />
          <div className="board-wrapper" onContextMenu={(e) => e.preventDefault()}>              <Chessboard position={fen} boardOrientation={boardOrientation}
                onPieceDrop={(s, t) => {
                  const game = new Chess(fen);
                  try {
                    const move = game.move({ from: s, to: t, promotion: 'q' });
                    if (move) {
                      const newFen = game.fen();

                      const newAllFens = [...allFens.slice(0, currentIndex + 1), newFen];
                      const newMoveHistory = [...moveHistory.slice(0, currentIndex), move.san];
                      const newLastMoveSquares = [...lastMoveSquares.slice(0, currentIndex + 1), { from: s, to: t }];

                      setAllFens(newAllFens);
                      allFensRef.current = newAllFens;
                      setMoveHistory(newMoveHistory);
                      setLastMoveSquares(newLastMoveSquares);

                      const newIndex = currentIndex + 1;
                      setCurrentIndex(newIndex);
                      setFen(newFen);
                      setPgnResult('*');
                      if (branchingPoint === null) setBranchingPoint(currentIndex);

                      // Update graph data for the new branch
                      const newPoint: GraphPoint = { move: newIndex, eval: graphDataRef.current[newIndex - 1]?.eval || 0, quality: 'normal' };
                      const updatedGraph: GraphPoint[] = [...graphDataRef.current.slice(0, newIndex), newPoint];
                      graphDataRef.current = updatedGraph;
                      setGraphData(updatedGraph);

                      scanQueueRef.current.push({ fen: newFen, index: newIndex });
                      setScanQueueLength(scanQueueRef.current.length);
                      processNextScan();

                      return true;
                    }
                  } catch (e: any) {
                    console.error("Move error:", e);
                  }
                  return false;
                }}
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
            <h3>History {branchingPoint !== null && <span className="branch-badge">(Research Mode)</span>}</h3>
            <div className="history-list">
              <span className={`move-item ${currentIndex === 0 ? 'active-move' : ''} ${branchingPoint === 0 ? 'branch-origin' : ''}`} onClick={() => goToMove(0)}>Start</span>
              {moveHistory.map((move, index) => {
                const isOrigin = (index + 1 === branchingPoint);
                const isStart = (branchingPoint !== null && index === branchingPoint);
                return (
                  <span key={index} 
                    className={`move-item ${index + 1 === currentIndex ? 'active-move' : ''} ${isOrigin ? 'branch-origin' : ''} ${isStart ? 'branch-start' : ''}`} 
                    onClick={() => goToMove(index + 1)}
                    title={isStart ? 'First move of research branch' : ''}
                  >
                    {index % 2 === 0 ? `${Math.floor(index / 2) + 1}. ` : ''}{move}{' '}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="eval-bar-container">
            <div className="eval-info">
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
              setBranchingPoint(null);
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
          <div className="live-stats-panel">
            <div className="stat-main">
              <div className="stat-info-group">
                <span className="stat-label">Evaluation</span>
              </div>
              <div className={`stat-value highlight ${getEvalColorClass(evaluation, userColor)}`}>
                {evaluation || '0.00'}
              </div>
            </div>
            <div className="stat-sub">
              <span className="stat-label">Material</span>
              <span className="stat-value">{materialAdvantage}</span>
            </div>
            <div className="stat-timer">
              <span className="engine-timer">Time: {elapsedTime}</span>
              <div className={`ws-status ${wsStatus}`}>
                {wsStatus === 'open' ? '● Connected' : wsStatus === 'connecting' ? '○ Connecting...' : '○ Disconnected (Retrying)'}
              </div>
            </div>
            </div>

            <div className="graph-container">
              <div className="graph-header">
                <div className="graph-title-group">
                  <h3>Evaluation Graph</h3>
                </div>
                <div className="graph-header-right">
                  <span className={`graph-eval-indicator-external ${getEvalColorClass(graphHoverEval || currentGraphEval, userColor)}`}>
                    {graphHoverEval || currentGraphEval || '-.--'}
                  </span>
                  <span className="graph-move-indicator-external">
                    {(graphHoverIdx !== null ? graphHoverIdx : currentIndex)} / {allFens.length - 1}
                  </span>
                </div>
              </div>
              <div style={{ height: '100px', width: '310px' }}>
                <EvaluationGraphView
                  data={chartData}
                  currentIndex={currentIndex}
                  onJump={onJump} 
                  boardOrientation={boardOrientation} 
                  branchingPoint={branchingPoint} 
                  isPreAnalyzed={isPreAnalyzed} 
                  showOverlay={showGraphOverlay}
                  userColor={userColor}
                  onHover={(idx: number | null, evalStr: string | null) => {
                    setGraphHoverIdx(idx);
                    setGraphHoverEval(evalStr);
                  }}
                />
              </div>
              {isScanning !== false ? (
                <div className="scanning-status-under">
                  <span className="scanning-badge">
                    <span className="scanning-dot"></span>
                    Scanning... ({scanQueueLength} left)
                  </span>
                </div>
              ) : isPreAnalyzed && (branchingPoint === null || currentIndex <= branchingPoint) && (
                <div className="scanning-status-under">
                  <span className={`scanning-badge ${isPreAnalyzed >= 30 ? 'deep' : 'regular'}`}>
                    Pre-Analyzed (Depth {isPreAnalyzed})
                  </span>
                </div>
              )}
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
                <div className="stat-row"><span className="badge brilliant">!!</span> {displayStats.brilliant}</div>
                <div className="stat-row"><span className="badge great">!</span> {displayStats.great}</div>
                <div className="stat-row"><span className="badge best">★</span> {displayStats.best}</div>
                <div className="stat-row"><span className="badge mistake">?</span> {displayStats.mistake}</div>
                <div className="stat-row"><span className="badge miss">X</span> {displayStats.miss}</div>
                <div className="stat-row"><span className="badge blunder">??</span> {displayStats.blunder}</div>
              </div>
              <div className="review-col">
                <h4 className="opponent">OPPONENT</h4>
                <div className="stat-row"><span className="badge brilliant">!!</span> {displayOpponentStats.brilliant}</div>
                <div className="stat-row"><span className="badge great">!</span> {displayOpponentStats.great}</div>
                <div className="stat-row"><span className="badge best">★</span> {displayOpponentStats.best}</div>
                <div className="stat-row"><span className="badge mistake">?</span> {displayOpponentStats.mistake}</div>
                <div className="stat-row"><span className="badge miss">X</span> {displayOpponentStats.miss}</div>
                <div className="stat-row"><span className="badge blunder">??</span> {displayOpponentStats.blunder}</div>
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
                {[1, 2, 3].map((rank) => {
                  const c = filteredCandidates.find((cand: any) => cand.rank === rank);
                  if (c) {
                    return (
                      <tr key={rank} onClick={() => goToMove(currentIndex + 1)} style={{cursor: 'pointer'}}>
                        <td>{rank}</td><td><strong>{c.move}</strong></td><td>{c.score}</td>
                      </tr>
                    );
                  } else {
                    return (
                      <tr key={rank} className="empty-row">
                        <td>{rank}</td><td>-</td><td>-</td>
                      </tr>
                    );
                  }
                })}
              </tbody>
            </table>          </div>
          <div className="chess-com-import">
            <h3>Chess.com Import ({chessComUsername})</h3>
            <div className="import-legend">
              <span className="analyzed-status-dot backend">●</span> Server Analysis
              <span className="analyzed-status-dot local" style={{ marginLeft: '10px' }}>●</span> Local Analysis
            </div>
            <button onClick={() => fetchGames()} disabled={loadingGames}>{loadingGames ? '...' : 'Fetch Recent Games'}</button>
            <div className="games-list">
              {chessComGames.map((g, i) => {
                const gameId = g.url.split('/').pop();
                const isBackendAnalyzed = analyzedGameIds.includes(gameId);
                const isAnalyzing = currentlyAnalyzingGameId === gameId;
                const localAnalysis = (() => {
                  const saved = localStorage.getItem(`analysis_${gameId}`);
                  if (!saved) return null;
                  try { return JSON.parse(saved); } catch(e) { return null; }
                })();
                
                const isLocalComplete = localAnalysis?.completed === true;
                const isLocalIncomplete = !isLocalComplete && localAnalysis?.evaluations?.length > 0;

                let statusClass = '';
                if (isBackendAnalyzed) statusClass = 'backend';
                else if (isAnalyzing) statusClass = 'analyzing-local';
                else if (isLocalComplete) statusClass = 'local';
                else if (isLocalIncomplete) statusClass = 'incomplete';

                const isSelected = selectedGameId === gameId;

                return (
                  <div key={i} className={`game-item ${statusClass} ${isSelected ? 'active' : ''}`} onClick={() => processPgn(g.pgn)}>
                    <div className="game-item-info">
                      {g.white.username} vs {g.black.username}
                      <div className="game-date">
                        {new Date(g.end_time * 1000).toLocaleString('en-US', { timeZone: timezone })}
                      </div>
                    </div>
                    {statusClass && (
                      <span 
                        className={`analyzed-status-dot ${statusClass}`} 
                        title={
                          statusClass === 'backend' ? 'Server Analysis Available' : 
                          statusClass === 'analyzing-local' ? 'Analyzing (Local)...' : 
                          statusClass === 'local' ? 'Local Analysis Available' :
                          'Incomplete Local Analysis'
                        }
                      >
                        {statusClass === 'incomplete' ? '▲' : '●'}
                      </span>
                    )}
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
                localGames.map((g, i) => {
                  const gameId = g.id;
                  const isBackendAnalyzed = analyzedGameIds.includes(gameId);
                  const isAnalyzing = currentlyAnalyzingGameId === gameId;
                  const localAnalysis = (() => {
                    const saved = localStorage.getItem(`analysis_${gameId}`);
                    if (!saved) return null;
                    try { return JSON.parse(saved); } catch(e) { return null; }
                  })();
                  
                  const isLocalComplete = localAnalysis?.completed === true;
                  const isLocalIncomplete = !isLocalComplete && localAnalysis?.evaluations?.length > 0;

                  let statusClass = '';
                  if (isBackendAnalyzed) statusClass = 'backend';
                  else if (isAnalyzing) statusClass = 'analyzing-local';
                  else if (isLocalComplete) statusClass = 'local';
                  else if (isLocalIncomplete) statusClass = 'incomplete';

                  const isSelected = selectedGameId === gameId;

                  return (
                    <div key={i} className={`game-item ${statusClass} ${isSelected ? 'active' : ''}`} onClick={() => processPgn(g.pgn)}>
                      <div className="game-item-info">
                        {g.white} vs {g.black} ({g.result})
                        <div className="game-date">{formatPgnDate(g.date, g.time, timezone)}</div>
                      </div>
                      {statusClass && (
                        <span 
                          className={`analyzed-status-dot ${statusClass}`} 
                          title={
                            statusClass === 'backend' ? 'Server Analysis Available' : 
                            statusClass === 'analyzing-local' ? 'Analyzing (Local)...' : 
                            statusClass === 'local' ? 'Local Analysis Available' :
                            'Incomplete Local Analysis'
                          }
                        >
                          {statusClass === 'incomplete' ? '▲' : '●'}
                        </span>
                      )}
                    </div>
                  );
                })
              }
            </div>
            <div style={{ marginTop: '20px', borderTop: '1px solid #444', paddingTop: '15px' }}>
              <button onClick={clearLocalCache} className="btn-clear-cache" style={{ width: '100%', backgroundColor: '#555' }}>
                Clear Browser Analysis Cache
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
