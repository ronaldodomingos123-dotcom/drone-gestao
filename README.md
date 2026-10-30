# Protótipo — Gestão de Aplicações com Drones Agrícolas (v1.7)

Protótipo **independente** de plataforma de gestão de aplicações com drones (cana-de-açúcar).
Não tem nenhuma ligação com o aplicativo de Acompanhamento Diário já em uso: outra pasta, outro
armazenamento (chaves `dap-proto-v1:` no navegador), sem servidor, sem banco externo, sem publicação.

> **Todos os dados são fictícios** (unidades, fazendas, pessoas, produtos e números), gerados por
> semente fixa para que a demonstração seja reproduzível.

## Como abrir

- **Uso direto:** abra `dist/index.html` em qualquer navegador (PC, Galaxy Tab, iPhone). Arquivo único, funciona offline.
  A fonte Inter é carregada da internet; sem conexão, usa a fonte do sistema.
- **A partir do código:**
  ```bash
  npm install          # instala typescript e esbuild (únicas dependências)
  npm run build        # checa tipos e gera dist/index.html
  npm test             # testes de regras de cálculo e validação (node:test)
  python3 tests/e2e/fluxo.py     # teste ponta a ponta (requer Playwright para Python)
  python3 tests/e2e/tratamento.py  # tratamento colado da OS, talhões da OS e sequência livre
  python3 tests/e2e/obstaculo.py   # conclusão com saldo = obstáculo; fechamento aplicado × obstáculos
  python3 tests/e2e/lancamento.py  # aplicado editável, ficha diária, desconto no talhão
  python3 tests/fixtures/gerar_pdfs.py tests/fixtures && python3 tests/e2e/pdf.py   # importação por PDF
  python3 tests/fixtures/gerar_pdfs.py tests/fixtures lote 12 && python3 tests/e2e/pdf_lote.py - [OS-real.pdf]   # lote no estilo da OS real
  python3 tests/fixtures/gerar_pdfs.py tests/fixtures replica && LOTE=tests/fixtures/replica python3 tests/e2e/pdf_lote.py - [OS-real.pdf]   # réplica geométrica: 1 a 110 talhões, várias páginas
  python3 tests/e2e/relatorios.py  # central de relatórios + CSV/Excel/PDF (abre os arquivos e confere)
  python3 tests/e2e/analise.py     # análise de produtividade A × B e planejamento
  python3 tests/e2e/rastreio.py    # rastreabilidade de OS e talhão
  python3 tests/e2e/unidade.py     # unidade/empresa opcional e criada na hora
  python3 tests/e2e/screens.py saida/   # capturas em desktop, tablet e iPhone
  ```

## Arquitetura

```
src/
  domain/      regras puras, sem interface (testáveis)
    types.ts        modelo de dados e hierarquias
    calc.ts         fórmulas (divisão protegida, tempos, áreas, doses)
    validation.ts   validação das 5 etapas do registro
    analytics.ts    indicadores e séries do dashboard
  data/
    demo.ts         gerador determinístico de dados fictícios
    repository.ts   interface de persistência + adaptador local (trocável por banco na Fase 4)
  ui/          componentes reutilizáveis (tabela, gráficos SVG, filtros, modal, ícones)
  modules/     telas (dashboard, aplicações, nova aplicação, cadastros, paradas, clima…)
  state.ts     estado da aplicação e filtros globais
  main.ts      menu, rotas e layout
tests/         testes unitários (node:test) e ponta a ponta (Playwright)
scripts/       build (arquivo único) e execução de testes
```

### Regras que evitam erro de cálculo

| Regra | Implementação |
|---|---|
| Área restante = planejada − aplicada acumulada | `calc.areaRestante` — pode ficar negativa; o excesso é **sinalizado**, nunca corrigido |
| % executado = aplicada ÷ planejada × 100 | `calc.percentualExecutado` — planejada 0 → "—" |
| Produtividade efetiva = área ÷ horas efetivas | `calc.produtividadeEfetiva` |
| Produtividade c/ paradas = área ÷ horas totais | `calc.produtividadeOperacional` |
| Divisão por zero | `calc.safeDiv` devolve `null`; a tela mostra "—" |
| Sem dupla contagem de área | A área existe só nos itens **OS × talhão** da operação; produtos e calda não carregam área |
| Dose ≠ volume de calda ≠ quantidade total | Grandezas e unidades separadas; `calc.quantidadeTotal` converte mL/g para L/kg |
| Operação noturna | Hora de término menor que a de início = virada do dia |
| Tempo parado ≠ tempo efetivo | Validação bloqueia efetivo + paradas > tempo total |

## Situação dos módulos (Fase 3)

