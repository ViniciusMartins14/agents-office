# Dev Office

Escritório local de desenvolvimento com seis funcionários e execução real via Claude Code, Codex CLI e IBM Bob CLI. Usa `node-pty` para consultar o painel interativo de limites do Claude de forma portátil; não precisa de uma chave de API no navegador.

A tela principal é um escritório 3D interativo (WebGL): cada funcionário tem a própria mesa, com monitor, cadeira e divisória. Arraste para girar, use a roda ou os botões para aproximar, e clique em uma pessoa para abrir o histórico e atribuir tarefas. O status de cada um vem do estado real da fila — trabalhando, na fila, atenção, configurar ou disponível.

## Iniciar

Requer Node.js 20+ e os terminais instalados e autenticados. Nesta pasta, execute:

```sh
npm install
npm start
```

Abra http://127.0.0.1:4317. Em **Configurações**, informe uma pasta existente e escolha o terminal de cada funcionário. Use **Nova missão** para enviar trabalho à equipe inteira ou a uma pessoa. Para mudar a porta: `PORT=4318 npm start`.

Ao abrir **Nova missão**, você também pode selecionar até quatro skills. Elas refinam o método de trabalho da missão sem ampliar o pedido nem autorizar publicação ou acesso a credenciais. O catálogo padrão tem 13 skills e cobre entrada (`pr-audit`, `issue-audit`, `architecture-review`), resolução (`github-resolution`, `dependency-bump`, `regression-fix`), verificação (`evidence-review`, `security-audit`, `post-resolution-audit`, `verification-planning`), entrega (`release`) e melhoria (`kaizen`, `simplify`).

O catálogo fica em `skills/`; cada pasta contém um `SKILL.md` com frontmatter `name`, `description` e `stage`. Para usar outro catálogo, defina `OFFICE_SKILLS_DIR` com um caminho absoluto antes de iniciar o servidor. O carregamento não depende de links simbólicos e funciona em Windows 11, macOS e Linux.

A cena 3D possui um dock no canto superior esquerdo para abrir **Missões**, **Equipe** e **Ferramentas**. Ao sair da cena, a navegação lateral completa reaparece. A seção **Ferramentas** resume memória, MCPs, skills e ambiente; também diagnostica Node, Git, Claude Code, Codex CLI, GitHub CLI, ai-usagebar, ai-memory e ai-jail. Ela mostra instalação, versão, autenticação e compatibilidade com o sistema atual. Quando algo falta, exibe um comando próprio para Windows, macOS ou Linux e permite copiá-lo; o navegador nunca executa instaladores. Revise e rode o comando manualmente no terminal apropriado.

Na mesma tela, **MCPs compartilhados** mantém um catálogo portátil em `.office/mcps.json`. Pelo frontend é possível criar, editar, aplicar e remover cadastros; a última aplicação e o resultado de cada IA permanecem visíveis após reiniciar. Um servidor pode usar HTTP/Streamable HTTP ou um comando STDIO e ser destinado a Claude, Codex e/ou IBM Bob. O editor alterna entre o formulário simples e **JSON avançado**. O modo avançado aceita um servidor direto com `name`, o formato `{ "mcpServers": { ... } }` usado por Claude/Bob ou `{ "servers": { ... } }` usado pelo VS Code, importando até 20 servidores de uma vez. Campos como `env`, `cwd`, `headers`, `http_headers`, `env_http_headers` e `bearer_token_env_var` são validados e preservados no catálogo. **Salvar no catálogo** ainda não muda os terminais; **Aplicar nas IAs** traduz o cadastro para cada produto:

- Claude: configuração de usuário via `claude mcp add-json`, preservando a configuração avançada e deixando-a disponível em qualquer pasta.
- Codex: configuração global pelo próprio `codex mcp`, gravada no perfil `~/.codex/config.toml`. STDIO aceita `env`; HTTP aceita `bearer_token_env_var`. Se o CLI não conseguir traduzir um campo (por exemplo, um header HTTP arbitrário), o cartão mostra a pendência em vez de descartá-lo.
- IBM Bob: mesclagem do objeto completo em `~/.bob/settings/mcp.json`, com cópia de segurança quando o arquivo já existe.

O `ai-memory` local já vem cadastrado para as três IAs em `http://127.0.0.1:49375/mcp`. Como esse endereço é local, o Office precisa estar aberto para atendê-lo. O catálogo local pode armazenar a configuração avançada, mas evite segredos literais: use variáveis de ambiente ou OAuth/login oficial e nunca versione `.office/`. Fora de loopback, somente HTTPS é aceito. Reinicie terminais já abertos depois de aplicar uma configuração.

## Funcionários

