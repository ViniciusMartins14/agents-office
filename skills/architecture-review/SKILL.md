---
name: architecture-review
description: Avalie limites, dependências e fluxo de dados da arquitetura antes de propor mudanças estruturais incrementais.
stage: intake
---

# Revisão de arquitetura

Mapeie componentes, responsabilidades, dependências, persistência, processos externos e fronteiras de confiança. Use o código em execução como fonte principal; diagramas e documentação podem estar desatualizados.

Identifique acoplamento que produz defeitos observáveis, ciclos, duplicação de política, estado sem dono e APIs que vazam detalhes internos. Não trate preferência estética como problema arquitetural. Para cada achado, mostre evidência e consequência operacional.

Proponha uma sequência incremental com compatibilidade, migração, testes e ponto de reversão. Evite reescritas totais e novas camadas sem consumidor concreto. Se a arquitetura atual atende aos requisitos, diga isso claramente.
