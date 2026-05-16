# GaffBuster ♟️ (v2.0 beta 2)

GaffBuster is a powerful, web-based chess analysis application powered by the **Stockfish** engine. version 2.0 beta 0 introduces a background analysis bot, high-speed real-time graph building, and enhanced security for external hosting.

## Key Features

- **Automated Background Analysis**: A dedicated bot periodically fetches your Chess.com games and analyzes them at high depth (`analysisDepth`) when the frontend is idle.
- **High-Speed Graph Building**: When using the frontend, 16 threads (2x configured threads) are utilized to build the evaluation graph instantly.
- **Resumable Progress**: Analysis is saved move-by-move. If interrupted, the bot resumes from the exact position where it left off.
- **Local Persistence**: Original PGNs and detailed analysis results are stored locally, allowing instant access to previously analyzed games.
- **Smart Resource Management**:
    - **Frontend Priority**: Background bot fully stops its engines when the browser is open to give 100% resources to your current task.
    - **Native Priority Control**: Uses OS-level process prioritization (`nice` equivalent) to ensure the Evaluation Graph builder and Main engine share CPU cores without lag.
- **Enhanced Security**:
    - **Secure Passwords**: Mandatory `bcryptjs` hashing for user credentials (portable and dependency-free).
    - **Rate Limiting**: Protection against brute-force attacks on the API.
    - **Robust Handshaking**: Secure WebSocket communication for real-time analysis.

## Setup & Installation

### 1. Prerequisites
- Docker & Docker Compose
- Node.js (for initial setup)

### 2. Initial Configuration
Run the setup command to generate configuration files:
```bash
make setup
```

Edit `backend/config.json` to customize your Chess.com username and CPU resource allocation.

### 3. Secure Password Configuration (Mandatory)
In v2.0, both usernames and passwords must be secured. Use the provided interactive tool:

1. Run the following command:
   ```bash
   make add-user
   ```
2. Follow the prompts to enter your **username** and **password**.
   - Input is securely masked with `*` in the terminal.
   - For non-interactive automation, you can also use: `node backend/manage-users.js <user> <pass>`.
3. The tool automatically hashes both (SHA-256 for username, bcrypt for password) and saves them to `backend/users.json`.

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
