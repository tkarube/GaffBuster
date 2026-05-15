const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const basicAuth = require('express-basic-auth');

const app = express();
app.use(cors());

// Load engine configuration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json')));

// Public endpoint to get config (specifically the username)
// Place this BEFORE basicAuth middleware to allow initial fetch
app.get('/api/config', (req, res) => {
  res.json({ chessComUsername: config.chessComUsername || 'mebukichi' });
});

// Load users for authentication
const users = JSON.parse(fs.readFileSync(path.join(__dirname, 'users.json')));

// Load SSL certificates
const options = {
  key: fs.readFileSync(path.join(__dirname, '../certs/key.pem')),
  cert: fs.readFileSync(path.join(__dirname, '../certs/cert.pem'))
};

const PORT = 5000;
const server = https.createServer(options, app);

// Basic Auth Middleware configuration
const authOptions = {
  users: users,
  challenge: true,
  realm: 'Chess Analysis Tool'
};
const authMiddleware = basicAuth(authOptions);

// Apply auth to everything EXCEPT the /ws path to avoid interfering with handshakes
app.use((req, res, next) => {
  if (req.path === '/ws') return next();
  authMiddleware(req, res, next);
});

const wss = new WebSocketServer({ 
  noServer: true, // Manual upgrade handling
  path: '/ws' 
});

// PROXY: Forward all HTTP requests to Vite dev server
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://localhost:5173';
const proxy = createProxyMiddleware({
  target: FRONTEND_URL,
  changeOrigin: true,
  secure: false, 
  ws: true 
});
app.use('/', proxy);

// Handle WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, `https://${req.headers.host}`).pathname;

  if (pathname === '/ws') {
    // Manually verify Basic Auth for WebSocket upgrade
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="Chess Analysis Tool"\r\n\r\n');
      socket.destroy();
      return;
    }

    const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
    const user = auth[0];
    const pass = auth[1];

    if (users[user] && users[user] === pass) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  } else {
    proxy.upgrade(req, socket, head);
  }
});

let activeWs = null;

wss.on('connection', (ws) => {
  if (activeWs) {
    activeWs.send(JSON.stringify({ type: 'error', data: 'Disconnected: A new connection has taken priority.' }));
    activeWs.close();
  }
  activeWs = ws;
  
  let stockfish = spawn('stockfish');
  let stockfishScan = spawn('stockfish');

  console.log(`Spawned engines - main (PID: ${stockfish.pid}), scan (PID: ${stockfishScan.pid})`);

  const handleError = (engine, label) => {
    engine.on('error', (err) => {
      console.error(`Failed to start ${label} engine:`, err);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', data: `Engine Error (${label}): ${err.message}. Please ensure Stockfish is installed and in your PATH.` }));
      }
    });
    engine.on('exit', (code, signal) => {
      console.log(`${label} engine process exited with code ${code} and signal ${signal}`);
    });
  };

  handleError(stockfish, 'main');
  handleError(stockfishScan, 'scan');

  const setupEngine = (engine, label) => {
    let buffer = '';
    engine.stdout.on('data', (data) => {
      const output = data.toString();
      // console.log(`[${label} stdout]: ${output.trim()}`); // Debug: uncomment for verbose UCI log
      buffer += output;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          // Log NPS for performance debugging
          const npsMatch = trimmed.match(/nps\s+(\d+)/);
          if (npsMatch && label === 'scan') {
             console.log(`[Scan Performance] NPS: ${npsMatch[1]}`);
          }

          if (label === 'scan' && trimmed.startsWith('bestmove')) {
             ws.send(JSON.stringify({ type: 'scan_complete', engine: label }));
          } else {
             ws.send(JSON.stringify({ type: 'info', engine: label, data: trimmed }));
          }
        }
      }
    });
    engine.stderr.on('data', (data) => console.error(`${label} stderr: ${data}`));
  };

  setupEngine(stockfish, 'main');
  setupEngine(stockfishScan, 'scan');

  ws.on('message', (message) => {
    try {
      const command = JSON.parse(message.toString());
      console.log('Received command:', command.type);
      if (command.type === 'uci') {
        console.log(`Setting up engines with Threads: ${config.threads || 1}, Hash: ${config.hash || 128}`);
        
        stockfish.stdin.write('uci\n');
        stockfish.stdin.write(`setoption name Threads value ${config.threads || 1}\n`);
        stockfish.stdin.write(`setoption name Hash value ${config.hash || 128}\n`);
        stockfish.stdin.write('setoption name MultiPV value 3\n');
        stockfish.stdin.write('isready\n');

        stockfishScan.stdin.write('uci\n');
        stockfishScan.stdin.write(`setoption name Threads value ${config.threads || 1}\n`);
        stockfishScan.stdin.write(`setoption name Hash value ${config.hash || 128}\n`);
        stockfishScan.stdin.write('isready\n');
      } else if (command.type === 'position') {
        if (typeof command.fen !== 'string' || command.fen.includes('\n') || command.fen.includes('\r')) {
           console.error('Invalid FEN detected');
           return;
        }
        stockfish.stdin.write(`stop\n`);
        stockfish.stdin.write(`position fen ${command.fen}\n`);
        stockfish.stdin.write(`go movetime 300000\n`);
      } else if (command.type === 'scan_position') {
        if (typeof command.fen !== 'string' || command.fen.includes('\n') || command.fen.includes('\r')) {
           console.error('Invalid FEN detected');
           return;
        }
        const depth = config.scanDepth || 22;
        console.log(`Sending scan command: go depth ${depth}`);
        stockfishScan.stdin.write(`stop\n`);
        stockfishScan.stdin.write(`position fen ${command.fen}\n`);
        stockfishScan.stdin.write(`go depth ${depth}\n`);
      } else if (command.type === 'stop') {
        stockfish.stdin.write('stop\n');
        stockfishScan.stdin.write('stop\n');
      }
    } catch (e) { console.error(e); }
  });

  ws.on('close', () => {
    if (activeWs === ws) activeWs = null;
    stockfish.kill();
    stockfishScan.kill();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Unified Secure Server with Config listening on https://localhost:${PORT}`);
});

// Graceful shutdown handling
const shutdown = () => {
  console.log('Shutting down server...');
  if (activeWs) {
    activeWs.close();
  }
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
  // Force exit after a small delay if server.close hangs
  setTimeout(() => process.exit(0), 1000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
