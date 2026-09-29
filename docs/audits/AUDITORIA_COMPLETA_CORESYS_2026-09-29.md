# Auditoria Completa — CoreSys

**Data:** 29/09/2026  
**Escopo:** Frontend React/TypeScript + repositório GitHub + Supabase/PostgreSQL + Edge Functions/configuração + validação local  
**Repositório:** `FlavioProgramador/projeto-loja-multimarcas`  
**Projeto Supabase:** `ndrjynlbwrugakjqtzwy`  
**Diretório local:** `D:\Projetos\vestra`  
**Commit auditado:** `71be81a50a572bec2c8d5e7c2b01eb4aa626d16c`

## 1. Resumo executivo

O CoreSys apresenta uma arquitetura funcional e já possui uma camada relevante de segurança no PostgreSQL, principalmente RLS, isolamento por loja, RPCs transacionais e idempotência para operações críticas.

Entretanto, **o sistema ainda não deve ser considerado pronto para produção sem uma rodada adicional de hardening**. Foram encontrados problemas concretos no frontend e no backend, sendo os mais importantes:

- falha de TypeScript em `StoreContext.tsx`;
- ausência de testes automatizados reais;
- 3 vulnerabilidades moderadas reportadas pelo `npm audit`;
- sobrecarga legada de `complete_sale` ainda executável e sem isolamento por loja;
- RPCs legadas de relatórios ainda executáveis e capazes de consultar dados agregados sem filtro por loja;
- 18 funções `SECURITY DEFINER` expostas a `authenticated`, exigindo revisão individual de superfície de ataque;
- proteção contra senhas vazadas desabilitada no Supabase Auth;
- `sale_idempotency` com RLS sem policy, aparentemente intencional, mas que deve ser documentado/testado;
- forte dependência de `localStorage` no `StoreContext`, criando duplicidade entre estado local e fonte de verdade do banco;
- bundle JavaScript de produção com ~819 kB antes de gzip;
- branch `main` sem proteção/required status checks.

**Classificação geral:** `ATENÇÃO — precisa de correções antes de produção plena`.

## 2. Evidências da auditoria

A cópia local está no commit `71be81a50a572bec2c8d5e7c2b01eb4aa626d16c`, o mesmo SHA atualmente apontado pela branch `main` no GitHub.

O diretório local contém migrations, Edge Functions, testes SQL, documentação de auditoria, workflows de CI/CD e o código React/TypeScript.

O working tree possui alterações não commitadas:
- `supabase/config.toml` modificado;
- `audit-npm.json` não rastreado;
- `docs/audits/AUDITORIA_QUALIDADE_DEVOPS.md` não rastreado;
- `supabase/.temp/` não rastreado.

Esses itens devem ser revisados antes de um commit de produção.

## 3. Validação do frontend

### 3.1 TypeScript — FALHA

`npm run typecheck` falha atualmente com:

`src/contexts/StoreContext.tsx(372,37): error TS2339: Property 'custo' does not exist on type 'Omit<Product, "id">'.`

A causa é objetiva: o fluxo de criação de produto usa `prodData.custo`, mas a interface `Product` em `src/types.ts` não declara a propriedade `custo`.

**Impacto:** o código não passa pelo typecheck oficial e existe divergência entre o modelo de domínio e o uso real no contexto.

**Prioridade:** P0.

### 3.2 Build — PASSA COM ALERTA

`npm run build` conclui com sucesso.

Resultado observado:
- 1781 módulos transformados;
- bundle JS: aproximadamente 818,79 kB minificado;
- gzip: aproximadamente 233,33 kB;
- CSS: aproximadamente 60,47 kB;
- Vite alerta chunk acima de 500 kB.

**Recomendação:** aplicar code splitting por rota/módulo e lazy loading de áreas pesadas, especialmente dashboard, relatórios, PDV e gráficos.

### 3.3 Testes — INSUFICIENTES

O script `npm test` não executa testes. O `package.json` contém apenas:

`echo "Testes automatizados ainda não configurados"`

Isso significa que não existe uma barreira automatizada real contra regressões.

**Prioridade:** P0/P1.

## 4. Dependências

