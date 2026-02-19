# SPEC: Endpoints de Consulta de Usuários

**Serviço:** users-service  
**Porta:** 3000  
**Status:** Pendente  
**Criado em:** 2026-02-17  
**Depende de:** [01-scaffold](./01-scaffold.md), [02-user-registration](./02-user-registration.md), [03-jwt-login](./03-jwt-login.md), [04-jwt-guards-route-protection](./04-jwt-guards-route-protection.md)

---

## 1. Objetivo

Implementar os endpoints de consulta de usuários no `users-service`, criando o `UsersController` e adicionando métodos de consulta ao `UsersService` existente. Esses endpoints são essenciais para o funcionamento do marketplace: o perfil do usuário logado, a listagem de vendedores ativos e a consulta de um usuário específico por ID.

Este spec NÃO inclui criação, atualização, exclusão, listagem com paginação, troca de senha ou qualquer operação de escrita — apenas consultas.

---

## 2. Contexto

O `users-service` já possui (specs 01 a 04):

- NestJS configurado com `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`)
- TypeORM conectado ao PostgreSQL (`users_db`, porta 5433)
- Entidade `User` com campos: `id`, `email`, `password` (com `@Exclude()`), `firstName`, `lastName`, `role`, `status`, `createdAt`, `updatedAt`
- Enums `UserRole` (`seller`, `buyer`) e `UserStatus` (`active`, `inactive`)
- `UsersModule` com `UsersService` registrado como provider e exportado — **sem controller**
- `UsersService` com métodos existentes: `findByEmail(email)`, `findByEmailWithPassword(email)` e `create(data)`
- `AuthModule` com `AuthController` e `AuthService` (register e login)
- Proteção global de rotas com `JwtAuthGuard` via `APP_GUARD` — todas as rotas exigem token JWT por padrão
- Decorator `@Public()` para marcar rotas que não requerem autenticação
- O usuário autenticado está disponível em `req.user` com `{ id, email, role }` (extraído do token JWT)
- O campo `password` da entidade `User` já possui o decorator `@Exclude()` do `class-transformer`

### Dependências adicionais necessárias

Nenhuma — todas as dependências necessárias já estão instaladas no projeto.

---

## 3. Requisitos Funcionais

### RF-01: Endpoint de Perfil do Usuário Logado — `GET /users/profile`

Deve existir um endpoint que retorne os dados completos do usuário atualmente autenticado:

- Acessível via `GET /users/profile`
- Utiliza o `id` disponível em `req.user.id` (extraído do token JWT) para buscar os dados **atualizados** do usuário no banco de dados
- Retorna todos os campos do usuário, **exceto `password`**
- Protegido pelo `JwtAuthGuard` global (comportamento padrão — não precisa de decorator adicional)

**Motivação:** O token JWT contém apenas `id`, `email` e `role`. Este endpoint permite que o frontend obtenha os dados completos e atualizados do usuário (como `firstName`, `lastName`, `status`, `createdAt`, etc.).

### RF-02: Endpoint de Listagem de Vendedores Ativos — `GET /users/sellers`

Deve existir um endpoint que retorne a lista de todos os vendedores ativos do marketplace:

- Acessível via `GET /users/sellers`
- Retorna apenas usuários que possuam **simultaneamente**: `role` igual a `seller` **E** `status` igual a `active`
- Retorna um array de objetos de usuário, **sem o campo `password`** em nenhum deles
- Se não houver vendedores ativos, retorna um array vazio `[]`
- Protegido pelo `JwtAuthGuard` global (comportamento padrão)
- Não possui paginação, ordenação ou filtros adicionais

**Motivação:** O frontend precisa listar os vendedores do marketplace, e o `products-service` pode precisar validar se um vendedor está ativo.

### RF-03: Endpoint de Consulta de Usuário por ID — `GET /users/:id`

Deve existir um endpoint que retorne os dados de um usuário específico pelo seu ID:

- Acessível via `GET /users/:id`, onde `:id` é um UUID
- Busca o usuário pelo ID fornecido no parâmetro da rota
- Se encontrado, retorna os dados do usuário **sem o campo `password`**
- Se **não** encontrado, retorna erro `404 Not Found`
- O parâmetro `:id` deve ser validado como UUID — se o formato for inválido, retornar `400 Bad Request`
- Protegido pelo `JwtAuthGuard` global (comportamento padrão)

