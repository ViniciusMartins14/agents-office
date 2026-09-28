---
name: dependency-bump
description: Agrupe atualizações rotineiras de dependência com verificação de supply chain, compatibilidade, lockfile e testes.
stage: resolution
---

# Atualização segura de dependências

Inventarie os bumps pedidos e confirme pacote, origem, versão atual, versão alvo e tipo de mudança. Verifique nomes parecidos, troca de mantenedor ou registry, scripts de instalação, artefatos inesperados e alterações de licença. Qualquer sinal estranho deve interromper o caminho rápido e virar auditoria completa.

Atualize manifestos e lockfiles usando o gerenciador oficial do projeto, sem editar lockfile manualmente. Agrupe apenas bumps independentes que possam ser validados juntos. Leia notas de breaking changes quando houver salto relevante.

Execute instalação reproduzível, testes, lint, build e verificações de segurança disponíveis. Relate cada versão alterada e qualquer migração necessária. Não publique nem aceite automaticamente alertas do bot como prova de segurança.
