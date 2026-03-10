# SPEC: Instrumentação de Métricas HTTP — users-service

**Serviço:** users-service  
**Status:** Proposta  
**Autor:** Arquitetura  
**Data:** 2026-03-05  

---

## 1. Visão Geral

Instrumentar o `users-service` (porta 3000) com métricas HTTP usando `prom-client`, expondo o endpoint `GET /metrics` no formato Prometheus. Isso permitirá que o Prometheus (já configurado na SPEC 01 do `observability-stack`) colete métricas automaticamente a cada 15s.

O `users-service` possui `JwtAuthGuard` registrado como guard global via `APP_GUARD` no `AuthModule`. O endpoint `/metrics` deve ser marcado com `@Public()` para bypass da autenticação JWT.

---

## 2. Escopo

### Incluso

- Instalação do `prom-client` como dependência
- Criação do `MetricsModule` (`@Global`) com `MetricsService`, `HttpMetricsInterceptor` e `MetricsController`
- Registro do módulo no `AppModule`
- Endpoint `GET /metrics` público (sem JWT) retornando métricas no formato Prometheus

### Fora de escopo

- Métricas de negócio customizadas — spec futura
- Dashboards no Grafana — spec futura
- Alterações no Prometheus ou Grafana — já configurados

---

## 3. Contexto do Serviço

| Aspecto | Detalhe |
|---------|---------|
| **Porta** | 3000 |
| **Guard global** | `JwtAuthGuard` (APP_GUARD) via `AuthModule` |
| **@Public()** | Disponível em `src/auth/decorators/public.decorator.ts` |
| **prom-client** | Não instalado |
| **Endpoint /metrics** | Não existe |

---

## 4. Dependências

Instalar no `users-service/`:

```bash
npm install prom-client
```

---

## 5. Estrutura de Arquivos

```
users-service/
└── src/
    └── metrics/
        ├── metrics.module.ts            ← módulo @Global
        ├── metrics.service.ts           ← registry, counter, histogram
        ├── metrics.controller.ts        ← GET /metrics (@Public)
        └── http-metrics.interceptor.ts  ← interceptor global
```

---

## 6. Implementação

### 6.1 MetricsService (`src/metrics/metrics.service.ts`)

Responsável por encapsular o `prom-client` Registry e expor as métricas.

**Requisitos:**

- Criar um `Registry` dedicado (não usar o default global, para isolamento)
- Registrar `collectDefaultMetrics` com o registry dedicado e prefix `users_service_`
- Criar um `Counter` chamado `http_requests_total` com labels: `method`, `route`, `status_code`
- Criar um `Histogram` chamado `http_request_duration_seconds` com labels: `method`, `route`, `status_code`
- Buckets do histogram: `[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]` (padrão Prometheus)
- Expor método `getMetrics(): Promise<string>` que retorna `registry.metrics()`
- Expor método `getContentType(): string` que retorna `registry.contentType`

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Registry,
  Counter,
  Histogram,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly registry: Registry;
  readonly httpRequestsTotal: Counter;
  readonly httpRequestDuration: Histogram;

  constructor() {
    this.registry = new Registry();

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });
  }

  onModuleInit() {
    collectDefaultMetrics({
      register: this.registry,
      prefix: 'users_service_',
    });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}
```

### 6.2 HttpMetricsInterceptor (`src/metrics/http-metrics.interceptor.ts`)

Interceptor global que captura métricas de cada request HTTP.

**Requisitos:**

- Implementar `NestInterceptor`
- Capturar `method`, `route` e `status_code` de cada request
- Medir a duração da request em segundos
- Incrementar `http_requests_total` e observar `http_request_duration_seconds`
- **Excluir** o endpoint `/metrics` da contabilização (evitar loop de métricas do Prometheus)
- Usar `req.route?.path || req.url` para capturar o route pattern (ex: `/users/:id` em vez de `/users/123`)

```typescript
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const { method, url } = req;

    if (url === '/metrics') {
      return next.handle();
    }

    const startTime = process.hrtime.bigint();

    return next.handle().pipe(
      tap({
        next: () => {
          this.recordMetrics(req, context, startTime);
        },
        error: () => {
          this.recordMetrics(req, context, startTime);
        },
      }),
    );
  }

  private recordMetrics(
    req: any,
    context: ExecutionContext,
    startTime: bigint,
  ): void {
    const res = context.switchToHttp().getResponse();
    const route = req.route?.path || req.url;
    const method = req.method;
    const statusCode = res.statusCode?.toString() || '500';
    const duration =
      Number(process.hrtime.bigint() - startTime) / 1_000_000_000;

    const labels = { method, route, status_code: statusCode };
    this.metricsService.httpRequestsTotal.inc(labels);
    this.metricsService.httpRequestDuration.observe(labels, duration);
  }
}
```

### 6.3 MetricsController (`src/metrics/metrics.controller.ts`)

**Requisitos:**

- Rota `GET /metrics` que retorna métricas no formato Prometheus (text/plain)
- Usar `@Public()` do `src/auth/decorators/public.decorator.ts` para bypass do `JwtAuthGuard` global
- Definir `Content-Type` correto via `res.set()`

```typescript
import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Public()
  @Get()
  async getMetrics(@Res() res: Response): Promise<void> {
    const metrics = await this.metricsService.getMetrics();
    res.set('Content-Type', this.metricsService.getContentType());
    res.send(metrics);
  }
}
```

### 6.4 MetricsModule (`src/metrics/metrics.module.ts`)

**Requisitos:**

- Decorado com `@Global()` para que `MetricsService` esteja disponível em toda a aplicação
- Registrar `HttpMetricsInterceptor` como `APP_INTERCEPTOR` (interceptor global)
- Exportar `MetricsService`

```typescript
import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpMetricsInterceptor,
    },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
