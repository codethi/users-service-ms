# SPEC: Login com JWT

**Serviço:** users-service  
**Porta:** 3000  
**Status:** Pendente  
**Criado em:** 2026-02-17  
**Depende de:** [01-scaffold](./01-scaffold.md), [02-user-registration](./02-user-registration.md)

---

## 1. Objetivo

Implementar o endpoint de login no `users-service`, permitindo que usuários registrados autentiquem-se com email e senha e recebam um token JWT. O token será utilizado futuramente para proteger rotas autenticadas no marketplace.

Este spec NÃO inclui proteção de rotas (guards), refresh tokens, sessions ou qualquer mecanismo além da geração do JWT básico no login.

---

## 2. Contexto

O `users-service` já possui (specs 01 e 02):

- NestJS configurado com `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`)
- TypeORM conectado ao PostgreSQL (`users_db`, porta 5433)
- Entidade `User` com campos: `id`, `email`, `password` (com `@Exclude()`), `firstName`, `lastName`, `role`, `status`, `createdAt`, `updatedAt`
- Enums `UserRole` (`seller`, `buyer`) e `UserStatus` (`active`, `inactive`)
- `UsersService` com métodos `findByEmail(email)` e `create(data)`
- `AuthModule` com `AuthController` e `AuthService` (endpoint `POST /auth/register` funcionando)
- Senha armazenada como hash bcrypt no banco de dados
- Campo `password` excluído das respostas via `@Exclude()` do `class-transformer`
- `bcryptjs` já instalado como dependência

### Dependências adicionais necessárias

- `@nestjs/jwt` — módulo JWT para NestJS
- `@nestjs/passport` — integração Passport com NestJS
- `passport` — framework de autenticação
- `passport-jwt` — estratégia JWT para Passport
- `@types/passport-jwt` — tipos TypeScript para passport-jwt (devDependency)

---

## 3. Requisitos Funcionais

### RF-01: Instalação de Dependências

As seguintes dependências devem ser adicionadas ao projeto:

- **dependencies:** `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`
- **devDependencies:** `@types/passport-jwt`

### RF-02: Variável de Ambiente JWT_SECRET

- Deve ser adicionada a variável `JWT_SECRET` ao arquivo `.env` com um valor para desenvolvimento local
- Deve ser adicionada a variável `JWT_SECRET` ao arquivo `.env.example` (sem valor, apenas o nome)
- O `AuthModule` deve consumir essa variável via `ConfigService` do `@nestjs/config`

### RF-03: Configuração do JwtModule

O `AuthModule` deve registrar o `JwtModule` com as seguintes configurações:

- O `secret` deve ser lido da variável de ambiente `JWT_SECRET` via `ConfigService`
- O tempo de expiração do token deve ser de **24 horas**
- O registro deve ser assíncrono (`registerAsync`) para poder injetar o `ConfigService`

### RF-04: DTO de Login

Deve ser criado um DTO de login em `src/auth/dto/login.dto.ts` com as seguintes validações:

| Campo    | Tipo   | Obrigatório | Regras de Validação            |
|----------|--------|-------------|--------------------------------|
| email    | string | Sim         | Deve ser um email válido       |
| password | string | Sim         | Mínimo de 6 caracteres         |

### RF-05: Endpoint de Login

| Propriedade  | Valor            |
|--------------|------------------|
| Método       | `POST`           |
| Rota         | `/auth/login`    |
| Body         | JSON (DTO login) |
| Autenticação | Nenhuma (público)|

O endpoint deve executar a seguinte lógica, nesta ordem:

1. Receber os dados validados pelo DTO (email e senha)
2. Buscar o usuário pelo email no banco de dados (utilizando o `UsersService.findByEmail`)
3. Se o usuário **não for encontrado**, retornar erro **401 Unauthorized** com a mensagem `Credenciais inválidas`
4. Se o usuário for encontrado, comparar a senha fornecida com o hash armazenado usando bcrypt
5. Se a senha **não corresponder**, retornar erro **401 Unauthorized** com a mensagem `Credenciais inválidas` (mesma mensagem — não revelar se o erro é no email ou na senha)
6. Se a senha corresponder, verificar se o `status` do usuário é `active`
7. Se o status **não for** `active`, retornar erro **401 Unauthorized** com a mensagem `Conta inativa`
8. Se tudo for válido, gerar um token JWT com o payload definido na seção 4.2
9. Retornar o objeto do usuário (sem `password`) junto com o token