| Módulo | Situação |
|---|---|
| Dashboard gerencial | Funcional (indicadores, metas, previsão de término, filtros) |
| Registro de campo (boletim do turno) | Funcional |
| Aplicações (lista, registro técnico, **corrigir/excluir com motivo**) | Funcional |
| Nova aplicação (formulário completo) | Funcional |
| Ordens de serviço | **Editável**: tabela de talhões (zona · talhão · área bruta · desconto previsto, com total), colar talhões da planilha, tratamento, concluir manualmente, reabrir, cancelar |
| Campanhas e tratamento | **Editável**: prazo e **tratamento** (conjunto de produtos com dose); colar a tabela da OS; resumo de insumos com totais; herdado pelas OS |
| Turnos e líderes, Fazendas e talhões (com unidades), Aeronaves, Pilotos e colaboradores, Produtos | **Editáveis** (criar, editar, excluir quando sem vínculo ou inativar) |
| Relatórios → Sequência de aplicação | Funcional: importar (colar do Excel **ou PDF da OS**), **sequência livre** (arrastar, digitar a posição, ▲▼), reimportar mantendo a ordem ajustada, concluir, copiar resumo, salvar imagem |
| Relatórios → Diário de aplicações | Funcional: exportar imagem, imprimir, **CSV/Excel/PDF** |
| Relatórios gerenciais e técnicos | **Funcional (Fase 3)**: Resumo por OS · Fazenda e talhão · Desempenho por aeronave · por operador · Planejado × realizado · Clima · Paradas · Evolução da campanha · Relatório técnico da aplicação — com período, filtros, data de geração e responsável; **CSV, Excel (.xlsx) e PDF** |
| Análise de produtividade | **Funcional (Fase 3)**: período A × B (anterior, semana anterior, ano anterior, livre), por aeronave/piloto/turno/fazenda; ha/h × meta, eficiência, tempo parado; exportação |
| Planejamento e metas | **Funcional (Fase 3)**: metas vigentes; por campanha: falta aplicar, dias até o prazo, término na meta e no ritmo real (faixa pessimista), ha/dia e drone-turnos/dia necessários |
| Fechamento do dia | **Funcional (v1.2)**: registra o dia pela ficha diária (janela, paradas, área por drone, real por fazenda/OS, clima); toda área vira voo com drone, piloto fixo e horário; rateio fazenda × drone estimado e editável que fecha os dois totais; bloqueia se o total não fecha ou se o clima é implausível |
| Estações meteorológicas | **Funcional (v1.1)**: importa o relatório **horário** e/ou **diário** da plataforma da estação (Excel/CSV), liga fazenda ↔ estação (automático pelo FN), gráficos e registros por estação, clima de cada aplicação com alertas; entra no detalhe da operação, no Diário e nos relatórios Clima e Técnico |
| Histórico e auditoria | Funcional: toda alteração com data, usuário, motivo e antes/depois; **rastreabilidade** de OS e talhão (voos, paradas, lançamentos, alterações, acumulado), exportável |
| Configurações | Metas, limites, **base própria**, **backup/restauração** |

## Fase 3 — gestão e relatórios

- **Um relatório = um objeto de dados** (`src/domain/relatorios.ts`): seções com colunas tipadas e números crus. A tela, o CSV, o Excel e o PDF só formatam, então mostram os mesmos números — e os números vêm das mesmas funções do painel (teste automático confere programado, aplicado, obstáculos, área do período, ha/h e tempo parado).
- **CSV**: padrão do Excel brasileiro (";" e vírgula decimal, UTF-8 com BOM); horas em minutos.
- **Excel (.xlsx)**: números como números (somáveis), datas como data, % como percentual, horas em [h]:mm; cabeçalho e totais formatados.
- **PDF**: A4 paisagem (retrato no relatório técnico), cabeçalho com período/filtros/gerado em/responsável, cabeçalho de tabela repetido a cada página, totais e "Página X de Y".
- Responsável: campo na tela do relatório (fica salvo no aparelho). Sem login, é um nome digitado — não é identificação verificada (isso é Fase 4).
- Bibliotecas, embutidas e carregadas só ao exportar: **jszip** 3.10 (MIT) e **pdf-lib** 1.17 (MIT). Nada é enviado pela internet.
- Toda área vem de voo (Fechamento do dia ou Registro de campo). Aplicado lançado sem voo em versões anteriores (v0.9.3–v1.1) continua contando na área, fora do ha/h.

## Paradas e tempos no relógio (v1.7.7)

- Paradas, Dashboard (tempo efetivo, total, parado e "Motivos de parada") e Relatório de paradas passam a mostrar o tempo no RELÓGIO: paradas de drones diferentes no mesmo horário contam uma vez (ex.: "Problemas de equipe" 13:20–18:30 = 5h10, e não 7h50 somando os dois drones). A soma por drone (horas-drone) continua ao lado e é a base das porcentagens sobre o tempo dos voos e do ha/h por drone.
- Quando um drone para e o outro segue aplicando, esse horário conta como efetivo (alguém aplicava) e também como parado (houve parada registrada).

## Tempo efetivo da operação (v1.7.6)

- No Diário, "Efetivo da operação" = tempo em que pelo menos um drone estava aplicando (drones trabalhando ao mesmo tempo contam uma vez: união dos intervalos de voo menos paradas). "Parado" = tempo dentro da janela dos voos em que nenhum drone aplicava. A soma por drone aparece à parte (é a base do ha/h por drone).

## Linha do tempo editável (v1.7.4)

