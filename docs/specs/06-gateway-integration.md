# SPEC: Integração do users-service com o api-gateway

**Serviço:** users-service + api-gateway  
**Portas:** 3000 (users-service) / 3005 (api-gateway)  
**Status:** Pendente  
**Criado em:** 2026-02-17  
**Depende de:** [01-scaffold](./01-scaffold.md), [02-user-registration](./02-user-registration.md), [03-jwt-login](./03-jwt-login.md), [04-jwt-guards-route-protection](./04-jwt-guards-route-protection.md), [05-user-query-endpoints](./05-user-query-endpoints.md)

---

## 1. Objetivo

Finalizar a integração entre o `users-service` e o `api-gateway`, adicionando os endpoints auxiliares necessários no `users-service` (validação de token, health check e Swagger) e verificando que o fluxo completo de autenticação e consulta de usuários funciona de ponta a ponta através do gateway.

Esta spec NÃO altera o mecanismo de proxy, guards ou circuit breaker do gateway — esses já estão implementados e funcionais. Também NÃO implementa session management.

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

- `ProxyService` com circuit breaker, retry com backoff exponencial e timeout configuráveis
- `serviceConfig` com `users.url` apontando para `process.env.USERS_SERVICE_URL || 'http://localhost:3000'`
- `AuthController` com `POST /auth/login` e `POST /auth/register` que delegam para o `AuthService`
- `AuthService` que faz chamadas HTTP diretas ao `users-service` para login e registro
- `JwtAuthGuard` com suporte a `@Public()` para rotas públicas
- `RoleGuard` para autorização baseada em roles
- `HealthCheckService` que chama `GET /health` em cada microserviço para verificar disponibilidade
- `HealthController` com endpoints `/health`, `/health/services`, `/health/services/:serviceName`, `/health/ready`, `/health/live`
- Swagger/OpenAPI configurado com Bearer Auth e Session Auth
- CORS configurado com header `Authorization` na lista de `allowedHeaders`
- `.env` com `USERS_SERVICE_URL=http://localhost:3000`
- O `ProxyService` já repassa headers (incluindo `Authorization`) e injeta headers `x-user-id`, `x-user-email`, `x-user-role` nas requisições

### 2.3 Lacunas Identificadas

| Lacuna | Onde | Impacto |
|--------|------|---------|
| Não existe `GET /auth/validate-token` | users-service | O gateway não consegue validar tokens diretamente contra o serviço emissor |
| Não existe `GET /health` | users-service | O `HealthCheckService` do gateway retorna `unhealthy` para o users-service |
| Swagger não configurado | users-service | Sem documentação interativa para desenvolvimento e debug |

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

### RF-05: Proxy de Rotas `/auth/*` e `/users/*`

O `ProxyService` do gateway deve encaminhar corretamente as seguintes rotas para o `users-service`:

| Rota no Gateway | Método | Destino no users-service |
|-----------------|--------|--------------------------|
| `/auth/register` | POST | `http://localhost:3000/auth/register` |
| `/auth/login` | POST | `http://localhost:3000/auth/login` |
| `/auth/validate-token` | GET | `http://localhost:3000/auth/validate-token` |
| `/users/profile` | GET | `http://localhost:3000/users/profile` |
| `/users/sellers` | GET | `http://localhost:3000/users/sellers` |
| `/users/:id` | GET | `http://localhost:3000/users/:id` |

**Status:** O mecanismo de proxy já existe — verificar que as rotas acima são encaminhadas corretamente com os headers necessários.

### RF-06: Repasse do Header Authorization

O header `Authorization: Bearer <token>` enviado pelo cliente ao gateway deve ser repassado integralmente nas requisições proxy ao `users-service`, para que o `JwtAuthGuard` do users-service possa validar o token.

**Status:** O `ProxyService` já repassa headers — verificar que o `Authorization` está incluso.

---

## 5. Fluxo Completo Esperado via Gateway (porta 3005)

### 5.1 Registro de Usuário

```
Cliente → POST http://localhost:3005/auth/register (body com dados do usuário)
       → Gateway recebe (rota pública, sem autenticação)
       → Proxy encaminha para http://localhost:3000/auth/register
       → users-service registra o usuário no banco
       → Resposta retorna ao cliente via gateway (201 Created)
```

