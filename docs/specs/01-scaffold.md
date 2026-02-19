# SPEC: Scaffold do users-service

**Serviço:** users-service  
**Porta:** 3000  
**Status:** Pendente  
**Criado em:** 2026-02-17

---

## 1. Objetivo

Configurar o scaffold do microserviço `users-service` dentro do projeto `marketplace-ms`, incluindo conexão com banco de dados PostgreSQL, definição da entidade `User`, Docker Compose para o banco e configuração base do NestJS seguindo o padrão dos demais serviços (`checkout-service`, `payments-service`).

Este scaffold NÃO inclui endpoints, autenticação ou lógica de negócio — apenas a fundação do serviço.

---

## 2. Contexto do Sistema

| Serviço            | Porta | Banco          | Porta DB |
|--------------------|-------|----------------|----------|
| users-service      | 3000  | users_db       | 5433     |
| checkout-service   | 3003  | checkout_db    | 5434     |
| payments-service   | 3004  | payments_db    | 5435     |
| api-gateway        | 3005  | —              | —        |
| messaging-service  | —     | — (RabbitMQ)   | 5672     |

---

## 3. Requisitos Funcionais

### RF-01: Dependências do Projeto

O projeto (já criado via `nest new`) deve ter as seguintes dependências adicionais instaladas:

- `@nestjs/typeorm` — integração TypeORM com NestJS
- `typeorm` — ORM
- `pg` — driver PostgreSQL
- `@nestjs/config` — gerenciamento de variáveis de ambiente
- `class-validator` — validação de DTOs
- `class-transformer` — transformação de objetos

### RF-02: Docker Compose com PostgreSQL

Deve existir um arquivo `docker-compose.yml` na raiz do `users-service` com:

- Imagem: `postgres:15`
- Nome do container: `marketplace-users-db`
- Porta exposta: `5433:5432`
- Database: `users_db`
- Credenciais padrão: `postgres` / `postgres`
- Volume nomeado para persistência de dados
- Healthcheck configurado
- Política de restart: `unless-stopped`

### RF-03: Configuração de Banco de Dados

Deve existir um arquivo de configuração de banco em `src/config/database.config.ts` que:

- Exporte um objeto compatível com `TypeOrmModuleOptions`
- Use variáveis de ambiente para todas as configurações de conexão
- Tenha valores padrão (fallback) para desenvolvimento local:
  - Host: `localhost`
  - Porta: `5433`
  - Username: `postgres`
  - Password: `postgres`
  - Database: `users_db`
- Carregue entidades automaticamente via glob pattern (`**/*.entity{.ts,.js}`)
- Habilite `synchronize` apenas fora de produção (`NODE_ENV !== 'production'`)
- Habilite `logging` apenas em desenvolvimento (`NODE_ENV === 'development'`)

### RF-04: Módulo Principal (AppModule)

O `AppModule` deve importar:

- `ConfigModule.forRoot()` com `isGlobal: true`
- `TypeOrmModule.forRoot()` usando a configuração de banco
- `UsersModule` (módulo de usuários)

### RF-05: Configuração do main.ts

O arquivo `main.ts` deve:

- Criar a aplicação NestJS
- Habilitar CORS
- Configurar `ValidationPipe` global com:
  - `whitelist: true`
  - `forbidNonWhitelisted: true`
  - `transform: true`
- Escutar na porta definida pela variável `PORT` (fallback: `3000`)
- Exibir mensagem de log ao iniciar (ex: `👤 Users Service running on port ${port}`)

### RF-06: Módulo de Usuários (UsersModule)

Deve existir um módulo `UsersModule` em `src/users/users.module.ts` que:

- Registre a entidade `User` via `TypeOrmModule.forFeature()`
- Exporte o módulo para uso futuro por outros módulos
- NÃO contenha controllers ou services neste momento

### RF-07: Entidade User

Deve existir uma entidade `User` em `src/users/entities/user.entity.ts` com a seguinte estrutura:

