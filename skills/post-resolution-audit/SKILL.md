---
name: post-resolution-audit
description: Faça uma revisão cruzada após várias correções, buscando regressões entre tickets, duplicações e mudanças acidentais.
stage: verification
---

# Pós-auditoria da rodada

Use depois de uma rodada com várias resoluções. Revise o conjunto completo de mudanças, não apenas cada ticket isolado. Relacione arquivos compartilhados, contratos alterados e testes que exercitam mais de uma correção.

Procure regressões cruzadas, soluções duplicadas, comportamentos inconsistentes, migrações incompletas, dead code, mudanças de configuração e efeitos de ordem. Confirme que cada correção ainda tem um teste que falharia sem ela e que nenhum teste foi enfraquecido para passar.

Execute a suíte adequada em estado limpo e reporte achados por severidade. Se não houver defeitos, registre o alcance real da revisão e o que não pôde ser verificado. Não transforme esta etapa em refatoração geral.
