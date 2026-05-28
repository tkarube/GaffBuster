const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');
const { createProxyMiddleware } = require('http-proxy-middleware');
const os = require('os');
const basicAuth = require('express-basic-auth');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const cors = require('cors');
const { Chess } = require('chess.js');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Log basic info for every request
app.use((req, res, next) => {
    if (!req.path.startsWith('/_')) { // Ignore Vite HMR traffic in logs
        console.log(`[Backend] HTTP ${req.method} ${req.path}`);
    }
    next();
});

const totalCores = (() => {
    try { return os.cpus().length || 1; } catch (e) { return 1; }
})();
console.log(`[Backend] Detected ${totalCores} CPU cores`);

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests' }
});
app.use('/api/', limiter);

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json')));
const users = JSON.parse(fs.readFileSync(path.join(__dirname, 'users.json')));

const options = {
    key: fs.readFileSync(path.join(__dirname, '../certs/key.pem')),
    cert: fs.readFileSync(path.join(__dirname, '../certs/cert.pem'))
};

const PORT = 5000;
const server = https.createServer(options, app);

const authOptions = {
    authorizer: (username, password, cb) => {
        const userHash = crypto.createHash('sha256').update(username).digest('hex');
        const hashedPassword = users[userHash];
        if (!hashedPassword) return cb(null, false);
        bcrypt.compare(password, hashedPassword, (err, res) => cb(err, res));
    },
    authorizeAsync: true,
    challenge: true,
    realm: 'Chess Analysis Tool'
};
const authMiddleware = basicAuth(authOptions);

app.use((req, res, next) => {
    if (req.path === '/ws') return next();
    authMiddleware(req, res, next);
});

app.get('/api/config', (req, res) => {
    res.json({ 
        chessComUsername: config.chessComUsername || '', 
        timezone: config.timezone || 'Asia/Tokyo',
        scanDepth: config.scanDepth || 22,
        analysisDepth: config.analysisDepth || 30
    });
});

app.post('/api/save-analysis', (req, res) => {
    const { gameId, evaluations, pgn, white, black, endTime, analysisDepth } = req.body;
    if (!gameId || !/^[a-z0-9-]+$/i.test(gameId)) return res.status(400).json({ error: 'Invalid data' });
    
    console.log(`[Backend] Saving frontend analysis: ${gameId} (${evaluations.length} positions)`);
    const filePath = path.join(__dirname, 'results', `${gameId}.json`);
    const pgnPath = path.join(__dirname, 'pgns', `${gameId}.pgn`);
    const currentDepth = analysisDepth || config.scanDepth || 22;
    let data = { gameId, url: '', pgn, white, black, endTime, evaluations: [], analysisDepth: currentDepth };

    if (pgn) {
        if (!fs.existsSync(path.join(__dirname, 'pgns'))) fs.mkdirSync(path.join(__dirname, 'pgns'), { recursive: true });
        fs.writeFileSync(pgnPath, pgn);
    }

    if (fs.existsSync(filePath)) {        try {
            const existing = JSON.parse(fs.readFileSync(filePath));
            const mergedDepth = Math.max(existing.analysisDepth || 0, currentDepth);
            data = { ...data, ...existing, analysisDepth: mergedDepth };
        } catch (e) {}
    }

    // Merge new evaluations, giving precedence to existing ones if they have higher depth
    // (In this simple version, we just append/overwrite based on move index)
    const evMap = new Map();
    data.evaluations.forEach(e => evMap.set(e.move, e));
    evaluations.forEach(e => {
        const existing = evMap.get(e.move);
        // Only overwrite if existing is 0/normal (placeholder) or if we are intentional
        if (!existing || existing.quality === 'normal') {
            evMap.set(e.move, e);
        }
    });
    data.evaluations = Array.from(evMap.values()).sort((a, b) => a.move - b.move);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    res.json({ success: true });
});

