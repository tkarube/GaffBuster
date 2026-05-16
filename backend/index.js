const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const { Chess } = require('chess.js');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const basicAuth = require('express-basic-auth');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const os = require('os');

const app = express();
app.use(cors());

// Cache CPU core count
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
        const hashed = users[username];
        if (!hashed) return cb(null, false);
        bcrypt.compare(password, hashed, (err, res) => cb(err, res));
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
    res.json({ chessComUsername: config.chessComUsername || '', timezone: config.timezone || 'Asia/Tokyo' });
});

app.get('/api/analysis/:gameId', (req, res) => {
    const gameId = req.params.gameId;
    if (!/^[a-z0-9-]+$/i.test(gameId)) return res.status(400).json({ error: 'Invalid ID' });
    const filePath = path.join(__dirname, 'results', `${gameId}.json`);
    if (fs.existsSync(filePath)) res.json(JSON.parse(fs.readFileSync(filePath)));
    else res.status(404).json({ error: 'Not found' });
});

app.get('/api/analyzed-ids', (req, res) => {
    const dir = path.join(__dirname, 'results');
    if (!fs.existsSync(dir)) return res.json([]);
    res.json(fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')));
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
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else {
        proxy.upgrade(req, socket, head);
    }
});

app.use('/', proxy);

// --- GLOBAL ENGINE MANAGEMENT ---
let activeWs = null;
const PAUSE_FILE = path.join(__dirname, 'results', 'bot_pause.signal');

// Singleton engines
let mainEngine = null;
let scanEngine = null;

function ensureEngines() {
    if (!mainEngine) {
        mainEngine = spawn('stockfish');
        mainEngine.on('exit', () => { mainEngine = null; });
        setupEngineOutput(mainEngine, 'main');
    }
    if (!scanEngine) {
        scanEngine = spawn('stockfish');
        scanEngine.on('exit', () => { scanEngine = null; });
        setupEngineOutput(scanEngine, 'scan');
        try { os.setPriority(scanEngine.pid, 0); } catch (e) {} // Scan (Graph) high priority
        try { os.setPriority(mainEngine.pid, 10); } catch (e) {} // Main low priority
    }
}

function setupEngineOutput(engine, label) {
    let buffer = '';
    engine.stdout.on('data', (data) => {
        if (!activeWs || activeWs.readyState !== 1) return;
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
                if (label === 'scan' && trimmed.startsWith('bestmove')) {
                    activeWs.send(JSON.stringify({ type: 'scan_complete', engine: label }));
                } else {
                    activeWs.send(JSON.stringify({ type: 'info', engine: label, data: trimmed }));
                }
            }
        }
    });
}

function stopEngines() {
    if (mainEngine) try { mainEngine.stdin.write('stop\n'); } catch(e) {}
    if (scanEngine) try { scanEngine.stdin.write('stop\n'); } catch(e) {}
}

// Cleanup pause file on start
if (fs.existsSync(PAUSE_FILE)) fs.unlinkSync(PAUSE_FILE);

wss.on('connection', (ws) => {
    if (activeWs) activeWs.close();
    activeWs = ws;
    console.log('[Backend] Frontend connected');

    if (!fs.existsSync(PAUSE_FILE)) fs.writeFileSync(PAUSE_FILE, 'paused');

    ensureEngines();

    ws.on('message', (msg) => {
        try {
            const cmd = JSON.parse(msg.toString());
            if (cmd.type === 'uci') {
                // Allocation: use double threads (16) to fully saturate CPU via priorities
                const activeThreads = (config.threads || 8) * 2;
                console.log(`[Backend] UCI init - Allocation: ${activeThreads} threads per engine`);
                
                mainEngine.stdin.write(`uci\nsetoption name Threads value ${activeThreads}\nsetoption name Hash value ${config.hash || 128}\nsetoption name MultiPV value 3\nucinewgame\nisready\n`);
                scanEngine.stdin.write(`uci\nsetoption name Threads value ${activeThreads}\nsetoption name Hash value ${config.hash || 128}\nucinewgame\nisready\n`);
            } else if (cmd.type === 'position') {
                const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
                if (cmd.fen === startFen) {
                    console.log('[Backend] Main engine: Idle (start position)');
                    mainEngine.stdin.write('stop\n');
                } else if (cmd.fen) {
                    mainEngine.stdin.write(`stop\nposition fen ${cmd.fen}\ngo movetime 300000\n`);
                }
            } else if (cmd.type === 'scan_position') {
                if (cmd.fen) {
                    scanEngine.stdin.write(`stop\nposition fen ${cmd.fen}\ngo depth 18\n`);
                }
            } else if (cmd.type === 'stop') {
                mainEngine.stdin.write('stop\n');
            } else if (cmd.type === 'stop_scan') {
                scanEngine.stdin.write('stop\n');
            }
        } catch (e) {}
    });

    ws.on('close', () => {
        console.log('[Backend] Frontend disconnected');
        if (activeWs === ws) {
            activeWs = null;
            if (fs.existsSync(PAUSE_FILE)) try { fs.unlinkSync(PAUSE_FILE); } catch(e) {}
        }
        stopEngines();
    });
});

server.listen(PORT, '0.0.0.0', () => console.log(`[Backend] Listening on port ${PORT}`));

const shutdown = () => {
    console.log('[Backend] Shutting down');
    if (activeWs) activeWs.close();
    if (mainEngine) mainEngine.kill();
    if (scanEngine) scanEngine.kill();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
