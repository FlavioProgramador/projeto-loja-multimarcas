# Auditoria Técnica Completa — Vestra ERP/PDV
**Repositório analisado:** `FlavioProgramador/projeto-loja-multimarcas` (branch `main`, código-fonte real inspecionado via `git clone`, não apenas README)

Metodologia: clonagem do repositório, leitura integral do schema SQL (`supabase/setup.sql`, 910 linhas), das duas Edge Functions, de todos os `services/*.ts`, dos `contexts/*.tsx`, do `App.tsx` e de uma amostra representativa dos componentes de UI (auth, PDV, inventário, financeiro). Todas as afirmações abaixo são baseadas em código real, com arquivo/linha citados. Onde não encontrei implementação, digo explicitamente "não implementado" em vez de presumir.

---

## 0. O que o projeto realmente é

Antes de tudo, uma correção de expectativa importante: **este não é um sistema com backend próprio**. É uma SPA em **React 19 + TypeScript + Vite 6**, que fala **diretamente com o Supabase** (Postgres + Auth + Storage + 2 Edge Functions Deno) usando a `anon key` no navegador. Não existe API REST/GraphQL própria, não existe Express rodando (apesar de `express` estar no `package.json`, ele não é importado em nenhum lugar de `src/` — dependência morta, sobra de um scaffold do Google AI Studio, junto com `@google/genai`, também não utilizado em nenhum arquivo).

- **Frontend:** React 19, Vite 6, TypeScript 5.8, CSS puro (sem Tailwind aplicado apesar de estar instalado), `lucide-react`, `chart.js`, `motion`.
- **"Backend":** Supabase (Postgres 15+, Auth, RLS, Storage, Edge Functions em Deno).
- **Lógica crítica de negócio:** vive dentro de **3 funções PL/pgSQL** (`complete_sale`, `cancel_mp_pix_sale`, `increment_variant_stock`) — o que é, em si, uma escolha de arquitetura correta para consistência transacional (ver seção 2).
- **Pagamento:** integração parcial com Mercado Pago (PIX) via 2 Edge Functions.
- **Multi-loja/franquia:** **não existe absolutamente nenhum vestígio** no schema, no código ou nos tipos — nem `store_id`, nem `organization_id`, nem nada equivalente.
- **Módulo fiscal (NF-e/NFC-e):** **inexistente**, nem como stub.

---

## 1. RESUMO EXECUTIVO

O Vestra é um MVP de PDV/estoque **funcional para uma única loja, em ambiente de baixo volume e com um único nível de confiança entre usuários**. Ele tem partes genuinamente bem feitas — principalmente a função `complete_sale`, que implementa lock pessimista (`FOR UPDATE`) e é uma transação atômica de verdade, algo que muitos projetos desse porte não têm. Só que essa qualidade convive, no mesmo repositório, com **duas vulnerabilidades de escalonamento de privilégio críticas** que tornam o sistema, hoje, inseguro para produção com dados reais: (1) qualquer pessoa que se cadastre pela tela de login vira **ADMIN** por padrão, e (2) qualquer usuário autenticado, de qualquer papel, pode **promover a si mesmo a ADMIN** via uma chamada direta ao Supabase, porque a policy de RLS de `profiles` não tem `WITH CHECK` restringindo a coluna `role`.

Não há multi-loja, não há caixa (abertura/fechamento/sangria/suprimento), não há troca/devolução, não há cancelamento de venda para pagamentos não-PIX, não há testes, não há CI/CD, não há observabilidade, e a integração de pagamento PIX está **quebrada** porque as Edge Functions chamam duas funções RPC (`create_mp_pix_sale`, `approve_mp_pix_sale`) que **não existem** no `setup.sql` fornecido.

### Notas (0–10)

| Área | Nota | Justificativa resumida |
|---|---|---|
| Frontend | 5 | UI cuidada e consistente, mas zero RBAC visual, sem paginação, sem estados de erro robustos |
| Backend (RPC/Edge Functions) | 4 | `complete_sale` é bem desenhada; mas 2 das 4 funções chamadas pelas Edge Functions não existem |
| Banco de dados | 5 | Modelagem de variantes/SKU correta; mas `ON DELETE CASCADE` destrói trilha de auditoria |
| Segurança | **2** | 2 vetores de escalonamento de privilégio a ADMIN; RLS excessivamente permissiva |
| PDV | 5 | Fluxo de venda único funciona e é atômico; falta caixa, troca, cancelamento, split de pagamento |
| Estoque | 4 | Modelo de variante correto e RPC atômica; mas edição de produto apaga histórico de movimentação |
| Arquitetura | 4 | Coerente para 1 loja; não suporta multi-loja sem reescrita de schema e de RLS |
| LGPD | 2 | CPF/PII em `localStorage` sem expiração, sem política de retenção/exclusão, sem consentimento |
| Auditoria | 3 | `inventory_movements` existe mas é destruída em cascata; não há audit log genérico |
| Prontidão para produção | 2 | Sem testes, sem CI/CD, sem monitoramento, com vulnerabilidades críticas abertas |
| **Nota geral** | **3,5 / 10** | MVP de loja única razoável tecnicamente, mas inseguro e não pronto para uso comercial real |

---

## 2. O QUE JÁ ESTÁ BOM

Pontos positivos reais, encontrados no código (não no README):

