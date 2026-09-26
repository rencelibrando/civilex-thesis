# Production Dockerfile for Backend Node Gateway
FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source files
COPY . .

# Default port
ENV PORT=4000
EXPOSE 4000

CMD ["node", "index.js"]
