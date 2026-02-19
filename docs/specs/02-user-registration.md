# SPEC: Registro de Usuário

**Serviço:** users-service  
**Porta:** 3000  
**Status:** Pendente  
**Criado em:** 2026-02-17  
**Depende de:** [01-scaffold](./01-scaffold.md)

---

## 1. Objetivo

Implementar o endpoint de registro de novos usuários no `users-service`, permitindo que compradores (`buyer`) e vendedores (`seller`) criem suas contas no marketplace. O registro deve validar os dados de entrada, garantir unicidade de email, armazenar a senha de forma segura (hash) e nunca expor a senha nas respostas da API.

Este spec NÃO inclui login, JWT, autenticação de rotas ou qualquer outro endpoint — apenas o registro de novos usuários.

---

## 2. Contexto

O `users-service` já possui o scaffold completo (spec 01):
- NestJS configurado com `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`)
- TypeORM conectado ao PostgreSQL (`users_db`, porta 5433)
- Entidade `User` com campos: `id`, `email`, `password`, `firstName`, `lastName`, `role`, `status`, `createdAt`, `updatedAt`
- Enums `UserRole` (`seller`, `buyer`) e `UserStatus` (`active`, `inactive`)
- Módulo `UsersModule` configurado com a entidade `User` registrada via `TypeOrmModule.forFeature()`

### Dependência adicional necessária

- `bcryptjs` — para hash de senhas (preferido sobre `bcrypt` por não exigir compilação nativa)

---

## 3. Requisitos Funcionais

### RF-01: Módulo de Autenticação (AuthModule)

Deve ser criado um módulo `AuthModule` em `src/auth/` contendo:

- Um **controller** responsável por expor os endpoints de autenticação (nesta spec, apenas o registro)
- Um **service** contendo a lógica de negócio do registro
- Importação do `UsersModule` para acesso ao repositório da entidade `User`

O `AuthModule` deve ser importado no `AppModule`.

### RF-02: Serviço de Usuários (UsersService)

O `UsersModule` deve passar a conter um **service** (`UsersService`) que encapsule o acesso ao repositório da entidade `User`. Esse service deve ser exportado pelo `UsersModule` para que outros módulos (como o `AuthModule`) possam utilizá-lo.

O `UsersService` deve oferecer operações de consulta e persistência de usuários que o `AuthService` consumirá, como:

- Buscar um usuário pelo email
- Criar e salvar um novo usuário no banco de dados

### RF-03: Endpoint de Registro

| Propriedade | Valor                |
|-------------|----------------------|
| Método      | `POST`               |
| Rota        | `/auth/register`     |
| Body        | JSON (DTO de criação)|
| Autenticação| Nenhuma (público)    |

O endpoint deve:

1. Receber os dados do usuário no corpo da requisição (validados pelo DTO)
2. Verificar se já existe um usuário cadastrado com o mesmo email
3. Se o email já existir, retornar erro **409 Conflict**
4. Gerar o hash da senha usando bcrypt com **10 salt rounds**
5. Definir o `status` automaticamente como `active` (o cliente NÃO envia esse campo)
6. Persistir o usuário no banco de dados
7. Retornar os dados do usuário criado **sem o campo `password`**

### RF-04: Validação dos Dados de Entrada

Os dados de entrada devem ser validados antes de qualquer lógica de negócio. A validação deve usar `class-validator` via DTO, aproveitando o `ValidationPipe` global já configurado.

As mensagens de erro de validação devem ser claras e descritivas em inglês (padrão NestJS).

### RF-05: Segurança da Senha

- A senha **NUNCA** deve ser armazenada em texto plano no banco de dados
- A senha deve ser transformada em hash usando bcrypt com **10 salt rounds** antes da persistência
- A senha **NUNCA** deve ser retornada em nenhuma resposta da API (nem no registro, nem em qualquer operação futura)

### RF-06: Exclusão da Senha na Resposta

A resposta do endpoint de registro deve conter todos os campos do usuário **exceto** `password`. A exclusão do campo `password` deve ser garantida de forma estrutural (não depender de `delete` manual em cada endpoint), para que futuras operações que retornem dados do usuário também estejam protegidas.

---

## 4. Estrutura de Dados

### 4.1 DTO de Criação (entrada)

| Campo     | Tipo   | Obrigatório | Regras de Validação                                      |
|-----------|--------|-------------|----------------------------------------------------------|
| email     | string | Sim         | Deve ser um email válido                                 |
| password  | string | Sim         | Mínimo de 6 caracteres                                   |
| firstName | string | Sim         | Não pode ser vazio, máximo de 100 caracteres              |
| lastName  | string | Sim         | Não pode ser vazio, máximo de 100 caracteres              |
| role      | string | Sim         | Deve ser um dos valores: `seller` ou `buyer`             |

Campos que **NÃO** devem ser aceitos na entrada (rejeitados pelo `ValidationPipe` com `forbidNonWhitelisted`):
- `id`, `status`, `createdAt`, `updatedAt`, `password_confirmation` ou qualquer campo não listado acima

### 4.2 Resposta de Sucesso (saída)

