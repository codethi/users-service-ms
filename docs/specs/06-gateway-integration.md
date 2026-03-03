# SPEC: Integração do users-service com o api-gateway

**Serviço:** users-service + api-gateway  
**Portas:** 3000 (users-service) / 3005 (api-gateway)  
**Status:** Pendente  
**Criado em:** 2026-02-17  
**Depende de:** [01-scaffold](./01-scaffold.md), [02-user-registration](./02-user-registration.md), [03-jwt-login](./03-jwt-login.md), [04-jwt-guards-route-protection](./04-jwt-guards-route-protection.md), [05-user-query-endpoints](./05-user-query-endpoints.md)

---

## 1. Objetivo

Finalizar a integração entre o `users-service` e o `api-gateway`, em duas frentes:

1. **users-service:** adicionar os endpoints auxiliares necessários (validação de token, health check e Swagger)
2. **api-gateway:** refatorar o roteamento de `/auth/*` e `/users/*` para utilizar o `ProxyService` existente (com circuit breaker, retry, timeout e repasse fiel de erros 4xx), substituindo o `AuthController`/`AuthService` legados que fazem chamadas HTTP diretas e engoliam erros do backend

O padrão correto já foi implementado na integração do `products-service` (`ProductsController` usa `ProxyService.proxyRequest()` para todas as rotas). Esta spec aplica o mesmo padrão ao `users-service`.

Esta spec NÃO altera o `ProxyService`, `RetryService` ou `CircuitBreakerService` — esses já estão corrigidos para repassar erros 4xx. Também NÃO implementa session management.

---

## 2. Contexto

### 2.1 users-service (porta 3000)

O `users-service` já possui (specs 01 a 05):

- NestJS configurado com `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`)
- `ClassSerializerInterceptor` global (exclui campo `password` das respostas)
- TypeORM conectado ao PostgreSQL (`users_db`, porta 5433)
- Entidade `User` com campos: `id`, `email`, `password` (com `@Exclude()`), `firstName`, `lastName`, `role`, `status`, `createdAt`, `updatedAt`
- Enums `UserRole` (`seller`, `buyer`) e `UserStatus` (`active`, `inactive`)
- `AuthModule` com `AuthController` e `AuthService`:
  - `POST /auth/register` — rota pública, registra novo usuário
  - `POST /auth/login` — rota pública, autentica e retorna token JWT
- Proteção global de rotas com `JwtAuthGuard` via `APP_GUARD` — todas as rotas exigem token JWT por padrão
- Decorator `@Public()` para marcar rotas que não requerem autenticação
- `UsersModule` com `UsersController` e `UsersService`:
  - `GET /users/profile` — retorna perfil do usuário logado
  - `GET /users/sellers` — retorna vendedores ativos
  - `GET /users/:id` — retorna usuário por ID
- O usuário autenticado está disponível em `req.user` com `{ id, email, role }` (extraído do token JWT)
- **NÃO possui** endpoint de validação de token
- **NÃO possui** endpoint de health check
- **NÃO possui** documentação Swagger/OpenAPI configurada

### 2.2 api-gateway (porta 3005)

O `api-gateway` já possui:

- `ProxyService` com circuit breaker, retry com backoff exponencial e timeout configuráveis — já corrigido para repassar erros 4xx sem retry/circuit breaker
- `serviceConfig` com `users.url` apontando para `process.env.USERS_SERVICE_URL || 'http://localhost:3000'`
- `ProductsController` (`api-gateway/src/products/`) que roteia `/products/*` via `ProxyService.proxyRequest()` — **padrão de referência**
- `AuthController` com `POST /auth/login` e `POST /auth/register` que delegam para o `AuthService` — **PROBLEMA: contorna o ProxyService**
- `AuthService` que faz chamadas HTTP diretas ao `users-service` para login e registro — **PROBLEMA: engole erros 4xx do backend** (ex: 409 Conflict vira 401 genérico)
- `JwtAuthGuard` com suporte a `@Public()` para rotas públicas
- `RoleGuard` para autorização baseada em roles
- `HealthCheckService` que chama `GET /health` em cada microserviço para verificar disponibilidade
- `HealthController` com endpoints `/health`, `/health/services`, `/health/services/:serviceName`, `/health/ready`, `/health/live`
- Swagger/OpenAPI configurado com Bearer Auth e Session Auth
- CORS configurado com header `Authorization` na lista de `allowedHeaders`
- `.env` com `USERS_SERVICE_URL=http://localhost:3000`
- O `ProxyService` já repassa headers (incluindo `Authorization`) e injeta headers `x-user-id`, `x-user-email`, `x-user-role` nas requisições
- **Não possui** controller que exponha rotas `/users/*` via `ProxyService`