1. **`complete_sale` é uma transação atômica de verdade** (`supabase/setup.sql`, linhas ~338-475). Ela usa `SELECT ... FOR UPDATE` para travar a linha da variante antes de validar estoque, evita condição de corrida em vendas concorrentes, insere `sales`, `sale_items`, `payments`, `financial_transactions` e `inventory_movements` na mesma transação SQL, e reverte tudo automaticamente se qualquer `RAISE EXCEPTION` disparar (comportamento nativo do Postgres). Isso é bem acima da média para um projeto desse tamanho.
2. **`increment_variant_stock`** também é atômica (`stock_quantity = stock_quantity + p_amount` direto no `UPDATE`, sem race condition de leitura-depois-escrita no cliente).
3. **Modelagem de produto com variantes (SKU) está correta** para o caso de uso de roupas: `products` (dados comuns) → `product_variants` (tamanho/cor/estoque/SKU/código de barras individuais), exatamente como pedido no enunciado (Camiseta Nike Preta/P, Preta/M etc. como registros independentes com estoque próprio).
4. **RLS (Row Level Security) está habilitada em todas as tabelas de negócio** — não é um projeto que deixou tudo aberto por padrão; existe uma tentativa real de controle de acesso (mesmo que, como veremos, mal calibrada).
5. **Não encontrei segredos hard-coded no repositório.** `src/lib/supabase/client.ts` lê variáveis de ambiente corretamente, usa `anon key` (a chave certa para uso no navegador) e tem um mecanismo de "modo não configurado" com placeholders que evita crash. O `.gitignore` exclui `.env*` corretamente.
6. **Não encontrei `dangerouslySetInnerHTML`, `eval()` ou `new Function()`** em `src/` — ou seja, não há vetor óbvio de XSS via renderização de HTML não sanitizado nem execução dinâmica de código.
7. **Índices relevantes existem** (`idx_products_brand`, `idx_variants_sku`, `idx_sales_created_at`, `idx_inventory_mov_variant` etc.), o que mostra alguma preocupação com performance de consulta desde o início.
8. **Webhook do Mercado Pago não confia cegamente no payload recebido** (`supabase/functions/mp-webhook/index.ts`, linha ~33): ele usa o `id` do pagamento apenas para *buscar* o status real direto na API do Mercado Pago antes de aprovar a venda — um padrão de segurança correto contra payloads forjados.
9. **Constraints de integridade no banco são reais**, não só decorativas: `CHECK (stock_quantity >= 0)`, `CHECK (sale_price >= 0)`, `CHECK (quantity > 0)` em `sale_items`, `UNIQUE` em `sku`, `barcode`, `cpf`, `document`. Isso é uma defesa de última linha contra dados corrompidos, mesmo que a aplicação tenha bugs.
10. `cancel_mp_pix_sale` é **idempotente por design** — chamar duas vezes numa venda já cancelada retorna sucesso sem duplicar o estorno de estoque (linhas ~589-593).

---

## 3. O QUE ESTÁ INCOMPLETO (🟡)

Funcionalidades que existem parcialmente — código presente, mas incompleto ou não conectado ponta a ponta:

| Funcionalidade | Onde está o pedaço que existe | O que falta |
|---|---|---|
| Pagamento PIX (Mercado Pago) | `create-mp-pix/index.ts`, `mp-webhook/index.ts` | Chamam `create_mp_pix_sale` e `approve_mp_pix_sale`, RPCs **inexistentes** no schema — fluxo quebra em produção |
| Cupons de desconto | Tabela `coupons` completa, com `max_uses`/`uses_count` | `complete_sale` não recebe `coupon_code`, não valida nem incrementa `uses_count` (o comentário no próprio SQL diz *"cupons descontinuados"*, linha ~365) |
| Código de barras | Coluna `barcode` existe, `UNIQUE`, é lida em `products.service.ts` (linha 22) | Nenhum formulário de produto (`NewProductModal.tsx`, `EditProductModal.tsx`) tem campo para cadastrá-lo; nenhum componente lê um leitor de código de barras |
| Devolução/Troca | Enum `inventory_movements.type` inclui `'RETURN'` | Nenhum service, RPC ou componente jamais insere uma movimentação `RETURN`; não há tela de troca/devolução |
| Pagamento parcelado/dividido | Tabela `payments` suporta múltiplas linhas por venda e `installments` | `complete_sale` insere **um único** registro em `payments` por venda — pagamento dividido (ex: metade PIX, metade cartão) não é suportado ponta a ponta |
| Papéis/Permissões (RBAC) | 4 papéis definidos no banco (`ADMIN/MANAGER/CASHIER/EMPLOYEE`) e usados nas policies de RLS | No frontend, o papel só é exibido como texto no Sidebar (`Sidebar.tsx`, linha 59); nenhuma tela, menu ou botão é ocultado/bloqueado por papel |
| "Automações" | `AutomationsView.tsx` calcula alertas de estoque baixo e contas a vencer client-side | Não há jobs agendados, notificações por e-mail/WhatsApp/push, nem nada que rode sem o usuário estar com a tela aberta — é um painel de regras, não uma automação de verdade |
| Modo offline/local | `StoreContext.tsx` tem fallback completo com `localStorage` quando Supabase não está configurado | Esse modo é isolado por navegador, sem sincronização — serve para demo, não para operação real |

---

## 4. BUGS ENCONTRADOS (reais, no código)

### 🔴 BUG-01 — Seed SQL quebra a própria instalação (CRÍTICO / bloqueia deploy)
- **Arquivo:** `supabase/setup.sql`, seção 14 (final do arquivo)
- **Problema:** o script cria `financial_transactions.type` com `CHECK (type IN ('INCOME', 'EXPENSE'))`, mas o próprio bloco de seed insere linhas com `type = 'entrada'` e `type = 'saida'`:
  ```sql
  INSERT INTO public.financial_transactions (type, category, description, amount, status, created_at)
  VALUES
    ('entrada', 'Vendas PDV', 'Venda PDV #1001', 189.90, 'PAID', NOW() - INTERVAL '30 days'), ...
  ```
