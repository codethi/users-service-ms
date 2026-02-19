# SPEC: Guards JWT e Proteção de Rotas

**Serviço:** users-service  
**Porta:** 3000  
**Status:** Pendente  
**Criado em:** 2026-02-17  
**Depende de:** [01-scaffold](./01-scaffold.md), [02-user-registration](./02-user-registration.md), [03-jwt-login](./03-jwt-login.md)

---

## 1. Objetivo

Implementar a proteção de rotas no `users-service` utilizando Passport com estratégia JWT, de forma que **todas as rotas sejam protegidas por padrão** e apenas rotas explicitamente marcadas como públicas possam ser acessadas sem autenticação. Após a proteção, os dados do usuário autenticado (extraídos do token) devem estar disponíveis em `req.user` para uso nos controllers.

Este spec NÃO inclui guards de autorização por role, guards de sessão, refresh tokens, novos endpoints ou qualquer lógica de negócio além da proteção de rotas com JWT.

---

## 2. Contexto

O `users-service` já possui (specs 01, 02 e 03):

- NestJS configurado com `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`)
- TypeORM conectado ao PostgreSQL (`users_db`, porta 5433)
- Entidade `User` com campos: `id`, `email`, `password` (com `@Exclude()`), `firstName`, `lastName`, `role`, `status`, `createdAt`, `updatedAt`
- Enums `UserRole` (`seller`, `buyer`) e `UserStatus` (`active`, `inactive`)
- `UsersService` com métodos `findByEmail(email)`, `findByEmailWithPassword(email)` e `create(data)`
- `AuthModule` com `AuthController` e `AuthService`
- Endpoints funcionando: `POST /auth/register` e `POST /auth/login` (retorna token JWT)
- `JwtModule` registrado no `AuthModule` com `secret` via `ConfigService` e expiração de 24h
- Payload do JWT contendo: `sub` (UUID do usuário), `email` e `role`
- Dependências já instaladas: `@nestjs/passport`, `passport`, `passport-jwt`, `@types/passport-jwt`

### Dependências adicionais necessárias

Nenhuma — todas as dependências necessárias já estão instaladas no projeto.

---

## 3. Requisitos Funcionais

### RF-01: Estratégia JWT do Passport (JwtStrategy)

Deve ser criada uma estratégia JWT para o Passport que:

- Extraia o token JWT do header `Authorization` da requisição, no formato `Bearer <token>`
- Valide automaticamente a assinatura do token usando o `JWT_SECRET` configurado via variável de ambiente
- Valide automaticamente a expiração do token (rejeitar tokens expirados)
- A partir do payload válido do token, retorne um objeto contendo:
  - `id` — extraído do campo `sub` do payload
  - `email` — extraído do campo `email` do payload
  - `role` — extraído do campo `role` do payload
- Esse objeto retornado ficará automaticamente disponível em `req.user` nas rotas protegidas
- A estratégia deve ser registrada como provider no `AuthModule`

### RF-02: Guard de Autenticação JWT (JwtAuthGuard)

Deve ser criado um guard de autenticação JWT que:

- Herde o comportamento padrão do guard do Passport para a estratégia JWT
- Antes de exigir autenticação, verifique se a rota possui um metadata indicando que é pública
- Se a rota possuir o metadata de rota pública, permita o acesso **sem exigir token** (bypass da autenticação)
- Se a rota **não** possuir o metadata de rota pública, execute a validação normal do token JWT via Passport
- Deve ser registrado como **guard global** (via `APP_GUARD`) para que **todas as rotas da aplicação sejam protegidas automaticamente**, sem necessidade de aplicar o guard individualmente em cada controller ou rota

### RF-03: Decorator de Rota Pública (@Public)

Deve ser criado um decorator customizado que:

- Marque uma rota ou controller como público (acessível sem autenticação)
- Utilize o sistema de metadata do NestJS (`SetMetadata`) para definir um metadata que o `JwtAuthGuard` possa verificar
- A chave do metadata deve ser constante e reutilizável (não hardcoded em múltiplos locais)

### RF-04: Rotas Existentes Marcadas como Públicas

As seguintes rotas existentes devem ser marcadas como públicas utilizando o decorator `@Public()`:

- `POST /auth/register` — registro de novos usuários (não requer autenticação)
- `POST /auth/login` — login de usuários (não requer autenticação)

Após essa marcação, essas rotas devem continuar funcionando normalmente, exatamente como antes, sem exigir token JWT.

### RF-05: Registro dos Providers no AuthModule

O `AuthModule` deve ser atualizado para incluir como providers:

- A estratégia JWT (JwtStrategy)
- O guard global JWT (JwtAuthGuard), registrado via `APP_GUARD` para aplicação automática em todas as rotas

O `PassportModule` deve estar importado no `AuthModule` (caso ainda não esteja).

---

## 4. Fluxo de Requisição

### 4.1 Fluxo para rota protegida (sem @Public)

1. Requisição chega ao servidor
2. O `JwtAuthGuard` (global) intercepta a requisição
3. O guard verifica os metadados da rota — **não possui** `@Public()`
4. O guard delega a validação ao Passport com a estratégia JWT
5. O Passport extrai o token do header `Authorization: Bearer <token>`
6. Se o token estiver **ausente**: retorna `401 Unauthorized`
7. Se o token estiver **expirado**: retorna `401 Unauthorized`
8. Se a **assinatura for inválida**: retorna `401 Unauthorized`
9. Se o token for **válido**: a `JwtStrategy` extrai `id`, `email` e `role` do payload
10. O objeto `{ id, email, role }` é injetado em `req.user`
11. A requisição prossegue para o controller normalmente

### 4.2 Fluxo para rota pública (com @Public)