### 2.3 Lacunas Identificadas

| Lacuna | Onde | Impacto |
|--------|------|---------|
| Não existe `GET /auth/validate-token` | users-service | O gateway não consegue validar tokens diretamente contra o serviço emissor |
| Não existe `GET /health` | users-service | O `HealthCheckService` do gateway retorna `unhealthy` para o users-service |
| Swagger não configurado | users-service | Sem documentação interativa para desenvolvimento e debug |
| Rotas `/auth/*` contornam o `ProxyService` | api-gateway | Sem circuit breaker, retry ou timeout para chamadas ao users-service; erros 4xx são engolidos |
| `AuthService` engole erros do backend | api-gateway | 409 Conflict no registro vira 401 genérico; 401 no login perde a mensagem original |
| Não existem rotas `/users/*` no gateway | api-gateway | `GET /users/profile`, `/users/sellers`, `/users/:id` não são roteados pelo gateway |

---

## 3. Requisitos Funcionais — users-service

### RF-01: Endpoint de Validação de Token — `GET /auth/validate-token`

Deve existir um endpoint no `AuthController` que permita validar um token JWT e retornar os dados do usuário autenticado:

- Acessível via `GET /auth/validate-token`
- Protegido pelo `JwtAuthGuard` global (comportamento padrão — requer token JWT válido no header `Authorization: Bearer <token>`)
- Utiliza os dados do usuário já extraídos pelo guard (`req.user`) para compor a resposta
- Retorna um objeto com: `userId`, `email` e `role`
- Finalidade: permitir que o api-gateway (ou outros microserviços) valide tokens e obtenha informações do usuário autenticado sem precisar decodificar o JWT localmente

**Resposta esperada — 200 OK:**

```json
{
  "userId": "uuid-do-usuario",
  "email": "usuario@email.com",
  "role": "buyer"
}
```

**Resposta esperada — 401 Unauthorized** (token ausente, expirado ou inválido):