`npm audit` encontrou **3 vulnerabilidades moderadas**, todas relacionadas à cadeia `qs`/`body-parser`/`express`.

Principais pontos:
- `express@4.22.2` aparece como dependência direta afetada;
- `body-parser` aparece transitivamente;
- `qs` possui advisories relacionados a parsing e potencial DoS;
- existe correção disponível.

**Prioridade:** P1.

Além disso, o `package.json` ainda declara versões com ranges amplos (`^`), enquanto o ambiente local possui versões efetivamente mais recentes no lockfile. O lockfile deve ser tratado como fonte de reprodução e atualizado conscientemente após a correção.

## 5. Arquitetura frontend

O `StoreContext` concentra uma quantidade elevada de responsabilidades: produtos, clientes, fornecedores, vendas, devoluções, finanças, movimentações, notificações, sincronização e cache.

Isso aumenta:
- acoplamento;
- quantidade de renders potencialmente desnecessários;
- dificuldade de teste;
- risco de inconsistência entre estado local e servidor;
- custo de manutenção.

Recomendação arquitetural: separar por domínio e migrar gradualmente para services/hooks especializados, mantendo o contexto apenas para estado global realmente compartilhado.

## 6. Persistência local e fonte de verdade

O `StoreContext` persiste diversas coleções em `localStorage`, incluindo produtos, transações, movimentações, clientes, devoluções, fornecedores, despesas fixas e notificações.

Isso é aceitável como cache/fallback controlado, mas é perigoso se o usuário interpretar o estado local como fonte oficial do ERP.

O risco aumenta em cenários:
- troca de usuário no mesmo navegador;
- troca de loja ativa;
- duas abas abertas;
- alterações concorrentes;
- falha parcial de sincronização;
- dados antigos após mudança no banco.

Recomendação: Supabase deve ser a fonte de verdade; `localStorage` deve guardar somente preferências, cache explicitamente versionado e dados não críticos.

## 7. Multi-tenant / multi-loja

A arquitetura atual já possui os principais componentes necessários:
- `stores`;
- `user_store_access`;
- `store_inventory`;
- `store_id` em entidades transacionais;
- helpers de acesso à loja;
- RLS por loja;
- RPCs com `p_store_id`.

Isso representa uma evolução importante e torna o desenho adequado para SaaS multi-loja.

Porém, o isolamento ainda é inconsistente nas funções legadas. O principal risco é a coexistência de versões antigas e novas das RPCs.

**Conclusão:** o modelo multi-tenant existe, mas ainda há dívida de compatibilidade que precisa ser eliminada.

## 8. RLS

As tabelas públicas auditadas estão com RLS habilitado e existem policies para os principais domínios.

Há policies específicas para:
- produtos;
- variantes;
- clientes;
- fornecedores;
- vendas;
- itens de venda;
- estoque por loja;
- movimentações;
- financeiro;
- devoluções;
- inventário físico;
- lojas;
- acesso usuário/loja.

### Achado

`public.sale_idempotency` possui RLS habilitado, mas nenhuma policy.

O advisor do Supabase classifica isso como `INFO`. O desenho pode ser intencional porque a tabela é utilizada pelas RPCs `SECURITY DEFINER`, mas deve existir teste explícito garantindo que o cliente nunca consiga ler/escrever diretamente nessa tabela.

**Prioridade:** P1 para documentação/teste; não necessariamente para criação de policy.

## 9. SECURITY DEFINER

O banco possui **18 funções `SECURITY DEFINER` executáveis por `authenticated`**.

Esse padrão pode ser legítimo para operações transacionais, mas transforma cada função em uma fronteira de segurança.

Funções relevantes incluem:
- `complete_sale`;
- `create_mp_pix_sale`;
- `cancel_sale`;
- `process_return`;
- `register_stock_entry`;
- `manage_product`;
- `approve_physical_inventory`;
- funções de relatórios;
- helpers de autorização;
- administração de acesso de usuários.

A recomendação não é simplesmente remover `SECURITY DEFINER`. É necessário verificar autenticação, papel, loja, argumentos, `search_path`, invariantes e escopo de dados em cada RPC.

## 10. Achado crítico — complete_sale legado

