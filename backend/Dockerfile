FROM node:22-slim

# Install dependencies for downloading and running Stockfish
RUN apt-get update && apt-get install -y \
    wget \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Download and install Stockfish 18 (BMI2 binary - recommended for modern CPUs)
RUN wget https://github.com/official-stockfish/Stockfish/releases/download/sf_18/stockfish-ubuntu-x86-64-bmi2.tar -O stockfish.tar \
    && tar -xf stockfish.tar \
    && mv stockfish/stockfish-ubuntu-x86-64-bmi2 /usr/local/bin/stockfish \
    && chmod +x /usr/local/bin/stockfish \
    && rm -rf stockfish.tar stockfish

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
