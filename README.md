# GaffBuster ♟️ (v2.1.1)

GaffBuster is a high-performance, web-based chess analysis application powered by **Stockfish 18**. Version 2.1.1 introduces a parallel analysis architecture, enhanced research capabilities, and seamless connectivity.

## Key Features

- **Dynamic Analysis Depth**: The interface now dynamically displays the actual depth used for each game (e.g., Depth 22 or Depth 30), synchronized with backend configurations.
- **Parallel Background Analysis**: A redesigned analysis bot uses a **Worker Pool** to analyze multiple positions concurrently, significantly increasing throughput and reaching higher depths faster.
- **Deep Analysis (Configurable)**: Optimized for high-memory environments. Supports massive Hash sizes (e.g., 8GB - 32GB) to maintain stable and accurate evaluations at extreme depths.
- **Enhanced Research Mode**:
    - **Interactive Branching**: Freely explore alternate lines at any point in the game history.
    - **Visual Branching Indicator**: Clear visualization of where your research line diverged from the original PGN, including vertical lines on the evaluation graph.
    - **Intelligent Navigation**: Click the graph to jump between your research and the original main line instantly.
- **High-Performance Frontend**:
    - **Full Thread Utilization**: Automatically scales to use all available CPU cores for both real-time analysis and graph generation.
    - **Prioritized Rendering**: Evaluation graph updates are prioritized over move suggestions to ensure a smooth, lag-free UI experience.
    - **Resumable Progress**: Frontend analysis is automatically saved to `localStorage` and periodically synced to the server. Analysis resumes from the last completed move after a reload.
- **Seamless Connectivity**:
    - **Unified Vite Proxy**: Routes all traffic through a single origin, eliminating browser security blocks and the need to manually accept self-signed certificates for the backend.
    - **Auto-Reconnect**: Robust WebSocket management with automatic reconnection and a watchdog timer to recover from analysis stalls.
- **Material Advantage Display**: Real-time calculation and display of the material balance (+/- points) alongside Stockfish evaluations.

## Setup & Installation

### 1. Prerequisites
- Docker & Docker Compose
- Node.js (v18 or higher recommended)

### 2. Initial Configuration
Run the setup command to generate configuration files and install dependencies:
```bash
make setup
```

Edit `backend/config.json` to customize your Chess.com username and memory/CPU allocation. For Depth 30 analysis, **8192MB (8GB) Hash** is highly recommended.

### 3. User Management
Secure both usernames and passwords using the provided tool:

#### Interactive Mode
```bash
make add-user
```
Follow the prompts to enter your **username** and **password**.

#### Command Line Mode
```bash
make add-user user=your_username pass=your_password
```

### 4. Running the Application
```bash
make build
make up
```

Access via `https://localhost:5173`.

## Maintenance Commands

- **Check Progress**: `make logs` (displays real-time NPS, Depth, and worker pool progress).
- **Restart**: `make restart` (applies configuration changes).
- **Clean Start**: `make clean && make setup && make build && make up`.

## Architecture Note
GaffBuster v2.1 balances resources dynamically:
1. **Analysis Bot**: Operates at `nice 10` priority and pauses instantly when a user connects to free up memory.
2. **Interactive Engines**: Both Main and Scan engines utilize all available threads, managed by OS-level scheduling (nice 0 for Main, nice 10 for Scan) to ensure perfect responsiveness while maximizing throughput.