| Campo     | Tipo      | Descrição                              |
|-----------|-----------|----------------------------------------|
| id        | string    | UUID gerado automaticamente            |
| email     | string    | Email do usuário                       |
| firstName | string    | Primeiro nome                          |
| lastName  | string    | Sobrenome                              |
| role      | string    | `seller` ou `buyer`                    |
| status    | string    | Sempre `active` no registro            |
| createdAt | timestamp | Data de criação                        |
| updatedAt | timestamp | Data de atualização                    |

O campo `password` **NÃO** deve estar presente na resposta.

---

## 5. Respostas Esperadas

### 5.1 Sucesso — 201 Created

Quando o registro é realizado com sucesso.

```json
{
  "id": "uuid-gerado",
  "email": "user@example.com",
  "firstName": "João",
  "lastName": "Silva",
  "role": "buyer",
  "status": "active",
  "createdAt": "2026-02-17T10:00:00.000Z",
  "updatedAt": "2026-02-17T10:00:00.000Z"
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

### 5.3 Email Duplicado — 409 Conflict

Quando já existe um usuário cadastrado com o email informado.

```json
{
  "statusCode": 409,
  "message": "Email already registered",
  "error": "Conflict"
}
```

---

## 6. Estrutura de Pastas Esperada

Novos arquivos e alterações em relação ao scaffold (spec 01):

```
users-service/
└── src/
    ├── app.module.ts              # (alterado) importar AuthModule
    ├── auth/
    │   ├── auth.module.ts         # (novo)
    │   ├── auth.controller.ts     # (novo)
    │   ├── auth.service.ts        # (novo)
    │   └── dto/
    │       └── register.dto.ts    # (novo)
    └── users/
        ├── users.module.ts        # (alterado) adicionar e exportar UsersService
        └── users.service.ts       # (novo)
```

---

## 7. Critérios de Aceite

### CA-01: Registro com dados válidos retorna 201
- [ ] Enviar `POST /auth/register` com todos os campos válidos deve retornar status `201`
- [ ] A resposta deve conter os campos: `id`, `email`, `firstName`, `lastName`, `role`, `status`, `createdAt`, `updatedAt`
- [ ] O campo `password` **NÃO** deve estar presente na resposta
- [ ] O campo `status` deve ser `active`
- [ ] O campo `id` deve ser um UUID válido

### CA-02: Senha é armazenada como hash
- [ ] Após o registro, consultar o banco de dados diretamente e verificar que o campo `password` contém um hash bcrypt (iniciando com `$2a$` ou `$2b$`), e **não** o texto plano enviado
- [ ] O hash deve ter sido gerado com 10 salt rounds

### CA-03: Email duplicado retorna 409
- [ ] Registrar um usuário com email `test@example.com`
- [ ] Tentar registrar outro usuário com o mesmo email `test@example.com`
- [ ] A segunda requisição deve retornar status `409` com a mensagem `Email already registered`
- [ ] Nenhum segundo registro deve ser criado no banco

### CA-04: Validação de email inválido retorna 400
- [ ] Enviar `POST /auth/register` com `email: "nao-e-email"` deve retornar status `400`
- [ ] A resposta deve conter mensagem de erro indicando que o email é inválido

### CA-05: Validação de senha curta retorna 400
- [ ] Enviar `POST /auth/register` com `password: "123"` (menos de 6 caracteres) deve retornar status `400`
- [ ] A resposta deve conter mensagem de erro sobre o tamanho mínimo da senha

### CA-06: Validação de campos obrigatórios retorna 400
- [ ] Enviar `POST /auth/register` com body vazio `{}` deve retornar status `400`
- [ ] A resposta deve conter mensagens de erro para todos os campos obrigatórios ausentes (`email`, `password`, `firstName`, `lastName`, `role`)

### CA-07: Validação de role inválida retorna 400
- [ ] Enviar `POST /auth/register` com `role: "admin"` deve retornar status `400`
- [ ] Apenas os valores `seller` e `buyer` devem ser aceitos

### CA-08: Campos não permitidos são rejeitados
- [ ] Enviar `POST /auth/register` com campo extra (ex: `status: "inactive"` ou `isAdmin: true`) deve retornar status `400`
- [ ] O `ValidationPipe` com `forbidNonWhitelisted` deve rejeitar campos não declarados no DTO

### CA-09: Validação de comprimento máximo
- [ ] Enviar `POST /auth/register` com `firstName` contendo mais de 100 caracteres deve retornar status `400`
- [ ] Enviar `POST /auth/register` com `lastName` contendo mais de 100 caracteres deve retornar status `400`

### CA-10: Testes automatizados passam
- [ ] Devem existir testes unitários para o `AuthService` cobrindo: registro com sucesso, email duplicado e hash da senha
- [ ] Devem existir testes unitários para o `AuthController` cobrindo: chamada correta do service
- [ ] `npm run test` deve executar todos os testes sem falhas

---

## 8. Fora de Escopo

- Login / autenticação (JWT, sessions, etc.)
- Endpoint de listagem, atualização ou exclusão de usuários
- Recuperação de senha
- Confirmação de email
- Rate limiting
- Swagger / OpenAPI
- Integração com outros microserviços
- Seeds ou migrations
- CI/CD

---

## 9. Commits

Faça sempre um commit após cada implementação dessa spec.