1. Requisição chega ao servidor
2. O `JwtAuthGuard` (global) intercepta a requisição
3. O guard verifica os metadados da rota — **possui** `@Public()`
4. O guard permite o acesso imediatamente, **sem verificar o token**
5. A requisição prossegue para o controller normalmente
6. `req.user` estará `undefined` (nenhum token foi processado)

---

## 5. Respostas Esperadas

### 5.1 Token Válido — Resposta Normal

Quando o token JWT é válido, a rota protegida deve processar normalmente e retornar a resposta do controller.

### 5.2 Token Ausente — 401 Unauthorized

Quando a requisição para uma rota protegida não contém o header `Authorization`.

```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

### 5.3 Token Expirado — 401 Unauthorized

Quando o token JWT enviado está expirado.

```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

### 5.4 Token com Assinatura Inválida — 401 Unauthorized

Quando o token JWT foi assinado com um secret diferente.

```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

### 5.5 Token Malformado — 401 Unauthorized

Quando o valor do header `Authorization` não é um JWT válido.

```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

---

## 6. Estrutura de Pastas Esperada

Novos arquivos e alterações em relação às specs anteriores:

```
users-service/
└── src/
    └── auth/
        ├── auth.module.ts                # (alterado) registrar JwtStrategy, PassportModule e APP_GUARD
        ├── auth.controller.ts            # (alterado) marcar rotas com @Public()
        ├── strategies/
        │   └── jwt.strategy.ts           # (novo) estratégia JWT do Passport
        ├── guards/
        │   └── jwt-auth.guard.ts         # (novo) guard de autenticação JWT
        └── decorators/
            └── public.decorator.ts       # (novo) decorator @Public()
```

---

## 7. Critérios de Aceite

### CA-01: Rotas públicas continuam acessíveis sem token

- [ ] Enviar `POST /auth/register` com dados válidos e **sem header Authorization** deve retornar `201` normalmente
- [ ] Enviar `POST /auth/login` com dados válidos e **sem header Authorization** deve retornar `200` normalmente
- [ ] Ambas as rotas devem funcionar exatamente como antes da implementação dos guards

### CA-02: Rota protegida rejeita requisição sem token

- [ ] Enviar requisição para qualquer rota **não marcada como @Public** e **sem header Authorization** deve retornar `401 Unauthorized`

### CA-03: Rota protegida rejeita token expirado

- [ ] Enviar requisição para uma rota protegida com um token JWT expirado no header `Authorization: Bearer <token-expirado>` deve retornar `401 Unauthorized`

### CA-04: Rota protegida rejeita token com assinatura inválida

- [ ] Enviar requisição para uma rota protegida com um token JWT assinado com um secret diferente do `JWT_SECRET` configurado deve retornar `401 Unauthorized`

### CA-05: Rota protegida rejeita token malformado

- [ ] Enviar requisição para uma rota protegida com `Authorization: Bearer token-invalido-qualquer` deve retornar `401 Unauthorized`
- [ ] Enviar requisição com `Authorization: InvalidFormat` (sem "Bearer") deve retornar `401 Unauthorized`

### CA-06: Rota protegida aceita token válido

- [ ] Fazer login via `POST /auth/login` e obter o token
- [ ] Enviar requisição para uma rota protegida com `Authorization: Bearer <token-valido>` deve permitir acesso
- [ ] A requisição deve ser processada normalmente pelo controller

### CA-07: req.user contém os dados corretos do usuário autenticado

- [ ] Em uma rota protegida acessada com token válido, `req.user` deve conter um objeto com:
  - `id` — UUID do usuário (extraído do campo `sub` do payload do token)
  - `email` — email do usuário
  - `role` — role do usuário (`seller` ou `buyer`)
- [ ] Os valores de `id`, `email` e `role` devem corresponder aos dados do usuário que gerou o token

### CA-08: Guard é global e protege todas as rotas automaticamente

- [ ] Qualquer nova rota adicionada ao sistema **sem** o decorator `@Public()` deve ser automaticamente protegida pelo guard
- [ ] Não deve ser necessário aplicar nenhum decorator de guard manualmente em rotas que precisam de autenticação
- [ ] Apenas rotas explicitamente marcadas com `@Public()` devem ser acessíveis sem token

### CA-09: Testes automatizados passam

- [ ] Devem existir testes unitários para a `JwtStrategy` cobrindo: extração correta dos campos do payload (sub → id, email, role)
- [ ] Devem existir testes unitários para o `JwtAuthGuard` cobrindo: bypass para rotas públicas e exigência de autenticação para rotas não-públicas
- [ ] `npm run test` deve executar todos os testes sem falhas (incluindo testes das specs anteriores)

### CA-10: Lint passa sem erros

- [ ] Executar `npm run lint` e não deve haver erros de linting nos arquivos criados ou alterados

---

## 8. Fora de Escopo

- Guards de autorização por role (RoleGuard)
- Guards de sessão (SessionGuard)
- Refresh tokens
- Logout / invalidação de tokens
- Novos endpoints (CRUD de usuários, perfil, etc.)
- Swagger / OpenAPI
- Rate limiting
- Integração com outros microserviços
- Seeds ou migrations
- CI/CD

---

## 9. Commits

Faça um commit granular após cada item implementado nesta spec. Sugestão de sequência:

1. **Commit:** Criar decorator @Public() para rotas públicas
2. **Commit:** Criar JwtStrategy para validação de tokens
3. **Commit:** Criar JwtAuthGuard com suporte a rotas públicas
4. **Commit:** Registrar JwtStrategy e JwtAuthGuard global no AuthModule
5. **Commit:** Marcar rotas de register e login como @Public()
6. **Commit:** Adicionar testes unitários dos guards e strategy
