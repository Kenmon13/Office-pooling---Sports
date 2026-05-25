FROM node:22-slim

WORKDIR /app

# Install build tools needed for better-sqlite3 native compilation
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy backend source and install dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm install
COPY backend/*.js ./backend/

# Install frontend dependencies, build, and copy output to backend/public
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install
COPY frontend/ ./frontend/
RUN cd frontend && npm run build && rm -rf ../backend/public && cp -r dist ../backend/public

RUN mkdir -p /data

EXPOSE 3001

CMD ["node", "backend/index.js"]
