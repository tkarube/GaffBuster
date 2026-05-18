const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Chess } = require('chess.js');
const axios = require('axios');
const os = require('os');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const ANALYZED_GAMES_PATH = path.join(__dirname, 'analyzed_games.json');
const RESULTS_DIR = path.join(__dirname, 'results');
const PAUSE_FILE = path.join(RESULTS_DIR, 'bot_pause.signal');

const totalCores = (() => {
    try {
        return os.cpus().length || 1;
    } catch (e) {
        return 1;
    }
})();

if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR);
}

function loadAnalyzedGames() {
    if (fs.existsSync(ANALYZED_GAMES_PATH)) {
        try {
            return JSON.parse(fs.readFileSync(ANALYZED_GAMES_PATH));
        } catch (e) {
            return [];
        }
    }
    return [];
}

function saveAnalyzedGames(games) {
    fs.writeFileSync(ANALYZED_GAMES_PATH, JSON.stringify(games, null, 2));
}

function isPaused() {
    return fs.existsSync(PAUSE_FILE);
}

function log(msg) {
    const ts = new Date().toLocaleString('en-US', { hour12: false });
    console.log(`[${ts}] ${msg}`);
}

class Engine {
    constructor(id, threads, hash) {
        this.id = id;
        this.threads = threads;
        this.hash = hash;
        this.stockfish = null;
        this.busy = false;
        this.currentEval = 0;
        this.resolver = null;
        this.depth = 0;
    }

    async start() {
        return new Promise((resolve) => {
            this.stockfish = spawn('stockfish');
            
            // Background bot priority (10 = lower priority/nice 10)
            try {
                os.setPriority(this.stockfish.pid, 10);
            } catch (e) {}

            let buffer = '';
            this.stockfish.stdout.on('data', (data) => {
                buffer += data.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    const l = line.trim();
                    if (this.resolver) {
                        if (l.startsWith('info depth') && l.includes('score')) {
                            const dMatch = l.match(/depth (\d+)/);
                            if (dMatch) this.lastDepth = parseInt(dMatch[1]);

                            const cpMatch = l.match(/score cp (-?\d+)/);
                            const mateMatch = l.match(/score mate (-?\d+)/);
                            if (cpMatch) this.currentEval = parseInt(cpMatch[1]) / 100;
                            else if (mateMatch) this.currentEval = `M${mateMatch[1]}`;
                            
                            const npsMatch = l.match(/nps (\d+)/);
                            if (npsMatch && parseInt(npsMatch[1]) > 0) this.lastNps = parseInt(npsMatch[1]);
                        }
                        if (l.startsWith('bestmove')) {
                            const res = this.resolver;
                            this.resolver = null;
                            this.busy = false;
                            res(this.currentEval);
                        }
                    }
                    if (l.includes('readyok')) resolve();
                }
            });

            this.stockfish.stdin.write('uci\n');
            this.stockfish.stdin.write(`setoption name Threads value ${this.threads}\n`);
            this.stockfish.stdin.write(`setoption name Hash value ${this.hash}\n`);
            this.stockfish.stdin.write('setoption name UCI_AnalyseMode value true\n');
            this.stockfish.stdin.write('isready\n');
        });
    }

    async getEvaluation(fen, depth) {
        if (this.busy) throw new Error('Engine busy');
        this.busy = true;
        this.depth = depth;
        this.currentEval = 0;
        this.lastNps = 0;

        return new Promise((resolve) => {
            let timer = setTimeout(() => {
                log(`[Worker ${this.id}] Timeout for FEN: ${fen}`);
                this.resolver = null;
                this.busy = false;
                resolve(0);
            }, 300000); // 5 min timeout per move

            const checkPause = setInterval(() => {
                if (isPaused()) {
                    log(`[Worker ${this.id}] Pause detected during evaluation. Stopping...`);
                    clearInterval(checkPause);
                    this.stop();
                    this.resolver = null;
                    this.busy = false;
                    clearTimeout(timer);
                    resolve(null); // Return null to indicate pause
                }
            }, 1000);

            this.resolver = (val) => {
                clearInterval(checkPause);
                clearTimeout(timer);
                resolve(val);
            };
            this.stockfish.stdin.write(`position fen ${fen}\n`);
            this.stockfish.stdin.write(`go depth ${depth}\n`);
        });
    }

    stop() {
        if (this.stockfish) {
            try {
                if (this.stockfish.stdin && this.stockfish.stdin.writable) {
                    this.stockfish.stdin.write('quit\n');
                }
            } catch (e) {}
            this.stockfish.kill();
            this.stockfish = null;
            this.busy = false;
        }
    }
}

