# GaffBuster ♟️

GaffBuster is a powerful, web-based chess analysis application powered by the **Stockfish** engine. Import games directly from Chess.com, visualize evaluation trends with real-time graphs, and perform deep game reviews with move quality classification.

## Features

- **Real-time Evaluation**: Powered by Stockfish 18 (BMI2 optimized for x86-64-v3).
- **Deep Analysis**: Stockfish thinks for up to **5 minutes** per position for high-quality evaluations.
- **Game Import**: Fetch games directly from Chess.com via username or load custom PGNs.
- **Interactive & Adaptive Graph**: Visualize evaluation trends. The graph **automatically inverts** when you flip the board, so "up" always means "advantage for the side at the bottom."
- **Move Classification**: Understand "Brilliant", "Great", and "Blunder" moves with visual icons and a summary panel.
- **Real-time Analysis Timer**: A live countdown timer shows exactly how long Stockfish has been analyzing the current position, ensuring you know the depth of the evaluation.
- **Game Status & Results**: Clearly see the game outcome (Checkmate, Stalemate, Draw) with board overlays and status indicators.
- **Optimized UI**:
  - Horizontal **Move History** located directly below the board for better focus.
  - Responsive layout that works well on different screen sizes.
  - Smooth piece animations and intuitive controls (Arrow keys support).
- **Secure Access & Hardening**:
  - Built-in Basic Authentication and HTTPS support.
  - **Security Hardening**: Robust input validation and authenticated WebSocket upgrades to prevent unauthorized engine access.

---

## Getting Started with Docker (Recommended)

The easiest way to run GaffBuster is using Docker. This version is configured to use a high-performance Stockfish 18 binary optimized for BMI2-capable CPUs (x86-64-v3).

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)
- `make` (optional, but recommended)

### Quick Start

1.  **Clone the repository**:
    ```bash
    git clone <repository-url>
    cd GaffBuster
    ```

2.  **Setup configuration and SSL**:
    This will create default `config.json`, `users.json`, and generate self-signed SSL certificates in the `certs/` directory.
    ```bash
    make setup
    ```

3.  **Build and Start**:
    ```bash
    make build
    make up
    ```

4.  **Access the app**:
    Open [https://localhost:5000](https://localhost:5000) in your browser.

    > ⚠️ **Important Security Note**: Since the application uses self-signed certificates generated during setup, your browser will display a security warning (e.g., "Your connection is not private"). You must click "Advanced" and "Proceed to localhost (unsafe)" to access the application. This is expected for local development and private installations.

### Makefile Commands

| Command | Description |
| :--- | :--- |
| `make setup` | Initialize config files and generate SSL certs. |
| `make build` | Build Docker images. |
| `make up` | Start the application in detached mode. |
| `make stop` | Stop the containers without removing them. (Alternative: `docker compose stop`) |
| `make down` | Stop and remove the containers and network. |
| `make restart` | Restart the application containers. |
| `make logs` | Follow application logs. |
| `make clean` | Remove containers, images, and volumes. |

---

## Managing the Application

- **To Stop**: Run `make down`. This will stop the app and clean up the internal network.
- **To Restart**: Run `make restart`. Use this after changing configuration files.
- **To View Logs**: Run `make logs` to see what's happening inside the containers.

---

## Configuration

You can customize the application by editing the files in the `backend/` directory.

### 1. User Authentication (`backend/users.json`)
Manage the users and passwords for the Basic Authentication login.
```json
{
  "admin": "your-secure-password"
}
```
*Note: After changing this file, you need to restart the containers with `make up` (or `docker compose restart backend`).*

### 2. Engine & App Settings (`backend/config.json`)
Configure the Stockfish engine performance and default settings.
- **`threads`**: Number of CPU cores to be used by Stockfish. Increase this for faster analysis.
- **`hash`**: Memory (MB) allocated to the engine's hash table.
- **`scanDepth`**: The analysis depth (number of half-moves) for the evaluation graph and game review. Increase this for higher precision, or decrease it for faster processing (default is 22).
- **`chessComUsername`**: The default Chess.com username used to fetch games.

```json
{
  "threads": 4,
  "hash": 512,
  "chessComUsername": "your_username"
}
```
*Note: These settings are applied when the Stockfish engine starts (usually upon a new browser connection).*

---

## Local Development (Without Docker)

If you prefer to run it locally:

1.  **Install dependencies**:
    ```bash
    npm run install-all
    ```

2.  **Setup SSL**:
    Create a `certs/` directory and place `key.pem` and `cert.pem` inside.

3.  **Start both backend and frontend**:
    ```bash
    npm start
    ```

---

## Versions & Tech Stack

### Core Components
- **Stockfish**: 18 (BMI2 optimized)
- **Node.js**: 22 (LTS)

### Frontend
- **React**: 19.2.6
- **TypeScript**: 6.0.2
- **Vite**: 8.0.12
- **chess.js**: 1.4.0
- **cm-chessboard**: 8.12.7
- **react-chessboard**: 4.7.2
- **Recharts**: 3.8.1
- **@vitejs/plugin-basic-ssl**: 2.3.0

### Backend
- **Express**: 5.2.1
- **ws (WebSocket)**: 8.20.1
- **express-basic-auth**: 1.2.1
- **cors**: 2.8.6
- **http-proxy-middleware**: 4.0.0

### Infrastructure
- **Docker**: Engine 24+ / Desktop 4+ recommended
- **Docker Compose**: V2 recommended
- **Makefile**: GNU Make 4.3+ recommended