- **Cenário:** qualquer pessoa que siga o próprio `README.md` ("execute o SQL Editor") e rode o script inteiro de uma vez recebe `ERROR: new row for relation "financial_transactions" violates check constraint`. Dependendo de como o SQL Editor do Supabase trata a transação, isso pode abortar a execução do script inteiro.
- **Correção:** trocar `'entrada'`/`'saida'` por `'INCOME'`/`'EXPENSE'` no seed, ou remover a constraint do enum e resolver a inconsistência de vocabulário PT/EN em toda a base (ver BUG-07).
- **Prioridade:** P0.

### 🔴 BUG-02 — Cadastro público concede papel ADMIN a qualquer visitante (CRÍTICO — segurança)
- **Arquivo:** `src/components/auth/AuthModal.tsx`, dentro de `handleSubmit`:
  ```tsx
  if (isSignUp) {
    await signUp(email, password, fullName, 'ADMIN');
  ```
- **Problema:** o formulário de "Criar conta", acessível a qualquer visitante não autenticado (é a própria tela de login, `App.tsx` renderiza `<AuthModal isOpen={true} .../>` quando não há usuário logado), chama `signUp` passando o papel **hard-coded como `'ADMIN'`**. `AuthService.signUp` (`src/services/auth.service.ts`) manda esse valor como `options.data.role` para o Supabase Auth, e o trigger `handle_new_user()` (`setup.sql`, linha ~38) faz `COALESCE(NEW.raw_user_meta_data->>'role', 'EMPLOYEE')` — ou seja, confia inteiramente no metadado enviado pelo cliente.
- **Cenário:** qualquer pessoa com acesso à URL pública do sistema clica em "Criar conta", preenche e-mail/senha, e se torna Administrador com acesso total a produtos, preços, financeiro, clientes e fornecedores.
- **Correção:** nunca aceitar `role` vindo do cliente. Sempre criar usuários como `EMPLOYEE` por padrão no trigger, e promover papéis exclusivamente por uma ação server-side executada por um ADMIN existente (idealmente via Edge Function com Service Role Key, nunca client-side).
- **Prioridade:** P0.

### 🔴 BUG-03 — Qualquer usuário pode se autopromover a ADMIN via RLS mal configurada (CRÍTICO — segurança)
- **Arquivo:** `supabase/setup.sql`, policy de `profiles`:
  ```sql
  CREATE POLICY "Users can update own profile or Admins can update any"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (id = auth.uid() OR public.current_user_role() = 'ADMIN');
  ```
- **Problema:** a policy não define `WITH CHECK`. No Postgres, quando `WITH CHECK` é omitido em uma policy de `UPDATE`, a expressão de `USING` é reaplicada como `WITH CHECK` — mas essa expressão só valida `id = auth.uid()`, e o `id` não muda numa atualização de perfil próprio. **Nada impede o usuário de incluir `role: 'ADMIN'` no mesmo `UPDATE`.**
- **Cenário:** um funcionário com papel `EMPLOYEE`, autenticado normalmente, abre o console do navegador e executa `supabase.from('profiles').update({ role: 'ADMIN' }).eq('id', meuId)`. A policy permite, porque a única condição (`id = auth.uid()`) continua verdadeira depois da alteração. Isso funciona **mesmo sem o BUG-02 existir** — é uma falha independente.
- **Correção:** adicionar `WITH CHECK` explícito que preserve o `role` original para usuários não-ADMIN, por exemplo restringindo a policy de autoatualização a colunas específicas via uma função `SECURITY DEFINER` dedicada (`update_own_profile(full_name text)`), e deixando a troca de `role` apenas para uma policy separada, exclusiva de `ADMIN`, com `WITH CHECK (public.current_user_role() = 'ADMIN')`.
- **Prioridade:** P0.

### 🔴 BUG-04 — Integração PIX chama funções que não existem no banco (CRÍTICO — feature quebrada)
- **Arquivos:** `supabase/functions/create-mp-pix/index.ts` (linha ~26, `supabase.rpc('create_mp_pix_sale', ...)`) e `supabase/functions/mp-webhook/index.ts` (linha ~48, `supabase.rpc('approve_mp_pix_sale', ...)`)
- **Problema:** busquei as duas funções em todo o `setup.sql` (`grep -n "CREATE OR REPLACE FUNCTION"`) e elas **não existem**. Só existem `complete_sale`, `cancel_mp_pix_sale`, `increment_variant_stock`, `current_user_role`, `handle_new_user`, `handle_updated_at`.
- **Cenário:** qualquer tentativa de gerar um QR Code PIX no PDV falha com `PGRST202 function ... does not exist`; e mesmo que uma venda pendente fosse criada por outro caminho, o webhook de aprovação também falharia.
- **Correção:** escrever as duas funções faltantes (uma para criar venda com `status = 'PENDING'` e reservar/validar estoque sem baixar ainda, outra para, no `approved`, baixar estoque e marcar a venda como `COMPLETED` — replicando a lógica de `complete_sale` mas para o fluxo assíncrono do PIX) antes de ativar essa forma de pagamento em produção.
- **Prioridade:** P0 (bloqueia a funcionalidade PIX citada no README como pronta).

### 🔴 BUG-05 — Edge Function `create-mp-pix` usa `process.env` em ambiente Deno (ALTO)
- **Arquivo:** `supabase/functions/create-mp-pix/index.ts`, linha 4:
  ```ts
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
  ```