app.get('/api/analysis/:gameId', (req, res) => {
    const gameId = req.params.gameId;
    if (!/^[a-z0-9-]+$/i.test(gameId)) return res.status(400).json({ error: 'Invalid ID' });
    const filePath = path.join(__dirname, 'results', `${gameId}.json`);
    if (fs.existsSync(filePath)) res.json(JSON.parse(fs.readFileSync(filePath)));
    else res.status(404).json({ error: 'Not found' });
});

app.get('/api/analyzed-ids', (req, res) => {
    const resultsDir = path.join(__dirname, 'results');
    if (!fs.existsSync(resultsDir)) return res.json([]);
    try {
        const files = fs.readdirSync(resultsDir).filter(f => f.endsWith('.json'));
        const analyzed = [];
        for (const file of files) {
            const gameId = file.replace('.json', '');
            try {
                const data = JSON.parse(fs.readFileSync(path.join(resultsDir, file)));
                analyzed.push({ id: gameId, depth: data.analysisDepth || 0 });
            } catch (e) {}
        }
        res.json(analyzed);
    } catch (e) {
        res.json([]);
    }
});

app.get('/api/local-games', (req, res) => {
    const dir = path.join(__dirname, 'pgns');
    if (!fs.existsSync(dir)) return res.json([]);
    const games = fs.readdirSync(dir).filter(f => f.endsWith('.pgn')).map(file => {
        const content = fs.readFileSync(path.join(dir, file), 'utf8');
        const chess = new Chess();
        chess.loadPgn(content);
        return {
            id: file.replace('.pgn', ''),
            white: chess.header().White || 'Unknown',
            black: chess.header().Black || 'Unknown',
            result: chess.header().Result || '*',
            date: chess.header().Date || '',
            time: chess.header().StartTime || chess.header().UTCTime || '',
            pgn: content
        };
    });
    res.json(games.reverse());
});

const wss = new WebSocketServer({ noServer: true, path: '/ws' });

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://localhost:5173';
const proxy = createProxyMiddleware({ target: FRONTEND_URL, changeOrigin: true, secure: false, ws: false });

server.on('upgrade', (req, socket, head) => {
    const pathname = req.url.split('?')[0];
    if (pathname === '/ws') {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="Chess Analysis Tool"\r\n\r\n');
            socket.destroy();
            return;
        }
        
        const [user, pass] = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
        const userHash = crypto.createHash('sha256').update(user).digest('hex');
        const hashedPass = users[userHash];
        
        if (hashedPass && bcrypt.compareSync(pass, hashedPass)) {
            wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
        } else {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
        }
    } else {
        proxy.upgrade(req, socket, head);
    }
});

app.use('/', proxy);

let activeWs = null;
let stockfishMain = null;
let stockfishScan = null;

const PAUSE_FILE = path.join(__dirname, 'results', 'bot_pause.signal');
if (fs.existsSync(PAUSE_FILE)) try { fs.unlinkSync(PAUSE_FILE); } catch(e) {}

const killEngines = () => {
    console.log('[Backend] Killing engine processes...');
    [stockfishMain, stockfishScan].forEach(s => {
        if (s) {
            try {
                if (s.stdin && s.stdin.writable) s.stdin.write('quit\n');
                s.kill('SIGKILL');
            } catch (e) {}
        }
    });
    stockfishMain = null;
    stockfishScan = null;
};

// Cleanup any orphaned stockfish processes on startup
try {
    const { execSync } = require('child_process');
    execSync('pkill -9 stockfish || true');
    console.log('[Backend] Cleaned up orphaned Stockfish processes');
} catch (e) {}

