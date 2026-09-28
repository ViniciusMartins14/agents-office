---
name: regression-fix
description: Corrija um defeito reproduzível com teste de regressão e alteração mínima dentro do escopo solicitado.
stage: resolution
---

# Correção com regressão

Reproduza o comportamento com dados controlados. Quando for viável, escreva primeiro um teste que falhe pelo motivo esperado; em seguida aplique a menor correção que resolva a causa.

Não misture refatorações ou melhorias sem relação com o defeito. Execute os testes diretamente relacionados e depois a verificação mais ampla que seja proporcional ao risco.

Registre a causa, o teste que cobre a regressão, a correção e qualquer limitação que não tenha sido validada.