- **Problema:** Edge Functions do Supabase rodam em **Deno**, não em Node.js. `process` não existe no escopo global do Deno por padrão. Essa linha está no nível superior do módulo, fora de qualquer try/catch, então a referência a uma variável inexistente tende a quebrar o carregamento da função **antes mesmo de `serve()` ser chamado**. A própria `mp-webhook/index.ts` (linha 4) usa corretamente `Deno.env.get('ALLOWED_ORIGIN')`, confirmando que é uma inconsistência/erro de cópia entre os dois arquivos, não uma escolha proposital.
- **Correção:** trocar para `Deno.env.get('ALLOWED_ORIGIN') || '*'`.
- **Prioridade:** P0 (soma-se ao BUG-04 — o endpoint de criação de PIX está duplamente quebrado).

### 🔴 BUG-06 — Editar um produto apaga permanentemente o histórico de estoque das variantes antigas (CRÍTICO — integridade/auditoria)
- **Arquivo:** `src/services/products.service.ts`, método `update()`:
  ```ts
  await supabase.from('product_variants').delete().eq('product_id', uuid);
  const newVariants = updates.skus.map(...)
  await supabase.from('product_variants').insert(newVariants);
  ```
- **Problema:** ao editar qualquer produto que tenha variações (o que é o caso normal de roupas), o código **apaga todas as variantes existentes e recria novas, com novos UUIDs e novos SKUs gerados por `Date.now()`**. Como `inventory_movements.product_variant_id` tem `ON DELETE CASCADE` (`setup.sql`, seção 6), **todo o histórico de movimentações de estoque daquelas variantes é apagado junto**. `sale_items.product_variant_id` tem `ON DELETE SET NULL`, então vendas antigas perdem a rastreabilidade até a variante (o texto descritivo permanece, mas o vínculo relacional não).
- **Cenário:** uma gerente corrige o nome de uma cor ("Preto" → "Preto Fosco") num produto que já vendeu 50 unidades ao longo do mês. Ao salvar, o sistema apaga as 50+ linhas de `inventory_movements` daquelas variantes (entradas, vendas, ajustes) e troca o SKU físico que já pode estar impresso em etiqueta/prateleira.
- **Correção:** nunca fazer delete+recreate de variantes. Fazer `UPDATE` das variantes existentes quando o `id` já existe, e só fazer `INSERT` para variantes genuinamente novas; nunca gerar SKU a partir de `Date.now()` (colisão e instabilidade) — usar sequência/UUID de verdade e permitir edição manual do SKU.
- **Prioridade:** P0.

### 🔴 BUG-07 — Exclusão de produto apaga em cascata toda a trilha de auditoria de estoque (CRÍTICO)
- **Arquivo:** `src/services/products.service.ts`, método `remove()`: `DELETE FROM products WHERE id = uuid` (hard delete físico).
- **Problema:** `products` já tem uma coluna `is_active BOOLEAN` claramente pensada para soft delete, mas ela nunca é usada para exclusão — `remove()` faz `DELETE` físico. Combinado com `product_variants.product_id ON DELETE CASCADE` → `inventory_movements.product_variant_id ON DELETE CASCADE`, apagar **um único produto apaga em cascata todas as suas variantes e todo o histórico de movimentação de estoque associado a elas** — exatamente o tipo de dado que a Seção 13 (Auditoria) do pedido original exige preservar.
- **Correção:** usar `UPDATE products SET is_active = false` em vez de `DELETE`; se exclusão física for necessária por algum motivo, mover `inventory_movements` para `ON DELETE SET NULL` (mantendo `product_variant_id` nulo mas preservando a linha) ou arquivar antes de apagar.
- **Prioridade:** P0.

### 🟠 BUG-08 — Vendas canceladas/reembolsadas continuam contando como faturamento nos relatórios (ALTO — integridade financeira)
- **Arquivos:** `src/services/dashboard.service.ts` (query de `sales`, sem filtro de `status`), `src/services/reports.service.ts` (`getMonthlyComparison`, idem), `src/services/sales.service.ts` (`getMovements`, idem).
- **Problema:** nenhuma dessas três consultas filtra `status = 'COMPLETED'`. Uma venda com `status = 'CANCELLED'` (produzida por `cancel_mp_pix_sale`) continua sendo somada em `totalVendasMes`, `ticketMedio` e no comparativo mensal.
- **Cenário:** um PIX é gerado, expira, é cancelado e o estoque é restaurado — mas o valor da venda cancelada segue aparecendo como receita no Dashboard e nos Relatórios até que alguém note a discrepância contra o caixa físico.
- **Correção:** adicionar `.eq('status', 'COMPLETED')` (ou `.neq('status', 'CANCELLED')` conforme a regra de negócio para `REFUNDED`) em todas as consultas usadas para métricas financeiras.
- **Prioridade:** P1.