**Motivação:** Permite que qualquer usuário autenticado consulte os dados públicos de outro usuário (ex: comprador visualizando perfil do vendedor).

### RF-04: Ordem de Declaração das Rotas no Controller

A ordem de declaração das rotas no controller **importa** e deve ser:

1. `GET /users/profile` — rota estática
2. `GET /users/sellers` — rota estática
3. `GET /users/:id` — rota dinâmica

As rotas estáticas (`profile`, `sellers`) devem ser declaradas **antes** da rota dinâmica (`:id`), caso contrário o NestJS tentará interpretar `"profile"` e `"sellers"` como valores do parâmetro `:id`, resultando em comportamento incorreto.

### RF-05: Métodos de Consulta no UsersService

O `UsersService` deve ser estendido com novos métodos de consulta:

- Um método para buscar um usuário pelo `id` (UUID) — retorna o usuário ou `null`
- Um método para buscar todos os vendedores ativos (role `seller` + status `active`) — retorna um array de usuários

Esses métodos devem ser utilizados pelo `UsersController` para atender os endpoints.

### RF-06: Registro do Controller no UsersModule

O `UsersController` deve ser registrado no `UsersModule` para que o NestJS reconheça e habilite os endpoints.

---

## 4. Exclusão do Campo Password

O campo `password` da entidade `User` já possui o decorator `@Exclude()` do `class-transformer`. Para que essa exclusão funcione nas respostas HTTP, o `ClassSerializerInterceptor` do NestJS deve estar aplicado nos endpoints (seja globalmente ou no controller).

O campo `password` **nunca** deve aparecer em nenhuma resposta dos 3 endpoints desta spec.

---

## 5. Respostas Esperadas

### 5.1 `GET /users/profile` — 200 OK

Retorna os dados completos do usuário logado (sem `password`):

```json
{
  "id": "uuid-do-usuario",
  "email": "usuario@email.com",
  "firstName": "Nome",
  "lastName": "Sobrenome",
  "role": "buyer",
  "status": "active",
  "createdAt": "2026-02-17T00:00:00.000Z",
  "updatedAt": "2026-02-17T00:00:00.000Z"
}
```

### 5.2 `GET /users/sellers` — 200 OK

Retorna um array de vendedores ativos (sem `password` em nenhum):

```json
[
  {
    "id": "uuid-do-vendedor-1",
    "email": "vendedor1@email.com",
    "firstName": "Vendedor",
    "lastName": "Um",
    "role": "seller",
    "status": "active",
    "createdAt": "2026-02-17T00:00:00.000Z",
    "updatedAt": "2026-02-17T00:00:00.000Z"
  },
  {
    "id": "uuid-do-vendedor-2",
    "email": "vendedor2@email.com",
    "firstName": "Vendedor",
    "lastName": "Dois",
    "role": "seller",
    "status": "active",
    "createdAt": "2026-02-17T00:00:00.000Z",
    "updatedAt": "2026-02-17T00:00:00.000Z"
  }
]
```

Quando não há vendedores ativos:

```json
[]
```

### 5.3 `GET /users/:id` — 200 OK

Retorna os dados de um usuário específico (sem `password`):

```json
{
  "id": "uuid-do-usuario",
  "email": "usuario@email.com",
  "firstName": "Nome",
  "lastName": "Sobrenome",
  "role": "seller",
  "status": "active",
  "createdAt": "2026-02-17T00:00:00.000Z",
  "updatedAt": "2026-02-17T00:00:00.000Z"
}
```

### 5.4 `GET /users/:id` — 404 Not Found

Quando o ID informado não corresponde a nenhum usuário no banco:

```json
{
  "statusCode": 404,
  "message": "User not found"
}
```

### 5.5 `GET /users/:id` — 400 Bad Request

Quando o parâmetro `:id` não é um UUID válido:

```json
{
  "statusCode": 400,
  "message": "Validation failed (uuid is expected)",
  "error": "Bad Request"
}
```

### 5.6 Qualquer Endpoint — 401 Unauthorized

Quando o token JWT está ausente, expirado, malformado ou com assinatura inválida (tratado automaticamente pelo `JwtAuthGuard` global):

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
    └── users/
        ├── users.module.ts              # (alterado) registrar UsersController
        ├── users.service.ts             # (alterado) adicionar métodos findById e findActiveSellers
        ├── users.controller.ts          # (novo) endpoints GET profile, sellers e :id
        └── users.controller.spec.ts     # (novo) testes unitários do controller
