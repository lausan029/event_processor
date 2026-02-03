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
- Métricas de EPS y latencia (próximamente)

---

**Stack**: Node.js 20 | Fastify | TypeScript | React | Vite | MongoDB 7 | PostgreSQL 16 | Redis 7 | Docker
