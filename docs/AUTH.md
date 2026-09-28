# Autenticação COREsys (Supabase Auth)

A autenticação do COREsys usa **somente** o Supabase Auth. O frontend não gera JWT, não compara senha e não guarda tokens manualmente.

## Variáveis de ambiente (públicas)

No frontend, apenas:

```
VITE_SUPABASE_URL=https://SEU_PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=chave_anon_publica
```

Nunca coloque `service_role`, JWT secret, tokens de pagamento ou outras chaves privadas no frontend.

Exemplos versionados: `env/.env.development.example`.

## Fluxo

1. O usuário acessa `/login`.
2. O cliente chama `supabase.auth.signInWithPassword()`.
3. O Supabase emite e persiste a sessão (JWT) no storage do navegador.
4. A aplicação carrega `profiles` e `user_store_access` do usuário autenticado.
5. O acesso é **fail-closed**:
   - sem sessão → login
   - sem perfil, perfil inativo, papel inválido ou sem loja ativa → acesso negado
6. Rotas da aplicação permanecem protegidas até existir sessão + perfil + vínculo de loja.
7. Logout usa `supabase.auth.signOut()` e redireciona para `/login`.

Rotas de autenticação:

- `/login`
- `/forgot-password`
- `/reset-password`

Módulos autenticados continuam no hash (`/#/dashboard`, `/#/pdv`, ...).

## Recuperação de senha

1. Em `/forgot-password` o sistema chama `resetPasswordForEmail` com `redirectTo = {origem}/reset-password`.
2. No painel do Supabase Auth, cadastre a URL do frontend em **Redirect URLs**.
3. A mensagem da tela é genérica e não revela se o e-mail existe.
4. O usuário define a nova senha com `supabase.auth.updateUser({ password })`.

## Como testar localmente

1. Copie `env/.env.development.example` para `.env.local`.
2. Preencha URL e anon key do projeto.
3. `npm install` e `npm run dev`.
4. Abra `/login`.
5. Teste:
   - campos vazios
   - senha inválida
   - login válido
   - refresh da página autenticado
   - acesso direto a `/#/dashboard` sem sessão
   - logout
   - recuperação de senha (exige Redirect URL configurada no Auth)

O JWT é enviado automaticamente nas chamadas do cliente Supabase (RPCs e `create-mp-pix` com `verify_jwt = true`).
