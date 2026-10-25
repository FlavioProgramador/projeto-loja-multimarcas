# Relatório de Auditoria Técnica Diária - CoreSys
**Data:** 2026-10-25
**Responsável:** Engenharia de Software Sênior (Jules)
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`

---

##  EXECUTIVE SUMMARY & RESUMO EXECUTIVO

Foi realizada a auditoria técnica diária e varredura de segurança do ecossistema CoreSys, englobando o código do frontend React/TypeScript, chamadas a serviços Supabase, funções PL/pgSQL (RPCs), suporte multi-tenant e configurações de RLS e autenticação.

### Status Geral da Aplicação
- **Isolamento Multi-tenant (RLS):** Forte nas entidades principais (`sales`, `inventory_movements`, `store_inventory`, `customers`).
- **RPCs Críticas de Negócio:** `complete_sale`, `cancel_sale`, `process_return` e `manage_product` possuem verificações de permissão e `search_path = public` explicitamente configurados.
- **Vulnerabilidades Encontradas:** Foram identificados 4 pontos críticos/altos de atenção que demandam remediação estrutural e boas práticas de arquitetura.

---

## 1. QUADRO DE ACHADOS E CLASSIFICAÇÃO DE RISCO

| ID | Severidade | Categoria | Descrição Sucinta | Afetados |
|---|---|---|---|---|
| **AUD-01** | **ALTO** | Multi-tenant / BOLA | Ausência de filtro por `store_id` no serviço de Fornecedores (`SuppliersService.getAll`) | `src/services/suppliers.service.ts` / Tabela `suppliers` |
| **AUD-02** | **ALTO** | Segurança / RPC | Funções `SECURITY DEFINER` de webhooks e suporte a automação sem verificação interna de papel ou tenant | RPCs `claim_mp_webhook_event`, `list_stale_pix_reconciliation_candidates`, `resolve_sale_customer_link` |
| **AUD-03** | **MÉDIO** | Integridade / BOLA | Inserção/Edição direta via Supabase Client no frontend sem passar por RPCs transacionais com validação no backend | `src/services/customers.service.ts`, `src/services/suppliers.service.ts` |
| **AUD-04** | **BAIXO** | Tratamento de Erros | Erros silenciosos no frontend (retornando array vazio sem relançar exceções na UI) | `src/services/suppliers.service.ts` |

---

## 2. DETALHAMENTO DOS ACHADOS E SUGESTÕES DE CORREÇÃO

### 🔴 AUD-01: Ausência de Escopo por `store_id` no Serviço de Fornecedores
- **Severidade:** **ALTO**
- **Explicação:** O método `SuppliersService.getAll()` no frontend consulta `.from('suppliers').select('*').eq('is_active', true)` sem filtrar por `store_id`. Embora as políticas RLS impeçam o vazamento cruzado entre lojas na camada do Supabase (quando configuradas corretamente), a ausência do parâmetro `store_id` na query do frontend viola a diretriz de defesa em profundidade e pode resultar em comportamentos inconsistentes ao trocar de contexto de loja na UI.
- **Afetados:**
  - Arquivo: `src/services/suppliers.service.ts`
  - Tabela: `suppliers`
- **Sugestão de Correção:**
  - Atualizar `SuppliersService.getAll(storeId: string)` para aceitar obrigatoriamente `storeId` e incluir `.eq('store_id', storeId)`.

---

### 🟠 AUD-02: Funções `SECURITY DEFINER` de Suporte/Webhooks sem Guard de Autorização
- **Severidade:** **ALTO**
- **Explicação:** As funções `claim_mp_webhook_event`, `complete_mp_webhook_event`, `fail_mp_webhook_event`, `list_stale_pix_reconciliation_candidates` e `resolve_sale_customer_link` executam com privilégios de `SECURITY DEFINER` e possuem `search_path = public`, porém não verificam explicitamente se o invocador possui role de sistema (`v_role`) ou se a chamada provém do `service_role` ou de uma rotina autorizada. Se a permissão `GRANT EXECUTE` for concedida acidentalmente a `authenticated` ou `anon`, usuários poderão acionar conciliações ou alterar links internos de vendas sem restrições.
- **Afetados:**
  - Migrações: `20260929234330_harden_mp_webhook_processing.sql`, `20261001151503_refine_pix_reconciliation_health.sql`, `20261002234838_server_pagination_phase25c.sql`
  - Funções: `public.claim_mp_webhook_event`, `public.list_stale_pix_reconciliation_candidates`, `public.resolve_sale_customer_link`
- **Sugestão de Correção:**
  - Revogar privilégios de execução (`REVOKE EXECUTE ON FUNCTION ... FROM public, authenticated, anon`).
  - Adicionar um guard interno nas funções verificando se `current_setting('role') = 'service_role'` ou se o usuário autenticado possui role de `ADMIN` da loja correspondente.

---

### 🟡 AUD-03: Mutação Direta de Tabelas via Client JS sem RPC Transacional
- **Severidade:** **MÉDIO**
- **Explicação:** Em `CustomersService.create` / `.update` e `SuppliersService.create` / `.update`, a aplicação realiza mutações diretamente via `supabase.from('customers').insert(...)` ou `.update(...)`. Mutações diretas do cliente frontend contornam regras de negócio centralizadas, auditoria transacional e validações agregadas que seriam garantidas por RPCs no banco de dados.
- **Afetados:**
  - Arquivos: `src/services/customers.service.ts`, `src/services/suppliers.service.ts`
  - Tabelas: `customers`, `suppliers`
- **Sugestão de Correção:**
  - Criar RPCs dedicadas no banco de dados (ex: `manage_customer`, `manage_supplier`) com validação de formato de CPF/CNPJ e autorização por `store_id`, substituindo as mutações diretas da aplicação.

---

### 🔵 AUD-04: Captura Silenciosa de Erros de Banco em `SuppliersService.getAll`
- **Severidade:** **BAIXO**
- **Explicação:** O método `SuppliersService.getAll()` captura qualquer erro retornado pelo Supabase (`if (error) { console.error(...); return []; }`) e retorna um array vazio. Isso impede que a interface do usuário (UI) exiba um estado de erro apropriado ou tente uma reconexão, mascarando falhas de rede ou de autorização.
- **Afetados:**
  - Arquivo: `src/services/suppliers.service.ts`
- **Sugestão de Correção:**
  - Relançar o erro (`throw error;`) para permitir que a UI lide com o estado de erro através de ErrorBoundaries ou alertas visualizáveis.

---

## 3. CHECKLIST DE ARQUITETURA E ISOLAMENTO MULTI-TENANT

- [x] **RLS Ativo nas Tabelas Críticas:** `sales`, `inventory_movements`, `financial_transactions`, `products`, `customers`, `suppliers`.
- [x] **RPCs de Venda Protegidas:** `complete_sale`, `cancel_sale`, `create_mp_pix_sale` requerem autenticação e `has_store_access()`.
- [x] **Search Path Protegido:** RPCs críticas possuem `SET search_path = public`.
- [x] **Imutabilidade de Histórico:** Movimentações de estoque (`inventory_movements`) possuem triggers que bloqueiam exclusões e edições não autorizadas.
- [!] **Filtro Multi-tenant na UI:** Fornecedores necessitam inclusão do filtro de `store_id` no serviço do frontend.

---

## 4. CONCLUSÃO E PRÓXIMOS PASSOS

O ecossistema CoreSys apresenta elevado nível de maturidade e hardening de segurança, especialmente após as migrações recentes de proteção de RLS e idempotência. As correções identificadas neste relatório tratam de consistência de defensive programming na camada de serviços do frontend e fechamento de privilégios em RPCs internas.

**Recomendação de Ação:**
1. Criar uma issue no GitHub detalhando a inclusão obrigatoriedade do `store_id` em `SuppliersService`.
2. Encaminhar a revisão dos privilégios e guards internos das RPCs de webhooks para o próximo ciclo de sprint.
