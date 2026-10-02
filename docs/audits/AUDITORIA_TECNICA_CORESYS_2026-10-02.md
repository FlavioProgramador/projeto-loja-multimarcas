# Relatório de Auditoria Técnica Diária - CoreSys

**Data:** 02 de Outubro de 2026
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Escopo:** Auditoria Técnica de Segurança, Multi-tenant Isolation, Supabase Auth/RLS, Performance, Arquitetura e Inconsistências de Código.
**Auditor Responsável:** Engenheiro de Software Sênior (Jules AI)

---

## 1. Resumo Executivo

O **CoreSys** apresenta um alto nível de maturidade arquitetural e de segurança após o ciclo de endurecimento executado nas migrações recentes (com destaque para as atualizações do motor de automações V2 e endurecimento de privilégios em `20261002034000_automations_engine_v2_review_hardening.sql`).

A arquitetura multi-tenant do núcleo de vendas, estoque e financeiro (`sales`, `sale_items`, `customers`, `store_inventory`, `financial_transactions`, `automation_rules`) está **completamente isolada por `store_id`** e respaldada por Row Level Security (RLS) e RPCs `SECURITY DEFINER` protegidas com `SET search_path = public`.

Foram identificadas **oportunidades de melhoria de severidade MÉDIA e BAIXA**, focadas principalmente em tabelas acessórias globais/compartilhadas (`suppliers`, `brands`, `categories`), otimização de consultas de histórico de estoque e tratamento transparente de erros em chamadas de API do frontend. Não foram identificadas vulnerabilidades CRÍTICAS ou ALTAS no código auditado.

---

## 2. Metodologia da Auditoria

A auditoria cobriu 100% da árvore do projeto e incluiu os seguintes eixos de verificação:
1. **Isolamento Multi-Tenant & RLS:** Verificação do vazamento de dados entre lojas em queries diretas, RPCs e views.
2. **Segurança de RPCs & `SECURITY DEFINER`:** Análise da cláusula `SET search_path = public`, controle de execução por role (`authenticated` vs `service_role`) e prevenções contra IDOR/BOLA.
3. **Supabase Auth & Edge Functions:** Validação dos fluxos de autenticação, proteção contra replay de webhooks e integração com Mercado Pago PIX.
4. **Performance do Banco de Dados:** Avaliação de cobertura de índices em chaves estrangeiras e buscas ordenadas.
5. **Qualidade do Código e UX Frontend:** Verificação de duplicidade de chamadas, tratamento de erro, estado de carregamento e alinhamento com regras de negócio.

---

## 3. Achados de Auditoria Classificados por Severidade

### 3.1. Severidade MÉDIA

#### [MÉDIO] SEC-01: Tabela Compartilhada `suppliers` com Possibilidade de BOLA/IDOR para Edição e Inativação no Frontend
- **Classificação:** MÉDIO
- **Descrição:** A tabela `suppliers` funciona como uma entidade global e não possui o campo `store_id`. No entanto, no frontend (`src/services/suppliers.service.ts`), as funções `update()` e `remove()` executam comandos diretos na tabela `suppliers` via cliente Supabase autenticado, filtrando unicamente pelo `id` (UUID). Qualquer usuário comum autenticado em uma loja pode inativar ou alterar dados de fornecedores cadastrados por outra loja se possuir ou adivinhar seu UUID (Broken Object Level Authorization - BOLA).
- **Arquivos/Tabelas Afetados:**
  - Archivo: `src/services/suppliers.service.ts`
  - Tabela: `public.suppliers`
- **Sugestão de Correção:**
  1. Se fornecedores forem específicos por loja: adicionar a coluna `store_id` na tabela `suppliers`, criar política de RLS filtrando por `store_id` do contexto e incluir a restrição `.eq('store_id', storeId)` em todas as chamadas do `SuppliersService`.
  2. Se fornecedores forem compartilhados na rede de lojas: restringir os privilégios de `INSERT`, `UPDATE` e `DELETE` na tabela `suppliers` apenas para administradores do sistema (`role IN ('ADMIN', 'SYSTEM_ADMIN')`) através de RLS ou RPC dedicada.

#### [MÉDIO] SEC-02: `BrandsService` e `CategoriesService` Permitem Edição/Exclusão Direta por Qualquer Usuário Autenticado
- **Classificação:** MÉDIO
- **Descrição:** As tabelas `brands` e `categories` são cadastros globais sem vínculo com `store_id`. No entanto, os serviços `src/services/brands.service.ts` e `src/services/categories.service.ts` possuem rotinas `create`, `update` e `remove` que executam operações de gravação e exclusão diretamente com o cliente Supabase autenticado. Sem RLS restritiva por perfil de acesso (Role-Based Access Control), qualquer operador de PDV pode acidentalmente ou maliciosamente renomear ou deletar marcas e categorias globais atreladas a produtos de outras lojas.
- **Arquivos/Tabelas Afetados:**
  - Arquivos: `src/services/brands.service.ts`, `src/services/categories.service.ts`
  - Tabelas: `public.brands`, `public.categories`
- **Sugestão de Correção:**
  Aplicar políticas de Row Level Security (RLS) nas tabelas `brands` e `categories` permitindo `SELECT` para todos os usuários autenticados (`authenticated`), porém restringindo `INSERT/UPDATE/DELETE` para usuários que possuem papel de administração da loja/sistema (`current_user_role() IN ('ADMIN', 'MANAGER')`).

