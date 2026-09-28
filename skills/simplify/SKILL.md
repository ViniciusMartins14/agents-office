---
name: simplify
description: Simplifique código alterado recentemente sem mudar comportamento, reduzindo duplicação e complexidade comprovadas.
stage: improvement
---

# Simplificação controlada

Restrinja-se ao código alterado ou diretamente relacionado ao pedido. Preserve comportamento público, contratos, mensagens relevantes e cobertura. Antes de editar, identifique a complexidade concreta: duplicação, fluxo difícil de seguir, nomes enganosos ou abstração que não paga seu custo.

Faça mudanças pequenas e legíveis. Não compacte código apenas para reduzir linhas, não introduza framework ou padrão por gosto e não misture redesign. Execute os testes que demonstram equivalência e revise o diff para garantir que nenhuma funcionalidade nova entrou escondida.

Explique brevemente o que ficou mais simples e qual evidência protege o comportamento.
