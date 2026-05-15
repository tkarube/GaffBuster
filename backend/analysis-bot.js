const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Chess } = require('chess.js');
const axios = require('axios');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const ANALYZED_GAMES_PATH = path.join(__dirname, 'analyzed_games.json');
const RESULTS_DIR = path.join(__dirname, 'results');
const PAUSE_FILE = path.join(RESULTS_DIR, 'bot_pause.signal');

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

class EngineManager {
    constructor(config) {
        this.config = config;
        this.stockfish = null;
        this.ready = false;
        this.resolver = null;
        this.depth = 24;
    }

    start() {
        return new Promise((resolve) => {
            const totalCores = parseInt(require('child_process').execSync('nproc').toString().trim()) || 1;
            // Spawn Stockfish with a higher nice value (lower priority)
            this.stockfish = spawn('nice', ['-n', '10', 'stockfish']);
            this.stockfish.stdout.on('data', (data) => {
                const lines = data.toString().split('\n');
                for (const line of lines) {
                    if (this.resolver && (line.startsWith('info depth ' + this.depth) || (line.startsWith('info depth') && line.includes('score')))) {
                        const cpMatch = line.match(/score cp (-?\d+)/);
                        const mateMatch = line.match(/score mate (-?\d+)/);
                        if (cpMatch) {
                            this.currentEval = parseInt(cpMatch[1]) / 100;
                        } else if (mateMatch) {
                            this.currentEval = `M${mateMatch[1]}`;
                        }
                    }
                    if (line.startsWith('bestmove') && this.resolver) {
                        const res = this.resolver;
                        this.resolver = null;
                        res(this.currentEval);
                    }
                    if (line.includes('readyok')) {
                        this.ready = true;
                        resolve();
                    }
                }
            });

            this.stockfish.stdin.write('uci\n');
            const requestedThreads = this.config.analysisThreads || this.config.threads || 1;
            const threads = Math.min(requestedThreads, totalCores);
            log(`[Bot] Setting engine threads to ${threads} (requested: ${requestedThreads}, system cores: ${totalCores})`);
            this.stockfish.stdin.write(`setoption name Threads value ${threads}\n`);
            this.stockfish.stdin.write(`setoption name Hash value ${this.config.hash || 128}\n`);
            this.stockfish.stdin.write('isready\n');
        });
    }

    async getEvaluation(fen, depth) {
        this.depth = depth;
        this.currentEval = 0;
        return new Promise((resolve) => {
            let timer = setTimeout(() => {
                log(`[Bot] Evaluation timeout for FEN: ${fen}`);
                this.resolver = null;
                resolve(0);
            }, 60000); // 1 minute safety timeout

            this.resolver = (val) => {
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
                this.stockfish.stdin.write('quit\n');
            } catch (e) {}
            this.stockfish.kill();
            this.stockfish = null;
        }
    }
}

let currentEngine = null;

async function analyzeGame(game, config) {
    const depth = config.analysisDepth || 24;
    const gameId = game.url.split('/').pop();
    const fileName = `${gameId}.json`;
    const filePath = path.join(RESULTS_DIR, fileName);

    const chess = new Chess();
    try {
        chess.loadPgn(game.pgn);
    } catch (e) {
        log(`[Bot] Failed to load PGN for game ${game.url}: ${e.message}`);
        return;
    }
    
    const history = chess.history({ verbose: true });
    const fens = [new Chess().fen()]; // Initial position
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
            log(`[Bot] Found partial analysis for ${game.url}. Resuming from pos ${evaluations.length}/${fens.length - 1}`);
        } catch (e) {
            evaluations = [];
        }
    }

    if (evaluations.length >= fens.length) {
        log(`[Bot] Game ${game.url} already analyzed.`);
        return;
    }

    log(`[Bot] Starting analysis: ${game.url} at depth ${depth}`);
    
    for (let i = evaluations.length; i < fens.length; i++) {
        if (isPaused()) {
            log(`[Bot] PAUSED - Frontend active. Stopping engine...`);
            if (currentEngine) {
                currentEngine.stop();
                currentEngine = null;
            }
            while (isPaused()) {
                await new Promise(r => setTimeout(r, 1000)); // Faster check (1s)
            }
            log(`[Bot] RESUMED - Starting engine to continue at position ${i}`);
        }

        if (!currentEngine) {
            currentEngine = new EngineManager(config);
            await currentEngine.start();
        }

        if (i % 5 === 0 || i === fens.length - 1) {
            log(`  [Bot] Progress: ${i}/${fens.length - 1}`);
        }
        
        const eval = await currentEngine.getEvaluation(fens[i], depth);
        evaluations.push({ move: i, fen: fens[i], eval });

        const result = {
            url: game.url, pgn: game.pgn, white: game.white.username, black: game.black.username,
            endTime: game.end_time, analysisDepth: depth, evaluations
        };
        fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
    }

    if (currentEngine) {
        currentEngine.stop();
        currentEngine = null;
    }
    
    log(`[Bot] Analysis complete for ${game.url}`);

    const PGNS_DIR = path.join(__dirname, 'pgns');
    if (!fs.existsSync(PGNS_DIR)) fs.mkdirSync(PGNS_DIR);
    fs.writeFileSync(path.join(PGNS_DIR, `${gameId}.pgn`), game.pgn);
}

let isRunning = false;

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

    try {
        const archivesRes = await axios.get(`https://api.chess.com/pub/player/${username}/games/archives`);
        const archives = archivesRes.data.archives;
        if (archives && archives.length > 0) {
            // Reverse archives to check the latest month first
            const lastTwoArchives = archives.slice(-2).reverse();
            for (const archiveUrl of lastTwoArchives) {
                const gamesRes = await axios.get(archiveUrl);
                // Reverse games in the archive to analyze the most recent ones first
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

function getInterval() {
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH));
        if (config.analysisIntervalHours) return config.analysisIntervalHours * 3600000;
    } catch (e) {}
    return 3600000;
}

const INTERVAL = getInterval();
log(`[Bot] Scheduled every ${INTERVAL / 1000 / 60} minutes`);
runBot();
const mainInterval = setInterval(runBot, INTERVAL);

// Graceful Shutdown
const shutdown = () => {
    log('[Bot] Shutting down bot...');
    clearInterval(mainInterval);
    if (currentEngine) {
        currentEngine.stop();
    }
    process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
