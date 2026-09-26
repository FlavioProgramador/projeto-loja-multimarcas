# Auditoria Visual e Contraste — CoreSys

Data: 2026-09-25

## Objetivo

Corrigir problemas de legibilidade e contraste no sistema sem alterar a identidade visual CoreSys nem a lógica de negócio.

## Principais problemas identificados

- Regras globais antigas no `src/index.css` podiam forçar `background: #fff` e `color: #000` em áreas do sistema.
- O módulo de estoque possuía tokens próprios claros que conflitavam com o tema escuro global.
- Alguns gráficos utilizavam cores hardcoded para tooltip e bordas.
- O cabeçalho possuía referências a tokens antigos de background/border/texto no seletor de loja.
- Inputs, selects e options precisavam de regras explícitas para o tema escuro.
- Havia várias cores hardcoded legítimas para impressão, overlays ou estados, que foram avaliadas individualmente.

## Correções

- Reforço dos design tokens globais para foreground, surfaces, inputs e estados semânticos.
- Correção de foreground de botões de sucesso/perigo.
- Garantia de contraste para inputs, selects, options, placeholders e estados disabled.
- Correção dos tokens de cor do estoque para utilizar a linguagem visual CoreSys.
- Ajuste dos tooltips de gráficos.
- Correção do seletor de loja do Header.
- Criação de `src/contrast-audit.css` como camada global de proteção de contraste.
- Carregamento dessa camada no `main.tsx`.
- Correção de uma regra global antiga que poderia produzir texto preto em áreas claras/escuras de forma inconsistente.

## Critério adotado

Não foi feita substituição cega de todas as ocorrências de preto/branco. Elementos como impressão térmica, overlays e foreground de CTAs foram avaliados pelo contexto.

## Validação

GitHub Actions:
- `npm ci`: aprovado
- `npm run typecheck`: aprovado
- `npm run build`: aprovado

A pipeline foi executada em uma branch isolada de auditoria visual.

## Commits

- fix(ui): corrigir tokens globais de contraste
- fix(ui): adaptar estoque ao tema CoreSys
- fix(ui): corrigir contraste do grafico de faturamento
- fix(ui): corrigir contraste do ranking de produtos
- fix(ui): corrigir contraste do PDV
- fix(ui): corrigir contraste do dashboard
- fix(ui): corrigir controles e selecao da loja
- fix(ui): criar camada global de seguranca de contraste
- fix(ui): aplicar protecao global de contraste
- fix(ui): remover regra global incompatível de contraste
- fix(ui): reforcar contraste no tema de referencia
- ci(ui): adicionar validacao visual com typecheck e build

## Observação

A auditoria visual foi direcionada para o problema demonstrado nas telas: texto, ícones e controles que não ficam visíveis por conflito entre background e foreground ou por estilos antigos.