Ainda existe a sobrecarga:

`complete_sale(uuid,text,text,jsonb,text,integer,numeric,numeric,text)`

Ela continua executável por `authenticated` e apresenta problemas importantes:

- não recebe `p_store_id`;
- não grava `store_id` na venda;
- usa `unit_price` enviado pelo cliente;
- usa `product_id` e dados textuais enviados pelo cliente;
- opera sobre `product_variants.stock_quantity` global;
- grava movimentação sem `store_id`.

Existe também a versão nova, que recebe `p_store_id`, valida acesso à loja, utiliza o preço oficial do produto e controla idempotência.

**Risco:** um cliente autenticado que consiga chamar explicitamente a assinatura antiga pode contornar parte das garantias do novo modelo multi-loja.

**Prioridade:** P0.

**Ação recomendada:** revogar `EXECUTE` da assinatura antiga e, após confirmação de inexistência de consumidores, removê-la em migration posterior.

## 11. Relatórios legados sem isolamento

As versões sem `p_store_id` das funções abaixo ainda existem e são `SECURITY DEFINER`:

- `report_stock_status()`;
- `report_top_selling_products(integer)`;
- `report_inventory_movements_summary(timestamptz,timestamptz)`;
- `get_profitability_by_product(date,date)`;
- `get_profitability_by_category(date,date)`.

Essas implementações consultam dados sem filtro explícito por loja.

Mesmo que a UI utilize as versões novas, as assinaturas antigas permanecem uma superfície de acesso indevida.

**Prioridade:** P0.

## 12. RPCs modernas

As versões modernas demonstram evolução correta:
- exigem usuário autenticado e perfil ativo;
- validam loja ativa;
- usam `has_store_access`/`get_user_store_role`;
- aplicam `store_id` às consultas;
- usam locks em operações críticas;
- usam idempotência em vendas;
- calculam preço a partir do banco em `complete_sale`;
- registram movimentações de estoque;
- atualizam estoque agregado.

O padrão deve ser consolidado e aplicado a todas as funções públicas.

## 13. Idempotência

A nova `complete_sale` e `create_mp_pix_sale` utilizam chave de idempotência e lock transacional com `pg_advisory_xact_lock`.

Isso é uma boa decisão para evitar vendas duplicadas em retries.

No frontend, `SalesService` também mantém um mapa temporário de chaves pendentes.

A proteção real, entretanto, deve continuar sendo a do banco, pois memória do navegador não sobrevive a reload, crash, múltiplas abas ou múltiplos dispositivos.

## 14. Devoluções

`process_return` apresenta bom nível de integridade transacional:
- exige loja;
- verifica acesso;
- exige venda original;
- exige venda concluída;
- valida que a variante pertence à venda;
- calcula quantidade ainda disponível para devolução;
- atualiza estoque por loja;
- registra `RETURN` em movimentações;
- atualiza estoque agregado;
- cria crédito/vale ou estorno financeiro.

Este é um dos pontos mais maduros do backend.

Recomendação: adicionar testes de concorrência e casos de devolução parcial/duplicada.

## 15. Inventário físico

`approve_physical_inventory` apresenta controles importantes:
- `p_user_id` precisa corresponder a `auth.uid()`;
- perfil precisa estar ativo;
- loja precisa estar ativa;
- papel precisa ser `ADMIN` ou `MANAGER`;
- inventário precisa estar em estado permitido;
- itens precisam ser válidos;
- alterações são feitas com locks;
- divergências geram movimentação de ajuste.

Esse fluxo deve receber testes SQL de autorização negativa e concorrência.

## 16. Auth

O Supabase Auth está operacional, mas o advisor atual acusa:

**Leaked Password Protection Disabled.**

Isso significa que senhas comprometidas em bases públicas de vazamento não estão sendo bloqueadas automaticamente.

**Prioridade:** P1.

Também é recomendável garantir políticas de senha, confirmação de e-mail, recuperação de conta e expiração/rotação de sessão de acordo com o nível de risco do SaaS.

## 17. Edge Functions

Estado observado anteriormente no projeto:
- `create-mp-pix`: `verify_jwt=true`;
- `mp-webhook`: `verify_jwt=false`;
- funções Stripe: `verify_jwt=false`.