- Felipe: gerente de projetos.
- Davi: desenvolvimento backend.
- Toninho: qualidade e testes.
- Vinicius: arquitetura e UX.
- Karen: desenvolvimento frontend.
- Marcos: revisão e entrega.

Cada funcionário pode ser ligado a Claude, Codex ou IBM Bob em **Configurações**. Funcionários ligados ao mesmo terminal compartilham a mesma conta e o mesmo limite.

O fluxo da equipe é sequencial e fixo. Cada etapa recebe o pedido original e as saídas das etapas concluídas da mesma missão, com limite de contexto. Todos trabalham na pasta selecionada. Só um processo é executado por vez, evitando gravações concorrentes. Uma etapa que falha bloqueia as seguintes da mesma missão. Outras missões podem prosseguir. O gerente produz o plano; o servidor aplica a sequência de papéis acima, sem alegar delegação dinâmica.

## Execução e limites

- Claude usa `-p --verbose --output-format stream-json --permission-mode acceptEdits --permission-prompts none`: permite edições, mas pedidos que exigirem aprovação indisponível são negados e a etapa fica pendente quando reportados pelo terminal.
- Codex usa `exec --json --sandbox workspace-write --skip-git-repo-check` e recebe o prompt pelo stdin. Referência: https://learn.chatgpt.com/docs/non-interactive-mode.
- IBM Bob usa `run --format stream-json --workspace ... --max-turns 60`. Esse modo exige `BOB_API_KEY` no ambiente do processo. Configure-a no seu terminal antes de iniciar o servidor; ela não é pedida, gravada nem devolvida pelo navegador. A simples instalação/autenticação interativa do Bob não substituiu essa variável no teste local. Não aceita licenças nem marca diretórios como confiáveis automaticamente.
- Login, confiança de pasta e permissões são configurados no terminal do respectivo produto. Resolva as pendências lá e use **Retomar a partir desta etapa**. Não há terminal interativo/PTY embutido nem continuação da sessão de chat anterior; cada atribuição é uma nova execução com contexto de sua missão.
- Rodar tarefas consome os limites/créditos da conta usada por cada CLI.
- **Configurações → Limites da equipe** usa `ai-usagebar` como fonte principal para Claude e Codex. Os leitores diretos (`/usage` do Claude e `app-server` isolado do Codex) permanecem apenas como fallback quando a ferramenta não está disponível.
- **Pausar fila** deixa o processo atual terminar; **Encerrar missão** envia sinais de encerramento e cancela as próximas etapas. Arquivos já alterados permanecem.
- Cada etapa tem limite de 45 minutos. “Concluída” significa que o processo terminou sem falha reportada, não uma garantia independente de que o software está correto. Confira testes e saída.
- O servidor escuta apenas em `127.0.0.1`, valida Host/Origin e exige token para operações. Não exponha a porta por túneis nem publique este servidor. Os CLIs mantêm acesso e proteções próprios; o aplicativo não cria uma sandbox adicional para Claude/Bob.
- Pedidos e resultados ficam em `.office/state.json`; arquivos arquivados em `.office/archive`. Saída exibida limitada aos últimos 400.000 caracteres por etapa. Histórico ativo limitado a 200 etapas. Arquive missões antigas para liberar espaço.
- A memória persistente usa o servidor oficial `ai-memory`, gerenciado localmente pelo Office em `127.0.0.1:49375`. O armazenamento isolado fica em `.office/ai-memory/`, com um projeto por pasta de trabalho. O Office grava uma página episódica por missão, recupera as três missões anteriores como contexto e remove a página ao apagar a missão. A sanitização e a indexação são responsabilidade do `ai-memory`; não existe uma segunda implementação de memória no Office.
- Ao reiniciar, etapas ativas/na fila ficam interrompidas e exigem retomada explícita. O navegador reconecta automaticamente. Fechar o servidor encerra os processos do escritório.

## Verificar

```sh
npm run check
npm test
```

Os testes de integração usam CLIs substitutos em pasta temporária, sem consumir IA ou modificar repositórios do usuário. Verificam proteção de acesso local, fluxo sequencial, contexto, falhas, cancelamento, retomada e persistência.

O estado de conexão depende dos logins locais de Claude e Codex e da variável `BOB_API_KEY` no processo que iniciou o escritório. A tela de configurações mostra a disponibilidade atual de cada terminal.

## Arquitetura

`server.mjs`: servidor HTTP local, histórico, fila e gerenciamento de processos. `adapters.mjs`: comandos, papéis e composição do contexto. `skills.mjs`: catálogo validado de skills compartilhadas. `ai-memory.mjs`: ciclo de vida e adaptador do serviço oficial `ai-memory`. `mcps.mjs`: catálogo MCP e adaptadores de configuração para Claude, Codex e Bob. `dependencies.mjs`: diagnóstico portátil e instruções de instalação. `dist/`: interface independente de framework. `test/`: verificações com Node Test Runner.

