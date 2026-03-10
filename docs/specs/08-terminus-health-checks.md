# SPEC: Health Checks Avançados com @nestjs/terminus — users-service

**Serviço:** users-service  
**Status:** Proposta  
**Autor:** Arquitetura  
**Data:** 2026-03-10  

---

## 1. Visão Geral

Substituir o health check simplificado do `users-service` (`{ status: "ok" }`) por health checks reais usando `@nestjs/terminus`, que verificam a conectividade com o banco de dados PostgreSQL via `TypeOrmHealthIndicator`.

Atualmente o endpoint `GET /health` retorna um JSON estático sem verificar nenhuma dependência real. Isso significa que o serviço pode reportar "ok" mesmo quando o banco de dados está inacessível, mascarando falhas críticas tanto para o Prometheus (que scrapa `/health` indiretamente via `up`) quanto para o `api-gateway` (que chama `GET /health` dos serviços downstream).

Com `@nestjs/terminus`, o endpoint passará a retornar o formato padronizado do NestJS HealthCheck (`status: "ok" | "error"` com detalhes por dependência), e responderá HTTP 503 quando alguma dependência estiver indisponível.

---

## 2. Escopo

### Incluso

- Instalação de `@nestjs/terminus` no `users-service`
- Criação de `HealthModule` com `HealthController` usando `TerminusModule`
- Verificação do PostgreSQL via `TypeOrmHealthIndicator`
- Endpoint `GET /health` público (bypass JWT via `@Public()`)
- Resposta HTTP 200 quando saudável, HTTP 503 quando não saudável

### Fora de escopo

- Readiness/liveness probes (conceito de Kubernetes)
- Health checks de serviços externos (responsabilidade do api-gateway)
- Alterações em métricas ou dashboards existentes
- Notificações externas (Slack, email)

---

## 3. Contexto do Serviço

| Aspecto | Detalhe |
|---------|---------|
| **Porta** | 3000 |
| **Guard global** | `JwtAuthGuard` (APP_GUARD) via `AuthModule` |
| **@Public()** | Disponível em `src/auth/decorators/public.decorator.ts` |
| **Banco de dados** | PostgreSQL via TypeORM (`@nestjs/typeorm`) |
| **Health check atual** | `GET /health` → `{ status: 'ok', service: 'users-service' }` (estático) |
| **RabbitMQ** | Não utilizado |

---

## 4. Dependências

Instalar no `users-service/`:

```bash
npm install @nestjs/terminus
```

> `@nestjs/typeorm` já está instalado — o `TypeOrmHealthIndicator` é fornecido pelo `TerminusModule` e usa a conexão existente.

---

## 5. Estrutura de Arquivos

```
users-service/
└── src/
    └── health/
        ├── health.module.ts       ← novo (substitui registro direto no AppModule)
        └── health.controller.ts   ← reescrever (usar @nestjs/terminus)
```

---

## 6. Implementação

### 6.1 HealthController (`src/health/health.controller.ts`)

Substituir o controller atual que retorna JSON estático por um que usa `HealthCheckService` do `@nestjs/terminus`.

**Requisitos:**

- Injetar `HealthCheckService` e `TypeOrmHealthIndicator` do `@nestjs/terminus`
- Rota `GET /health` decorada com `@Public()` para bypass do `JwtAuthGuard`
- Usar `@HealthCheck()` decorator para documentação Swagger
- Verificar o PostgreSQL com `TypeOrmHealthIndicator.pingCheck('database')`
- Retornar HTTP 200 quando saudável, HTTP 503 quando não saudável (comportamento padrão do terminus)

```typescript
import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../auth/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('database'),
    ]);
  }
}
```

**Formato de resposta quando saudável (HTTP 200):**

```json
{
  "status": "ok",
  "info": {
    "database": { "status": "up" }
  },
  "error": {},
  "details": {
    "database": { "status": "up" }
  }
}
```

**Formato de resposta quando não saudável (HTTP 503):**

```json
{
  "status": "error",
  "info": {},
  "error": {
    "database": {
      "status": "down",
      "message": "Connection refused"
    }
  },
  "details": {
    "database": {
      "status": "down",
      "message": "Connection refused"
    }
  }
}
```

