FROM node:22-slim

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the frontend code
COPY . .

# Expose the frontend port
EXPOSE 5173

# Start the frontend dev server with exec form to handle signals correctly
CMD ["./node_modules/.bin/vite", "--host", "0.0.0.0"]