- Cada evento da linha do tempo do Diário é clicável, com o ícone ⚙ (Líder/Gestor; v1.7.5: o evento inteiro abre a edição e o painel mostra a dica; o mesmo evento nos dois drones aparece uma vez mesmo quando intercalado): muda a hora de início/fim do voo, a hora/motivo/observação da parada ou a hora da retomada, nos drones marcados (dá para corrigir só um drone). "Excluir parada" remove a parada inteira. Início e fim do voo não se excluem por aqui.
- O tempo efetivo do voo é ajustado pela diferença (parada mais longa = menos efetivo), sem passar da jornada. Horários fora do voo são recusados. Tudo vai para a auditoria e, com a nuvem, sobe para a equipe.

## Correção: dois turnos no mesmo dia; recuperar voos; observações editáveis (v1.7.3)

- **Correção importante:** gravar o fechamento de um turno substituía os voos já gravados na MESMA data para os MESMOS drones, mesmo de OUTRO turno (ex.: o 2º turno apagava o 1º com o mesmo drone). Agora só é substituído o fechamento do mesmo dia, mesmo turno e mesmos drones (regravar = corrigir); voos de outro turno são mantidos e a prévia avisa que o fechamento soma.
- **Recuperar voos** (Nuvem e acesso → Versões anteriores, Gestor): lista os voos que existiam numa versão anterior e não existem mais hoje; devolve só os marcados (com as paradas), sem mexer no resto; fica na auditoria. Requer a função `ler_versao` no banco (`supabase/atualizacao-v1.7.3.sql`, já incluída no `schema.sql`).
- **Observações do Diário**: botões Editar e Excluir (Líder/Gestor); vale para todos os voos do dia com o mesmo texto; as notas técnicas automáticas ficam como estão. Na importação do app de acompanhamento, observação que já está em outro turno do mesmo dia não é repetida.
- **Linha do tempo**: o mesmo evento, na mesma hora, nos dois drones aparece uma vez (com os dois drones).

## Diário: imagem e observações (v1.7.2)

- Imagem exportada: o cabeçalho (data, campanha, turno · líder) não quebra linha, para não sobrepor os cartões quando a imagem usa a fonte do sistema.
- Observações: só o que foi digitado (ficha / app de acompanhamento). As notas técnicas automáticas ("Fechamento do dia…", "Data corrigida…") continuam no registro de cada voo, mas não aparecem no Diário; texto igual em vários drones aparece uma vez.
- Rodapé: "Dados fictícios" só aparece com a base de demonstração.

## Menu lateral recolhível (v1.7.1)

- No computador, o botão **‹** no topo do menu lateral recolhe o menu: o conteúdo passa a usar a largura toda da tela. O **☰** no topo abre o menu por cima (gaveta) e o botão **›** fixa de novo. A escolha fica gravada no aparelho.
- As imagens exportadas (Diário, Sequência, Dashboard) usam a largura da tela quando ela é maior que a mínima de exportação; com o menu recolhido a imagem sai mais larga (ex.: Diário de 1.200 para 1.392 px de conteúdo numa tela de 1.440 px, em resolução 2×).

## Nuvem e acesso pela equipe (Fase 4 · v1.7)

**Como funciona**
- Um link (GitHub Pages, pasta `docs/`) abre sempre a versão mais nova do app, no celular ou no computador.
- Os dados ficam numa tabela do Supabase (projeto próprio do protótipo). Cada aparelho guarda uma cópia e funciona sem internet; ao voltar a conexão, o que ficou pendente é enviado.
- **Sem login: só leitura.** Para gravar, entra-se com e-mail/senha. Perfis: **Gestor** (tudo, inclusive usuários e restaurar versões), **Líder** (lança o dia a dia; não altera campanhas, metas, safra, aeronaves, colaboradores, turnos, produtos, unidades, limites nem troca a base inteira), **Visualizador** (só vê).
- As regras valem **no banco** (`supabase/schema.sql`: RLS + funções), não só na tela: quem não tem permissão não grava mesmo chamando a API direto.
- Cada gravação leva a versão-base: se outra pessoa gravou antes, as alterações são **mescladas item a item** (`src/domain/mesclar.ts`) e reenviadas; o mesmo item alterado pelos dois fica com a versão de quem enviou por último e o app avisa.
- Histórico: as últimas 60 versões ficam guardadas; o Gestor pode voltar a qualquer uma (a atual também é guardada antes).
- A auditoria passa a registrar a parte do e-mail antes do @ de quem estava logado (informado pelo app; o controle de quem PODE gravar é do banco).
- Modo local (`?modo=local`): o app não usa a nuvem (testes ou uso isolado), com aviso na faixa.

