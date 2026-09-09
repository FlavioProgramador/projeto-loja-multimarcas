# 🛍️ Vestra - Sistema PDV & ERP para Lojas Multimarcas

Um sistema completo de Ponto de Venda (PDV) e Gestão Empresarial (ERP) moderno, desenvolvido com React, TypeScript, Vite e Supabase. O projeto foi projetado para ser rápido, bonito e fácil de usar, com foco na experiência do lojista e do cliente.

## 🚀 Funcionalidades

- **Ponto de Venda (PDV) Moderno**:
  - Interface ágil para fechamento de vendas.
  - Formas de pagamento integradas (Cartão de Crédito, Cartão de Débito, Dinheiro).
  - Integração de pagamento via PIX (Mercado Pago).
  - Impressão automática de recibo/cupom não fiscal com opções de compartilhamento (WhatsApp/PDF).
  - Controle e baixa instantânea de estoque.

- **Gestão de Estoque (Inventário)**:
  - Cadastro de produtos com variações (Tamanho, Cor).
  - Registro de movimentos de entrada e saída.
  - Alertas visuais de estoque baixo.

- **Gestão de Clientes e Fornecedores**:
  - CRM embutido para cadastro e histórico de clientes.
  - Cadastro de fornecedores e controle de informações.

- **Gestão Financeira**:
  - Fluxo de caixa diário/mensal (Entradas e Saídas).
  - Gráficos de receita e faturamento.
  - Relatórios de vendas e produtos mais vendidos (Top Products).

- **Gestão de Acesso (Auth)**:
  - Sistema de Login seguro via Supabase Auth.
  - Gestão de diferentes papéis e permissões (Caixa, Gerente).

## 💻 Tecnologias Utilizadas

**Frontend:**
- [React](https://reactjs.org/) + [Vite](https://vitejs.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- UI construída com componentes customizados em CSS puro moderno, com animações suaves e design "premium"
- [Lucide Icons](https://lucide.dev/) (Ícones)
- [Recharts](https://recharts.org/) (Gráficos)
- [date-fns](https://date-fns.org/) (Manipulação de Datas)

**Backend / Infraestrutura:**
- [Supabase](https://supabase.com/) (PostgreSQL, Auth, Edge Functions)
- RPCs (Remote Procedure Calls) no PostgreSQL para transações críticas atômicas (como vendas no PDV)
- [Mercado Pago](https://www.mercadopago.com.br/) (Integração para pagamentos via PIX)

## 🛠️ Como executar localmente

1. **Clone o repositório:**
```bash
git clone https://github.com/FlavioProgramador/projeto-loja-multimarcas.git
cd projeto-loja-multimarcas
```

2. **Instale as dependências:**
```bash
npm install
```

3. **Configure as Variáveis de Ambiente:**
Crie ou configure o arquivo `.env.development` baseado no template (não versione valores reais):
```env
VITE_SUPABASE_URL=sua_url_do_supabase_dev
VITE_SUPABASE_ANON_KEY=sua_anon_key_do_supabase_dev
```

4. **Inicie o servidor de desenvolvimento:**
```bash
npm run dev
```

## 🏗️ Arquitetura de Ambientes e Git Flow

O VESTRA utiliza uma arquitetura profissional de 3 ambientes separados para garantir segurança e estabilidade, operando em um **único repositório GitHub**.

### Projetos Supabase Independentes
- **VESTRA_DEV**: Ambiente de desenvolvimento (dados fictícios). *(Este projeto será criado)*
- **VESTRA_HOMOLOGACAO**: Ambiente de testes/staging (dados fictícios, mesma estrutura da produção). *(Já existente)*
- **VESTRA_PRODUCAO**: Ambiente real (dados sensíveis, nunca executar testes aqui). *(Já existente)*

> **Atenção:** Existe um projeto atual (Ref: `ndrjynlbwrugakjqtzwy`) configurado no arquivo `.env`. Antes de configurá-lo como DEV ou PRODUÇÃO, **NÃO execute comandos destrutivos**. Verifique se este projeto contém dados reais. Ele não será resetado nem modificado automaticamente nesta fase.

### Estrutura de Branches (Git Flow)
- `feature/*` → Funcionalidades criadas a partir da `develop`.
- `develop` → Branch de **Desenvolvimento** (Deploy para VESTRA_DEV).
- `main` → Branch de **Produção** (Deploy para VESTRA_PRODUCAO).

**Fluxo Esperado:**
`feature` → `develop` (DEV) → (Release/PR) → `staging` (HOMOLOGAÇÃO) → `main` (PRODUÇÃO).

## 📦 Banco de Dados (Supabase CLI e Migrations)

A infraestrutura do banco de dados (tabelas, RLS, RPCs) é gerenciada via **Supabase CLI** e versionada na pasta `supabase/migrations`.
- **Nunca edite o banco de produção manualmente.**
- **Nunca edite migrations históricas já aplicadas.** Crie sempre uma nova migration.

### Comandos Úteis (CLI)
- Iniciar Supabase CLI local: `npx supabase init`
- Linkar a um projeto: `npx supabase link --project-ref [ID_DO_PROJETO]`
- Aplicar migrations pendentes: `npx supabase db push` (Sempre confirme o ambiente antes!)

## 🔒 Edge Functions e Segurança
As funções como `mp-webhook` e `create-mp-pix` residem em `supabase/functions/`.
- Os _secrets_ (como `MERCADOPAGO_ACCESS_TOKEN`) devem ser injetados **diretamente no painel de cada projeto Supabase** via CLI (`supabase secrets set`), e NUNCA devem ser colocados no `.env` do frontend ou versionados no Git.
- O Frontend possui apenas credenciais públicas (`ANON_KEY`).

## 📝 Licença

Desenvolvido para lojas de moda e multimarcas. Reservados todos os direitos ou conforme acordo com o cliente.