wss.on('connection', (ws) => {
    if (activeWs) {
        console.log('[Backend] Closing previous connection');
        activeWs.close();
    }
    activeWs = ws;
    
    // Ensure old engines are gone before spawning new ones
    killEngines();

    console.log('[Backend] Frontend connected - Bot PAUSED');
    if (!fs.existsSync(PAUSE_FILE)) try { fs.writeFileSync(PAUSE_FILE, 'paused'); } catch(e) {}

    stockfishMain = spawn('stockfish');
    stockfishScan = spawn('stockfish');
    
    try {
        if (stockfishMain.pid) os.setPriority(stockfishMain.pid, 0);
        if (stockfishScan.pid) os.setPriority(stockfishScan.pid, 10);
    } catch (e) {}

    let currentScanIndex = null;

    const setupEngine = (engine, label) => {
        if (!engine) return;
        engine.on('error', (err) => console.error(`[Engine ${label}] Error:`, err));
        engine.on('exit', (code, signal) => {
            console.log(`[Engine ${label}] Exited with code ${code}, signal ${signal}`);
            if (label === 'main') stockfishMain = null;
            if (label === 'scan') stockfishScan = null;
        });

        let buffer = '';
        engine.stdout.on('data', (data) => {
            const str = data.toString();
            console.log(`[Engine ${label}] ${str.trim()}`);
            if (ws.readyState !== 1) return; // Only send if WS is OPEN
            buffer += str;
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed) {
                    if (label === 'scan') {
                        if (trimmed === 'readyok') {
                            engine.ignoreUntilReady = false;
                        } else if (!engine.ignoreUntilReady) {
                            if (trimmed.startsWith('bestmove')) {
                                ws.send(JSON.stringify({ type: 'scan_complete', engine: label, index: currentScanIndex }));
                            } else if (trimmed.includes('score')) {
                                ws.send(JSON.stringify({ type: 'info', engine: label, index: currentScanIndex, data: trimmed }));
                            }
                        }
                    } else if (label === 'main') {
                        if (trimmed === 'readyok') {
                            engine.ignoreUntilReady = false;
                        } else if (!engine.ignoreUntilReady && trimmed.includes('score')) {
                            ws.send(JSON.stringify({ type: 'info', engine: label, data: trimmed }));
                        }
                    }
                }
            }
        });
    };

    const configureEngine = (engine, threads, hash, multipv, stopFirst, isNewGame) => {
        if (!engine || !engine.stdin.writable) return;
        if (stopFirst) engine.stdin.write('stop\n');
        engine.stdin.write('uci\n');
        engine.stdin.write(`setoption name Threads value ${threads}\n`);
        engine.stdin.write(`setoption name Hash value ${hash}\n`);
        if (multipv) engine.stdin.write(`setoption name MultiPV value ${multipv}\n`);
        if (isNewGame) engine.stdin.write('ucinewgame\n');
        engine.stdin.write('isready\n');
    };

    setupEngine(stockfishMain, 'main');
    setupEngine(stockfishScan, 'scan');

    ws.on('message', (msg) => {
        try {
            const cmd = JSON.parse(msg.toString());
            console.log(`[Backend] Received command: ${cmd.type}`);
            if (cmd.type === 'respawn_scan_engine') {
                currentScanIndex = null;
                if (stockfishScan) {
                    console.log('[Backend] Force respawning scan engine due to timeout');
                    try {
                        if (stockfishScan.stdin && stockfishScan.stdin.writable) {
                            stockfishScan.stdin.write('quit\n');
                        }
                        stockfishScan.kill('SIGKILL');
                    } catch(e) {}
                    stockfishScan = null;
                }
            } else if (cmd.type === 'uci') {
                currentScanIndex = null;
                if (!stockfishScan) {
                    console.log('[Backend] Respawning scan engine');
                    stockfishScan = spawn('stockfish');
                    try { if (stockfishScan.pid) os.setPriority(stockfishScan.pid, 10); } catch(e){}
                    setupEngine(stockfishScan, 'scan');
                }
                const totalThreads = config.threads || 8;
                const totalHash = config.hash || 8192;
                
                // 50/50 split for threads and hash to accelerate background scanning
                const mainThreads = Math.max(1, Math.floor(totalThreads * 0.5));
                const scanThreads = Math.max(1, totalThreads - mainThreads);
                
                const mainHash = Math.max(32, Math.floor(totalHash * 0.5));
                const scanHash = Math.max(32, totalHash - mainHash);

                console.log(`[Backend] UCI Setup - Main: ${mainThreads}T/${mainHash}MB, Scan: ${scanThreads}T/${scanHash}MB (Total: ${totalThreads}T)`);

                configureEngine(stockfishMain, mainThreads, mainHash, 3, false, true);
                configureEngine(stockfishScan, scanThreads, scanHash, null, false, true);
            } else if (cmd.type === 'position') {
                const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
                if (!stockfishMain || !stockfishMain.stdin.writable) return;
                
                stockfishMain.ignoreUntilReady = true;

                if (cmd.fen === startFen) {
                    stockfishMain.stdin.write('stop\n');
                } else if (cmd.fen) {
                    stockfishMain.stdin.write(`stop\nposition fen ${cmd.fen}\nisready\ngo movetime 300000\n`);
                }
            } else if (cmd.type === 'scan_position') {
                currentScanIndex = cmd.index;
                if (cmd.fen) {
                    if (!stockfishScan || !stockfishScan.stdin || !stockfishScan.stdin.writable) {
                        console.log('[Backend] Scan engine not running or not writable. Respawning and partitioning resources...');
                        
                        // Spawn scan engine
                        stockfishScan = spawn('stockfish');
                        try { if (stockfishScan.pid) os.setPriority(stockfishScan.pid, 10); } catch(e){}
                        setupEngine(stockfishScan, 'scan');

                        const totalThreads = config.threads || 8;
                        const totalHash = config.hash || 8192;
                        
                        const mainThreads = Math.max(1, Math.floor(totalThreads * 0.5));
                        const scanThreads = Math.max(1, totalThreads - mainThreads);
                        
                        const mainHash = Math.max(32, Math.floor(totalHash * 0.5));
                        const scanHash = Math.max(32, totalHash - mainHash);

                        console.log(`[Backend] UCI Setup on Demand - Main: ${mainThreads}T/${mainHash}MB, Scan: ${scanThreads}T/${scanHash}MB (Total: ${totalThreads}T)`);
                        configureEngine(stockfishMain, mainThreads, mainHash, 3, true, true);
                        configureEngine(stockfishScan, scanThreads, scanHash, null, false, true);
                    }
                    
                    if (stockfishScan && stockfishScan.stdin.writable) {
                        const depth = config.scanDepth || 22;
                        stockfishScan.ignoreUntilReady = true;
                        stockfishScan.stdin.write(`stop\nposition fen ${cmd.fen}\nisready\ngo depth ${depth}\n`);
                    }
                }
            } else if (cmd.type === 'stop') {
                if (stockfishMain && stockfishMain.stdin.writable) stockfishMain.stdin.write('stop\n');
            } else if (cmd.type === 'stop_scan') {
                currentScanIndex = null;
                if (stockfishScan && stockfishScan.stdin.writable) stockfishScan.stdin.write('stop\n');
            } else if (cmd.type === 'upgrade_main_engine') {
                currentScanIndex = null;
                const totalThreads = config.threads || 8;
                const totalHash = config.hash || 8192;
                
                // Kill scan engine to free up all resources
                if (stockfishScan) {
                    console.log('[Backend] Terminating scan engine for full-power upgrade');
                    try {
                        if (stockfishScan.stdin.writable) stockfishScan.stdin.write('quit\n');
                        stockfishScan.kill('SIGKILL');
                    } catch (e) {}
                    stockfishScan = null;
                }

                if (stockfishMain && stockfishMain.stdin.writable) {
                    console.log(`[Backend] Upgrading Main Engine to Full Power: ${totalThreads}T/${totalHash}MB`);
                    configureEngine(stockfishMain, totalThreads, totalHash, 3, true, false);
                }
            }
        } catch (e) {}
    });

    ws.on('close', () => {
        if (activeWs === ws) {
            console.log('[Backend] Frontend disconnected - Bot RESUMED');
            activeWs = null;
            if (fs.existsSync(PAUSE_FILE)) try { fs.unlinkSync(PAUSE_FILE); } catch(e) {}
            killEngines();
        }
    });
});

server.listen(PORT, '0.0.0.0', () => console.log(`[Backend] Listening on port ${PORT}`));

const shutdown = () => {
    console.log('[Backend] Shutting down...');
    if (activeWs) activeWs.close();
    killEngines();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
