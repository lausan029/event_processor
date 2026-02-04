# Event Processor - High Scale Event System (50k EPS)

Sistema de procesamiento de eventos de alta escala diseñado para manejar 50,000 eventos por segundo.

## 🏗️ Arquitectura

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Event Processor                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────┐    ┌─────────────┐    ┌─────────────────────────────┐ │
│  │ Frontend │───▶│   Backend   │───▶│        Redis Streams        │ │
│  │  (React) │    │  (Fastify)  │    │     (Ingestion Buffer)      │ │
│  └──────────┘    └──────┬──────┘    └──────────────┬──────────────┘ │
│                         │                          │                 │
│                         ▼                          ▼                 │
│            ┌────────────────────┐    ┌─────────────────────────────┐│
│            │    PostgreSQL 16   │    │   MongoDB Sharded Cluster   ││
│            │   (Master Data)    │    │  (Events - hashed userId)   ││
│            │  Users, Auth, etc. │    │  mongos ─▶ shard1, shard2   ││
│            └────────────────────┘    └─────────────────────────────┘│
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## 📁 Estructura del Proyecto

```
event_processor/
├── backend/                 # Node.js + Fastify + TypeScript
│   ├── src/
│   │   ├── domain/         # Entidades y reglas de negocio
│   │   ├── infrastructure/ # Adaptadores externos (DB, HTTP, etc.)
│   │   ├── application/    # Casos de uso y servicios
│   │   └── config/         # Configuración
│   └── prisma/             # Schema de PostgreSQL
├── frontend/               # React + Vite + TypeScript + Tailwind
├── shared/                 # Tipos TypeScript compartidos
└── infrastructure/         # Docker y scripts
    ├── docker-compose.yml
    ├── scripts/
    │   ├── init-sharding.sh    # Configura sharding MongoDB
    │   ├── init-replica-sets.sh # Inicializa replica sets
    │   ├── scale-workers.sh    # Escala workers horizontalmente
    │   └── load-test.sh        # Pruebas de carga
    └── Dockerfile.*
```

## 🚀 Quick Start

### Prerrequisitos

- Docker & Docker Compose
- Node.js 20+
- npm 10+

### 1. Clonar y configurar

```bash
# Copiar variables de entorno
cp .env.example .env
```

### 2. Levantar infraestructura

```bash
# Levantar todos los servicios
npm run docker:up

# Ver logs
npm run docker:logs

# La inicialización de MongoDB tarda ~30 segundos
```

### 3. Verificar servicios

Una vez levantado:

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001/api/health
- **MongoDB**: localhost:27017
- **PostgreSQL**: localhost:5432
- **Redis**: localhost:6379

### 4. Desarrollo local (sin Docker)

```bash
# Instalar dependencias
npm install

# Desarrollo backend (requiere servicios Docker corriendo)
npm run dev:backend

# Desarrollo frontend
npm run dev:frontend
```

## 🗄️ Bases de Datos

### MongoDB (Sharded Cluster)

- **Propósito**: Almacenamiento de eventos de alta volumetría
- **Sharding Key**: `hashed(userId)` - distribución uniforme
- **Colecciones**: `events`, `events_dlq`

### PostgreSQL 16

- **Propósito**: Datos maestros (usuarios, auth, configuración)
- **Tablas**: `users`, `api_keys`, `user_settings`

### Redis 7

- **Propósito**: Buffer de ingesta (Streams), caché, deduplicación
- **Uso**: `XADD` para ingesta, `SETNX` para idempotencia

## 🔧 Comandos Útiles

```bash
# Docker
npm run docker:up        # Levantar servicios
npm run docker:down      # Detener servicios
npm run docker:logs      # Ver logs

# Backend
npm run dev:backend      # Desarrollo con hot-reload
npm run build:backend    # Compilar TypeScript
npm run test:backend     # Ejecutar tests

# Frontend
npm run dev:frontend     # Desarrollo con Vite
npm run build:frontend   # Build producción

# Prisma (PostgreSQL)
cd backend
npm run prisma:generate  # Generar cliente
npm run prisma:migrate   # Ejecutar migraciones
npm run prisma:studio    # UI de base de datos
```

## 📊 Principios de Arquitectura

1. **Ingesta Asíncrona**: API → Redis Stream → Workers → MongoDB
2. **Non-blocking**: Sin escrituras directas a DB durante POST
3. **Batching**: Workers usan `bulkWrite` (500-1000 eventos)
4. **Idempotencia**: Redis `SETNX` con TTL de 10 min
5. **Sharding-Aware**: Queries siempre consideran `userId`

## 🛡️ Seguridad

- API Keys/JWT cacheados en Redis
- Rate limiting configurado
- Helmet para headers de seguridad
- CORS configurado por entorno

## 📈 Monitoreo

- Logs estructurados JSON (Pino.js)
- Health checks en `/api/health`, `/api/ready`, `/api/live`
- Métricas de EPS y latencia

## 🧪 Testing

```bash
# Backend
cd backend
npm run test:unit        # Unit tests
npm run test:integration # Integration tests (Testcontainers)
npm run test:e2e         # E2E tests
npm run test:all         # Toda la suite
npm run test:coverage    # Con coverage HTML

# Frontend
cd frontend
npm run test             # Unit tests
npm run test:coverage    # Con coverage
npm run test:e2e         # Playwright E2E

# Load Testing
k6 run k6-load-test.js   # Prueba de carga con métricas p95/p99
```

## 🚀 Deployment (Railway)

### 1. Configurar Railway

1. Conecta tu repositorio GitHub a Railway
2. Configura los servicios en Railway Dashboard:
   - **Backend**: Usa `infrastructure/Dockerfile.backend`
   - **Worker** (x3 réplicas): Usa `infrastructure/Dockerfile.worker`
   - **Frontend**: Usa `infrastructure/Dockerfile.frontend`
3. Añade los plugins:
   - PostgreSQL
   - MongoDB
   - Redis

### 2. Variables de Entorno (Railway)

```
# Backend & Workers
DATABASE_URL=${{ Postgres.DATABASE_URL }}
MONGO_URI=${{ MongoDB.MONGO_URL }}
REDIS_URL=${{ Redis.REDIS_URL }}
JWT_SECRET=<generar con: openssl rand -base64 48>
NODE_ENV=production
LOG_LEVEL=info

# Workers (adicional)
CONSUMER_NAME=${{ RAILWAY_REPLICA_ID }}
WORKER_BATCH_SIZE=100

# Frontend
VITE_API_URL=https://<tu-backend>.up.railway.app
```

### 3. CI/CD Pipeline

El pipeline de GitHub Actions (`.github/workflows/ci-cd.yml`) se ejecuta en cada push a `main`:

1. **Lint & Type Check**: Valida código
2. **Unit Tests**: Tests rápidos
3. **Integration Tests**: Redis + MongoDB reales
4. **Docker Build**: Valida imágenes
5. **Deploy**: Despliega a Railway automáticamente

Añade `RAILWAY_TOKEN` como secret en GitHub para el deploy automático.

---

**Stack**: Node.js 20 | Fastify | TypeScript | React | Vite | MongoDB 7 | PostgreSQL 16 | Redis 7 | Docker | Railway