**Configurar (uma vez)**
1. Supabase → SQL Editor → colar `supabase/schema.sql` com o e-mail do Gestor no lugar de `__EMAIL_GESTOR__` → Run.
2. Authentication → Users → Add user → Create new user (e-mail do Gestor, senha, **Auto Confirm User**). O plano grátis só envia e-mail para membros da equipe do projeto (2 por hora), então as contas da equipe são criadas assim, com senha provisória; a pessoa troca a senha no app.
3. Authentication → URL Configuration → Site URL = endereço do GitHub Pages.
4. GitHub → Settings → Pages → Deploy from a branch → `main` / `/docs`.
5. Abrir o link, entrar como Gestor, "Nuvem e acesso" → **Enviar dados deste aparelho** (no aparelho que tem a base real) → **Testar segurança da nuvem** (precisa dar 12/12).

**Testes**
- `bash tests/sql/rodar_teste_rls.sh` — 45 verificações das regras do banco num PostgreSQL 16 local (sem login, visualizador, líder, gestor, e-mail não confirmado, conflito de versão, histórico, último gestor).
- `python3 tests/e2e/nuvem.py` — 34 verificações de tela com o mesmo schema.sql num PostgreSQL local (só o login e o gateway HTTP são simulados): dois aparelhos, leitura sem login, Líder lançando, Gestor recebendo, conflito com aparelho sem internet, teste de segurança, restauração, modo local.
- Os demais testes de tela rodam em modo local.

**Limites conhecidos desta etapa**
- A sincronização envia a base inteira a cada gravação (adequado para equipe pequena; o tamanho atual é de centenas de KB).
- A atualização entre aparelhos é por verificação a cada 10 s (não é instantânea).
- O projeto grátis do Supabase pausa após cerca de 1 semana sem uso (reativar no painel).
- Ainda não testado contra o projeto real a partir deste ambiente (a rede daqui não alcança o Supabase): o botão "Testar segurança da nuvem" faz essa conferência no navegador do usuário.

## Linha do tempo: excluir voo e ordem no mesmo minuto (v1.7.11)

- Tocar em **Início** ou **Fim da aplicação** agora mostra **"Excluir voo"**: apaga o voo inteiro dos drones marcados (área, horário e paradas), com confirmação que lista voo e área e pede o motivo. Fica na auditoria (com o registro anterior) e nas versões anteriores da nuvem.
- **Ordem no mesmo minuto:** retomada → fim do voo anterior → início do voo seguinte → parada que começa junto. Antes, "Início 12:34" aparecia antes de "Fim 12:34".

## Adicionar parada na linha do tempo (v1.7.10)

- **Líder do turno → Linha do tempo → "Adicionar parada"** (Líder e Gestor): escolhe os drones, hora da parada, hora da retomada, motivo e observação. A parada entra no voo do drone que passa pelo horário (o drone pode ter mais de um voo no dia). **Retomada em branco = parou até o fim do voo** (fim de tarefa, troca de turno).
- Recusa hora fora do voo e parada sobreposta a outra do mesmo voo. O tempo da parada sai do tempo efetivo do voo; excluir devolve. Tudo vai para a auditoria.
- Editar e excluir continuam no toque sobre o evento (engrenagem).
- **Motivos novos:** Fim de tarefa, Troca de turno, Refeição/intervalo, Aguardando liberação (também reconhecidos na importação do app de acompanhamento). Não são climáticos.

## Turno sem aplicação e datas no gráfico diário (v1.7.9)

- **Fechamento do dia → "Dia/turno sem aplicação"** (ou o link "Este turno não aplicou? Lançar parada" embaixo do Turno da ficha): lançamento manual com **Abrangência** = dia inteiro ou só um turno. Só um turno pode ser lançado mesmo que o outro turno tenha aplicado no dia (ex.: vento no Turno A, Turno B aplicou); só é recusado se o próprio turno já tem voo gravado na data. Dia inteiro continua recusado em dia com aplicação.
- Gravado em `diasParados` com o campo opcional `turnoId` (registros antigos sem ele = dia inteiro). Nada existente é alterado.
- **Gráfico diário:** dia com aplicação e turno parado mantém a barra e ganha ícone do motivo acima do valor e "½ Vento" embaixo da data; o detalhe mostra o turno, o motivo e a observação. Dia sem área com só um turno registrado conta como parado.
- **Datas do eixo:** todas as datas aparecem quando cabem (antes saía uma sim, uma não em períodos curtos); quando não cabem, o espaçamento termina sempre no último dia do período.
- **Planejamento → Dias da campanha:** a célula do dia mostra "Turno A: Vento" abaixo da área.

## Motivo nos dias sem aplicação (v1.7.8)

- **Gráfico "Área aplicada × planejado por dia"** (Dashboard): dia registrado como "Dia sem aplicação" ganha faixa laranja clara e ícone do motivo (chuva, vento, umidade/orvalho, manutenção/equipamento; outros = pausa). Dia passado sem nada lançado ganha "?" cinza ("sem registro"). Hoje ainda sem lançamento não é marcado. Só conta a janela da campanha filtrada.
- Até 31 dias no período: motivo escrito embaixo da data e valor em todas as barras (no celular a letra do motivo diminui para caber). Período longo: só os ícones, para não poluir. O toque/hover mostra o motivo completo e a observação.
- **Planejamento → Dias da campanha** (até 31 dias): uma célula por dia com a data e "x ha", o motivo ou "sem registro"/"hoje"; acima disso continua a faixa de quadrados.
- Nada novo é gravado: usa os registros que já existem em "Dia sem aplicação".

