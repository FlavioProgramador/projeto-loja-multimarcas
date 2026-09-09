# VESTRA ERP/PDV - Security Guidelines & Threat Model

Este documento descreve o modelo de segurança, permissões e práticas implementadas no VESTRA ERP/PDV.

## 1. Modelo de Ameaça (Threat Model)

O sistema lida com dados financeiros, estoque e pagamentos. Os principais vetores de ataque incluem:
- **Acesso Anônimo a RPCs:** Mitigado revogando `PUBLIC EXECUTE` e exigindo `auth.uid() IS NOT NULL`.
- **Escalonamento de Privilégios (Privilege Escalation):** Usuários comuns tentando alterar seu `role` para `ADMIN`. Mitigado via trigger `trg_protect_profile_role`.
- **Geração de PIX Falsos / Travamento de Estoque:** Atacantes criando pedidos falsos. Mitigado exigindo `verify_jwt = true` na Edge Function `create-mp-pix`.
- **Acesso Transversal a Dados:** Mitigado via políticas restritivas de RLS (Row Level Security).
- **Webhooks Maliciosos:** Mitigado pela validação direta na API oficial do provedor (Mercado Pago / Stripe).

## 2. Matriz de Permissões (RBAC)

O controle de acesso é baseado no banco de dados, não no frontend.

| Módulo/Tabela        | ADMIN | MANAGER | CASHIER | EMPLOYEE |
|----------------------|-------|---------|---------|----------|
| **Vendas (PDV)**     | CRUD  | CRUD    | C, R    | -        |
| **Estoque**          | CRUD  | CRUD    | R       | -        |
| **Produtos**         | CRUD  | CRUD    | R       | R        |
| **Financeiro**       | CRUD  | CRU     | R       | -        |
| **Fornecedores**     | CRUD  | CRUD    | -       | -        |
| **Clientes**         | CRUD  | CRUD    | C, R    | C, R     |
| **Usuários (Roles)** | CRUD  | -       | -       | -        |

- **ADMIN:** Controle total. Único papel autorizado a alterar *roles* de usuários e deletar transações financeiras.
- **MANAGER:** Gerencia operações e produtos, mas não pode gerenciar permissões.
- **CASHIER:** Registra vendas, clientes e visualiza o estoque disponível.
- **EMPLOYEE:** Acesso mínimo.

## 3. Row Level Security (RLS)

O sistema emprega políticas restritas:
- **Redundâncias Eliminadas:** Políticas `FOR ALL` genéricas que geravam sobreposição e ineficiência foram substituídas por `FOR INSERT`, `FOR UPDATE` e `FOR DELETE`.
- **Controle de Perfil:** A alteração da própria conta é permitida usando `(select auth.uid())`, melhorando a performance ao evitar chamadas excessivas a funções auxiliares.
- **Funções `SECURITY DEFINER`:** Funções críticas (`complete_sale`, `cancel_mp_pix_sale`) contam com validação rígida da identidade e papel, impedindo execuções não autorizadas mesmo se as permissões de tabela falharem.

## 4. Gestão de Secrets e Edge Functions

- **Nunca expor chaves:** `SUPABASE_SERVICE_ROLE_KEY`, tokens do Mercado Pago e Stripe Secrets NUNCA devem estar prefixados com `NEXT_PUBLIC_` ou `VITE_`.
- **Integração MP:** A Edge Function `create-mp-pix` exige token JWT válido para iniciar qualquer processo. A `mp-webhook` processa pagamentos utilizando Bypass RLS de forma segura, com validação de status no lado do provedor.
- **CORS:** Restrito em produção substituindo `*` pelo domínio real no painel do Supabase / variáveis de ambiente.

## 5. Resposta Básica a Incidentes (Incident Response)

1. **Vazamento de Secret do MP/Stripe:** Revogar o token imediatamente no painel do provedor e atualizar o `.env` das Edge Functions (`supabase secrets set`).
2. **Acesso Indevido Identificado:**
   - Bloquear o usuário na tabela `profiles` (`is_active = false`) ou via Dashboard do Supabase Auth.
   - Suspender chaves JWT atuais.
3. **Falha Crítica de Venda/Estoque:** Acionar o bloqueio temporário do Frontend. Reverter o banco para um snapshot Point-in-Time Recovery (PITR) se houver corrupção lógica de estoque.

## 6. Recomendações de Produção e Privacidade (LGPD)

- **Minimização:** Colete CPF e telefones apenas se necessário para NF-e/Garantia.
- **Máscaras de Log:** Não envie objetos inteiros de clientes para os logs das Edge Functions.
- **Senhas:** Ativar proteção contra "senhas fracas" e "senhas comprometidas" na configuração do Supabase Auth.
- **Índices de Performance:** Os índices Foreign Key foram criados. Monitore *Slow Queries* no Supabase periodicamente.
