---
name: release
description: Prepare uma versão a partir das mudanças reais, valide semver, changelog, artefatos e CI no commit exato.
stage: release
---

# Preparação de release

Derive a versão das mudanças desde a última versão publicada: correções compatíveis são patch, funcionalidades compatíveis são minor e quebras são major. Confirme a política específica do repositório antes de aplicar essa regra.

Atualize changelog e metadados apenas com mudanças verificáveis. Valide build limpo, testes, lint, empacotamento, conteúdo dos artefatos, checksums e instalação mínima quando aplicável. A aprovação exige CI verde no commit exato que receberia a tag; sucesso em commit anterior não basta.

Nunca reescreva uma tag publicada. Não crie tag, release, push, publicação de pacote ou anúncio sem autorização explícita do usuário. Sem autorização, entregue o candidato, a versão proposta e a lista objetiva do que falta.
