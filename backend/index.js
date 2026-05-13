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

// Basic Auth Middleware
app.use(basicAuth({
  users: users,
  challenge: true,
  realm: 'Chess Analysis Tool'
}));

const wss = new WebSocketServer({ 
  server,
  path: '/ws' 
});

// PROXY: Forward all HTTP requests to Vite dev server
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://localhost:5173';
app.use('/', createProxyMiddleware({
  target: FRONTEND_URL,
  changeOrigin: true,
  secure: false, 
  ws: false 
}));

let activeWs = null;

wss.on('connection', (ws) => {
  if (activeWs) {
    activeWs.send(JSON.stringify({ type: 'error', data: 'Disconnected: A new connection has taken priority.' }));
    activeWs.close();
  }
  activeWs = ws;
  
  let stockfish = spawn('stockfish');
  let stockfishScan = spawn('stockfish');

  const setupEngine = (engine, label) => {
    let buffer = '';
    engine.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep the last partial line in the buffer
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          if (label === 'scan' && trimmed.startsWith('bestmove')) {
             ws.send(JSON.stringify({ type: 'scan_complete', engine: label }));
          } else {
             ws.send(JSON.stringify({ type: 'info', engine: label, data: trimmed }));
          }
        }
      }
    });
    engine.stderr.on('data', (data) => console.error(`${label} error: ${data}`));
  };

  setupEngine(stockfish, 'main');
  setupEngine(stockfishScan, 'scan');

  ws.on('message', (message) => {
    try {
      const command = JSON.parse(message.toString());
      if (command.type === 'uci') {
        stockfish.stdin.write('uci\n');
        stockfish.stdin.write('isready\n');
        stockfish.stdin.write('setoption name MultiPV value 3\n');
        // Apply settings from config.json
        stockfish.stdin.write(`setoption name Threads value ${config.threads || 1}\n`);
        stockfish.stdin.write(`setoption name Hash value ${config.hash || 128}\n`);
        stockfishScan.stdin.write('uci\n');
        stockfishScan.stdin.write('isready\n');
      } else if (command.type === 'position') {
        stockfish.stdin.write(`stop\n`);
        stockfish.stdin.write(`position fen ${command.fen}\n`);
        stockfish.stdin.write(`go infinite\n`);
      } else if (command.type === 'scan_position') {
        stockfishScan.stdin.write(`stop\n`);
        stockfishScan.stdin.write(`position fen ${command.fen}\n`);
        stockfishScan.stdin.write(`go depth 12\n`);
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
