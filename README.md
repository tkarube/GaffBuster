# GaffBuster ♟️ (v2.3.0)

GaffBuster is a high-performance, web-based chess analysis application powered by **Stockfish 16.1**. It provides professional-grade evaluation, move quality categorization, and automated background analysis of your games.

## Key Features

-   **Deep Engine Integration**: High-performance Stockfish integration with optimized thread allocation (75% for interactive analysis, 25% for background scanning).
-   **Parallel Background Analysis**: A redesigned analysis bot uses a **Worker Pool** (2 parallel workers) to analyze multiple positions concurrently, maximizing throughput and reaching Depth 30 significantly faster.
-   **Interactive Evaluation Graph**:
    *   **Move-Aware Tooltips**: Hover over the graph to see precise evaluation and depth (e.g., "Depth 22 (Pre-Analyzed)").
    *   **Scanning Feedback**: Real-time "Scanning..." badge shows remaining moves in the analysis queue.
-   **Smart Analysis Status**:
    *   🟢 **Server Analysis**: Deep analysis (Depth 30+) completed and synced to the backend.
    *   🟠 **Local Analysis**: Rapid scan (Depth 22) completed and saved in your browser's localStorage.
    *   🌀 **Pulsing Indicator**: Visual feedback while a game is actively being analyzed (Orange for Local, Green for Server).
-   **Auto-Load Convenience**: Automatically fetches and loads your latest finished Chess.com game on startup.
-   **Enhanced Research Mode**:
    *   **Interactive Branching**: Freely explore alternate lines; the system tracks your divergence from the main line.
    *   **Intelligent Navigation**: Click the graph to jump to any move, or use arrow keys/UI buttons.
-   **Automated Background Analysis**: The bot automatically analyzes new games when the browser is closed, ensuring deep insights are ready for your next session.
-   **Multi-User Security**: Secure access with BCrypt hashing and easy user management via CLI. **No default credentials provided.**

## Setup & Installation

### 1. Prerequisites
-   Docker and Docker Compose
-   Node.js (for initial setup and user management)

### 2. Initial Configuration
Run the setup command to generate configuration files and install dependencies:
```bash
make setup
```

Edit `backend/config.json` to customize your Chess.com username and memory/CPU allocation. For Depth 30 analysis, **8192MB (8GB) Hash** is highly recommended.

### 3. User Management
Secure access by adding your own credentials (there is no default user):
```bash
make add-user user=your_name pass=your_password
```

### 4. Launch
```bash
make build
make up
```
Access the application at `https://localhost:5173`.

## Management Commands

| Command | Description |
| :--- | :--- |
| `make add-user` | Add or update a user (Usage: `make add-user user=NAME pass=PASS`) |
| `make logs` | View real-time logs for all services (NPS, Depth, Worker status) |
| `make restart` | Restart all containers (applies config changes) |
| `make stop` | Stop containers |
| `make down` | Stop and remove all containers |
| `make clean` | Full cleanup including images and volumes |

## Technology Stack

-   **Frontend**: React, TypeScript, Vite, Chessboard.jsx, Recharts
-   **Backend**: Node.js (Express), WebSocket, Stockfish 16.1 (UCI)
-   **Security**: Basic Auth with BCrypt, Self-signed TLS
-   **DevOps**: Docker, Docker Compose

## Architecture Note
GaffBuster v2.2 manages resources intelligently:
1.  **Analysis Bot**: Pauses instantly when a user connects to the web interface to prevent resource contention.
2.  **Resource Balancing**: Interactive analysis threads are split (75% for the main engine, 25% for graph scanning) to ensure a responsive UI without over-provisioning.