### 🟠 BUG-09 — `refreshData()` busca as 6 tabelas inteiras a cada mutação, sem paginação (ALTO — performance/escalabilidade)
- **Arquivo:** `src/contexts/StoreContext.tsx`, função `refreshData` e todas as funções de mutação (`addProduct`, `addCustomer`, `processSale`, etc., cada uma chama `await refreshData()` ao final).
- **Problema:** `refreshData()` dispara `Promise.all` com `ProductsService.getAll()`, `FinanceService.getTransactions()`, `FinanceService.getFixedExpenses()`, `SalesService.getMovements()`, `CustomersService.getAll()`, `SuppliersService.getAll()` — **nenhuma dessas usa `.range()`/`.limit()`**. Além disso, `DashboardService.getMetrics()` e `ReportsService.getMonthlyComparison()` buscam a tabela `sales` inteira (com `sale_items` e `payments` aninhados) sem filtro de data, e filtram "hoje"/"este mês" **em JavaScript no navegador**, não em SQL.
- **Cenário:** com 10.000 vendas históricas, abrir o Dashboard baixa as 10.000 linhas (e seus itens/pagamentos aninhados) só para calcular o total do dia atual. Cadastrar um único cliente novo dispara o recarregamento de produtos, financeiro, movimentações, clientes e fornecedores inteiros.
- **Correção:** filtrar no SQL (`gte('created_at', inicioDoMes)`), usar agregação no Postgres (`SUM`/`COUNT` via RPC ou view materializada) em vez de somar no cliente, paginar listas grandes, e atualizar apenas a fatia de estado que realmente mudou em vez de `refreshData()` global.
- **Prioridade:** P1.

### 🟡 BUG-10 — `AuthContext` assume papel ADMIN como padrão quando o perfil ainda não carregou
- **Arquivo:** `src/contexts/AuthContext.tsx`: `const role: UserRole = profile?.role || 'ADMIN'; // Default para visualização completa`
- **Problema:** o comentário confirma que é intencional, mas é uma escolha perigosa: em qualquer instante em que `profile` seja `null` (carregamento em andamento, falha de rede momentânea ao buscar o perfil, erro silencioso capturado em `fetchProfile`), a variável `role` usada por toda a interface assume `'ADMIN'`, mesmo que nenhuma tela hoje use `role` para bloquear nada (ver Seção 5). O risco cresce assim que alguém implementar RBAC no frontend seguindo esse `role` como fonte de verdade.
- **Correção:** o padrão seguro é o oposto — na ausência de perfil confirmado, tratar como o papel de **menor privilégio** (ou bloquear a tela), nunca como ADMIN.
- **Prioridade:** P1.

### 🟡 BUG-11 — IDs numéricos reconstruídos por índice de array a cada fetch (arquitetura frágil)
- **Arquivos:** `src/services/products.service.ts`, `customers.service.ts`, `finance.service.ts`, `sales.service.ts` — todos fazem `.map((row, index) => ({ id: index + 1, uuid: row.id, ... }))`.
- **Problema:** o `id` numérico usado por boa parte dos componentes de UI não é uma chave estável do banco — é recalculado como a posição do item no array retornado a cada `refreshData()`. A chave real e estável é `uuid`. Isso funciona hoje porque a maior parte das mutações de fato usa `uuid` internamente, mas é uma fonte constante de bugs sutis (ex.: comparação de identidade de item entre dois estados obtidos em momentos diferentes, chaves de lista React reaproveitadas incorretamente) e deveria ser eliminado, usando `uuid` como identificador único em toda a aplicação.
- **Prioridade:** P2.

---

## 5. VULNERABILIDADES (classificadas por severidade)

| # | Vulnerabilidade | Onde | Severidade |
|---|---|---|---|
| 1 | Escalonamento de privilégio via cadastro público (`role: 'ADMIN'` hard-coded) | `AuthModal.tsx` | **CRÍTICO** |
| 2 | Escalonamento de privilégio via autoatualização de `profiles.role` (RLS sem `WITH CHECK`) | `setup.sql` (policy de `profiles`) | **CRÍTICO** |
| 3 | Broken Access Control: qualquer usuário autenticado pode `INSERT` diretamente em `sales`, `sale_items`, `payments`, `inventory_movements` (`WITH CHECK (true)`), contornando totalmente a RPC `complete_sale` e suas validações de estoque/transação | `setup.sql`, policies de `sales`/`sale_items`/`payments`/`inventory_movements` | **ALTO** |
| 4 | Exposição de dados sensíveis a todos os papéis: qualquer funcionário autenticado (inclusive `EMPLOYEE`) pode ler **todo** o financeiro, **todas** as vendas e **todos** os dados de clientes (CPF, telefone, e-mail, endereço), pois as policies de `SELECT` são `USING (true)` sem diferenciação por papel | `setup.sql`, policies `SELECT` de `customers`, `sales`, `financial_transactions` | **ALTO** |
| 5 | `cancel_mp_pix_sale` pode ser chamada por qualquer usuário autenticado, para **qualquer `sale_id`**, sem checar se a venda é de fato um PIX pendente/expirado nem quem a criou — permite estornar (restaurar estoque + lançar despesa de estorno) uma venda `COMPLETED` legítima | `setup.sql`, função `cancel_mp_pix_sale` | **ALTO** |
| 6 | RPCs `SECURITY DEFINER` (`complete_sale`, `cancel_mp_pix_sale`, `increment_variant_stock`) não fazem nenhuma verificação de papel internamente — dependem inteiramente de que a policy de `EXECUTE` da função esteja corretamente restrita; nenhum `REVOKE`/`GRANT EXECUTE` explícito aparece no script, então o comportamento efetivo depende do padrão do Supabase (tipicamente `anon` + `authenticated` recebem `EXECUTE` por padrão em funções criadas via SQL Editor) | `setup.sql` | **MÉDIO/ALTO** — precisa ser confirmado e travado explicitamente no ambiente real |
| 7 | Webhook do Mercado Pago (`mp-webhook`) não valida assinatura/origem da requisição (não checa cabeçalho de assinatura do Mercado Pago); mitigado parcialmente por rebuscar o status direto na API do MP, mas o endpoint em si aceita chamadas de qualquer origem sem autenticação | `mp-webhook/index.ts` | **MÉDIO** |
| 8 | CORS com fallback `'*'` nas duas Edge Functions quando `ALLOWED_ORIGIN` não está definido | `create-mp-pix/index.ts`, `mp-webhook/index.ts` | **BAIXO/MÉDIO** (depende de configuração em produção) |
| 9 | Dados de clientes (nome, CPF, telefone, e-mail, endereço, histórico de compras) ficam em `localStorage` sem expiração (`erp_customers`) e persistem indefinidamente no navegador mesmo após logout — `signOut()` não limpa o `localStorage` | `StoreContext.tsx`, `AuthContext.tsx` | **MÉDIO** (ver LGPD, seção 6) |
| 10 | Nenhum rate limiting aplicado a login/cadastro (depende só do padrão do Supabase Auth) — risco de força bruta de credenciais não mitigado pela aplicação | Geral | **MÉDIO** |
| 11 | Dependência de pacote de IA (`@google/genai`) presente no `package.json` sem uso e sem necessidade de chave — não é uma vulnerabilidade ativa, mas é superfície de ataque/manutenção desnecessária (dependência morta que pode ganhar CVEs sem ninguém notar) | `package.json` | **BAIXO** |

