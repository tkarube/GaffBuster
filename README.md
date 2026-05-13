# Web-Based Chess Analysis Tool

A high-performance, web-based chess analysis application powered by the **Stockfish 17** engine. 
Seamlessly import games from Chess.com, visualize evaluation trends with real-time graphs, and perform deep game reviews with automated move quality classification.

## Key Features

- **Interactive Analysis**: Continuous "Infinite Search" using Stockfish with visual candidate move arrows (Top 3 lines).
- **Evaluation Graph**: Real-time line chart showing game progression with integrated blunder, brilliant, and mistake markers.
- **Automated Game Review**: Professional move quality classification (Brilliant !!, Great !, Best ★, Mistake ?, Miss X, Blunder ??).
- **Chess.com Integration**: One-click import of any player's recent games via the official Public API.
- **Main Line Restoration**: Branch off to explore variations and return to the original game state with a single click on the graph.
- **Unified Secure Server**: Single-port HTTPS/WSS support for seamless access across PC and mobile (iOS/Android) browsers.
- **Resource Management**: Configure CPU threads and memory allocation for Stockfish to match your hardware.

## Installation Guide

### 1. Prerequisites
Ensure the following are installed on your host:
- **Node.js** (v18 or higher)
- **Stockfish Engine**
  - Linux: `sudo apt-get install stockfish`
  - macOS: `brew install stockfish`

### 2. Setup Certificates (HTTPS)
Generate self-signed SSL certificates in the project root:
```bash
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes -subj "/C=JP/ST=Tokyo/L=City/O=ChessTool/OU=Dev/CN=localhost"
```

### 3. Install Dependencies
Run the unified installation script:
```bash
npm run install-all
```

## Configuration

### Authentication (`backend/users.json`)
Copy `backend/users.json.example` to `backend/users.json` and set your credentials:
```json
{
  "admin": "your_secure_password"
}
```

### Engine & User Settings (`backend/config.json`)
Copy `backend/config.json.example` to `backend/config.json` to set your preferences:
```json
{
  "threads": 4,
  "hash": 512,
  "chessComUsername": "your_username"
}
```

## Running the Tool

To start both the frontend and backend servers simultaneously:
```bash
npm start
```

**Access URL**: `https://[Your-Server-IP]:5000`

> **Security Note**: As this uses a self-signed certificate, your browser will show a warning. Click **"Advanced"** and then **"Proceed"** to enter. No separate port access or additional configuration is required.

## GitHub Publishing
This repository includes a `.gitignore` to protect your `users.json`, `config.json`, and SSL certificates. **Do not remove these entries** if you plan to keep your repository public.

## License
ISC License
