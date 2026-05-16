# GaffBuster ♟️ (v2.0-beta1)

GaffBuster is a powerful, web-based chess analysis application powered by the **Stockfish** engine. version 2.0 introduces a background analysis bot, high-speed real-time graph building, and enhanced security for external hosting.

## Key Features

- **Automated Background Analysis**: A dedicated bot periodically fetches your Chess.com games and analyzes them at high depth (`analysisDepth`) when the frontend is idle.
- **High-Speed Graph Building**: When using the frontend, 16 threads (2x configured threads) are utilized to build the evaluation graph instantly.
- **Resumable Progress**: Analysis is saved move-by-move. If interrupted, the bot resumes from the exact position where it left off.
- **Local Persistence**: Original PGNs and detailed analysis results are stored locally, allowing instant access to previously analyzed games.
- **Smart Resource Management**:
    - **Frontend Priority**: Background bot fully stops its engines when the browser is open to give 100% resources to your current task.
    - **Native Priority Control**: Uses OS-level process prioritization (`nice` equivalent) to ensure the Evaluation Graph builder and Main engine share CPU cores without lag.
- **Enhanced Security**:
    - **Secure Passwords**: Mandatory `bcrypt` hashing for user credentials.
    - **Rate Limiting**: Protection against brute-force attacks on the API.
    - **Robust Handshaking**: Secure WebSocket communication for real-time analysis.

## Setup & Installation

### 1. Prerequisites
- Docker & Docker Compose
- Node.js (for initial password setup)

### 2. Initial Configuration
Run the setup command to generate configuration files:
```bash
make setup
```

Edit `backend/config.json` to customize:
- `chessComUsername`: Your Chess.com username.
- `threads`: Base CPU cores (doubled to 16 when using the frontend).
- `analysisThreads`: Cores dedicated to background analysis.
- `analysisDepth`: Target depth for background bot (e.g., 24-30).
- `timezone`: Your local timezone (e.g., `Asia/Tokyo`).

### 3. Secure Password Configuration (Mandatory)
1. Open `backend/users.json` and add your users with **plain-text** passwords:
   ```json
   {
     "admin": "your_secure_password"
   }
   ```
2. Run the hashing utility:
   ```bash
   node backend/hash-passwords.js
   ```
   This converts passwords into secure `bcrypt` hashes.

### 4. Running the Application
```bash
make build
make up
```

Access via `https://localhost:5173`. Use the credentials from step 3.

## Maintenance Commands

- **Check Progress**: `make logs` (displays real-time NPS and analysis progress).
- **Restart**: `make restart` (applies configuration changes).
- **Clean Start**: `make down && make build && make up` (clears all temporary processes and rebuilds).

## Architecture Note
GaffBuster uses two independent Stockfish engines in the frontend:
1. **Scan Engine (Priority: High)**: Builds the complete Evaluation Graph at depth 18-22.
2. **Main Engine (Priority: Low)**: Calculates Best/2nd/3rd moves for your current position.
Both engines share the doubling of threads to ensure the graph is finished as fast as possible.