```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

### RF-02: Endpoint de Health Check — `GET /health`

Deve existir um endpoint público que retorne o status de saúde do `users-service`:

- Acessível via `GET /health`
- Rota pública — **não** requer autenticação (decorada com `@Public()`)
- Retorna um objeto com o status do serviço e seu nome identificador
- Finalidade: ser consumido pelo `HealthCheckService` do api-gateway, que periodicamente chama `GET /health` nos microserviços

**Resposta esperada — 200 OK:**

```json
{
  "status": "ok",
  "service": "users-service"
}
```

### RF-03: Configuração do Swagger/OpenAPI

A documentação Swagger deve ser configurada no `main.ts` do `users-service`:

- Acessível via `/api` (rota padrão do Swagger)
- Título: `"Users Service"`
- Descrição: breve descrição do serviço
- Versão: `"1.0"`
- Suporte a Bearer Auth (JWT) para que seja possível testar endpoints protegidos diretamente pelo Swagger
- O Swagger deve documentar automaticamente todos os endpoints existentes (auth e users)

**Motivação:** Facilitar o desenvolvimento, debug e testes dos endpoints do `users-service` de forma independente do gateway.

### Dependências Adicionais Necessárias

- `@nestjs/swagger` — para configuração do Swagger/OpenAPI (deve ser instalada no users-service, caso ainda não esteja)

---

## 4. Requisitos Funcionais — api-gateway

### RF-04: Configuração da Variável de Ambiente

O arquivo `.env` do api-gateway deve conter:

```
USERS_SERVICE_URL=http://localhost:3000
```

**Status:** Já configurado — apenas verificar que está presente e correto.

### RF-05: Refatoração — Rotear `/auth/*` e `/users/*` via ProxyService

#### Problema atual

O `AuthController` do gateway (`api-gateway/src/auth/controllers/auth.controller.ts`) delega para um `AuthService` (`api-gateway/src/auth/service/auth.service.ts`) que faz chamadas HTTP diretas ao `users-service` usando `HttpService`, **contornando toda a infraestrutura de resiliência** do `ProxyService` (circuit breaker, retry, timeout, fallback).

Além disso, o `AuthService` captura **todos** os erros do backend com `catch` genérico e lança `UnauthorizedException` com mensagens fixas, **engolindo** os erros reais do `users-service`. Exemplos:
- Um `409 Conflict` na rota de registro (email duplicado) vira `401 "Registration failed"`
- Um `401 Unauthorized` no login (credenciais inválidas) vira `401 "Invalid login credentials"` sem o body original

#### Solução

Criar um `UsersController` no gateway que utilize `ProxyService.proxyRequest('users', ...)` para **todas** as rotas de autenticação e usuários, seguindo o mesmo padrão do `ProductsController` (`api-gateway/src/products/products.controller.ts`) e `ProductsModule` (`api-gateway/src/products/products.module.ts`).

As camadas de resiliência do `ProxyService` já estão corrigidas para repassar erros 4xx ao cliente (sem retry e sem acionar circuit breaker) — ver `ProxyService`, `RetryService` e `CircuitBreakerService`.

#### Estrutura a criar

```
api-gateway/src/users/
├── users.module.ts          # (novo) importa ProxyModule, declara UsersController
└── users.controller.ts      # (novo) roteia /auth/* e /users/* via ProxyService
```

O `UsersModule` deve ser importado no `AppModule` do gateway.

#### Tabela de rotas

| Rota no Gateway          | Método | Autenticação | Implementação no UsersController                                                                                   |
|--------------------------|--------|--------------|--------------------------------------------------------------------------------------------------------------------|
| `/auth/register`         | POST   | Pública      | `proxyService.proxyRequest('users', 'POST', '/auth/register', body)`                                               |
| `/auth/login`            | POST   | Pública      | `proxyService.proxyRequest('users', 'POST', '/auth/login', body)`                                                  |
| `/auth/validate-token`   | GET    | Protegida    | `proxyService.proxyRequest('users', 'GET', '/auth/validate-token', undefined, { authorization }, user)`             |
| `/users/profile`         | GET    | Protegida    | `proxyService.proxyRequest('users', 'GET', '/users/profile', undefined, { authorization }, user)`                   |
| `/users/sellers`         | GET    | Protegida    | `proxyService.proxyRequest('users', 'GET', '/users/sellers', undefined, { authorization }, user)`                   |
| `/users/:id`             | GET    | Protegida    | `proxyService.proxyRequest('users', 'GET', '/users/${id}', undefined, { authorization }, user)`                     |

**Regras:**

- Rotas públicas (`POST /auth/register`, `POST /auth/login`): **não** usar guards de autenticação, encaminhar apenas o body
- Rotas protegidas (`GET /auth/validate-token`, `GET /users/profile`, `GET /users/sellers`, `GET /users/:id`): usar `@UseGuards(JwtAuthGuard)`, repassar header `Authorization` e `userInfo` (via `@CurrentUser()`) para que o `ProxyService` inclua os headers `x-user-id`, `x-user-email`, `x-user-role`
- O controller deve usar dois prefixos separados — um `@Controller('auth')` e outro `@Controller('users')` — ou um único controller sem prefixo com rotas explícitas. A abordagem recomendada é criar **dois controllers** no mesmo módulo (`AuthProxyController` com prefixo `auth` e `UsersProxyController` com prefixo `users`), mantendo consistência com o padrão de prefixo único por controller do NestJS

### RF-06: Remoção do AuthController e AuthService legados

O `AuthController` (`api-gateway/src/auth/controllers/auth.controller.ts`) e o `AuthService` (`api-gateway/src/auth/service/auth.service.ts`) devem ser **removidos**, pois o fluxo de proxy via `UsersController` substitui completamente as chamadas HTTP diretas.

**Itens a remover ou refatorar:**

| Arquivo | Ação |
|---------|------|
| `api-gateway/src/auth/controllers/auth.controller.ts` | Remover (substituído pelo novo controller de proxy) |
| `api-gateway/src/auth/service/auth.service.ts` | Remover os métodos `login()` e `register()` que fazem chamadas HTTP diretas. Manter `validateJwtToken()` e `validateSessionToken()` se ainda forem usados pelos guards/strategies |
| `api-gateway/src/auth/auth.module.ts` | Atualizar para refletir as remoções |
| `api-gateway/src/auth/dtos/login.dto.ts` | Pode ser removido (o gateway não precisa mais validar DTOs de login, apenas repassa o body) |
| `api-gateway/src/auth/dtos/register.dto.ts` | Pode ser removido (mesma razão) |

**Nota:** O `AuthModule` continua necessário para fornecer `JwtStrategy`, `JwtAuthGuard`, decorators (`@Public()`, `@CurrentUser()`, `@Roles()`) e o `AuthService.validateJwtToken()` usado pelo `JwtStrategy`. Apenas o controller e os métodos de chamada HTTP direta devem ser removidos.

### RF-07: Repasse do Header Authorization

O header `Authorization: Bearer <token>` enviado pelo cliente ao gateway deve ser repassado integralmente nas requisições proxy ao `users-service`, para que o `JwtAuthGuard` do users-service possa validar o token.

**Status:** O `ProxyService` já repassa headers via parâmetro — o novo `UsersController` deve utilizar `@Headers('authorization')` e repassar no objeto `headers`.

---

## 5. Fluxo Completo Esperado via Gateway (porta 3005)

O fluxo E2E deve funcionar inteiramente através do gateway. O consumidor (frontend, curl, Postman) **nunca** acessa o users-service diretamente. Todas as requisições passam pelo `ProxyService`, que garante resiliência (circuit breaker, retry, timeout) e repasse fiel de erros 4xx.

### 5.1 Registro de Usuário

```
Cliente → POST http://localhost:3005/auth/register (body com dados do usuário)
       → Gateway recebe (rota pública, sem autenticação)
       → UsersController chama ProxyService.proxyRequest('users', 'POST', '/auth/register', body)
       → ProxyService encaminha para http://localhost:3000/auth/register
       → users-service registra o usuário no banco
       → Resposta retorna ao cliente via gateway (201 Created)
       → Se email duplicado: users-service retorna 409 → ProxyService repassa 409 ao cliente
```

### 5.2 Login

```
Cliente → POST http://localhost:3005/auth/login (body com email e password)
       → Gateway recebe (rota pública, sem autenticação)
       → UsersController chama ProxyService.proxyRequest('users', 'POST', '/auth/login', body)
       → ProxyService encaminha para http://localhost:3000/auth/login
       → users-service valida credenciais e gera token JWT
       → Resposta com token retorna ao cliente via gateway (200 OK)
       → Se credenciais inválidas: users-service retorna 401 → ProxyService repassa 401 ao cliente (com body original)
```

### 5.3 Consulta de Perfil (rota protegida)

```
Cliente → GET http://localhost:3005/users/profile (header Authorization: Bearer <token>)
       → Gateway recebe e valida o token JWT via JwtAuthGuard
       → UsersController chama ProxyService.proxyRequest('users', 'GET', '/users/profile', undefined, { authorization }, userInfo)
       → ProxyService encaminha para http://localhost:3000/users/profile (com header Authorization + x-user-*)
       → users-service valida o token novamente via seu próprio JwtAuthGuard
       → users-service busca dados do usuário no banco e retorna
       → Resposta retorna ao cliente via gateway (200 OK)
```

### 5.4 Listagem de Vendedores (rota protegida)

```
Cliente → GET http://localhost:3005/users/sellers (header Authorization: Bearer <token>)
       → Gateway recebe e valida o token JWT via JwtAuthGuard
       → UsersController chama ProxyService.proxyRequest('users', 'GET', '/users/sellers', undefined, { authorization }, userInfo)
       → ProxyService encaminha para http://localhost:3000/users/sellers (com header Authorization + x-user-*)
       → users-service valida o token e retorna lista de vendedores ativos
       → Resposta retorna ao cliente via gateway (200 OK)
```

### 5.5 Validação de Token

```
Cliente → GET http://localhost:3005/auth/validate-token (header Authorization: Bearer <token>)
       → Gateway recebe e valida o token JWT via JwtAuthGuard
       → UsersController chama ProxyService.proxyRequest('users', 'GET', '/auth/validate-token', undefined, { authorization }, userInfo)
       → ProxyService encaminha para http://localhost:3000/auth/validate-token (com header Authorization)
       → users-service valida o token e retorna { userId, email, role }
       → Resposta retorna ao cliente via gateway (200 OK)
```

### 5.6 Health Check do users-service via Gateway

```
Gateway HealthCheckService → GET http://localhost:3000/health (chamada interna periódica)
                           → users-service retorna { status: "ok", service: "users-service" }
                           → HealthCheckService marca users-service como "healthy"
```

---

## 6. Respostas Esperadas

### 6.1 `GET /auth/validate-token` — 200 OK

```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "email": "usuario@email.com",
  "role": "buyer"
}
```

### 6.2 `GET /auth/validate-token` — 401 Unauthorized

Quando o token JWT está ausente, expirado ou inválido:

```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

### 6.3 `GET /health` — 200 OK

```json
{
  "status": "ok",
  "service": "users-service"
}
```

### 6.4 `POST /auth/register` — 409 Conflict (email duplicado)

Quando o email já está cadastrado, o `users-service` retorna 409 e o gateway repassa fielmente:

```json
{
  "statusCode": 409,
  "message": "Email already exists",
  "error": "Conflict"
}
```

### 6.5 `POST /auth/login` — 401 Unauthorized (credenciais inválidas)

Quando as credenciais são inválidas, o `users-service` retorna 401 e o gateway repassa fielmente:

```json
{
  "statusCode": 401,
  "message": "Invalid credentials",
  "error": "Unauthorized"
}
```

### 6.6 Erros 4xx genéricos — Repasse fiel

Qualquer resposta 4xx do `users-service` (400, 401, 403, 404, 409, 422, etc.) é repassada pelo `ProxyService` ao cliente com o **mesmo status code e body**, sem transformação. O circuit breaker e o retry **não** são acionados por erros 4xx.

### 6.7 Erros de Proxy via Gateway — 503 Service Unavailable

Quando o `users-service` está fora do ar e o circuit breaker do gateway é acionado:

```json
{
  "error": "Service unavailable",
  "service": "users",
  "message": "User service unavailable"
}
```

---

## 7. Estrutura de Pastas Esperada

Novos arquivos e alterações em relação às specs anteriores:

```
users-service/
└── src/
    ├── main.ts                         # (alterado) adicionar configuração do Swagger
    ├── health/
    │   └── health.controller.ts        # (novo) endpoint GET /health
    └── auth/
        └── auth.controller.ts          # (alterado) adicionar endpoint GET /auth/validate-token

api-gateway/
└── src/
    ├── app.module.ts                        # (alterado) importar UsersModule
    ├── users/
    │   ├── users.module.ts                  # (novo) importa ProxyModule, declara controllers
    │   └── users.controller.ts              # (novo) roteia /auth/* e /users/* via ProxyService
    └── auth/
        ├── controllers/
        │   └── auth.controller.ts           # (removido) substituído pelo novo controller de proxy
        ├── service/
        │   └── auth.service.ts              # (alterado) remover métodos login() e register()
        ├── auth.module.ts                   # (alterado) remover AuthController, atualizar providers
        ├── dtos/
        │   ├── login.dto.ts                 # (removido) não mais necessário
        │   └── register.dto.ts              # (removido) não mais necessário
        ├── strategies/
        │   └── jwt.strategy.ts              # (inalterado)
        └── decorators/                      # (inalterado)
            ├── current-user.decorator.ts
            ├── public.decorator.ts
            └── roles.decorator.ts
```

---

## 8. Critérios de Aceite

### CA-01: GET /auth/validate-token retorna dados do usuário autenticado

- [ ] Enviar `GET /auth/validate-token` com token JWT válido deve retornar `200` com `userId`, `email` e `role`
- [ ] Os campos retornados devem corresponder ao usuário do token
- [ ] Enviar `GET /auth/validate-token` **sem** header `Authorization` deve retornar `401 Unauthorized`
- [ ] Enviar `GET /auth/validate-token` com token expirado ou inválido deve retornar `401 Unauthorized`

### CA-02: GET /health retorna status do serviço

- [ ] Enviar `GET /health` **sem** autenticação deve retornar `200` com `{ "status": "ok", "service": "users-service" }`
- [ ] A rota não deve exigir token JWT

### CA-03: Swagger acessível no users-service

- [ ] Acessar `http://localhost:3000/api` no navegador deve exibir a documentação Swagger
- [ ] O título da documentação deve ser `"Users Service"`
- [ ] O Swagger deve listar todos os endpoints: `/auth/register`, `/auth/login`, `/auth/validate-token`, `/users/profile`, `/users/sellers`, `/users/:id`, `/health`
- [ ] O Swagger deve ter suporte a Bearer Auth para testar endpoints protegidos

### CA-04: Registro via gateway funciona (com repasse fiel de erros)

- [ ] Enviar `POST http://localhost:3005/auth/register` com body válido deve registrar o usuário e retornar `201 Created`
- [ ] Os dados devem ser persistidos no banco do `users-service`
- [ ] Enviar `POST http://localhost:3005/auth/register` com email **já cadastrado** deve retornar `409 Conflict` (não `401` genérico)
- [ ] O body da resposta 409 deve conter a mensagem original do `users-service` (ex: `"Email already exists"`)

### CA-05: Login via gateway funciona (com repasse fiel de erros)

- [ ] Enviar `POST http://localhost:3005/auth/login` com credenciais válidas deve retornar `200` com o token JWT
- [ ] O token retornado deve ser utilizável nos próximos requests
- [ ] Enviar `POST http://localhost:3005/auth/login` com credenciais **inválidas** deve retornar `401 Unauthorized` com a mensagem original do `users-service` (não uma mensagem genérica do gateway)

### CA-06: Consulta de perfil via gateway funciona

- [ ] Enviar `GET http://localhost:3005/users/profile` com o token JWT obtido no login deve retornar `200` com os dados do usuário
- [ ] O campo `password` **não** deve estar presente na resposta
- [ ] Enviar `GET http://localhost:3005/users/profile` **sem** token deve retornar `401`

### CA-07: Listagem de vendedores via gateway funciona

- [ ] Enviar `GET http://localhost:3005/users/sellers` com token JWT válido deve retornar `200` com array de vendedores
- [ ] O campo `password` **não** deve estar presente em nenhum item
- [ ] Enviar `GET http://localhost:3005/users/sellers` **sem** token deve retornar `401`

### CA-08: Validação de token via gateway funciona

- [ ] Enviar `GET http://localhost:3005/auth/validate-token` com token JWT válido deve retornar `200` com `userId`, `email` e `role`
- [ ] Enviar `GET http://localhost:3005/auth/validate-token` **sem** token deve retornar `401`

### CA-09: Health check do users-service via gateway funciona

- [ ] Enviar `GET http://localhost:3005/health/services/users` deve retornar o status do `users-service`
- [ ] Com o `users-service` rodando, o status deve ser `"healthy"`
- [ ] Com o `users-service` parado, o status deve ser `"unhealthy"`

### CA-10: JWT_SECRET compartilhado entre os serviços

- [ ] O `JWT_SECRET` configurado no `.env` do `api-gateway` deve ser o **mesmo** valor configurado no `.env` do `users-service`
- [ ] Se os secrets forem diferentes, o gateway não conseguirá validar tokens emitidos pelo `users-service`

### CA-11: Erros 4xx do users-service são repassados corretamente

- [ ] Erros 4xx retornados pelo `users-service` (400, 401, 403, 404, 409, 422) são repassados ao cliente com o **mesmo status code e body**
- [ ] O circuit breaker **não** é acionado por erros 4xx
- [ ] O retry **não** é executado para erros 4xx
- [ ] Erros 5xx e falhas de conexão continuam acionando o pipeline de resiliência normalmente

### CA-12: AuthController e AuthService legados removidos

- [ ] O `AuthController` antigo do gateway (que fazia chamadas HTTP diretas) foi removido
- [ ] Os métodos `login()` e `register()` do `AuthService` foram removidos
- [ ] O `AuthService.validateJwtToken()` e `validateSessionToken()` permanecem disponíveis para uso pelos guards/strategies
- [ ] Todas as rotas `/auth/*` e `/users/*` no gateway passam pelo `ProxyService`

### CA-13: Compatibilidade de rotas mantida

- [ ] Os mesmos paths, métodos HTTP e formato de resposta existentes continuam funcionando para o consumidor
- [ ] `POST /auth/register`, `POST /auth/login`, `GET /auth/validate-token` funcionam como antes
- [ ] `GET /users/profile`, `GET /users/sellers`, `GET /users/:id` funcionam como antes
- [ ] Nenhuma rota foi removida ou teve seu path alterado

### CA-14: Testes automatizados passam

- [ ] Devem existir testes unitários para o novo endpoint `GET /auth/validate-token` no users-service
- [ ] Devem existir testes unitários para o `HealthController` no users-service
- [ ] `npm run test` no `users-service` deve executar todos os testes sem falhas

### CA-15: Lint passa sem erros

- [ ] Executar `npm run lint` no `users-service` não deve apresentar erros nos arquivos criados ou alterados
- [ ] Executar `npm run lint` no `api-gateway` não deve apresentar erros nos arquivos criados ou alterados

---

## 9. Fluxo de Teste E2E via curl

Sequência de comandos para validar o fluxo completo passando pelo gateway:

```bash
# 1. Registrar um usuário
curl -s -w "\n%{http_code}" -X POST http://localhost:3005/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@email.com","password":"Str0ng!Pass","firstName":"Test","lastName":"User","role":"seller"}'
# → Esperado: 201 Created

# 2. Tentar registrar com mesmo email (deve retornar 409, NÃO 401)
curl -s -w "\n%{http_code}" -X POST http://localhost:3005/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@email.com","password":"Str0ng!Pass","firstName":"Test","lastName":"User","role":"seller"}'
# → Esperado: 409 Conflict com mensagem do users-service

# 3. Fazer login e obter token
curl -s -w "\n%{http_code}" -X POST http://localhost:3005/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@email.com","password":"Str0ng!Pass"}'
# → Esperado: 200 OK com access_token — Guardar o token retornado

# 4. Tentar login com credenciais inválidas (deve retornar 401 do users-service)
curl -s -w "\n%{http_code}" -X POST http://localhost:3005/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@email.com","password":"WrongPass"}'
# → Esperado: 401 Unauthorized com mensagem original do users-service

# 5. Validar o token
curl -s -w "\n%{http_code}" http://localhost:3005/auth/validate-token \
  -H "Authorization: Bearer <TOKEN>"
# → Esperado: 200 OK com { userId, email, role }

# 6. Consultar perfil
curl -s -w "\n%{http_code}" http://localhost:3005/users/profile \
  -H "Authorization: Bearer <TOKEN>"
# → Esperado: 200 OK com dados do usuário (sem campo password)

# 7. Listar vendedores
curl -s -w "\n%{http_code}" http://localhost:3005/users/sellers \
  -H "Authorization: Bearer <TOKEN>"
# → Esperado: 200 OK com array de vendedores

# 8. Health check do users-service
curl -s -w "\n%{http_code}" http://localhost:3005/health/services/users
# → Esperado: 200 OK com status "healthy"
```

Todos os comandos acima devem retornar as respostas esperadas sem erros.

---

## 10. Fora de Escopo

- Alteração nos guards do gateway (`JwtAuthGuard`, `RoleGuard`, `SessionGuard`)
- Alteração no `ProxyService`, `RetryService` ou `CircuitBreakerService` (já corrigidos para repassar erros 4xx)
- Implementação de session management
- Autenticação entre microserviços (service-to-service auth)
- Rate limiting no users-service
- Cache de validação de token
- Testes de integração E2E automatizados (a validação E2E é manual via curl/Postman)
- Docker Compose multi-serviço
- CI/CD
- Migrations ou seeds

---

## 11. Commits

Faça um commit granular após cada item implementado nesta spec. Sugestão de sequência:

1. **Commit:** Adicionar endpoint GET /auth/validate-token no AuthController do users-service
2. **Commit:** Adicionar endpoint GET /health com HealthController no users-service
3. **Commit:** Configurar Swagger/OpenAPI no users-service
4. **Commit:** Adicionar testes unitários dos novos endpoints no users-service
5. **Commit:** Criar UsersController e UsersModule no api-gateway com rotas via ProxyService
6. **Commit:** Remover AuthController e métodos HTTP diretos do AuthService no api-gateway