### RF-06: Geração do Token JWT

O token JWT deve ser gerado pelo `JwtService` (provido pelo `@nestjs/jwt`) com o payload descrito na seção 4.2. A expiração de 24 horas já estará configurada globalmente no módulo (RF-03).

### RF-07: Busca de Usuário com Senha para Validação

O `UsersService.findByEmail` existente utiliza o método padrão do TypeORM para buscar o usuário. Contudo, o campo `password` na entidade `User` possui o decorator `@Exclude()` do `class-transformer`.

Como o login precisa acessar o campo `password` para comparação com bcrypt, o `UsersService` deve oferecer uma forma de buscar o usuário **incluindo o campo password** para uso interno do `AuthService`. Isso pode ser feito através de um novo método dedicado ou ajustando a query para selecionar explicitamente o campo password.

**Importante:** o campo `password` deve continuar sendo excluído de todas as respostas da API — a seleção explícita é apenas para uso interno no fluxo de autenticação.

---

## 4. Estrutura de Dados

### 4.1 DTO de Login (entrada)

| Campo    | Tipo   | Obrigatório | Regras de Validação            |
|----------|--------|-------------|--------------------------------|
| email    | string | Sim         | Deve ser um email válido       |
| password | string | Sim         | Mínimo de 6 caracteres         |

### 4.2 Payload do Token JWT

| Campo | Tipo   | Descrição                              |
|-------|--------|----------------------------------------|
| sub   | string | ID do usuário (UUID)                   |
| email | string | Email do usuário                       |
| role  | string | Role do usuário (`seller` ou `buyer`)  |

### 4.3 Resposta de Sucesso (saída)

