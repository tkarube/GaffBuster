# GaffBuster ♟️ (v2.2.3)

GaffBuster is a high-performance, web-based chess analysis application powered by **Stockfish 18**. It provides professional-grade evaluation, move quality categorization, and automated background analysis of your games.

## What's New in v2.2.3
-   **Dynamic Thread Reallocation**: Automatically upgrades the main engine to 100% CPU threads once the background scan is complete, maximizing analysis depth for the current position.
-   **Robust Process Management**: Fixed issues with duplicate Stockfish processes by implementing explicit cleanup on startup, shutdown, and reallocation.
-   **Automated Permission Handling**: Improved Makefile and backend logic to prevent root-owned directory issues and ensure consistent file access.
-   **UI Persistence**: Analysis indicators (quality dots) now persist correctly even after clearing the browser cache, as long as the data exists on the server.
-   **Analysis Status Badges**: Added clear "Analysis Complete" and "Deep Analysis Complete" badges to the evaluation graph.

## Key Features

-   **Unified Evaluation System**: Absolute consistency in evaluation signs and colors across the entire UI.
    *   **White-POV Standard**: Always uses standard chess notation (Positive = White advantage, Negative = Black advantage).
    *   **Advantage-Based Coloring**: Numerical values turn **green** whenever the user has the advantage, based on their assigned color.
-   **Deep Engine Integration**: High-performance Stockfish integration with optimized thread allocation (50% for interactive analysis, 50% for background scanning).
-   **Parallel Background Analysis**: A redesigned analysis bot uses a **Worker Pool** (2 parallel workers) to analyze multiple positions concurrently, maximizing throughput and reaching Depth 30 significantly faster.
-   **Refined Evaluation Graph**:
    *   **Clutter-Free Design**: All numerical overlays and tooltips are moved to the header area, leaving the graph curve completely clear.
    *   **Real-Time Marking**: Move quality indicators (Brilliant!!, Blunder??, etc.) appear on the graph sequentially as moves are analyzed.
    *   **Stable Orientation**: The graph remains fixed to White-POV (Up = White, Down = Black) regardless of board orientation for consistent visual reference.
-   **Smart Analysis Status**:
    *   🟢 **Server Analysis**: Deep analysis (Depth 30+) completed and synced to the backend.
    *   🟠 **Local Analysis**: Rapid scan (Depth 22) completed and saved in your browser's localStorage.
    *   ▲ **Incomplete**: Local analysis was started but interrupted (indicated by an orange triangle).
-   **Multi-User Security**: Secure access with BCrypt hashing and easy user management via CLI.

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
Access the application at `https://localhost:5000`.

## Technology Stack

-   **Frontend**: React, TypeScript, Vite, Chessboard.jsx, Recharts
-   **Backend**: Node.js (Express), WebSocket, Stockfish 18 (UCI)
-   **Security**: Basic Auth with BCrypt, Self-signed TLS
-   **DevOps**: Docker, Docker Compose

## Architecture Note
GaffBuster v2.2.2 manages resources intelligently:
1.  **Analysis Bot**: Pauses instantly when a user connects to the web interface to prevent resource contention. It uses a robust signal-based resume mechanism to restart analysis as soon as the session ends.
2.  **Resource Balancing**: Interactive analysis threads are split **50/50** between the main engine and the graph scanner (e.g., 4T/4T for an 8T system) to accelerate background scanning while maintaining responsive interactivity.