## Checape do painel e imagem (v1.6.1)

- **Janela da campanha:** quando o período filtrado começa antes do início da campanha, os dias anteriores não entram mais no ritmo da previsão, na meta do período, na meta semanal nem no "ritmo planejado" do gráfico de evolução. Antes, um período de 30 dias com campanha de 5 dias dava ritmo de 6,5 ha/dia e "atraso de 72 dias" falso. O Planejamento usa a mesma regra (últimos 14 dias ou desde o início da campanha).
- **Impedidas por clima:** o cartão mostra também os dias sem aplicação registrados por clima.
- **Exportar imagem** (Dashboard, v1.6.2: termina no bloco "Evolução da campanha" + "Área por semana"; resolução 2× no computador e 3× no celular; v1.6.3: letras maiores só na imagem — textos pequenos de 11–12,5 px passam a 13,5–15 px): baixa um PNG do painel com o layout da tela (computador ou celular), em resolução 2×, com período, filtros e data/hora de geração. Gerado no próprio navegador, sem envio para fora. Usa a fonte do sistema (a fonte web não entra na imagem).

## Dias de operação e meta da safra (v1.6)

- **Dia sem aplicação** (Fechamento do dia → botão "Dia sem aplicação"): registra um dia ou período (máx. 62 dias) sem aplicação, com motivo (Chuva, Vento acima do limite, Umidade, Orvalho, Manutenção…), observação e campanhas (nenhuma marcada = todas). Dias que já têm aplicação gravada não são marcados; data futura é recusada; registrar o mesmo dia de novo substitui. Cada registro pode ser removido pela lista. Tudo vai para a auditoria.
- **Dias da campanha** (Planejamento e metas, em cada campanha, e no painel): dias corridos desde o início da campanha até hoje (ou até o fim), dias com aplicação, dias parados (por motivo; também conta dia com operação "impedida por clima" sem área), dias sem registro, ha por dia com aplicação e ha por dia corrido. Faixa com um quadrado por dia.
- **Meta da safra** (Planejamento e metas → "Definir meta e período"): meta fixa, padrão **24.000 ha**, com nome, início e fim definidos pelo usuário; independe das campanhas abertas e dos filtros do painel. Mostra aplicado (todas as campanhas no período da safra), %, falta, dias restantes, ha/dia necessário e projeção no ritmo atual. Os dias da safra contam a partir do início da 1ª campanha da safra. Sem safra gravada, o protótipo assume início = 1ª campanha, 12 meses, 24.000 ha.

## Fechamento do dia (v1.2)