```json
{
  "user": {
    "id": "uuid-do-usuario",
    "email": "user@example.com",
    "firstName": "João",
    "lastName": "Silva",
    "role": "buyer",
    "status": "active",
    "createdAt": "2026-02-17T10:00:00.000Z",
    "updatedAt": "2026-02-17T10:00:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

O campo `password` **NÃO** deve estar presente dentro do objeto `user`.

---

## 5. Respostas Esperadas

### 5.1 Sucesso — 200 OK

Quando o login é realizado com sucesso. Retorna o objeto do usuário (sem password) e o token JWT.

```json
{
  "user": {
    "id": "uuid-do-usuario",
    "email": "user@example.com",
    "firstName": "João",
    "lastName": "Silva",
    "role": "buyer",
    "status": "active",
    "createdAt": "2026-02-17T10:00:00.000Z",
    "updatedAt": "2026-02-17T10:00:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### 5.2 Erro de Validação — 400 Bad Request

Quando os dados de entrada não passam na validação do DTO.

```json
{
  "statusCode": 400,
  "message": [
    "email must be an email",
    "password must be longer than or equal to 6 characters"
  ],
  "error": "Bad Request"
}
```

### 5.3 Credenciais Inválidas — 401 Unauthorized

Quando o email não existe no banco **ou** a senha não corresponde ao hash. A mesma mensagem genérica deve ser usada em ambos os casos (segurança).

```json
{
  "statusCode": 401,
  "message": "Credenciais inválidas",
  "error": "Unauthorized"
}
```

### 5.4 Conta Inativa — 401 Unauthorized

Quando o email e a senha estão corretos, mas o status da conta não é `active`.

```json
{
  "statusCode": 401,
  "message": "Conta inativa",
  "error": "Unauthorized"
}
```

---

## 6. Estrutura de Pastas Esperada

Novos arquivos e alterações em relação às specs anteriores:

```
users-service/
├── .env                               # (alterado) adicionar JWT_SECRET
├── .env.example                       # (alterado) adicionar JWT_SECRET
└── src/
    ├── auth/
    │   ├── auth.module.ts             # (alterado) registrar JwtModule e PassportModule
    │   ├── auth.controller.ts         # (alterado) adicionar endpoint POST /auth/login
    │   ├── auth.service.ts            # (alterado) adicionar método login
    │   └── dto/
    │       ├── register.dto.ts        # (existente, sem alteração)
    │       └── login.dto.ts           # (novo)
    └── users/
        └── users.service.ts           # (alterado) adicionar método para busca com password
```

---

## 7. Critérios de Aceite

### CA-01: Login com credenciais válidas retorna 200

- [ ] Registrar um usuário via `POST /auth/register`
- [ ] Enviar `POST /auth/login` com email e senha corretos
- [ ] A resposta deve ter status `200`
- [ ] A resposta deve conter um objeto `user` com os campos: `id`, `email`, `firstName`, `lastName`, `role`, `status`, `createdAt`, `updatedAt`
- [ ] O campo `password` **NÃO** deve estar presente no objeto `user`
- [ ] A resposta deve conter um campo `token` com uma string JWT válida

### CA-02: Token JWT contém o payload correto

- [ ] O token retornado no login deve ser decodificável
- [ ] O payload deve conter `sub` (UUID do usuário), `email` e `role`
- [ ] O token deve ter expiração de 24 horas (`exp` no payload)

### CA-03: Email inexistente retorna 401 com mensagem genérica

- [ ] Enviar `POST /auth/login` com um email que não existe no banco
- [ ] A resposta deve ter status `401`
- [ ] A mensagem deve ser `Credenciais inválidas`
- [ ] A resposta **NÃO** deve indicar que o email não foi encontrado

### CA-04: Senha incorreta retorna 401 com mesma mensagem genérica

- [ ] Enviar `POST /auth/login` com email válido e senha incorreta
- [ ] A resposta deve ter status `401`
- [ ] A mensagem deve ser `Credenciais inválidas` (idêntica ao CA-03)
- [ ] A resposta **NÃO** deve indicar que a senha está incorreta

### CA-05: Conta inativa retorna 401 com mensagem específica

- [ ] Ter um usuário no banco com `status: inactive`
- [ ] Enviar `POST /auth/login` com email e senha corretos desse usuário
- [ ] A resposta deve ter status `401`
- [ ] A mensagem deve ser `Conta inativa`

### CA-06: Validação de email inválido retorna 400

- [ ] Enviar `POST /auth/login` com `email: "nao-e-email"` deve retornar status `400`
- [ ] A resposta deve conter mensagem de erro indicando que o email é inválido

### CA-07: Validação de senha curta retorna 400

- [ ] Enviar `POST /auth/login` com `password: "123"` (menos de 6 caracteres) deve retornar status `400`
- [ ] A resposta deve conter mensagem de erro sobre o tamanho mínimo da senha

### CA-08: Campos obrigatórios ausentes retorna 400

- [ ] Enviar `POST /auth/login` com body vazio `{}` deve retornar status `400`
- [ ] A resposta deve conter mensagens de erro para `email` e `password`

### CA-09: JWT_SECRET configurado via variável de ambiente

- [ ] O arquivo `.env` deve conter a variável `JWT_SECRET` com um valor de desenvolvimento
- [ ] O arquivo `.env.example` deve conter `JWT_SECRET=` (sem valor)
- [ ] O `AuthModule` deve ler o secret via `ConfigService`, não hardcoded

### CA-10: Dependências instaladas

- [ ] `@nestjs/jwt`, `@nestjs/passport`, `passport` e `passport-jwt` devem constar no `package.json` em `dependencies`
- [ ] `@types/passport-jwt` deve constar em `devDependencies`

### CA-11: Testes automatizados passam

- [ ] Devem existir testes unitários para o `AuthService` cobrindo: login com sucesso, email inexistente (401), senha incorreta (401), conta inativa (401) e geração correta do payload JWT
- [ ] `npm run test` deve executar todos os testes sem falhas (incluindo testes das specs anteriores)

---

## 8. Fora de Escopo

- Proteção de rotas com guards (JWT guard, roles guard)
- Estratégia JWT do Passport (JwtStrategy) — será implementada na spec de proteção de rotas
- Refresh tokens
- Sessions
- Logout / invalidação de tokens
- Rate limiting no endpoint de login
- Swagger / OpenAPI
- Recuperação de senha
- Integração com outros microserviços
- Seeds ou migrations
- CI/CD

---

## 9. Commits

Faça um commit granular após cada item implementado nesta spec. Sugestão de sequência:

1. **Commit:** Instalar dependências JWT e Passport
2. **Commit:** Adicionar JWT_SECRET ao .env e .env.example
3. **Commit:** Criar DTO de login com validações
4. **Commit:** Configurar JwtModule e PassportModule no AuthModule
5. **Commit:** Adicionar método de busca de usuário com password no UsersService
6. **Commit:** Implementar método login no AuthService
7. **Commit:** Adicionar endpoint POST /auth/login no AuthController
8. **Commit:** Adicionar testes unitários do login
