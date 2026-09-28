---
name: github-resolution
description: Resolva uma issue ou PR já auditado, um por vez, começando por teste de regressão e terminando com verificação completa.
stage: resolution
---

# Resolução de ticket aprovado

Só prossiga quando houver um problema confirmado, critérios de aceitação e evidência suficiente. Trabalhe em um ticket por vez. Reproduza o defeito localmente e, quando viável, escreva primeiro um teste que falhe pelo motivo correto.

Implemente a menor mudança que trate a causa. Não faça refatorações oportunistas, novas abstrações especulativas ou alterações cosméticas sem relação. Preserve compatibilidade e convenções do projeto.

Execute o teste de regressão, os testes diretamente afetados e a verificação mais ampla proporcional ao risco. Revise o diff final em busca de arquivos gerados, segredos e mudanças acidentais. Prepare um resumo ligando problema, evidência, teste e correção. Não faça merge, push, comentários ou fechamento remoto sem autorização explícita.
