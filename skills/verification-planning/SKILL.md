---
name: verification-planning
description: Planeje verificações observáveis antes da implementação, cobrindo riscos, invariantes, plataformas e critérios de conclusão.
stage: verification
---

# Planejamento de verificação

Converta requisitos em afirmações observáveis. Para cada uma, defina evidência esperada, teste ou inspeção adequada e o risco de falso positivo. Priorize caminhos críticos, fronteiras de confiança, persistência, concorrência, recuperação de falhas e diferenças entre Windows, macOS e Linux quando relevantes.

Separe testes unitários, integração, ponta a ponta, inspeção visual e validação manual. Identifique fixtures, dados sintéticos e dependências externas necessárias. Não proponha mocks onde a integração real é justamente o que precisa ser provado.

Entregue uma matriz curta de requisito, risco, método e critério de aprovação. Aponte limitações e custos antes da implementação para que o plano possa ser ajustado.