- **Regra**: toda área aplicada vem de um voo. Total do dia = soma dos drones = soma do real das fazendas (tolerância 0,01 ha, para o arredondamento da ficha). Se não fecha, a prévia mostra "faltam/sobram X ha" e não grava.
- **Entrada**: os números da ficha diária — hora inicial/final, paradas da linha do tempo (valem para todos os drones), área de cada drone, real de cada fazenda/OS e clima inicial/final. Drone que parou à parte (ex.: quebrou) tem horário e paradas próprios. O piloto vem do **piloto fixo** cadastrado na aeronave.
- **O que é estimado (e marcado)**: a ficha não diz quanto cada drone fez em cada fazenda, então a matriz fazenda × drone é preenchida por proporção, fechando linhas e colunas exatamente (ajuste proporcional iterativo + arredondamento em centésimos). Ex.: 350 = 145 + 205 → Fazenda X 120,00 = 49,72 + 70,28. Digitar uma célula a fixa e as demais se reajustam. O horário de cada trecho divide o tempo efetivo do drone na ordem das fazendas, pela área; a divisão por talhão segue o saldo de cada talhão.
- **Obstáculo**: ao concluir uma OS com saldo, marque o talhão do desconto (ex.: Jacinto I 32,17 de 32,70 → 0,53 no talhão 20). Dá para indicar depois em "Aplicado" da OS: os voos do fechamento são redistribuídos entre os talhões, sem mudar a área de cada drone.
- **Produtividade**: ha/h efetivo = área ÷ (jornada − paradas). Na ficha de 14/10: jornada 10h30, paradas 5h46, efetivo 4h44 → 25,25 ha/h para os dois drones (a ficha mostra 11,38 ha/h porque divide pela jornada inteira).
- **Clima**: valores implausíveis bloqueiam (ex.: temperatura final 68 °C com umidade 17% → "parecem trocadas", com botão para trocar).
- **Reimportar o mesmo dia substitui** os voos do fechamento anterior desses drones (não soma). Tudo fica na auditoria.
- **Importar do app de acompanhamento (v1.3)**: cole o código de Configurações → Exportar dados (`ACOMP1:`) ou abra o .txt. Cada dia fechado vira uma ficha: janela, paradas (pausa → retorno; motivo pelo texto: UR/umidade, vento, chuva, mudança de área…), T70 D/T70 A → aeronaves cadastradas (com piloto fixo), fazenda → OS aberta do protótipo (nome sem acento/maiúscula e sem "Fazenda/Sítio"), "concluída" do app → concluir a OS no último dia da fazenda, clima. Pendências (fazenda sem OS, aeronave não cadastrada) aparecem antes; nada é gravado sem conferir. O código traz só a campanha ativa do app; o dia em andamento não é importado.
- **Data corrigível (v1.3.1)**: a data de cada dia pode ser corrigida na lista de importação (fica salva para as próximas importações). O protótipo avisa quando o dia foi fechado mais de 1 dia depois da data registrada (ex.: registrado 14/10, fechado 20/10). Gravar com a data corrigida substitui o que tiver sido gravado com a data antiga.
- **Desconto previsto por talhão (v1.3.1)**: quando a OS tem a coluna "ñ aplicado" por talhão e o obstáculo do dia é exatamente esse total, o desconto vai para esses talhões com esses valores (igual à coluna "real" da planilha), sem marcar à mão.
- **Volume de calda manual (v1.3.2)**: campo "Volume de calda (L/ha)" no quadro Dia (vale para todas as fazendas) e "Calda (L/ha)" por fazenda, quando uma for diferente. Ordem: o da fazenda, senão o do dia, senão o da OS. Vai para os voos do dia; a OS não é alterada. Fica preenchido para o dia seguinte. Sem volume, não grava.
- **Taxa de aplicação na importação (v1.3.3)**: as abas "Colar tabela" e "PDF da OS" de Importar sequência têm o campo "Taxa de aplicação (L/ha)" (volume de calda por hectare) e o "Início da campanha". A taxa vai para a campanha e para todas as OS importadas; se o PDF trouxer outra taxa, a informada prevalece e a diferença é avisada. Em todas as telas o campo passou a se chamar "Taxa de aplicação (L/ha)".
- **KML de voo (v1.4)**: Fechamento do dia → "Importar KML de voo". Lê as trajetórias (uma por carga) com área, volume, tempo de voo, altura, velocidade e espaçamento; unidades conferidas pela plausibilidade (mL→L, ms→min, m²→ha). Agrupa os voos por local (centros a < 1 km) e sugere a fazenda/OS de cada grupo pela área real da ficha (uma OS, ou duas vizinhas cuja soma bate) ou pelo local já aprendido. A área de cada drone em cada fazenda passa a ser a medida (cada linha fecha com o real da ficha; o centésimo de arredondamento fica no maior resto); a área do drone é a soma das suas células. Os voos gravam cargas, tempo em voo, volume, taxa real, altura, velocidade e espaçamento; a prévia mostra ha/h em voo. Alerta de cargas com taxa fora de ±15% da taxa da OS e do volume acima do esperado. Mapa das trajetórias sem internet. Depois de gravar, o nº de série vai para a aeronave (se vazio) e o local para a fazenda.
  - Limites: o KML não traz data/hora (os voos entram no dia aberto na ficha; horários continuam da ficha) nem o contorno dos talhões (fazendas vizinhas no mesmo grupo são divididas pelo real de cada uma; a divisão por talhão continua estimada). Conferido com o KML real de 19 e 20/10: 84 cargas, 200,04 ha = soma das fazendas; 67 cargas a 14,94 L/ha; 17 fora da taxa.
- **Mapa de talhões + cruzamento (v1.5)**: Fazendas e talhões → "Importar mapa de talhões (KML)" (polígonos com cod_zona, cod_talhao, area_plantada…; ligados pela zona = código da fazenda; guarda só as fazendas do protótipo, contorno simplificado a 0,5 m). No Fechamento do dia, depois do KML de voo, abre o **Cruzamento com os talhões**: faixa de cada carga (largura = espaçamento) sobre o contorno, grade de 1 m; por talhão: % coberto, **medido = % × área plantada** (desconta o carreador na mesma proporção), repasse (2+ cargas), parte de cada drone e mapa de cobertura (aplicado / repasse / falha). O deslocamento base ↔ área é descartado: trecho reto inicial/final da carga (> 60 m) só sai se deixa a faixa mais próxima da área registrada pelo drone (84 cargas reais: 263,8 → 208,9 ha × 200,0 registrados). Talhões fora da OS: < 10% = passagem; ≥ 10% = não lançar / lançar num talhão da OS / adicionar o talhão à OS. Dois modos: **Medido (editável)** — padrão; corrija o aplicado de cada talhão antes de aplicar — ou **Manter o real da ficha** (o cruzamento vira conferência). Validação: TypeScript × Python (mesmo método) com diferença ≤ 0,06 ha por fazenda.
- Leitura da imagem da ficha: ainda não (teste com a ficha real: números corretos após realce de cor, um horário lido errado; depende de biblioteca que não pôde ser incluída).
- "Aplicado" da OS não acrescenta mais área sem voo: o total é o dos voos (somente leitura); serve para concluir e indicar o talhão do desconto.

## Estação meteorológica (v1.1)

