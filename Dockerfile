FROM node:22-slim

WORKDIR /app

# Install build tools needed for better-sqlite3 native compilation
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install backend dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm install

# Install frontend dependencies and build
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install

COPY frontend/ ./frontend/
RUN cd frontend && npm run build && cp -r dist ../backend/public

# Copy backend source (node_modules preserved thanks to .dockerignore)
COPY backend/ ./backend/

EXPOSE 3001

CMD ["node", "backend/index.js"]
