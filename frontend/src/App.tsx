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

const EvaluationGraphView = memo(({ data, currentIndex, onJump }: any) => {
  if (data.length === 0) {
    return <div style={{ height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: '12px' }}>Analyzing...</div>;
  }
  return (
    <LineChart width={310} height={100} data={data} 
      onClick={(d) => d && d.activeTooltipIndex !== undefined && onJump(d.activeTooltipIndex)}
      margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
    >
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#444" />
      <XAxis dataKey="move" hide />
      <YAxis domain={[-10, 10]} hide />
      <ReferenceLine y={0} stroke="#666" />
      <ReferenceLine x={currentIndex} stroke="#4caf50" strokeWidth={2} strokeDasharray="3 3" />
      <Line type="linear" dataKey="eval" stroke="#4caf50" strokeWidth={2} dot={<CustomDot />} isAnimationActive={false} />
    </LineChart>
  );
});

function App() {
  const [fen, setFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [allFens, setAllFens] = useState<string[]>(['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1']);
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pgn, setPgn] = useState('');
  const [chessComGames, setChessComGames] = useState<any[]>([]);
  const [loadingGames, setLoadingGames] = useState(false);
  const [boardOrientation, setBoardOrientation] = useState<'white' | 'black'>('white');
  const [players, setPlayers] = useState({ white: 'White', black: 'Black' });
  const [chessComUsername, setChessComUsername] = useState('mebukichi');

  const [evaluation, setEvaluation] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [graphData, setGraphData] = useState<GraphPoint[]>([]);
  const [stats, setStats] = useState<any>({ brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 });
  const [opponentStats, setOpponentStats] = useState<any>({ brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 });
  const [lastMoveSquares, setLastMoveSquares] = useState<any[]>([]);

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

  useEffect(() => {
    fenRef.current = fen;
  }, [fen]);

  // Fetch Config
  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (data.chessComUsername) setChessComUsername(data.chessComUsername);
      })
      .catch(e => console.error('Failed to fetch config', e));
  }, []);

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

  // Throttled UI Update
  useEffect(() => {
    const interval = setInterval(() => {
      setEvaluation(evalRef.current);
      setCandidates([...candidatesRef.current]);
      setGraphData([...graphDataRef.current]);
      setStats({ ...statsRef.current });
      setOpponentStats({ ...opponentStatsRef.current });
    }, 250);
    return () => clearInterval(interval);
  }, []);

  // WebSocket for Analysis
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsPort = window.location.port === '5173' ? '5000' : window.location.port;
    const socket = new WebSocket(`${protocol}//${window.location.hostname}:${wsPort}/ws`);
    socketRef.current = socket;
    socket.onopen = () => {
      console.log('WebSocket Connected');
      socket.send(JSON.stringify({ type: 'uci' }));
      socket.send(JSON.stringify({ type: 'position', fen: fenRef.current }));
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
        setTimeout(processNextScan, 10);
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
            if (typeof lastIdx === 'number') {
              const pov = (lastIdx % 2 === 0) ? 1 : -1;
              let score = cpMatch ? (pov * parseInt(cpMatch[1]) / 100) : (pov * (parseInt(mateMatch![1]) > 0 ? 10 : -10));
              score = Math.max(-10, Math.min(10, score));
              const newData = [...graphDataRef.current];
              while (newData.length <= lastIdx) newData.push({ move: newData.length, eval: 0, quality: 'normal' });
              let quality: any = 'normal';
              if (lastIdx > 0 && newData[lastIdx - 1]) {
                const prevEval = newData[lastIdx - 1].eval;
                const delta = (lastIdx % 2 !== 0) ? (score - prevEval) : (prevEval - score);
                if (delta >= 2.5 && Math.abs(prevEval) < 2.5) quality = 'brilliant';
                else if (delta >= 1.5) quality = 'great';
                else if (delta >= -0.05) quality = 'best';
                else if (delta <= -4.0) quality = 'blunder';
                else if (delta <= -2.5) quality = 'miss';
                else if (delta <= -1.5) quality = 'mistake';
              }
              newData[lastIdx] = { move: lastIdx, eval: score, quality };
              graphDataRef.current = newData;
              currentMoveQualityRef.current = quality;
            }
          }
        }
      }
    };
    return () => socket.close();
  }, [processNextScan]);

  useEffect(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN && fen) {
      candidatesRef.current = [];
      evalRef.current = null;
      socketRef.current.send(JSON.stringify({ type: 'stop' }));
      socketRef.current.send(JSON.stringify({ type: 'position', fen: fen }));
    }
  }, [fen]);

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
      setAllFens(fens);
      setLastMoveSquares(moveSqs);
      setMoveHistory(history.map(m => m.san));
      originalGameRef.current = { allFens: fens, moveHistory: history.map(m => m.san), lastMoveSquares: moveSqs };
      setCurrentIndex(0);
      setFen(fens[0]);
      setPgn(pgnString);
      graphDataRef.current = [];
      statsRef.current = { brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 };
      opponentStatsRef.current = { brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 };
      scanQueueRef.current = fens.map((f, i) => ({ fen: f, index: i }));
      isScanningRef.current = false;
      processNextScan();
    } catch (e) { console.error(e); }
  };

  const fetchGames = async () => {
    setLoadingGames(true);
    try {
      const response = await fetch(`https://api.chess.com/pub/player/${chessComUsername}/games/archives`);
      const data = await response.json();
      const latest = data.archives[data.archives.length - 1];
      const gRes = await fetch(latest);
      const gData = await gRes.json();
      setChessComGames(gData.games.reverse().slice(0, 10));
    } catch (e) {}
    setLoadingGames(false);
  };

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
                  const game = new Chess(fen);
                  try {
                    const move = game.move({ from: s, to: t, promotion: 'q' });
                    if (move) {
                      const nextFens = allFens.slice(0, currentIndex + 1);
                      nextFens.push(game.fen());
                      setAllFens(nextFens);
                      const nextMoveSqs = lastMoveSquares.slice(0, currentIndex + 1);
                      nextMoveSqs.push({ from: s, to: t });
                      setLastMoveSquares(nextMoveSqs);
                      const nextHistory = moveHistory.slice(0, currentIndex);
                      nextHistory.push(move.san);
                      setMoveHistory(nextHistory);
                      setCurrentIndex(nextFens.length - 1);
                      setFen(game.fen());
                      return true;
                    }
                  } catch (e: any) {
                    console.error("Invalid move", e);
                    alert(`Invalid move: ${e.message}`);
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
          <div className="eval-bar-container">
            <div className="eval-info"><p>Evaluation: <strong>{evaluation || 'Calculating...'}</strong></p><p>Move: <strong>{currentIndex} / {allFens.length - 1}</strong></p></div>
            <button onClick={() => {
              setAllFens(['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1']);
              setMoveHistory([]);
              setCurrentIndex(0);
              setFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
              graphDataRef.current = [];
              statsRef.current = { brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 };
              opponentStatsRef.current = { brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 };
            }} className="btn-reset">Reset</button>
          </div>
        </div>
        <div className="sidebar">
          <div className="graph-container">
            <div className="graph-header">
              <h3>Evaluation Graph</h3>
              <div className="current-eval-badge">
                {evaluation ? (evaluation.startsWith('M') ? evaluation : (parseFloat(evaluation) > 0 ? `+${evaluation}` : evaluation)) : '0.00'}
              </div>
            </div>
            <div style={{ height: '100px', width: '310px' }}>
              <EvaluationGraphView data={graphData} currentIndex={currentIndex} onJump={(idx: number) => goToMove(idx, true)} />
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
            <h3>Top Lines</h3>
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
          <div className="chess-com-import"><h3>Chess.com Import ({chessComUsername})</h3><button onClick={fetchGames} disabled={loadingGames}>{loadingGames ? '...' : 'Fetch Recent Games'}</button><div className="games-list">{chessComGames.map((g, i) => (<div key={i} className="game-item" onClick={() => processPgn(g.pgn)}>{g.white.username} vs {g.black.username}</div>))}</div></div>
          <div className="move-history"><h3>History</h3><div className="history-list"><span className={`move-item ${currentIndex === 0 ? 'active-move' : ''}`} onClick={() => goToMove(0)}>Start</span>{moveHistory.map((move, index) => (<span key={index} className={`move-item ${index + 1 === currentIndex ? 'active-move' : ''}`} onClick={() => goToMove(index + 1)}>{index % 2 === 0 ? `${Math.floor(index/2) + 1}. ` : ''}{move}{' '}</span>))}</div></div>
        </div>
      </main>
    </div>
  );
}

export default App;