Para webhooks, `verify_jwt=false` pode ser correto porque o provedor não possui JWT do Supabase. Nesse caso, a função precisa validar obrigatoriamente a assinatura/autenticidade do provedor e implementar proteção contra replay.

A proteção de replay do Mercado Pago já possui migration dedicada no repositório.

As funções Stripe devem ser tratadas como endpoints públicos autenticados pelo mecanismo específico do Stripe, nunca como endpoints públicos sem validação.

## 18. Search path

As funções próprias auditadas possuem `search_path` fixado, o que é positivo.

O advisor ainda acusa três funções do schema gerenciado `stripe`:
- `stripe.set_updated_at`;
- `stripe.set_updated_at_metadata`;
- `stripe.check_rate_limit`.

Essas funções pertencem à infraestrutura gerenciada e não devem ser modificadas sem suporte explícito do produto.

## 19. Performance do banco

O advisor de performance acusa 1 foreign key sem índice no schema gerenciado `stripe` e 51 índices não utilizados.

Há índices não utilizados também em tabelas públicas, como:
- `products`;
- `product_variants`;
- `sales`;
- `sale_items`;
- `inventory_movements`;
- `returns`;
- `physical_inventories`;
- `user_store_access`.

**Não remover automaticamente.** A ausência de uso no período observado não significa que o índice seja inútil em produção. A decisão deve considerar volume, planos de consulta e carga real.

## 20. GitHub / CI/CD

A branch `main` está sem proteção e sem required status checks.

O workflow de produção executa:
- checkout;
- Node 20;
- `npm ci`;
- `npm run typecheck`;
- `npm run build`.

O deploy de produção ainda aparece como estrutura preparada, não como pipeline de publicação completo.

Recomendação:
1. proteger `main`;
2. exigir CI verde antes de merge;
3. exigir revisão para mudanças de banco;
4. separar deploy de frontend e migrations;
5. impedir migration destrutiva direta em produção sem aprovação.

## 21. Integridade de migrations

O repositório possui uma sequência extensa de migrations de hardening entre agosto e setembro de 2026.

Isso demonstra evolução contínua, mas aumenta o risco de:
- funções sobrecarregadas legadas permanecerem vivas;
- grants antigos permanecerem ativos;
- `setup.sql` divergir do estado real;
- migrations corretivas se acumularem sem limpeza de compatibilidade.

Recomendação: manter uma matriz `estado atual do banco × migration × função × grant × consumer frontend`.

## 22. Histórico de estoque

A documentação anterior registra 18 movimentações históricas com `store_id = NULL` que não puderam ser corrigidas sem violar o mecanismo de imutabilidade.

A decisão de não desativar o trigger para alterar o histórico foi correta.

Esse legado deve permanecer explicitamente documentado e não pode contaminar consultas multi-loja atuais.

## 23. Segurança de configuração local

O `.env` local contém URL e chave pública anon do Supabase. O arquivo está coberto pelo `.gitignore` através de `.env*`.

A chave anon não é equivalente à service role key e pode existir no frontend. O ponto crítico é garantir que nenhuma `service_role` ou segredo de provedor seja incorporado ao bundle ou commitado.

## 24. Qualidade de código

Pontos positivos:
- TypeScript;
- services por domínio;
- contexto de autenticação separado;
- Supabase centralizado;
- validações explícitas;
- tratamento de erros;
- arquitetura orientada a RPC para operações transacionais.

Pontos a melhorar:
- `StoreContext` excessivamente grande;
- modelos duplicados entre UI e banco;
- dependência de `localStorage` como fallback amplo;
- testes insuficientes;
- código legado coexistindo com novo fluxo;
- necessidade de tipagem gerada do Supabase como fonte única para entidades persistidas.

## 25. Matriz de severidade