### 6.2 HealthModule (`src/health/health.module.ts`)

Criar o módulo que importa `TerminusModule` e registra o controller.

```typescript
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
```

### 6.3 Atualizar AppModule (`src/app.module.ts`)

Substituir o registro direto do `HealthController` no `AppModule` pelo `HealthModule`:

**Antes:**

```typescript
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(databaseConfig),
    MetricsModule,
    UsersModule,
    AuthModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
```

**Depois:**

```typescript
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(databaseConfig),
    MetricsModule,
    UsersModule,
    AuthModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

> Remover `HealthController` do array `controllers` do `AppModule`, pois agora é declarado dentro do `HealthModule`.

---

## 7. Decisões de Design

- **`TypeOrmHealthIndicator.pingCheck()`**: executa um `SELECT 1` no banco de dados para verificar a conectividade. É leve e rápido, adequado para ser chamado a cada 15s pelo Prometheus (via scraping que gera requests).
- **Sem timeout customizado**: o terminus usa timeout padrão de 1000ms para cada health indicator. Suficiente para um `SELECT 1` em ambiente local.
- **Formato padronizado**: o terminus retorna um JSON com estrutura fixa (`status`, `info`, `error`, `details`), compatível com ferramentas de monitoramento e com o `api-gateway` que já consome `GET /health`.
- **HTTP 503 em falha**: permite que load balancers, monitoring tools e o `api-gateway` distingam entre serviço saudável (200) e degradado (503) apenas pelo status code.
- **`@Public()`**: mantido do controller anterior — essencial para que o Prometheus e o api-gateway possam verificar saúde sem JWT.

---

## 8. Critérios de Aceite

### CA-01: Dependência instalada

- `@nestjs/terminus` deve estar listado em `users-service/package.json` nas `dependencies`.

### CA-02: Endpoint /health retorna formato terminus

- `GET http://localhost:3000/health` deve retornar HTTP 200 com body contendo `status`, `info`, `error` e `details`.
- O campo `info.database.status` deve ser `"up"` quando o PostgreSQL está acessível.

### CA-03: Sem autenticação

- `GET /health` deve funcionar **sem** token JWT no header `Authorization`.

### CA-04: Verificação real do banco de dados

- Parar o PostgreSQL e chamar `GET /health` deve retornar HTTP 503 com `status: "error"` e `error.database.status: "down"`.
- Reiniciar o PostgreSQL e chamar `GET /health` deve voltar a retornar HTTP 200 com `status: "ok"`.

### CA-05: HealthModule registrado

- O `HealthModule` deve estar importado no `AppModule`.
- O `HealthController` **não** deve estar listado diretamente no array `controllers` do `AppModule`.

### CA-06: Compatibilidade com api-gateway

- O `api-gateway` deve continuar conseguindo verificar o health do `users-service` via `GET /health` (o formato mudou mas o endpoint permanece o mesmo e o status field `status: "ok"` é compatível).

---

## 9. Validação

```bash
# 1. Iniciar o users-service (PostgreSQL deve estar rodando)
cd users-service && npm run start:dev

# 2. Verificar health check com banco disponível
curl -s http://localhost:3000/health | jq .
# Esperado: { "status": "ok", "info": { "database": { "status": "up" } }, ... }

# 3. Parar o PostgreSQL
docker stop <postgres-container>

# 4. Verificar health check com banco indisponível
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health
# Esperado: 503

curl -s http://localhost:3000/health | jq .
# Esperado: { "status": "error", "error": { "database": { "status": "down", ... } }, ... }

# 5. Reiniciar o PostgreSQL e verificar recuperação
docker start <postgres-container>
curl -s http://localhost:3000/health | jq .
# Esperado: { "status": "ok", ... }
```

---

## 10. Arquivos Impactados

| Arquivo | Ação |
|---------|------|
| `users-service/package.json` | Alterar — adicionar `@nestjs/terminus` |
| `users-service/src/health/health.controller.ts` | Reescrever — usar terminus |
| `users-service/src/health/health.module.ts` | Criar |
| `users-service/src/app.module.ts` | Alterar — importar `HealthModule`, remover `HealthController` do controllers |