`dist/office3d.js` monta a cena 3D. Piso, divisórias, mesas, cadeiras, monitores e plantas usam geometria procedural. Os seis funcionários usam o personagem articulado produzido em `blender/employee-studio.blend`, exportado em `dist/assets/blender/employee.glb`, com clipes de sentar, levantar, digitar, caminhar, esperar e dormir. Os assets Kenney anteriores permanecem como referência, com licença CC0 ao lado dos arquivos. Modelos, texturas e carregador ficam vendorizados no projeto e não dependem de URLs externas em tempo de execução. Nomes e balões são elementos HTML projetados a partir de posições 3D reais.

O Three.js e o `GLTFLoader` ficam vendorizados em `dist/vendor/` (MIT, com o LICENSE ao lado), servidos pelo próprio servidor local em rotas explícitas. Não há CDN nem instalação em tempo de execução. Para atualizar, substitua os arquivos pelo build oficial do pacote `three`.

Sem WebGL disponível, a cena é substituída por um aviso e a lista da equipe continua sendo o caminho completo de uso. A lista é navegável por teclado, e `prefers-reduced-motion` desliga as animações ociosas e o amortecimento da câmera.

A ilustração em `dist/office.png` era usada pela versão anterior da tela e não é mais exibida. O registro Sites em `.openai/hosting.json` foi criado antes da definição de execução local; não contém credenciais, não foi publicado e não é utilizado pelo aplicativo.


## Editar os personagens no Blender

- `blender/employee-studio.blend`: personagem base, esqueleto e mesa de validação. As animações estão nas Actions; digitação é a ação inicial.
- `blender/dev-office-animated.blend`: escritório completo com o novo personagem aplicado aos seis funcionários, com variações de cor.
- `blender/build_employee.py`: geração reproduzível do estúdio e GLB. `blender/assemble_office.py`: montagem do escritório a partir da base original. Rodar os scripts substitui os arquivos gerados; salve edições artísticas manuais com outro nome antes de regenerar.
- `dist/office-motion.js`: rotina de circulação e prioridade de trabalho/descanso. Os testes verificam continuidade do trajeto, permanência na cadeira e posições dos ossos após importar o GLB.
- `node test/serve-animation-review.mjs`: revisão visual isolada na porta 14318, com botões de trabalho, descanso, passeio e reunião. Não chama terminais nem usa o histórico real.

## Spotify no rádio

Clique no rádio da cena para abrir os controles. A integração controla o Spotify instalado no dispositivo que você selecionar; o áudio sai desse dispositivo. Exige conta Premium e um aplicativo no [Spotify for Developers](https://developer.spotify.com/dashboard).

1. Crie um aplicativo **Dev Office**, com **Web API**.
2. Em **Redirect URIs**, cadastre exatamente `http://127.0.0.1:4317/spotify/callback` (ajuste a porta se mudou `PORT`). Use `127.0.0.1`, não `localhost`.
3. Se solicitado, adicione sua conta à lista **Users and Access**.
4. Cole o **Client ID** no rádio e clique em **Conectar com Spotify**. Também pode definir `SPOTIFY_CLIENT_ID` no ambiente. Não precisa de Client Secret.
5. Autorize a leitura e o controle de reprodução na página oficial do Spotify. Abra o Spotify no computador e reproduza uma faixa uma vez para disponibilizar o dispositivo. Atualize a lista e selecione seu computador.

O rádio mostra a faixa atual, carrega até 50 playlists da conta, permite escolher e tocar uma playlist, pesquisar ou colar um link de faixa, reproduzir/pausar, avançar/voltar e ajustar volume. Contas conectadas antes da inclusão das playlists devem usar **Reconectar para liberar playlists** uma vez, autorizando a permissão `playlist-read-private`. O botão **Deixar escolher e tocar** chama o terminal atribuído ao funcionário para sugerir uma música de acordo com o clima que você escreveu. É uma consulta real de IA, sujeita aos limites do terminal. A sugestão é procurada no Spotify; se encontrada, é enviada ao dispositivo escolhido. Não há escolha automática ao conectar e uma ação manual cancela a consulta DJ pendente. O som sintetizado da versão anterior foi substituído pelo Spotify.

A autorização usa OAuth com PKCE e estado vinculado ao navegador. Tokens de acesso e renovação ficam em `.office/spotify.json` com permissão 0600, fora dos arquivos servidos e ignorados pelo Git; nunca são enviados aos terminais ou devolvidos pelo bootstrap. **Desconectar Spotify** remove a sessão local. Você também pode revogar o aplicativo na página da sua conta Spotify. Testes usam respostas simuladas; tocar uma faixa real depende da conta autorizada e de um dispositivo disponível.
