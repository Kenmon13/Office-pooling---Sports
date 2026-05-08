FROM node:22-alpine

WORKDIR /app

# Install backend dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm install

# Install frontend dependencies and build
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install

COPY frontend/ ./frontend/
RUN cd frontend && npm run build && cp -r dist ../backend/public

# Copy backend source
COPY backend/ ./backend/

EXPOSE 3001

CMD ["node", "backend/index.js"]