| ID | Achado | Severidade | Prioridade |
|---|---|---|---|
| C-01 | `complete_sale` legado executável | Crítica | P0 |
| C-02 | RPCs legadas de relatório sem filtro de loja | Crítica | P0 |
| C-03 | TypeScript quebrado | Alta | P0 |
| C-04 | Ausência de testes reais | Alta | P0/P1 |
| C-05 | 3 vulnerabilidades npm moderadas | Alta | P1 |
| C-06 | Leaked Password Protection desativado | Média/Alta | P1 |
| C-07 | 18 SECURITY DEFINER expostas | Média | P1 |
| C-08 | `sale_idempotency` sem policy | Baixa/Média | P1 |
| C-09 | localStorage amplo no StoreContext | Média | P1/P2 |
| C-10 | Bundle JS > 800 kB | Média | P2 |
| C-11 | main sem branch protection | Média | P1 |
| C-12 | Índices não utilizados | Baixa | P2 |

## 26. Plano de ação recomendado

### Fase 0 — Bloqueadores

1. Corrigir `Product.custo`/`StoreContext` e fazer `npm run typecheck` passar.
2. Revogar `EXECUTE` da sobrecarga legada de `complete_sale`.
3. Revogar `EXECUTE` das versões legadas dos relatórios.
4. Confirmar que nenhum frontend/Edge Function utiliza essas assinaturas antigas.
5. Criar testes SQL negativos para tentar acessar outra loja.

### Fase 1 — Segurança

1. Habilitar Leaked Password Protection.
2. Revisar as 18 funções `SECURITY DEFINER` individualmente.
3. Garantir `search_path` fixo em todas as funções próprias.
4. Testar `sale_idempotency` diretamente como `authenticated`.
5. Revisar assinatura/replay protection dos webhooks.
6. Atualizar dependências vulneráveis e executar `npm audit` novamente.

### Fase 2 — Qualidade

1. Adicionar Vitest/Playwright ou stack equivalente.
2. Criar testes de autenticação/RLS.
3. Criar testes de vendas concorrentes.
4. Criar testes de cancelamento/devolução.
5. Criar testes de isolamento entre duas lojas.
6. Adicionar CI obrigatório para typecheck, build e testes.

### Fase 3 — Arquitetura

1. Reduzir responsabilidades do `StoreContext`.
2. Separar hooks por domínio.
3. Limitar `localStorage` a cache/preferências.
4. Implementar invalidação de cache por `store_id` e usuário.
5. Aplicar lazy loading por rota.

### Fase 4 — Governança

1. Proteger branch `main`.
2. Exigir PR + CI verde.
3. Criar processo formal para migrations.
4. Manter changelog de schema.
5. Monitorar advisories Supabase/NPM regularmente.

## 27. Critério para considerar o CoreSys pronto

O sistema pode ser considerado pronto para produção quando, no mínimo:

- `npm run typecheck` passar sem erros;
- `npm run build` passar;
- suíte de testes automatizados estiver ativa;
- não existirem RPCs legadas perigosas executáveis por `authenticated`;
- todas as RPCs críticas estiverem isoladas por loja;
- testes negativos confirmarem impossibilidade de acesso cruzado entre lojas;
- webhooks tiverem validação criptográfica/replay protection;
- dependências vulneráveis estiverem corrigidas ou formalmente aceitas;
- Auth tiver leaked password protection habilitado;
- `main` estiver protegido;
- migrations e grants estiverem reconciliados com o estado real do Supabase.

## 28. Conclusão

O CoreSys **não está estruturalmente ruim**. Pelo contrário: a evolução recente criou uma base de backend consideravelmente mais robusta, com RLS, multi-loja, RPCs transacionais, idempotência, histórico de movimentações e controles de autorização.

O principal problema atual é a coexistência entre o modelo novo e artefatos legados ainda acessíveis. Em um SaaS multi-tenant, essa situação é especialmente perigosa porque uma única RPC antiga pode quebrar a garantia de isolamento construída pelo restante do sistema.

O maior ganho imediato será eliminar as superfícies legadas, corrigir o typecheck e estabelecer testes automatizados de isolamento multi-tenant. Depois disso, o trabalho deve migrar de correções emergenciais para maturidade operacional: CI obrigatório, observabilidade, performance, code splitting e governança de migrations.

**Parecer final:** `APROVAR PARA DESENVOLVIMENTO/QA; NÃO APROVAR AINDA PARA PRODUÇÃO MULTI-TENANT SEM A FASE 0.`
