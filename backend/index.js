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
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const os = require('os');
const crypto = require('crypto');

const app = express();
app.use(cors());

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
        // Hash input username to find it in the secured users map
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
        // Verify credentials for WebSocket upgrade
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
const PAUSE_FILE = path.join(__dirname, 'results', 'bot_pause.signal');
if (fs.existsSync(PAUSE_FILE)) fs.unlinkSync(PAUSE_FILE);

wss.on('connection', (ws) => {
    if (activeWs) activeWs.close();
    activeWs = ws;
    console.log('[Backend] Frontend connected - Bot PAUSED');
    if (!fs.existsSync(PAUSE_FILE)) fs.writeFileSync(PAUSE_FILE, 'paused');

    const stockfishMain = spawn('stockfish');
    const stockfishScan = spawn('stockfish');
    
    try {
        os.setPriority(stockfishScan.pid, 0);
        os.setPriority(stockfishMain.pid, 10);
    } catch (e) {}

    const setupEngine = (engine, label) => {
        let buffer = '';
        engine.stdout.on('data', (data) => {
            buffer += data.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed) {
                    if (label === 'scan' && trimmed.startsWith('bestmove')) ws.send(JSON.stringify({ type: 'scan_complete', engine: label }));
                    else ws.send(JSON.stringify({ type: 'info', engine: label, data: trimmed }));
                }
            }
        });
    };

    setupEngine(stockfishMain, 'main');
    setupEngine(stockfishScan, 'scan');

    ws.on('message', (msg) => {
        try {
            const cmd = JSON.parse(msg.toString());
            if (cmd.type === 'uci') {
                const threads = config.threads || totalCores || 1;
                stockfishMain.stdin.write(`uci\nsetoption name Threads value ${threads}\nsetoption name Hash value ${config.hash || 128}\nsetoption name MultiPV value 3\nucinewgame\nisready\n`);
                stockfishScan.stdin.write(`uci\nsetoption name Threads value ${threads}\nsetoption name Hash value ${config.hash || 128}\nucinewgame\nisready\n`);
            } else if (cmd.type === 'position') {
                const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
                if (cmd.fen === startFen) {
                    stockfishMain.stdin.write('stop\n');
                } else if (cmd.fen) {
                    stockfishMain.stdin.write(`stop\nposition fen ${cmd.fen}\ngo movetime 300000\n`);
                }
            } else if (cmd.type === 'scan_position') {
                if (cmd.fen) {
                    stockfishScan.stdin.write(`stop\nposition fen ${cmd.fen}\ngo depth 18\n`);
                }
            } else if (cmd.type === 'stop') {
                stockfishMain.stdin.write('stop\n');
            } else if (cmd.type === 'stop_scan') {
                stockfishScan.stdin.write('stop\n');
            }
        } catch (e) {}
    });

    ws.on('close', () => {
        console.log('[Backend] Frontend disconnected - Bot RESUMED');
        if (activeWs === ws) {
            activeWs = null;
            if (fs.existsSync(PAUSE_FILE)) try { fs.unlinkSync(PAUSE_FILE); } catch(e) {}
        }
        [stockfishMain, stockfishScan].forEach(s => { try { s.stdin.write('quit\n'); s.kill(); } catch(e) {} });
    });
});

server.listen(PORT, '0.0.0.0', () => console.log(`[Backend] Listening on port ${PORT}`));

const shutdown = () => {
    if (activeWs) activeWs.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