Não busquei ativamente CVEs nas versões exatas de cada dependência (isso exigiria rodar `npm audit`/Dependabot no ambiente real com acesso à internet completo), mas recomendo fortemente configurar isso em CI antes de produção — ver Seção 9 (roadmap DevOps).

---

## 6. LGPD

Dados pessoais efetivamente tratados pelo sistema, conforme o schema real:

- **Clientes** (`customers`): nome, **CPF**, telefone, e-mail, endereço, data de nascimento, histórico de compras (via relação com `sales`).
- **Funcionários** (`profiles`/`auth.users`): nome completo, e-mail, papel/cargo — e, via `auth.users`, hash de senha (gerenciado pelo Supabase Auth, fora do escopo do schema público).
- **Vendas** (`sales`): nome e CPF do comprador ficam duplicados também na própria linha de venda (`customer_name`, `customer_cpf`), mesmo quando já existe `customer_id` — redundância desnecessária de PII.
- **Pagamento**: nenhum dado de cartão é armazenado diretamente (`payments` só guarda `method`, `amount`, `installments`, `provider_transaction_id`) — **isso está correto**, delegando o dado sensível de cartão ao adquirente/Mercado Pago, exatamente como a boa prática pede.

### Principais adequações necessárias (nenhuma encontrada implementada hoje):