```

### 6.5 Registro no AppModule (`src/app.module.ts`)

Adicionar `MetricsModule` no array de `imports` do `AppModule`:

```typescript
import { MetricsModule } from './metrics/metrics.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(databaseConfig),
    MetricsModule,  // ← adicionar aqui
    UsersModule,
    AuthModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
```

---

## 7. Métricas Expostas

| Métrica | Tipo | Labels | Descrição |
|---------|------|--------|-----------|
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Total de requisições HTTP recebidas |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | Duração das requisições HTTP em segundos |
| `users_service_*` (default metrics) | Vários | — | Métricas padrão do Node.js (CPU, memória, event loop, GC, etc.) |

---

## 8. Decisões de Design

- **`@Public()` no MetricsController**: o `users-service` usa `JwtAuthGuard` como guard global (APP_GUARD). Sem `@Public()`, o Prometheus receberia 401 Unauthorized a cada scraping.
- **Registry dedicado**: não usa o registry global do `prom-client` para evitar colisão entre módulos ou testes.
- **Prefix `users_service_`**: as métricas padrão do Node.js recebem prefix para diferenciação quando visualizadas no Prometheus junto com outros serviços.
- **Exclusão de `/metrics` do interceptor**: evita que o próprio scraping do Prometheus infle as métricas HTTP.
- **`process.hrtime.bigint()`**: alta resolução para medir duração com precisão de nanosegundos.
- **`@Global()` no MetricsModule**: permite que qualquer módulo injete `MetricsService` sem importar o módulo explicitamente (preparação para métricas customizadas futuras).

---

## 9. Critérios de Aceite

### CA-01: Dependência instalada

- `prom-client` deve estar listado em `users-service/package.json` nas `dependencies`.

### CA-02: Endpoint /metrics acessível

- `GET http://localhost:3000/metrics` deve retornar HTTP 200 com `Content-Type: text/plain` (ou `application/openmetrics-text`).
- O body deve conter métricas no formato Prometheus exposition format.

### CA-03: Sem autenticação

- `GET /metrics` deve funcionar **sem** token JWT no header `Authorization`.

### CA-04: Métricas HTTP registradas

- Após fazer requests a outros endpoints (ex: `GET /health`), executar `GET /metrics` deve retornar:
  - `http_requests_total` com labels `method="GET"`, `route="/health"`, `status_code="200"` com valor ≥ 1
  - `http_request_duration_seconds_bucket` com os mesmos labels

### CA-05: Endpoint /metrics excluído das métricas

- Após múltiplas chamadas a `GET /metrics`, a métrica `http_requests_total` **não** deve conter label `route="/metrics"`.

### CA-06: Métricas padrão do Node.js

- `GET /metrics` deve incluir métricas com prefix `users_service_` como:
  - `users_service_process_cpu_user_seconds_total`
  - `users_service_process_resident_memory_bytes`
  - `users_service_nodejs_eventloop_lag_seconds`

### CA-07: Target UP no Prometheus

- No Prometheus (`http://localhost:9090/targets`), o target `users-service` (`host.docker.internal:3000`) deve aparecer como **UP**.

---

## 10. Validação

```bash
# 1. Iniciar o users-service
cd users-service && npm run start:dev

# 2. Verificar se /metrics responde (sem token JWT)
curl -s http://localhost:3000/metrics | head -20

# 3. Fazer uma request normal
curl -s http://localhost:3000/health

# 4. Verificar se métricas HTTP foram registradas
curl -s http://localhost:3000/metrics | grep http_requests_total

# 5. Verificar que /metrics não aparece nas métricas
curl -s http://localhost:3000/metrics | grep 'route="/metrics"'
# (deve retornar vazio)

# 6. Verificar no Prometheus (stack de observabilidade rodando)
# Acessar http://localhost:9090/targets → users-service deve estar UP
```

---

## 11. Arquivos Impactados

| Arquivo | Ação |
|---------|------|
| `users-service/package.json` | Alterar — adicionar `prom-client` |
| `users-service/src/metrics/metrics.module.ts` | Criar |
| `users-service/src/metrics/metrics.service.ts` | Criar |
| `users-service/src/metrics/metrics.controller.ts` | Criar |
| `users-service/src/metrics/http-metrics.interceptor.ts` | Criar |
| `users-service/src/app.module.ts` | Alterar — importar `MetricsModule` |