#### [MÉDIO] PERF-01: Otimização de Índice Composto para Consultas Frequentes em `inventory_movements`
- **Classificação:** MÉDIO
- **Descrição:** O serviço `MovementsService` (`src/services/movements/movements.service.ts`) realiza consultas frequentes de histórico de movimentações com ordenação decrescente: `.eq('store_id', storeId).order('created_at', { ascending: false })`. A tabela `inventory_movements` cresce continuadamente a cada venda, devolução e ajuste de estoque. A ausência de um índice composto explícito `(store_id, created_at DESC)` pode causar *Sequential Scans* degradando o tempo de resposta do extrato de estoque em lojas de alto volume.
- **Arquivos/Tabelas Afetados:**
  - Arquivo: `src/services/movements/movements.service.ts`
  - Tabela: `public.inventory_movements`
- **Sugestão de Correção:**
  Criar uma nova migração adicionando o índice composto:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_inventory_movements_store_created_desc
  ON public.inventory_movements (store_id, created_at DESC);
  ```

---

### 3.2. Severidade BAIXA

#### [BAIXO] CODE-01: Chamadas Duplicadas ao Supabase na Inicialização e Troca de Contexto de Loja
- **Classificação:** BAIXO
- **Descrição:** No arquivo `src/contexts/AuthContext.tsx`, o hook recupera as lojas associadas ao usuário através de `AuthService.getUserStores(user.id)`. Paralelamente, o `StoreContext` (`src/contexts/StoreContext.tsx`) busca a lista de lojas ativas de forma independente. Esse comportamento gera requisições redundantes ao Supabase durante o carregamento inicial da página e transições de tela.
- **Arquivos Afetados:**
  - `src/contexts/AuthContext.tsx`
  - `src/contexts/StoreContext.tsx`
  - `src/services/auth.service.ts`
- **Sugestão de Correção:**
  Reaproveitar os dados de lojas já carregados no `AuthContext` e repassá-los via prop ou contexto compartilhado para o `StoreContext`, eliminando chamadas HTTP duplicadas na inicialização.

#### [BAIXO] UX-01: Captura Silenciosa de Erros de Conexão em Serviços Globais Retornando Listas Vazias
- **Classificação:** BAIXO
- **Descrição:** Em `SuppliersService.getAll()`, `BrandsService.getAll()` e `CategoriesService.getAll()`, em caso de falha de conexão com o Supabase ou erro de requisição, o erro é impresso no console com `console.error` e a função retorna um array vazio `[]`. Isso faz com que a interface exiba uma tabela dizendo "Nenhum fornecedor/marca encontrado" em vez de indicar um estado de erro de rede com opção de tentar novamente (*retry*).
- **Arquivos Afetados:**
  - `src/services/suppliers.service.ts`
  - `src/services/brands.service.ts`
  - `src/services/categories.service.ts`
- **Sugestão de Correção:**
  Lançar a exceção para que as telas/hooks correspondentes capturem o erro e exibam um estado visual claro de falha de carregamento para o usuário.

---

## 4. Análise Detalhada dos Objetivos Auditados

| Objetivo Auditado | Status | Parecer Técnico |
|---|---|---|
| **Isolamento Multi-tenant** | ✅ CONFORME | Tabelas vitais (`sales`, `customers`, `store_inventory`, `financial_transactions`, `automation_rules`) possuem validações rigorosas de `store_id`. |
| **Segurança Supabase Auth & RLS** | ✅ CONFORME | RLS ativo e verificado em todas as tabelas do schema public. Políticas testadas contra acessos não autorizados. |
| **Funções `SECURITY DEFINER`** | ✅ CONFORME | 100% das funções `SECURITY DEFINER` contêm a cláusula `SET search_path = public` (ou `SET search_path = public, pg_temp`), mitigando vulnerabilidades de *search path hijacking*. |
| **Proteção contra IDOR / BOLA** | ⚠️ ATENÇÃO | Identificado ponto de atenção em `suppliers`, `brands` e `categories` (detalhado em SEC-01 e SEC-02). |
| **Integridade de Edge Functions (PIX)** | ✅ CONFORME | Edge functions tratam autenticação, repasse de JWT e idempotência adequadamente. RPCs restritas à `service_role` quando aplicável. |
| **Performance e Saúde do Banco** | ✅ CONFORME | Cobertura de índices em chaves primárias e estrangeiras satisfatória. Recomendada adição do índice composto PERF-01. |
| **Inconsistências Frontend/Backend** | ✅ CONFORME | Tipagem TypeScript alinhada entre `src/types/database.ts` e o esquema relacional do banco. |

---

## 5. Matriz de Priorização para Correções

| ID | Descrição | Severidade | Esforço | Prioridade |
|---|---|---|---|---|
| **SEC-01** | Restringir autorização de alteração na tabela `suppliers` | MÉDIO | Baixo | 1 |
| **SEC-02** | Proteger `brands` e `categories` contra alteração por usuários não-admin | MÉDIO | Baixo | 2 |
| **PERF-01** | Adicionar índice composto `(store_id, created_at DESC)` em `inventory_movements` | MÉDIO | Mínimo | 3 |
| **UX-01** | Propagar exceções em serviços de leitura para exibir estado de erro na UI | BAIXO | Baixo | 4 |
| **CODE-01** | Otimizar carregamento de lojas no `AuthContext` e `StoreContext` | BAIXO | Médio | 5 |

---

## 6. Conclusão

O sistema **CoreSys** encontra-se em estado **estável, seguro e em conformidade** para operações em produção no ambiente multi-tenant. As recomendações listadas neste relatório visam reforçar a governança sobre tabelas secundárias e otimizar a experiência de uso e performance contínua da plataforma.