class WorkerPool {
    constructor(config) {
        this.config = config;
        this.workers = [];
        this.poolSize = 2; // Analyze 2 positions in parallel
    }

    async init() {
        const totalThreads = this.config.analysisThreads || this.config.threads || 8;
        const totalHash = this.config.hash || 8192;
        
        const threadsPerWorker = Math.max(1, Math.floor(totalThreads / this.poolSize));
        const hashPerWorker = Math.max(32, Math.floor(totalHash / this.poolSize));

        log(`[Pool] Initializing ${this.poolSize} workers (Each: ${threadsPerWorker}T/${hashPerWorker}MB)`);
        
        for (let i = 0; i < this.poolSize; i++) {
            const worker = new Engine(i, threadsPerWorker, hashPerWorker);
            await worker.start();
            this.workers.push(worker);
        }
    }

    async analyze(tasks, onProgress) {
        let completed = 0;
        const results = [];
        const queue = [...tasks];
        
        const runWorker = async (worker) => {
            while (queue.length > 0) {
                if (isPaused()) {
                    worker.stop();
                    while (isPaused()) await new Promise(r => setTimeout(r, 2000));
                    await worker.start();
                    continue;
                }
                const task = queue.shift();
                log(`  [Worker ${worker.id}] Starting analysis: Move ${task.moveIndex} (Depth ${task.depth})`);
                const evalValue = await worker.getEvaluation(task.fen, task.depth);
                if (evalValue === null) {
                    // Put task back in queue if it was paused
                    queue.unshift(task);
                    continue;
                }
                
                // Convert to White-POV: Stockfish gives POV of side-to-move
                const turn = task.fen.split(' ')[1];
                const side = (turn === 'w') ? 1 : -1;
                const whitePovScore = (side * evalValue) / 100;
                
                const resultObj = { move: task.moveIndex, fen: task.fen, eval: whitePovScore };
                results.push(resultObj);
                completed++;
                onProgress(completed, tasks.length, worker.lastNps, results);
            }
        };

        await Promise.all(this.workers.map(w => runWorker(w)));
        return results.sort((a, b) => a.move - b.move);
    }

    stop() {
        this.workers.forEach(w => w.stop());
        this.workers = [];
    }
}

let isRunning = false;

async function analyzeGame(game, config) {
    const depth = config.analysisDepth || 30;
    const gameId = game.url.split('/').pop();
    const fileName = `${gameId}.json`;
    const filePath = path.join(RESULTS_DIR, fileName);

    const chess = new Chess();
    try {
        chess.loadPgn(game.pgn);
    } catch (e) {
        log(`[Bot] Failed to load PGN: ${e.message}`);
        return;
    }

    const whiteName = game.white?.username || chess.header().White || 'White';
    const blackName = game.black?.username || chess.header().Black || 'Black';
    const endTime = game.end_time || chess.header().EndTime || Math.floor(Date.now() / 1000);
    
    const history = chess.history({ verbose: true });
    const fens = [new Chess().fen()];
    let tempChess = new Chess();
    for (const move of history) {
        tempChess.move(move);
        fens.push(tempChess.fen());
    }

    let evaluations = [];
    if (fs.existsSync(filePath)) {
        try {
            const existing = JSON.parse(fs.readFileSync(filePath));
            evaluations = existing.evaluations || [];
        } catch (e) {}
    }

    if (evaluations.length >= fens.length) {
        log(`[Bot] Already analyzed: ${game.url}`);
        return;
    }

    log(`[Bot] Starting parallel analysis: ${game.url} (Depth ${depth}, Positions ${fens.length - evaluations.length})`);
    
    const pool = new WorkerPool(config);
    await pool.init();

    const tasks = [];
    for (let i = evaluations.length; i < fens.length; i++) {
        tasks.push({ moveIndex: i, fen: fens[i], depth });
    }

    const newResults = await pool.analyze(tasks, (done, total, nps, currentBatch) => {
        const latestDepth = pool.workers.map(w => w.lastDepth).filter(d => d > 0);
        const avgDepth = latestDepth.length > 0 ? (latestDepth.reduce((a, b) => a + b, 0) / latestDepth.length).toFixed(1) : 'N/A';
        log(`  [Progress] ${done}/${total} positions completed. (Avg Depth: ${avgDepth}/${depth}, Total NPS: ${(nps * pool.poolSize / 1000000).toFixed(1)}M)`);
        
        // Periodic save (save every position now)
        const combinedEvals = [...evaluations, ...currentBatch].sort((a, b) => a.move - b.move);
        const result = {
            url: game.url, pgn: game.pgn, white: whiteName, black: blackName,
            endTime: endTime, analysisDepth: depth, evaluations: combinedEvals
        };
        fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
    });

    evaluations = [...evaluations, ...newResults].sort((a, b) => a.move - b.move);
    const finalResult = {
        url: game.url, pgn: game.pgn, white: whiteName, black: blackName,
        endTime: endTime, analysisDepth: depth, evaluations
    };
    fs.writeFileSync(filePath, JSON.stringify(finalResult, null, 2));
    
    pool.stop();
    log(`[Bot] Analysis complete: ${game.url}`);

    const PGNS_DIR = path.join(__dirname, 'pgns');
    if (!fs.existsSync(PGNS_DIR)) fs.mkdirSync(PGNS_DIR);
    fs.writeFileSync(path.join(PGNS_DIR, `${gameId}.pgn`), game.pgn);
}

