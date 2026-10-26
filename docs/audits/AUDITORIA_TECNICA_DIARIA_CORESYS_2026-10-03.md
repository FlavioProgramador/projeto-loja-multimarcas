# Relatório de Auditoria Técnica Diária - CoreSys

**Data:** 03 de Outubro de 2026
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`
**Responsável:** Engenheiro de Software Sênior (Auditoria Técnica CoreSys)

---

## 1. Sumário Executivo

Esta auditoria técnica diária avaliou a integridade do código-fonte, componentes do frontend em React/TypeScript, serviços, Edge Functions e o banco de dados Supabase (migrations, RLS e RPCs).

As recentes atualizações de segurança (como as migrações `20261002234838_server_pagination_phase25c.sql` e `20261003000000_coresys_audit_final_remediation.sql`) consolidaram melhorias significativas em RPCs com `SECURITY DEFINER`, `search_path = public`, locks de transação e checagens de perfil inativo. No entanto, foram identificados pontos de atenção no frontend e na camada de serviços referentes a filtragem em memória, consultas sem escopo de loja explícito e dependências de hooks React.

---

## 2. Detalhamento dos Achados por Severidade

### 🔴 CRÍTICO (CRITICAL)
*Nenhum problema de severidade crítica não mitigado encontrado na data de hoje.*
As falhas de permissão em `complete_sale`, `create_mp_pix_sale` e `cancel_sale` foram corrigidas na migração `20261003000000_coresys_audit_final_remediation.sql`.

---

### 🟠 ALTO (HIGH)

#### 1. Desempenho e Carga Excessiva na Busca do Catálogo em `ProductsService.getAll`
* **Descrição:** A função `ProductsService.getAll(storeId)` consulta a tabela `products` trazendo todos os produtos, marcas, categorias e variantes do banco de dados, sem filtrar pelo `store_id` na query SQL inicial. O filtro de pertença à loja é feito via JavaScript no cliente (`.filter(...)`). Em bases com milhares de produtos, isso causará latência severa, alto consumo de memória e transferência de dados desnecessária.
* **Afetados:** `src/services/products.service.ts` (Função `getAll`).
* **Sugestão de Correção:** Criar uma RPC paginada no banco ou filtrar diretamente no Supabase Query Builder via `store_inventory.store_id.eq.storeId`.

#### 2. Ausência de Escopo `store_id` em Operações de Escrita no Frontend (Risco BOLA/IDOR Defensivo)
* **Descrição:** Funções de atualização e remoção como `CustomersService.update(uuid, ...)`, `CustomersService.remove(uuid)`, `ProductsService.remove(uuid)` e `SuppliersService.update(uuid, ...)` realizam updates filtrando apenas `.eq('id', uuid)`. Embora as políticas RLS no Supabase restrinjam o acesso por tenant no banco, a camada de serviço no frontend deve praticar defesa em profundidade incluindo `.eq('store_id', storeId)`.
* **Afetados:**
  * `src/services/customers.service.ts`
  * `src/services/products.service.ts`
  * `src/services/suppliers.service.ts`
* **Sugestão de Correção:** Exigir `storeId` obrigatoriamente e encadear `.eq('store_id', storeId)` em todas as queries de mutação.

---

### 🟡 MÉDIO (MEDIUM)

#### 1. Parâmetro Opcional de `storeId` em `SalesService.getMovements`
* **Descrição:** A função `SalesService.getMovements(storeId?: string, period?: ...)` aceita `storeId` opcional. Se for invocada sem o ID da loja, a query consulta a tabela `sales` sem restrição de loja.
* **Afetados:** `src/services/sales.service.ts` (Função `getMovements`).
* **Sugestão de Correção:** Tornar `storeId` um parâmetro obrigatório (`storeId: string`).

#### 2. Assinatura de `CustomersService.create` com `storeId` Opcional
* **Descrição:** A função `CustomersService.create(customer, storeId?: string)` permite a passagem de `storeId` como opcional. Como a coluna `store_id` é `NOT NULL` no banco, chamadas sem `storeId` falham em tempo de execução.
* **Afetados:** `src/services/customers.service.ts` (Função `create`).
* **Sugestão de Correção:** Exigir `storeId: string` como parâmetro obrigatório no cabeçalho do método.

---

### 🟢 BAIXO (LOW)

#### 1. Avisos de Linter e Dependências Faltantes em Hooks React
* **Descrição:** O linter apontou avisos sobre variáveis/ícones não utilizados e dependências omitidas em `useEffect` (ex.: `RevenueChart.tsx`, `TopProductsChart.tsx`, `FinanceView.tsx`, `PdvView.tsx`).
* **Afetados:**
  * `src/components/dashboard/DashboardView.tsx`
  * `src/components/dashboard/RevenueChart.tsx`
  * `src/components/dashboard/TopProductsChart.tsx`
  * `src/components/finance/FinanceView.tsx`
  * `src/components/pdv/PdvView.tsx`
* **Sugestão de Correção:** Limpar os imports/variáveis mortas e ajustar as dependências dos hooks React com `useCallback` ou ajustes no array de dependências.

#### 2. Manutenção de Fallbacks JS Legados em Serviços
* **Descrição:** Métodos como `getLegacyAll` e `legacyFilter` em `CustomersService` e `FinanceService` servem como fallback para bancos que não possuem as novas RPCs paginadas. À medida que o ambiente é consolidado, esse código morto deve ser deprecado para simplificar a manutenção.
* **Afetados:** `src/services/customers.service.ts`, `src/services/finance.service.ts`.
* **Sugestão de Correção:** Planejar remoção dos fallbacks assim que a versão mínima do banco for garantida.

---

## 3. Conclusão e Próximos Passos

O CoreSys encontra-se em estado estável quanto às regras críticas de negócio e segurança de banco de dados no Supabase. Para manter o padrão de excelência:
1. Recomenda-se priorizar a refatoração de `ProductsService.getAll` para paginação no banco.
2. Reforçar o parâmetro `storeId` obrigatório em todos os métodos de serviços no frontend.
3. Executar limpeza de avisos do ESLint para manter o build limpo.
