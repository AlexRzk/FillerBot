# Dockerfile
# PURPOSE: Optional containerization for intent-solver
# Build: docker build -t intent-solver .
# Run: docker run -it -e MODE=local -v $(pwd)/data:/app/data intent-solver npm run demo

FROM node:20-alpine

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache bash curl

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY src ./src
COPY tsconfig.json .
COPY contracts ./contracts
COPY scripts ./scripts
COPY seeds ./seeds
COPY jest.config.js .
COPY hardhat.config.ts .

# Build TypeScript
RUN npm run build

# Create data directory
RUN mkdir -p ./data

# Expose Anvil port (if running node inside container)
EXPOSE 8545

# Default command: run demo
CMD ["npm", "run", "demo"]