async function runBot() {
    if (isRunning) return;
    isRunning = true;
    
    if (isPaused()) {
        isRunning = false;
        return;
    }

    log('[Bot] Checking for new games...');
    if (!fs.existsSync(CONFIG_PATH)) {
        log('[Bot] config.json missing');
        isRunning = false;
        return;
    }

    const config = JSON.parse(fs.readFileSync(CONFIG_PATH));
    const username = config.chessComUsername;
    if (!username || username === 'YOUR_CHESS_COM_USERNAME') {
        isRunning = false;
        return;
    }

    const analyzedGames = loadAnalyzedGames();

    // 1. Check local PGNs first
    const PGNS_DIR = path.join(__dirname, 'pgns');
    if (fs.existsSync(PGNS_DIR)) {
        const localFiles = fs.readdirSync(PGNS_DIR).filter(f => f.endsWith('.pgn'));
        for (const file of localFiles) {
            const gameId = file.replace('.pgn', '');
            const localUrl = `local/${gameId}`;
            if (!analyzedGames.includes(localUrl)) {
                const pgn = fs.readFileSync(path.join(PGNS_DIR, file), 'utf8');
                log(`[Bot] Found local game to analyze: ${gameId}`);
                await analyzeGame({ url: localUrl, pgn }, config);
                analyzedGames.push(localUrl);
                saveAnalyzedGames(analyzedGames);
            }
        }
    }

    // 2. Check Chess.com archives
    try {
        const archivesRes = await axios.get(`https://api.chess.com/pub/player/${username}/games/archives`);
        const archives = archivesRes.data.archives;
        if (archives && archives.length > 0) {
            const lastTwoArchives = archives.slice(-2).reverse();
            for (const archiveUrl of lastTwoArchives) {
                const gamesRes = await axios.get(archiveUrl);
                const games = gamesRes.data.games.reverse();
                for (const game of games) {
                    if (game.rules === 'chess' && !analyzedGames.includes(game.url)) {
                        await analyzeGame(game, config);
                        analyzedGames.push(game.url);
                        saveAnalyzedGames(analyzedGames);
                    }
                }
            }
        }
    } catch (error) {
        log(`[Bot] Error: ${error.message}`);
    }
    
    isRunning = false;
}

const INTERVAL = 600000; // 10 minutes
log(`[Bot] Starting loop...`);
runBot();
const mainInterval = setInterval(runBot, INTERVAL);

let watchTimer = null;
if (fs.existsSync(RESULTS_DIR)) {
    fs.watch(RESULTS_DIR, (eventType, filename) => {
        // More robust check: if the pause file is gone, trigger a check regardless of 'filename'
        if (!isPaused() && !isRunning) {
            if (watchTimer) return;
            watchTimer = setTimeout(() => {
                log('[Bot] Resume signal - Triggering check');
                runBot();
                watchTimer = null;
            }, 2000);
        }
    });
}

const shutdown = () => {
    log('[Bot] Shutting down bot...');
    clearInterval(mainInterval);
    process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
