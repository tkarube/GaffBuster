FROM node:20-slim

# Install stockfish
RUN apt-get update && apt-get install -y stockfish && rm -rf /var/lib/apt/lists/*
ENV PATH="/usr/games:${PATH}"

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the backend code
COPY . .

# Expose the backend port
EXPOSE 5000

# Start the backend
CMD ["node", "index.js"]