| Campo       | Tipo                        | Restrições                          |
|-------------|-----------------------------|-------------------------------------|
| id          | UUID                        | PK, gerado automaticamente          |
| email       | string                      | Único, não nulo                     |
| password    | string                      | Não nulo (armazenará hash)          |
| firstName   | string                      | Não nulo                            |
| lastName    | string                      | Não nulo                            |
| role        | enum (`seller`, `buyer`)    | Não nulo                            |
| status      | enum (`active`, `inactive`) | Não nulo, default: `active`         |
| createdAt   | timestamp                   | Gerado automaticamente na criação   |
| updatedAt   | timestamp                   | Atualizado automaticamente          |

Os enums `role` e `status` devem ser definidos como tipos TypeScript (enum) no mesmo arquivo ou em arquivo separado dentro de `src/users/enums/`.

### RF-08: Variáveis de Ambiente

Deve existir um arquivo `.env.example` na raiz do `users-service` com as seguintes variáveis:

```
PORT=
NODE_ENV=
DB_HOST=
DB_PORT=
DB_USERNAME=
DB_PASSWORD=
DB_DATABASE=
```

Deve existir também um arquivo `.env` (para desenvolvimento local) com valores preenchidos:

```
PORT=3000
NODE_ENV=development
DB_HOST=localhost
DB_PORT=5433
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=users_db
```

---

## 4. Estrutura de Pastas Esperada

```
users-service/
├── docker-compose.yml
├── .env
├── .env.example
├── package.json
├── tsconfig.json
├── nest-cli.json
├── docs/
│   └── specs/
│       └── scaffold.md
└── src/
    ├── main.ts
    ├── app.module.ts
    ├── app.controller.ts
    ├── app.service.ts
    ├── config/
    │   └── database.config.ts
    └── users/
        ├── users.module.ts
        ├── entities/
        │   └── user.entity.ts
        └── enums/
            ├── user-role.enum.ts
            └── user-status.enum.ts
```

---

## 5. Critérios de Aceite

### CA-01: Projeto inicia sem erros
- [ ] Executar `npm run start:dev` e o serviço deve iniciar na porta 3000 sem erros de compilação

### CA-02: Banco de dados sobe via Docker
- [ ] Executar `docker-compose up -d` na raiz do `users-service` e o container `marketplace-users-db` deve estar rodando na porta 5433
- [ ] Deve ser possível conectar ao banco `users_db` via qualquer client PostgreSQL

### CA-03: Conexão com banco funciona
- [ ] Com o banco rodando, o serviço deve conectar automaticamente ao PostgreSQL ao iniciar
- [ ] Não deve haver erros de conexão nos logs

### CA-04: Tabela é criada automaticamente
- [ ] Com `synchronize: true` (dev), a tabela `user` deve ser criada automaticamente no banco ao iniciar o serviço
- [ ] A tabela deve conter todas as colunas definidas na entidade com os tipos corretos

### CA-05: Dependências instaladas
- [ ] `@nestjs/typeorm`, `typeorm`, `pg`, `@nestjs/config`, `class-validator` e `class-transformer` devem constar no `package.json` em `dependencies`

### CA-06: ValidationPipe ativo
- [ ] O `ValidationPipe` global deve estar configurado com `whitelist`, `forbidNonWhitelisted` e `transform`

### CA-07: Padrão consistente com outros serviços
- [ ] A estrutura de `database.config.ts` deve seguir o mesmo padrão do `checkout-service` e `payments-service`
- [ ] O `main.ts` deve seguir o mesmo padrão de bootstrap dos demais serviços
- [ ] O `AppModule` deve seguir o padrão de imports do `checkout-service`

### CA-08: Testes padrão passam
- [ ] `npm run test` deve executar sem falhas (testes gerados pelo CLI do NestJS)

---

## 6. Fora de Escopo

- Endpoints REST (CRUD de usuários)
- Autenticação / JWT
- Hash de senha (bcrypt)
- Integração com outros microserviços
- Swagger/OpenAPI
- Testes unitários customizados
- Seeds ou migrations
- CI/CD


## 7. Commits

Faça sempre um commit após cada implementação dessa spec
