# Event Processor

High-scale distributed event processing system designed to handle **50,000 events per second** with horizontal scalability, fault tolerance, and real-time analytics.

## Overview

Event Processor is a production-ready system for ingesting, processing, and analyzing high-volume event streams. Built with Node.js, Fastify, MongoDB Sharding, Redis Streams, and PostgreSQL, it provides a scalable foundation for event-driven architectures.

## Architecture

The system follows a microservices architecture with clear separation of concerns:

- **API Layer**: Fastify-based REST API for event ingestion
- **Ingestion Buffer**: Redis Streams for high-throughput event queuing
- **Processing Layer**: Scalable workers consuming from Redis Consumer Groups
- **Storage Layer**: MongoDB Sharded Cluster for events, PostgreSQL for master data
- **Analytics Layer**: Real-time aggregations with Redis caching

For detailed architecture documentation, see [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 20+
- npm 10+

### Local Development

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd event_processor
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the system**
   ```bash
   npm run dev
   ```
   This command starts all services (MongoDB, PostgreSQL, Redis, Backend, Workers, Frontend) using Docker Compose.

4. **Access the services**
   - Frontend Dashboard: http://localhost:3000
   - Backend API: http://localhost:3001
   - API Documentation: http://localhost:3001/docs
   - MongoDB: localhost:27017
   - PostgreSQL: localhost:5432
   - Redis: localhost:6379

### Environment Variables

Create a `.env` file in the root directory (see `.env.example` for reference):

```bash
# Server Configuration
NODE_ENV=development
PORT=3001
LOG_LEVEL=info

# PostgreSQL
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/event_processor?schema=public

# MongoDB
MONGO_URI=mongodb://localhost:27017
MONGO_DATABASE=event_processor

# Redis
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=your-super-secret-jwt-key-minimum-32-characters
API_KEY_PREFIX=evp_

# Worker Configuration
CONSUMER_GROUP=evp-workers-group
WORKER_BATCH_SIZE=100
WORKER_BATCH_TIMEOUT_MS=500
```

## Project Commands

### Development
```bash
npm run dev              # Start all services with Docker Compose
npm run dev:backend      # Start backend only (requires services running)
npm run dev:frontend      # Start frontend only
```

### Building
```bash
npm run build:all        # Build all packages (shared, backend, frontend)
npm run build:backend    # Build backend only
npm run build:frontend   # Build frontend only
```

### Testing
```bash
npm run test             # Run all tests (backend + frontend)
npm run test:backend     # Run backend tests only
npm run test:frontend    # Run frontend tests only
```

### Linting
```bash
npm run lint             # Lint all packages
npm run lint:backend     # Lint backend only
npm run lint:frontend    # Lint frontend only
```

### Docker
```bash
npm run docker:up        # Start services in detached mode
npm run docker:down      # Stop all services
npm run docker:logs      # View logs from all services
```

## Project Structure

```
event_processor/
├── backend/              # Node.js + Fastify API
│   ├── src/
│   │   ├── application/   # Business logic
│   │   ├── infrastructure/ # External adapters
│   │   └── config/        # Configuration
│   └── prisma/            # PostgreSQL schema
├── frontend/              # React + Vite dashboard
│   └── src/
│       ├── components/    # React components
│       ├── api/           # API client
│       └── context/       # React context
├── shared/                # Shared TypeScript types
├── infrastructure/        # Docker & deployment
│   ├── docker-compose.yml
│   └── scripts/           # Initialization scripts
└── docs/                  # Documentation
    ├── ARCHITECTURE.md    # Architecture details
    └── API_DOCS.md        # API specification
```

## Key Features

- **High Throughput**: Designed for 50k events per second
- **Horizontal Scalability**: Add workers and shards as needed
- **Fault Tolerance**: Retry logic, dead letter queues, graceful degradation
- **Real-time Analytics**: Cached aggregations with 10-second refresh
- **Idempotency**: Redis-based deduplication ensures exactly-once processing
- **API Documentation**: Interactive Swagger UI at `/docs`

## API Documentation

For complete API documentation including request/response examples and error codes, see [docs/API_DOCS.md](./docs/API_DOCS.md).

Interactive API documentation is available at:
- Local: http://localhost:3001/docs
- Production: https://your-backend.up.railway.app/docs

## Deployment

Deployment instructions are currently being finalized. The system is configured for Railway deployment with:

- Multi-service support (Backend, Workers, Frontend)
- CI/CD pipeline via GitHub Actions
- Health checks and zero-downtime deployments

For deployment configuration, see:
- `railway.json` - Railway service configuration
- `.github/workflows/ci-cd.yml` - CI/CD pipeline

## Testing

The project includes comprehensive test coverage:

- **Unit Tests**: 103 tests for business logic
- **Integration Tests**: Database and service integration
- **E2E Tests**: Complete user flows
- **Load Testing**: K6 scripts for performance validation

Run tests with:
```bash
npm run test
```

## Technology Stack

- **Backend**: Node.js 20, Fastify, TypeScript
- **Frontend**: React 18, Vite, Tailwind CSS
- **Databases**: MongoDB 7 (Sharded), PostgreSQL 16, Redis 7
- **Testing**: Vitest, Playwright, Testcontainers
- **Deployment**: Docker, Railway, GitHub Actions

## License

MIT

## Contributing

This is a private project. For questions or issues, please contact the maintainers.