- **Como trazer os dados**: no site da estação, exporte o *Relatório horário* (ou o diário) em Excel e use **Estações meteorológicas → Importar relatório**. Colunas reconhecidas pelo cabeçalho: PIC, Lat., Lon., Início, Fim, Pic inativa, Chuva, Temp. mín./média/máx., Umidade mín./média/máx., Pressão, Vento médio, Rajada máx., Radiação, ET₀.
- **Horário × diário**: com o horário, cada aplicação usa só as horas que cobrem o voo (inclusive voos que passam da meia-noite), com os **extremos medidos** em cada hora (T máx., UR mín., rajada máx.). Sem o horário, mostra o **resumo do dia** — rotulado como tal, porque não representa o momento da aplicação.
- **Sem dupla contagem**: os dois arquivos podem ser importados juntos; o total do dia usa o registro diário e, sem ele, soma as horas. Reimportar o mesmo período substitui, não duplica. (Conferência com os arquivos reais: chuva da PIC 03 em 15/10 = 16 mm no diário e 16 mm na soma das 24 horas.)
- **Ligação fazenda ↔ estação**: automática quando o código da fazenda (FN) aparece no nome da estação; para fazenda sem estação própria, escolha a mais próxima (tela de estações ou cadastro da fazenda). Fica na auditoria.
- **Alertas** contra os limites configurados: chuva, rajada/vento acima do máximo, UR mínima abaixo do limite, T máxima acima do limite e **ΔT > 8 °C**. ΔT = T − bulbo úmido, com o bulbo úmido pela fórmula de Stull (2011, *J. Appl. Meteor. Climatol.* 50:2267–2269), estimado para a pior combinação (T máx. com UR mín.) — é estimativa, não medição.
- **Qualidade do dado**: a prévia avisa valores implausíveis, agrupados por estação (ex.: PIC 20 com pressão 628 hPa em 179 registros — sensor a conferir). Estações sem anemômetro aparecem como "sem sensor" de vento (12 das 30 têm vento).
- **Conexão automática (API)**: não há API pública documentada da plataforma. Se o fornecedor liberar uma, a chave tem de ficar num servidor (Fase 4), nunca no aplicativo.

## Fase 2 — como carregar os dados reais

1. *Configurações → Exportar backup* (se quiser guardar a demonstração) e **Começar base própria**.
2. *Fazendas e talhões → Nova unidade*.
4. *Relatórios → Sequência → Importar sequência*: cole a tabela do Excel (Sequência · Fazenda · O.S · Área · Título).
   Cria a campanha, as fazendas e as OS; se houver vários títulos, escolha quais importar. Reimportar **atualiza**, não duplica.
5. *Campanhas e calda → Editar → Colar tabela do tratamento*: cole a tabela da OS (TRATAMENTO · DOSE · TOTAL e/ou CÓDIGO · RESUMO DE INSUMOS · TOTAL).
   Os produtos que não existem são criados com o código (classe provisória = tipo da campanha; ajuste em Produtos). A prévia confere dose × área = total.
   OS abertas sem produtos recebem o tratamento automaticamente; marque "aplicar a todas" para substituir também nas que já tinham.
6. Talhões: na própria OS (*Editar → Colar talhões da planilha*: Fazenda · ZONA · Tn · há · ñ aplicado · real) ou em lote em *Fazendas e talhões → Importar talhões*. A soma da área **bruta** é o programado (ex.: 32,70); "ñ aplicado" entra como desconto previsto (informativo). O talhão geral sai quando os talhões reais entram.
7. Cadastre colaboradores (líder e pilotos), turnos e aeronaves. Pronto para o Registro de campo.

### Importar pelo PDF da OS
- *Relatórios → Sequência → Importar sequência → aba **PDF da OS***: escolha (ou arraste) um ou vários PDFs.
- O aplicativo extrai **nº da OS** e **FN** (do texto; na falta, do nome do arquivo "OS 3410 - FN 094-095.pdf"), a **tabela de talhões** (Fazenda/FN · Zona · Talhão/Tn · Área/há · ñ aplicado), o **total** (linha TOTAL, "Área total" ou cabeçalho do tratamento) — conferido com a soma — e o **tratamento** (produtos, doses, códigos).
- OS com mais de uma FN (ex.: 094-095) vira uma OS por fazenda, com os talhões de cada uma. Sem tabela de talhões, entra o talhão GERAL com o total.
- Cada arquivo mostra o que foi lido; o "texto extraído" pode ser corrigido e relido antes de importar. Reimportar atualiza (não duplica).
- PDF digitalizado (imagem, sem texto) não é lido: precisaria de OCR.
- A leitura usa o pdf.js (Mozilla, licença Apache-2.0), embutido no próprio arquivo e carregado só quando a aba é aberta: **nada é enviado pela internet**.
- **Layout da OS real** (calibrado com a OS 3416 · FN 090): quadro **Zonas** ("090 - Fazenda …  32,70") identifica a fazenda; tabela **FN · ZN · TN · AREA OS · AREA TN · GLEBA · TRATAMENTO** (a coluna FN traz outro código, ex.: 1023 — a fazenda é a **zona**); a tabela do tratamento fica **ao lado** e é separada pela posição das colunas; **AREA OS** é o programado e **AREA TN** a área do talhão; usa **"Área Total"** e ignora "Área total do KML".
- **Tabelas longas (v0.9.2):** a leitura usa a **posição das colunas** no PDF (os valores são centralizados sob o cabeçalho). A tabela de talhões é lida até o fim do documento, mesmo quando passa pelo resumo de insumos, divide linhas com a tabela do tratamento ou continua em outra página (com ou sem cabeçalho repetido). Arquivo com soma ≠ total fica marcado **"conferir"**.
- **Vários PDFs de uma vez:** selecione ou arraste quantos quiser; a lista mostra o progresso (lendo X de N), lidos e com erro, e permite remover os com erro. O mesmo PDF escolhido duas vezes é ignorado. Testado com 62 PDFs (1,5 s) e 20 cópias do PDF real de 8,6 MB (0,8 s), em computador e iPhone.