### 5.2 Login

```
Cliente → POST http://localhost:3005/auth/login (body com email e password)
       → Gateway recebe (rota pública, sem autenticação)
       → Proxy encaminha para http://localhost:3000/auth/login
       → users-service valida credenciais e gera token JWT
       → Resposta com token retorna ao cliente via gateway (200 OK)
```

### 5.3 Consulta de Perfil (rota protegida)

```
Cliente → GET http://localhost:3005/users/profile (header Authorization: Bearer <token>)
       → Gateway recebe e valida o token JWT via JwtAuthGuard
       → Proxy encaminha para http://localhost:3000/users/profile (com header Authorization)
       → users-service valida o token novamente via seu próprio JwtAuthGuard
       → users-service busca dados do usuário no banco e retorna
       → Resposta retorna ao cliente via gateway (200 OK)
```

### 5.4 Listagem de Vendedores (rota protegida)

```
Cliente → GET http://localhost:3005/users/sellers (header Authorization: Bearer <token>)
       → Gateway recebe e valida o token JWT via JwtAuthGuard
       → Proxy encaminha para http://localhost:3000/users/sellers (com header Authorization)
       → users-service valida o token e retorna lista de vendedores ativos
       → Resposta retorna ao cliente via gateway (200 OK)
```

### 5.5 Validação de Token

```
Cliente → GET http://localhost:3005/auth/validate-token (header Authorization: Bearer <token>)
       → Gateway recebe e valida o token JWT
       → Proxy encaminha para http://localhost:3000/auth/validate-token (com header Authorization)
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

### 6.4 Erros de Proxy via Gateway — 503 Service Unavailable

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
```

O api-gateway **não** requer alterações de código — apenas verificação de configuração e funcionamento.

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

### CA-04: Registro via gateway funciona

- [ ] Enviar `POST http://localhost:3005/auth/register` com body válido deve registrar o usuário e retornar `201 Created`
- [ ] Os dados devem ser persistidos no banco do `users-service`

### CA-05: Login via gateway funciona

- [ ] Enviar `POST http://localhost:3005/auth/login` com credenciais válidas deve retornar `200` com o token JWT
- [ ] O token retornado deve ser utilizável nos próximos requests

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

### CA-11: Testes automatizados passam

- [ ] Devem existir testes unitários para o novo endpoint `GET /auth/validate-token`
- [ ] Devem existir testes unitários para o `HealthController`
- [ ] `npm run test` no `users-service` deve executar todos os testes sem falhas

### CA-12: Lint passa sem erros

- [ ] Executar `npm run lint` no `users-service` não deve apresentar erros nos arquivos criados ou alterados

---

## 9. Fluxo de Teste E2E via curl

Sequência de comandos para validar o fluxo completo passando pelo gateway:

```bash
# 1. Registrar um usuário
curl -X POST http://localhost:3005/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@email.com","password":"Str0ng!Pass","firstName":"Test","lastName":"User","role":"seller"}'

# 2. Fazer login e obter token
curl -X POST http://localhost:3005/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@email.com","password":"Str0ng!Pass"}'
# → Guardar o token retornado

# 3. Validar o token
curl http://localhost:3005/auth/validate-token \
  -H "Authorization: Bearer <TOKEN>"

# 4. Consultar perfil
curl http://localhost:3005/users/profile \
  -H "Authorization: Bearer <TOKEN>"

# 5. Listar vendedores
curl http://localhost:3005/users/sellers \
  -H "Authorization: Bearer <TOKEN>"

# 6. Health check do users-service
curl http://localhost:3005/health/services/users
```

Todos os comandos acima devem retornar as respostas esperadas sem erros.

---

## 10. Fora de Escopo

- Alteração no `ProxyService` do gateway (já funcional)
- Alteração nos guards do gateway (`JwtAuthGuard`, `RoleGuard`, `SessionGuard`)
- Implementação de session management
- Criação de novos endpoints no gateway (usa proxy existente)
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

1. **Commit:** Adicionar endpoint GET /auth/validate-token no AuthController
2. **Commit:** Adicionar endpoint GET /health com HealthController
3. **Commit:** Configurar Swagger/OpenAPI no users-service
4. **Commit:** Adicionar testes unitários dos novos endpoints