```

---

## 7. Critérios de Aceite

### CA-01: GET /users/profile retorna os dados do usuário logado

- [ ] Enviar `GET /users/profile` com token JWT válido deve retornar `200` com os dados completos do usuário correspondente ao token
- [ ] Os dados retornados devem ser buscados do banco (dados atualizados), não apenas os dados do token
- [ ] O campo `password` **não** deve estar presente na resposta
- [ ] Todos os outros campos da entidade (`id`, `email`, `firstName`, `lastName`, `role`, `status`, `createdAt`, `updatedAt`) devem estar presentes

### CA-02: GET /users/profile requer autenticação

- [ ] Enviar `GET /users/profile` **sem** header `Authorization` deve retornar `401 Unauthorized`
- [ ] Enviar `GET /users/profile` com token inválido deve retornar `401 Unauthorized`

### CA-03: GET /users/sellers retorna apenas vendedores ativos

- [ ] Enviar `GET /users/sellers` com token válido deve retornar `200` com um array
- [ ] O array deve conter **apenas** usuários com `role: "seller"` **E** `status: "active"`
- [ ] Usuários com `role: "buyer"` **não** devem aparecer na lista
- [ ] Usuários com `role: "seller"` mas `status: "inactive"` **não** devem aparecer na lista
- [ ] O campo `password` **não** deve estar presente em nenhum item do array
- [ ] Se não houver vendedores ativos, deve retornar um array vazio `[]`

### CA-04: GET /users/sellers requer autenticação

- [ ] Enviar `GET /users/sellers` **sem** header `Authorization` deve retornar `401 Unauthorized`

### CA-05: GET /users/:id retorna um usuário específico

- [ ] Enviar `GET /users/<uuid-existente>` com token válido deve retornar `200` com os dados do usuário
- [ ] O campo `password` **não** deve estar presente na resposta
- [ ] Todos os outros campos da entidade devem estar presentes

### CA-06: GET /users/:id retorna 404 para usuário inexistente

- [ ] Enviar `GET /users/<uuid-inexistente>` com token válido deve retornar `404` com mensagem `"User not found"`

### CA-07: GET /users/:id valida o formato do parâmetro

- [ ] Enviar `GET /users/nao-e-uuid` com token válido deve retornar `400 Bad Request`
- [ ] Enviar `GET /users/123` com token válido deve retornar `400 Bad Request`

### CA-08: GET /users/:id requer autenticação

- [ ] Enviar `GET /users/<uuid>` **sem** header `Authorization` deve retornar `401 Unauthorized`

### CA-09: Rotas estáticas têm prioridade sobre rota dinâmica

- [ ] `GET /users/profile` deve ser tratado como rota estática e retornar o perfil — **não** deve tentar buscar um usuário com id `"profile"`
- [ ] `GET /users/sellers` deve ser tratado como rota estática e retornar a lista — **não** deve tentar buscar um usuário com id `"sellers"`

### CA-10: Testes automatizados passam

- [ ] Devem existir testes unitários para o `UsersController` cobrindo os 3 endpoints e seus cenários (sucesso, 404, validação)
- [ ] Devem existir testes unitários para os novos métodos do `UsersService`
- [ ] `npm run test` deve executar todos os testes sem falhas (incluindo testes das specs anteriores)

### CA-11: Lint passa sem erros

- [ ] Executar `npm run lint` não deve apresentar erros de linting nos arquivos criados ou alterados

---

## 8. Fora de Escopo

- Criação de usuários (já existe em `POST /auth/register`)
- Atualização de dados do usuário (update/patch)
- Exclusão de usuários (delete)
- Troca de senha (change password)
- Listagem com paginação, ordenação ou filtros
- Guards de autorização por role (RoleGuard)
- Swagger / OpenAPI
- Rate limiting
- Upload de avatar ou imagem de perfil
- Cache de consultas
- Integração síncrona com outros microserviços
- Seeds ou migrations
- CI/CD

---

## 9. Commits

Faça um commit granular após cada item implementado nesta spec. Sugestão de sequência:

1. **Commit:** Adicionar métodos findById e findActiveSellers no UsersService
2. **Commit:** Criar UsersController com endpoints de consulta
3. **Commit:** Registrar UsersController no UsersModule
4. **Commit:** Adicionar testes unitários do UsersController e UsersService