1. **Base legal e finalidade**: não há nenhum texto de consentimento no cadastro de cliente nem de funcionário; CPF é coletado sem indicação de finalidade explícita ao titular.
2. **Minimização**: `sales.customer_cpf` e `sales.customer_name` duplicam dado que já existe em `customers` via FK — descontrole de onde o CPF "mora" dificulta atender pedidos de exclusão/retificação.
3. **Retenção/exclusão**: não existe **nenhum** mecanismo de exclusão ou anonimização de dados de cliente. `CustomersService` só tem `getAll`/`create` — não há `delete` nem `anonymize`. Um pedido de exclusão de titular (direito da LGPD) hoje não tem como ser atendido pela aplicação sem intervenção manual direta no banco.
4. **Exportação de dados** (portabilidade, art. 18 LGPD): inexistente.
5. **Controle de acesso a dados pessoais**: como visto na Seção 5 (vulnerabilidade #4), **qualquer funcionário autenticado** — inclusive o papel mais baixo, `EMPLOYEE` — pode ler CPF, telefone, e-mail e endereço de todos os clientes. Não há princípio de necessidade de conhecimento (need-to-know) aplicado por papel.
6. **Armazenamento local sem expiração**: PII de clientes fica cacheada em `localStorage` (`erp_customers`) indefinidamente, inclusive em máquinas compartilhadas de PDV, sem criptografia e sem limpeza no logout.
7. **Logs**: como não há um sistema de logging estruturado (ver Seção 7), não há como hoje provar quem acessou o dado de qual cliente e quando — pré-requisito para responder a incidentes e para auditorias de conformidade.
8. **Política de privacidade / termos de uso**: não há nenhuma tela ou texto no app.

**Recomendação central:** antes de operar com clientes reais, (a) restringir a leitura de PII por papel via RLS, (b) implementar exclusão/anonimização de cliente, (c) parar de duplicar CPF em `sales` (manter só a FK para `customers`, ou truncar/mascarar o CPF exibido na tela de venda) e (d) adicionar consentimento explícito no cadastro.

---

## 7. AUDITORIA E LOGS

**O que existe:** a tabela `inventory_movements` é, na prática, uma trilha de auditoria específica de estoque — registra `quantity_before`/`quantity_after`, `type`, `reference_id`, `user_id` e `notes` por movimentação, o que é bom. `sales`, `payments` e `financial_transactions` têm `created_at`/`updated_at`.

**O que não existe:**

- **Nenhum log genérico de auditoria** cobrindo os eventos citados no pedido original (`Produto alterado`, `Preço alterado`, `Usuário criado`, `Permissão alterada`, `Cliente excluído`, `Pagamento estornado`). Não há tabela `audit_log`, não há trigger de `AFTER UPDATE`/`AFTER DELETE` registrando valor anterior/novo em `products`, `profiles` ou `customers`.
- **A única trilha de auditoria que existe (`inventory_movements`) é apagável em cascata** por uma ação de rotina (editar/excluir produto — ver BUG-06/BUG-07), o que é o oposto do que uma trilha de auditoria deveria garantir (imutabilidade).
- **Nenhum log de aplicação estruturado.** Os `services/*.ts` usam `console.error`/`console.warn` (ex.: `console.error('Erro ao buscar produtos:', error)` em `products.service.ts`) — isso não é logging: some ao fechar a aba, não é pesquisável, não tem nível/contexto/correlação.
- **Nenhum log de autenticação** (tentativas de login falhas, criação de conta, mudança de senha) além do que o próprio Supabase Auth guarda internamente (não exposto na aplicação).
- **Nenhum IP/dispositivo registrado** em nenhuma operação sensível.

**Recomendação:** criar uma tabela `audit_log` genérica (`table_name`, `record_id`, `action`, `old_data JSONB`, `new_data JSONB`, `user_id`, `created_at`) populada por triggers `AFTER UPDATE/DELETE` nas tabelas sensíveis (`products`, `product_variants`, `profiles`, `sales`, `payments`), com **`REVOKE DELETE`** dessa tabela para todos os papéis exceto talvez um `AUDITOR` somente-leitura — e nunca usar `ON DELETE CASCADE` para apagar registros de auditoria.

---

## 8. FUNCIONALIDADES FALTANTES (por fase)

### MVP (mínimo para operar 1 loja com segurança)
- Corrigir BUG-01 a BUG-07 (todos P0) antes de qualquer uso com dinheiro real.
- RBAC de verdade no frontend (ocultar/bloquear módulos por papel) + RLS de leitura restrita por papel em `customers`/`financial_transactions`.
- Abertura e fechamento de caixa, com sangria e suprimento.
- Cancelamento de venda (qualquer forma de pagamento, não só PIX), com motivo e permissão restrita.
- Troca e devolução (usar o `type = 'RETURN'` que já existe no enum, mas está sem uso).
- Correção da duplicação de CPF entre `sales` e `customers`.
- Testes automatizados mínimos no fluxo de venda (`complete_sale`) e nas policies de RLS.

### V1 (sistema comercial profissional para 1 loja)
- Pagamento dividido/múltiplas formas na mesma venda.
- Cadastro e leitura de código de barras (o campo já existe, falta UI e leitor).
- Permissões granulares por módulo/ação (`vendas.criar`, `estoque.ajustar`, `financeiro.visualizar` etc.), não só 4 papéis fixos.
- Audit log genérico (Seção 7).
- Exclusão/anonimização de cliente (LGPD).
- Paginação e filtros server-side em todas as listagens (produtos, vendas, movimentações, clientes).
- Agregações de dashboard/relatório calculadas em SQL, não em JavaScript no navegador.
- Observabilidade básica (error tracking tipo Sentry, health check).
- CI mínimo (lint + type-check + testes em PR).

### V2 (multi-loja/franquias)
- Introduzir `store_id` (ver Seção 9 — Arquitetura recomendada) em todas as tabelas transacionais e de estoque, com RLS filtrando por loja do usuário.
- Estoque por loja + transferência entre lojas (nova tabela `stock_transfers` com `origin_store_id`/`destination_store_id`/status).
- Caixa por loja, relatórios por loja e relatório consolidado (matriz).
- Permissões por loja (um usuário pode ser `MANAGER` na Loja A e não ter acesso à Loja B).

### V3 (escala, fiscal, e-commerce, BI)
- Emissão fiscal (NFC-e/NF-e), que hoje **não existe em nenhuma forma**, nem como stub — precisaria de um provedor de emissão (ex. Focus NFe, eNotas, PlugNotas) e dos campos fiscais (CFOP, NCM, CEST, CST/CSOSN) que hoje não existem em `products`/`sale_items`.
- Fila/job assíncrono para conciliação financeira e webhooks.
- Integração com marketplaces/e-commerce.
- BI/relatórios avançados (margem por marca/categoria, cohort de clientes).

---

## 9. ARQUITETURA RECOMENDADA

A arquitetura atual (SPA → Supabase direto, lógica crítica em RPC `SECURITY DEFINER`) **não é uma má escolha para uma loja única** — é, na verdade, uma forma legítima e comum de construir sobre BaaS. O problema não é "SPA fala direto com Postgres", o problema é a **calibração das RLS e a ausência de camada de negócio para regras que envolvem mais de uma tabela de forma consistente**. Recomendo manter o modelo, mas reforçar duas camadas:

```
Frontend (React/Vite)
   │  (chama apenas RPCs para escrita crítica; leitura via SELECT com RLS restrita por papel/loja)
   ▼
RLS + RPC (PL/pgSQL, SECURITY DEFINER, com checagem de papel/loja dentro da função)
   │
   ▼
Postgres (Supabase) — dados + triggers de auditoria (nunca CASCADE em tabelas de histórico)
   │
   ├─▶ Edge Functions (Deno) — only para integrações externas: Mercado Pago, futura NFC-e, webhooks
   ├─▶ Storage — imagens de produto/marca (já em uso, ok)
   └─▶ (V2) coluna store_id em todas as tabelas + RLS por loja do usuário autenticado
```

**Deve permanecer:** o padrão de RPC atômica para venda (`complete_sale`) — é o coração correto do sistema, só precisa ganhar as funções irmãs que faltam para PIX e ganhar checagem de papel.

**Deve mudar:**
1. Toda policy de `INSERT`/`UPDATE` com `WITH CHECK (true)` deve ser substituída por checagem de papel explícita (ninguém, além da RPC via `SECURITY DEFINER`, deveria conseguir inserir direto em `sales`/`payments`/`inventory_movements`; a policy de `INSERT` nessas tabelas deveria, idealmente, ser **removida** para usuários comuns, deixando a escrita só pelo caminho da função).
2. `profiles` precisa de uma policy de auto-atualização que **não permita alterar a própria coluna `role`**.
3. Introduzir `store_id UUID REFERENCES stores(id)` em `product_variants` (estoque por loja), `sales`, `financial_transactions`, `profiles` (loja padrão do funcionário) quando o multi-loja for implementado — e todas as RLS passam a incluir `AND store_id = (SELECT store_id FROM profiles WHERE id = auth.uid())` (ou uma tabela `user_stores` many-to-many para quem acessa mais de uma loja).
4. Substituir o cálculo de métricas em JavaScript (dashboard/relatórios) por `SUM`/`COUNT`/`GROUP BY` no Postgres, expostos via RPC ou view.

---

## 10. ROADMAP

**FASE 0 — Correções críticas (bloqueiam qualquer uso real)**
Corrigir BUG-01 a BUG-07 e as vulnerabilidades #1, #2, #3, #5 da Seção 5. Sem isso, o sistema não deve receber nenhum dado real de cliente, venda ou pagamento.

**FASE 1 — Base do ERP**
RBAC real no frontend + RLS por papel na leitura de PII/financeiro; corrigir duplicação de CPF; audit log genérico; testes automatizados do fluxo de venda.

**FASE 2 — PDV**
Caixa (abertura/fechamento/sangria/suprimento), cancelamento de venda genérico, troca/devolução, pagamento dividido.

**FASE 3 — Estoque**
Corrigir BUG-06/07 (parar de recriar variantes); código de barras funcional; inventário/contagem cíclica; reserva de estoque para venda em andamento.

**FASE 4 — Financeiro**
Conciliação de caixa x vendas x financeiro; contas a pagar/receber com vencimento e alertas reais (não só cálculo client-side); comissão de vendedor.

**FASE 5 — Segurança/LGPD/Auditoria**
Exclusão/anonimização de cliente; consentimento; expiração de cache local; observabilidade (Sentry ou similar) e logging estruturado.

**FASE 6 — Multi-loja**
`store_id` em todo o schema; estoque por loja; transferência entre lojas; permissões por loja; relatório consolidado.

**FASE 7 — Pagamentos**
Concluir `create_mp_pix_sale`/`approve_mp_pix_sale`; suportar cartão via adquirente real (hoje `CREDIT_CARD`/`DEBIT_CARD` são só rótulos manuais no PDV, sem integração de maquininha); webhook com validação de assinatura.

**FASE 8 — Fiscal**
Avaliar provedor de emissão de NFC-e/NF-e; adicionar campos fiscais a `products`/`sale_items`; certificado digital.

**FASE 9 — Escalabilidade**
Paginação/agregação SQL em tudo; cache; filas para picos de PDV em datas de alto volume; CI/CD completo; backups testados (restore, não só backup).

---

## 11. CHECKLIST FINAL

### Segurança (fazer primeiro — bloqueadores)
- [x] Remover `role: 'ADMIN'` hard-coded do cadastro público (`AuthModal.tsx`)
- [x] Adicionar `WITH CHECK` na policy de `UPDATE` de `profiles` impedindo auto-alteração de `role`
- [x] Restringir/remover policies de `INSERT` com `WITH CHECK (true)` em `sales`, `sale_items`, `payments`, `inventory_movements`
- [x] Adicionar checagem de papel dentro de `cancel_mp_pix_sale` (e registrar quem cancelou)
- [x] Confirmar/travar `GRANT EXECUTE` das funções `SECURITY DEFINER` explicitamente
- [x] Corrigir `process.env` → `Deno.env.get` em `create-mp-pix/index.ts`
- [ ] Validar assinatura do webhook do Mercado Pago

### Backend / Banco
- [x] Criar `create_mp_pix_sale` e `approve_mp_pix_sale`
- [x] Corrigir seed SQL (`'entrada'/'saida'` → `'INCOME'/'EXPENSE'`)
- [x] Trocar `product_variants` update de delete+recreate para upsert real
- [x] Trocar `remove()` de produto para soft delete (`is_active = false`)
- [x] Filtrar `status = 'COMPLETED'` em todas as métricas financeiras

### PDV / Estoque
- [ ] Caixa: abertura, fechamento, sangria, suprimento
- [ ] Cancelamento de venda genérico (não só PIX)
- [ ] Troca e devolução
- [ ] Pagamento dividido
- [ ] Código de barras (UI + leitura)

### LGPD / Auditoria
- [ ] Exclusão/anonimização de cliente
- [ ] Restringir leitura de PII por papel
- [ ] Audit log genérico e imutável
- [ ] Expirar/limpar cache de PII no `localStorage` no logout

### Multi-loja
- [ ] `store_id` no schema
- [ ] Estoque e caixa por loja
- [ ] Transferência entre lojas
- [ ] Relatório consolidado

### Produção
- [ ] Testes automatizados (unit + integração dos RPCs + RLS)
- [ ] CI/CD (lint, type-check, testes, `npm audit`)
- [ ] Observabilidade (error tracking, health check)
- [ ] Backup/restore testado
- [ ] Remover dependências mortas (`express`, `@google/genai`)

---

## Nota metodológica

Esta auditoria cobre profundamente os pontos com maior risco (segurança, integridade de estoque/financeiro, PDV, LGPD, arquitetura multi-loja) porque é onde o código real revelou os problemas mais graves e concretos. Os itens 21 (observabilidade), 22 (testes) e 23 (DevOps) do pedido original foram confirmados como **inexistentes** (nenhum arquivo de teste, nenhum workflow de CI, nenhum Dockerfile no repositório) e por isso foram tratados de forma mais breve — não há o que "auditar" além de constatar a ausência.