### Aplicado editável e ficha diária (v0.9.3)
- Na Sequência, o **Aplicado** de cada OS é um botão: abre o lançamento com o aplicado total, a data e a tabela de talhões.
- **Importar da ficha diária:** cole as linhas (data · FN/fazenda · área — do app de acompanhamento, planilha ou WhatsApp); o aplicativo pega só as linhas da fazenda da OS e soma (ex.: 20,00 + 12,17 = 32,17).
- **Onde ficou o desconto:** marque o talhão do desconto real; os demais ficam com o programado (ex.: 32,17 de 32,70 → talhão 20 com 11,80 e 0,53 de desconto). Também dá para digitar o aplicado de cada talhão.
- **Concluir** uma OS com saldo abre esse lançamento (não conclui mais com aplicado zero — antes isso transformava os 32,70 inteiros em obstáculo).
- O lançamento não tem drone/horário: conta em aplicado, saldo, obstáculo, evolução e painel, mas **não entra no ha/h** nem nos indicadores por drone/piloto/turno. Nunca fica abaixo do que já foi registrado em voo. Editar de novo substitui (não soma). Tudo vai para a auditoria.

### Sequência livre
- A ordem é sua: arraste pela alça ⠿ (mouse ou dedo), digite a nova posição no número da linha (Enter) ou use ▲▼. Tudo renumera 1..N e vai para a auditoria (posição de → para).
- Ao **reimportar** a planilha numa campanha que já tem OS, escolha: **manter a ordem atual** (padrão — seus ajustes ficam, OS novas entram no fim) ou **usar a ordem da tabela**.

### Unidade / empresa (opcional)
- Fazendas, aeronaves e colaboradores podem ficar **sem unidade**. Nos importadores e no cadastro de fazenda há **"+ Nova unidade / empresa…"**: digite o nome e ela é criada ao salvar (o mesmo nome, ignorando acento/caixa/espaços, reaproveita a existente). Código e município da unidade são opcionais.

### Regras de integridade
- Alterações são feitas numa cópia, validadas e só então gravadas (tudo ou nada); cada uma gera registro de auditoria.
- Exclusão só quando o registro não é usado; com vínculo, oferece **inativar** (colaborador, turno, aeronave).
- OS com aplicações: não troca de fazenda, não remove talhão aplicado, não é cancelada (pode ser concluída manualmente).
- OS **concluída com saldo**: o programado continua bruto, a barra mostra o realmente aplicado (ex.: 32,17 de 32,70 = 98%) e o saldo fica registrado como **obstáculo** (0,53). Obstáculo não entra no "falta aplicar" nem na previsão de término. A Sequência traz o **fechamento aplicado × obstáculos**; o painel mostra o total de obstáculos. Reabrir devolve o saldo para "falta aplicar".
- Status das OS (aberta/em execução/concluída) é recalculado das áreas a cada gravação.
- Bases antigas são **migradas** (nunca apagadas); base própria nunca é substituída automaticamente.
- Período padrão dos filtros: da primeira data da base até hoje.

## Limitações conhecidas

- Sem usuários, login ou permissões (auditoria registra "Gestor (demo)"); sem servidor nem banco centralizado; sem sincronização entre aparelhos — use o backup para levar os dados.
- Dados ficam no `localStorage` do navegador: limpar dados do navegador apaga os registros feitos aqui.
- Sem integração com telemetria do drone ou RTK/NTRIP. Estação meteorológica: só por arquivo exportado (sem conexão automática).
- Limites climáticos são exemplos editáveis, não recomendação técnica.
- Os dados fictícios foram gerados com 14–21 ha/h por drone; por isso ficam abaixo da meta de 32 ha/h. Não representam desempenho real.
- Importação por PDF calibrada com UMA OS real (3416); outras variações de layout (2+ tratamentos, OS com várias zonas reais) foram testadas só com PDFs fictícios no mesmo estilo. Shapefile (.dbf/.shp) ainda não é lido.
- O arquivo único tem ~2,7 MB (leitor de PDF e motor de exportação embutidos para funcionar offline); eles só são carregados quando usados.
- Navegadores suportados: versões atuais de Chrome, Edge, Safari (iOS 15+) e Samsung Internet.
