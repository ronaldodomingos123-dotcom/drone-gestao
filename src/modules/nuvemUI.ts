/**
 * Telas da nuvem: indicador no topo, faixa de situação, login/conta, usuários (Gestor), histórico de
 * versões, primeiro envio e teste de segurança.
 */
import { alterar, estado, redesenhar } from '../state';
import { recuperarVoos, voosAusentes } from '../domain/recuperar';
import type { Dataset, Operacao } from '../domain/types';
import {
  aoMudarNuvem, atualizarPerfil, definirModoLocal, ehGestor, enviar, enviarBaseInicial, metaNuvem, mostrarAtualizacao, nuvem, puxar,
  type Papel,
} from '../data/nuvem';
import { criarConta, entrar, esqueciSenha, lerRetornoDoEmail, NUVEM, rpc, sair, semLogin, trocarSenha } from '../data/supabase';
import { PREFIXO } from '../data/repository';
import { abrirModal, confirmar, esc, toast } from '../ui/dom';
import { aviso } from '../ui/components';
import { icone } from '../ui/icons';

const ROT_PAPEL: Record<Papel, string> = { anonimo: 'Visitante (sem login)', visualizador: 'Visualizador', lider: 'Líder', gestor: 'Gestor' };
const hora = (iso: string) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(+d) ? '' : `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`; };

function textoChip(): { txt: string; cls: string } {
  if (nuvem.modo === 'local') return { txt: 'Modo local', cls: 'nv-local' };
  if (nuvem.atualizacaoAdiada) return { txt: 'Atualização disponível', cls: 'nv-aviso' };
  switch (nuvem.estado) {
    case 'iniciando': return { txt: 'Conectando…', cls: 'nv-neutro' };
    case 'enviando': return { txt: 'Enviando…', cls: 'nv-neutro' };
    case 'pendente': return { txt: 'Aguardando envio', cls: 'nv-aviso' };
    case 'offline': return { txt: metaNuvem().pendente ? 'Sem internet · alterações aguardando' : 'Sem internet', cls: 'nv-aviso' };
    case 'vazia': return { txt: 'Nuvem sem dados', cls: 'nv-aviso' };
    case 'erro': return { txt: 'Erro na nuvem', cls: 'nv-erro' };
    default: return { txt: 'Sincronizado', cls: 'nv-ok' };
  }
}

function desenharIndicadores() {
  const c = textoChip();
  const chip = document.querySelector('[data-nuvem-chip]') as HTMLElement | null;
  if (chip) {
    chip.className = `nuvem-chip ${c.cls}${nuvem.modo === 'nuvem' && nuvem.papel === 'anonimo' ? ' nv-anon' : ''}`;
    chip.innerHTML = `${icone(nuvem.modo === 'local' ? 'info' : 'camadas', 15)}<span>${esc(c.txt)}</span><em>${esc(nuvem.modo === 'local' ? '' : nuvem.papel === 'anonimo' ? 'Entrar' : ROT_PAPEL[nuvem.papel])}</em>`;
  }
  const rod = document.querySelector('.lateral-rodape') as HTMLElement | null;
  if (rod) {
    const ini = nuvem.email ? nuvem.email.slice(0, 2).toUpperCase() : '··';
    rod.innerHTML = nuvem.modo === 'local'
      ? `<span class="avatar">LC</span><div><b>Modo local</b><small>Nada vai para a nuvem</small></div>`
      : `<span class="avatar">${esc(ini)}</span><div><b>${esc(nuvem.email || 'Visitante')}</b><small>${esc(ROT_PAPEL[nuvem.papel])} · <button class="link" data-nuvem-abrir>${nuvem.papel === 'anonimo' ? 'Entrar' : 'Conta'}</button></small></div>`;
  }
  document.body.classList.toggle('somente-leitura', nuvem.modo === 'nuvem' && !(nuvem.papel === 'gestor' || nuvem.papel === 'lider'));
  atualizarFaixa();
}

/** Faixa no topo: de onde vêm os dados. */
export function atualizarFaixa() {
  const faixa = document.querySelector('.faixa-demo') as HTMLElement | null;
  if (!faixa || !estado.ds) return;
  const span = faixa.querySelector('span')!;
  const m = metaNuvem();
  if (nuvem.modo === 'nuvem' && m.vinculado && !nuvem.nuvemVazia) {
    faixa.classList.add('propria'); faixa.classList.toggle('nv-faixa-ro', !(nuvem.papel === 'gestor' || nuvem.papel === 'lider'));
    span.innerHTML = `<b>Dados da nuvem</b> · compartilhados com a equipe${nuvem.atualizadoEm ? ` · última gravação ${esc(hora(nuvem.atualizadoEm))}${nuvem.atualizadoPor ? ` por ${esc(nuvem.atualizadoPor)}` : ''}` : ''}${nuvem.papel === 'gestor' || nuvem.papel === 'lider' ? '' : ' · <b>somente leitura</b> (entre para lançar)'}`;
    return;
  }
  faixa.classList.remove('nv-faixa-ro');
  const propria = estado.ds.origemBase === 'propria';
  faixa.classList.toggle('propria', propria);
  span.innerHTML = nuvem.modo === 'local'
    ? (propria ? '<b>Base própria</b> · modo local: dados só neste aparelho, nada vai para a nuvem · faça backup em Configurações regularmente.' : '<b>DADOS DE DEMONSTRAÇÃO — fictícios.</b> Modo local: nada vai para a nuvem.')
    : nuvem.nuvemVazia
      ? `<b>A nuvem ainda não tem dados.</b> ${propria ? 'Base deste aparelho' : 'Dados de demonstração'} · o Gestor faz o primeiro envio em <button class="link" data-nuvem-abrir>Nuvem e acesso</button>.`
      : propria ? '<b>Base própria</b> · conectando à nuvem…' : '<b>DADOS DE DEMONSTRAÇÃO — fictícios.</b> Conectando à nuvem…';
}

export function iniciarNuvemUI() {
  const topo = document.querySelector('.topo') as HTMLElement;
  const btn = document.createElement('button');
  btn.setAttribute('data-nuvem-chip', ''); btn.setAttribute('aria-label', 'Nuvem e acesso');
  topo.insertBefore(btn, topo.querySelector('.btn-topo'));
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-nuvem-chip]')) { if (nuvem.atualizacaoAdiada && !document.querySelector('.modal-fundo')) mostrarAtualizacao(); else abrirPainelNuvem(); }
    else if (t.closest('[data-nuvem-abrir]')) { e.preventDefault(); abrirPainelNuvem(); }
  });
  aoMudarNuvem(desenharIndicadores);
  desenharIndicadores();
  // volta do e-mail (confirmação de conta / nova senha)
  const ret = lerRetornoDoEmail();
  if (ret?.erro) toast(`Link do e-mail inválido ou vencido: ${ret.erro}`, 'erro');
  else if (ret?.tipo === 'recovery') { void atualizarPerfil(); abrirNovaSenha(); }
  else if (ret?.tipo) { void atualizarPerfil().then(() => toast(`E-mail confirmado. Você entrou como ${ROT_PAPEL[nuvem.papel]}.`, 'ok')); }
}

function abrirNovaSenha() {
  const m = abrirModal('Definir nova senha', `<p class="nota">Escolha a nova senha (mínimo 8 caracteres).</p>
    <label class="campo"><span>Nova senha</span><input type="password" data-ns autocomplete="new-password"></label><div data-ns-msg></div>`,
  { rodapeHTML: `<button class="btn btn-sec" data-fechar>Cancelar</button><button class="btn btn-pri" data-ns-ok>Salvar senha</button>` });
  m.el.querySelector('[data-ns-ok]')!.addEventListener('click', async () => {
    const v = (m.el.querySelector('[data-ns]') as HTMLInputElement).value;
    const msg = m.el.querySelector('[data-ns-msg]') as HTMLElement;
    if (v.length < 8) { msg.innerHTML = aviso('critico', 'Use ao menos 8 caracteres.'); return; }
    try { await trocarSenha(v); m.fechar(); toast('Senha alterada.', 'ok'); } catch (e) { msg.innerHTML = aviso('critico', esc((e as Error).message)); }
  });
}

// ---------------------------------------------------------------------------------------------------
export function abrirPainelNuvem() {
  document.querySelector('.modal-fundo[data-nuvem-painel]')?.remove();
  const m = abrirModal('Nuvem e acesso', '<div data-np></div>', { largura: 'lg', rodapeHTML: '<button class="btn btn-sec" data-fechar>Fechar</button>' });
  m.el.setAttribute('data-nuvem-painel', '');
  const host = m.el.querySelector('[data-np]') as HTMLElement;
  // redesenha tudo só quando muda o que define as seções (perfil, modo, nuvem vazia); senão só a situação —
  // assim mensagens e campos digitados não somem a cada verificação automática
  const estrutura = () => `${nuvem.modo}|${nuvem.papel}|${nuvem.email}|${nuvem.nuvemVazia}`;
  let atual = '';
  const desligar = aoMudarNuvem(() => {
    if (!host.isConnected) { desligar(); return; }
    if (estrutura() !== atual && !host.contains(document.activeElement)) desenhar();
    else { const st = host.querySelector('[data-np-status]'); if (st) st.outerHTML = secaoStatus(); ligarStatus(host); }
  });
  const desenhar = () => { atual = estrutura(); host.innerHTML = corpoPainel(); ligarPainel(host, desenhar); };
  desenhar();
}

function secaoStatus(): string {
  const mt = metaNuvem();
  const c = textoChip();
  return `<section class="np-sec" data-np-status><h3 class="sec-tit">${icone('camadas', 16)} Situação</h3>
    <div class="chips-info"><span>Situação <b class="${c.cls}">${esc(c.txt)}</b></span><span>Versão na nuvem <b>${nuvem.versao}</b></span>${nuvem.atualizadoEm ? `<span>Última gravação <b>${esc(hora(nuvem.atualizadoEm))}</b>${nuvem.atualizadoPor ? ` por ${esc(nuvem.atualizadoPor)}` : ''}</span>` : ''}${mt.pendente ? '<span><b>Há alterações deste aparelho aguardando envio</b></span>' : ''}</div>
    ${nuvem.erro ? aviso('critico', esc(nuvem.erro)) : ''}
    <div class="np-acoes"><button class="btn btn-sec btn-peq" data-np-st="sync">${icone('restaurar', 14)} Sincronizar agora</button>${nuvem.atualizacaoAdiada ? `<button class="btn btn-pri btn-peq" data-np-st="mostrar">Mostrar atualização</button>` : ''}</div>
    <p class="nota">Endereço do projeto: <code>${esc(NUVEM.url)}</code>. Quem tem o link do app vê os dados; para gravar é preciso entrar como Líder ou Gestor.</p></section>`;
}

function ligarStatus(host: HTMLElement) {
  host.querySelectorAll<HTMLButtonElement>('[data-np-st]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { if (b.dataset.npSt === 'mostrar') mostrarAtualizacao(); else { await enviar(); await puxar(true); toast('Sincronizado.', 'ok'); } }
    catch (e) { toast((e as Error).message, 'erro'); } finally { b.disabled = false; }
  }));
}

function corpoPainel(): string {
  if (nuvem.modo === 'local') {
    return `${aviso('atencao', '<b>Modo local ativo.</b> Os dados ficam só neste aparelho e nada é enviado para a nuvem. Use para testes ou se não quiser compartilhar.')}
      <button class="btn btn-pri" data-np="modo-nuvem">${icone('camadas', 15)} Voltar a usar a nuvem</button>`;
  }
  const status = secaoStatus();

  const conta = nuvem.papel === 'anonimo'
    ? `<section class="np-sec"><h3 class="sec-tit">${icone('pessoa', 16)} Entrar</h3>
        <p class="nota">Sem login você <b>só vê</b>. Líderes e Gestores entram com o e-mail e a senha que o Gestor criou. Não tem conta? Peça ao Gestor.</p>
        <div class="form-grade"><label class="campo"><span>E-mail</span><input type="email" data-np-email autocomplete="username" inputmode="email"></label>
        <label class="campo"><span>Senha</span><input type="password" data-np-senha autocomplete="current-password"></label></div>
        <div class="np-acoes"><button class="btn btn-pri" data-np="entrar">${icone('ok', 15)} Entrar</button><button class="link" data-np="esqueci">Esqueci a senha</button></div>
        <div data-np-msg></div></section>`
    : `<section class="np-sec"><h3 class="sec-tit">${icone('pessoa', 16)} Sua conta</h3>
        <div class="chips-info"><span>E-mail <b>${esc(nuvem.email)}</b></span><span>Perfil <b>${esc(ROT_PAPEL[nuvem.papel])}</b></span></div>
        ${nuvem.papel === 'visualizador' ? aviso('info', 'Seu perfil é <b>Visualizador</b> (só leitura). Se você deveria lançar, peça ao Gestor para liberar seu e-mail como Líder. Se acabou de criar a conta, confirme o e-mail pelo link recebido e clique em "Atualizar perfil".') : ''}
        <div class="np-acoes"><button class="btn btn-sec btn-peq" data-np="perfil">Atualizar perfil</button><button class="btn btn-sec btn-peq" data-np="senha">Trocar senha</button><button class="btn btn-sec btn-peq" data-np="sair">Sair</button></div><div data-np-msg></div></section>`;

  const envio = nuvem.nuvemVazia && ehGestor()
    ? `<section class="np-sec np-dest"><h3 class="sec-tit">${icone('camadas', 16)} Primeiro envio</h3>
        <p>A nuvem ainda não tem dados. Envie a base <b>deste aparelho</b> para que toda a equipe passe a ver e lançar nela:</p>
        <div class="chips-info"><span>Base <b>${estado.ds.origemBase === 'propria' ? 'própria' : 'DEMONSTRAÇÃO (fictícia)'}</b></span><span>OS <b>${estado.ds.ordens.length}</b></span><span>Voos <b>${estado.ds.operacoes.length}</b></span><span>Fazendas <b>${estado.ds.fazendas.length}</b></span><span>Campanhas <b>${estado.ds.campanhas.length}</b></span></div>
        ${estado.ds.origemBase === 'propria' ? '' : aviso('atencao', 'Este aparelho está com <b>dados de demonstração</b>. Para enviar os seus dados reais, abra aqui o arquivo do protótipo que você já usava (ou importe o backup em Configurações) antes de enviar.')}
        <button class="btn btn-pri" data-np="enviar-base">${icone('ok', 15)} Enviar dados deste aparelho para a nuvem</button><div data-np-envio></div></section>`
    : '';

  const gestor = nuvem.papel === 'gestor'
    ? `<section class="np-sec"><h3 class="sec-tit">${icone('clientes', 16)} Usuários e perfis</h3>
        <p class="nota"><b>1.</b> Libere aqui o e-mail com o perfil. <b>2.</b> No painel do Supabase: <b>Authentication → Users → Add user → Create new user</b>, com o mesmo e-mail, uma senha provisória e <b>Auto Confirm User</b> marcado. <b>3.</b> Passe a senha à pessoa; ela entra e troca em "Trocar senha".<br><b>Líder</b>: lança o dia a dia (fechamento, dias parados, OS, estações). <b>Gestor</b>: tudo, inclusive campanhas, metas, safra, cadastros e usuários. <b>Visualizador</b>: só vê (igual a quem não entra).</p>
        <div class="form-grade compacta"><label class="campo"><span>E-mail</span><input type="email" data-np-novo-email inputmode="email"></label>
        <label class="campo"><span>Perfil</span><select data-np-novo-papel><option value="lider">Líder</option><option value="gestor">Gestor</option><option value="visualizador">Visualizador</option></select></label>
        <div class="campo"><span>&nbsp;</span><button class="btn btn-pri" data-np="liberar">Liberar acesso</button></div></div>
        <div data-np-usuarios><p class="nota">Carregando…</p></div></section>`
    : '';

  const hist = nuvem.papel === 'gestor' || nuvem.papel === 'lider'
    ? `<section class="np-sec"><h3 class="sec-tit">${icone('historico', 16)} Versões anteriores</h3>
        <p class="nota">Cada gravação guarda a versão anterior (últimas 60).${nuvem.papel === 'gestor' ? ' O Gestor pode voltar a qualquer uma; a versão atual também fica guardada antes.' : ''}</p>
        <div data-np-hist><button class="btn btn-sec btn-peq" data-np="hist">Ver versões</button></div></section>`
    : '';

  const guardadas = Object.keys(localStorage).filter((k) => k.startsWith(`${PREFIXO}dataset-antes-da-nuvem-`));
  const antigas = guardadas.length
    ? `<section class="np-sec"><h3 class="sec-tit">${icone('restaurar', 16)} Bases guardadas deste aparelho</h3><p class="nota">Cópia da base que estava neste aparelho antes de passar a usar a nuvem.</p>
        ${guardadas.map((k) => `<div class="np-linha"><span>${esc(hora(new Date(Number(k.split('-').pop())).toISOString()))}</span><button class="btn btn-sec btn-peq" data-np-baixar="${esc(k)}">Baixar (backup .json)</button></div>`).join('')}</section>`
    : '';

  const teste = `<section class="np-sec"><h3 class="sec-tit">${icone('alerta', 16)} Teste de segurança</h3>
    <p class="nota">Tenta, <b>sem login</b>, gravar, alterar, apagar e ver usuários no seu projeto. Todas as tentativas precisam ser <b>recusadas</b> pela nuvem; só a leitura dos dados pode passar.</p>
    <button class="btn btn-sec btn-peq" data-np="teste">Testar segurança da nuvem</button><div data-np-teste></div></section>`;

  const local = `<p class="nota np-local"><button class="link" data-np="modo-local">Usar só neste aparelho (modo local, sem nuvem)</button></p>`;
  return status + conta + envio + gestor + hist + antigas + teste + local;
}

function ligarPainel(host: HTMLElement, desenhar: () => void) {
  const val = (sel: string) => (host.querySelector(sel) as HTMLInputElement | null)?.value ?? '';
  const msg = (html: string) => { const el = host.querySelector('[data-np-msg]') as HTMLElement | null; if (el) el.innerHTML = html; };
  const ocupado = async (b: HTMLButtonElement, f: () => Promise<void>) => { b.disabled = true; try { await f(); } finally { b.disabled = false; } };
  host.querySelectorAll<HTMLButtonElement>('[data-np]').forEach((b) => b.addEventListener('click', () => void ocupado(b, async () => {
    try {
      switch (b.dataset.np) {
        case 'entrar':
          await entrar(val('[data-np-email]'), val('[data-np-senha]'));
          await atualizarPerfil(); await puxar(true);
          toast(`Você entrou como ${ROT_PAPEL[nuvem.papel]}.`, 'ok'); desenhar(); break;
        case 'criar': {
          const s = val('[data-np-senha]');
          if (s.length < 8) { msg(aviso('critico', 'Use uma senha com ao menos 8 caracteres.')); return; }
          const r = await criarConta(val('[data-np-email]'), s);
          if (r === 'pronto') { await atualizarPerfil(); desenhar(); toast('Conta criada.', 'ok'); }
          else msg(aviso('info', `Conta criada. Abra o e-mail enviado para <b>${esc(val('[data-np-email]'))}</b> e clique no link de confirmação (veja também o spam). Depois volte aqui e clique em <b>Entrar</b>.`));
          break;
        }
        case 'esqueci':
          if (!val('[data-np-email]')) { msg(aviso('atencao', 'Digite o e-mail e clique de novo em "Esqueci a senha".')); return; }
          await esqueciSenha(val('[data-np-email]'));
          msg(aviso('info', 'Se o e-mail puder receber mensagens do projeto, chega um link para criar nova senha. Se não chegar em alguns minutos, peça ao Gestor para recriar sua conta com uma senha provisória.')); break;
        case 'perfil': await atualizarPerfil(); desenhar(); break;
        case 'senha': abrirNovaSenha(); break;
        case 'sair': await sair(); await atualizarPerfil(); desenhar(); toast('Você saiu. O app fica só para leitura.', 'info'); break;
        case 'enviar-base': {
          const demo = estado.ds.origemBase !== 'propria';
          if (!(await confirmar('Primeiro envio para a nuvem', `Enviar os dados deste aparelho (${estado.ds.ordens.length} OS, ${estado.ds.operacoes.length} voos${demo ? ', DADOS DE DEMONSTRAÇÃO' : ''}) para a nuvem?\nA partir daí, todos com o link passam a ver estes dados.`, 'Enviar'))) return;
          const erro = await enviarBaseInicial();
          const el = host.querySelector('[data-np-envio]') as HTMLElement | null;
          if (erro) { if (el) el.innerHTML = aviso('critico', esc(erro)); } else { toast('Dados enviados. A nuvem está ativa.', 'ok'); desenhar(); redesenhar(); }
          break;
        }
        case 'liberar': {
          await rpc('definir_papel', { p_email: val('[data-np-novo-email]'), p_papel: val('[data-np-novo-papel]') });
          toast('Acesso liberado.', 'ok'); await listarUsuarios(host); break;
        }
        case 'hist': await listarHistorico(host); break;
        case 'teste': await testeSeguranca(host); break;
        case 'modo-local':
          if (await confirmar('Modo local', 'Neste aparelho o app deixa de usar a nuvem: o que você lançar fica só aqui. Você pode voltar à nuvem depois, aqui mesmo.', 'Usar modo local')) definirModoLocal(true);
          break;
        case 'modo-nuvem': definirModoLocal(false); break;
      }
    } catch (e) { const t = esc((e as Error).message); if (host.querySelector('[data-np-msg]')) msg(aviso('critico', t)); else toast((e as Error).message, 'erro'); }
  })));
  host.querySelectorAll<HTMLButtonElement>('[data-np-baixar]').forEach((b) => b.addEventListener('click', () => {
    const txt = localStorage.getItem(b.dataset.npBaixar!) ?? '';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' }));
    a.download = `backup-antes-da-nuvem-${b.dataset.npBaixar!.split('-').pop()}.json`; a.click();
  }));
  ligarStatus(host);
  if (nuvem.papel === 'gestor') void listarUsuarios(host);
}

async function listarUsuarios(host: HTMLElement) {
  const el = host.querySelector('[data-np-usuarios]') as HTMLElement | null;
  if (!el) return;
  try {
    const us = await rpc<{ email: string; papel: Papel; conta_criada: boolean; confirmado: boolean }[]>('listar_usuarios');
    el.innerHTML = us.length ? `<div class="tabela-rolagem"><table class="tabela tabela-simples"><thead><tr><th>E-mail</th><th>Perfil</th><th>Conta</th><th></th></tr></thead><tbody>
      ${us.map((u) => `<tr data-np-u="${esc(u.email)}"><td>${esc(u.email)}</td><td><select data-np-papel="${esc(u.email)}">${(['lider', 'gestor', 'visualizador'] as Papel[]).map((p) => `<option value="${p}" ${u.papel === p ? 'selected' : ''}>${ROT_PAPEL[p]}</option>`).join('')}</select></td>
        <td>${u.conta_criada ? (u.confirmado ? '<span class="selo selo-ok">ativa</span>' : '<span class="selo selo-atencao">não confirmada (marque Auto Confirm)</span>') : '<span class="selo selo-neutro">criar no Supabase</span>'}</td>
        <td><button class="btn-icone" data-np-rm="${esc(u.email)}" title="Remover acesso">${icone('lixo', 14)}</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="nota">Nenhum usuário ainda.</p>';
    el.querySelectorAll<HTMLSelectElement>('[data-np-papel]').forEach((s) => s.addEventListener('change', async () => {
      try { await rpc('definir_papel', { p_email: s.dataset.npPapel, p_papel: s.value }); toast('Perfil alterado.', 'ok'); if (s.dataset.npPapel === nuvem.email) await atualizarPerfil(); } catch (e) { toast((e as Error).message, 'erro'); }
      await listarUsuarios(host);
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-np-rm]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmar('Remover acesso', `${b.dataset.npRm} passa a só visualizar.`, 'Remover'))) return;
      try { await rpc('remover_acesso', { p_email: b.dataset.npRm }); toast('Acesso removido.', 'ok'); } catch (e) { toast((e as Error).message, 'erro'); }
      await listarUsuarios(host);
    }));
  } catch (e) { el.innerHTML = aviso('critico', esc((e as Error).message)); }
}

async function listarHistorico(host: HTMLElement) {
  const el = host.querySelector('[data-np-hist]') as HTMLElement;
  try {
    const hs = await rpc<{ id: number; versao: number; salvo_em: string; salvo_por: string | null; tamanho_kb: number }[]>('listar_historico');
    el.innerHTML = hs.length ? `<div class="tabela-rolagem"><table class="tabela tabela-simples"><thead><tr><th>Versão</th><th>Gravada em</th><th>Por</th><th class="dir">Tamanho</th><th></th></tr></thead><tbody>
      ${hs.map((h) => `<tr><td>${h.versao}</td><td>${esc(hora(h.salvo_em))}</td><td>${esc(h.salvo_por ?? '')}</td><td class="dir">${h.tamanho_kb} KB</td><td>${nuvem.papel === 'gestor' ? `<div class="np-acoes"><button class="btn btn-sec btn-peq" data-np-recup="${h.id}" data-v="${h.versao}">Recuperar voos</button><button class="btn btn-sec btn-peq" data-np-rest="${h.id}" data-v="${h.versao}">Voltar a esta</button></div>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <p class="nota"><b>Recuperar voos</b>: traz de volta só os voos daquela versão que não existem mais hoje (o resto fica como está). <b>Voltar a esta</b>: a base inteira volta àquela versão.</p>` : '<p class="nota">Ainda não há versões anteriores.</p>';
    el.querySelectorAll<HTMLButtonElement>('[data-np-recup]').forEach((b) => b.addEventListener('click', () => void abrirRecuperar(Number(b.dataset.npRecup), Number(b.dataset.v))));
    el.querySelectorAll<HTMLButtonElement>('[data-np-rest]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmar('Voltar a uma versão anterior', `Os dados de TODA a equipe voltam à versão ${b.dataset.v}. A versão atual fica guardada no histórico (dá para desfazer).`, 'Voltar a esta versão'))) return;
      try { await rpc('restaurar_versao', { p_id: Number(b.dataset.npRest) }); await puxar(true, true); toast(`Dados voltaram à versão ${b.dataset.v}.`, 'ok'); await listarHistorico(host); } catch (e) { toast((e as Error).message, 'erro'); }
    }));
  } catch (e) { el.innerHTML = aviso('critico', esc((e as Error).message)); }
}

/** Teste de segurança executado no navegador do usuário, contra o projeto real, SEM login. */
export async function testeSeguranca(host: HTMLElement) {
  const el = host.querySelector('[data-np-teste]') as HTMLElement;
  el.innerHTML = '<p class="nota">Testando…</p>';
  const recusou = (r: { status: number; corpo: unknown }) => r.status >= 400 || (Array.isArray(r.corpo) && r.corpo.length === 0);
  const casos: { nome: string; deve: 'ler' | 'recusar'; f: () => Promise<{ status: number; corpo: unknown }> }[] = [
    { nome: 'Ler os dados (permitido)', deve: 'ler', f: () => semLogin('/rest/v1/dataset?id=eq.1&select=versao') },
    { nome: 'Gravar pela função salvar_dataset', deve: 'recusar', f: () => semLogin('/rest/v1/rpc/salvar_dataset', { method: 'POST', body: JSON.stringify({ p_dados: { operacoes: [] }, p_versao_base: nuvem.versao }) }) },
    { nome: 'Alterar a tabela de dados', deve: 'recusar', f: () => semLogin('/rest/v1/dataset?id=eq.1', { method: 'PATCH', body: JSON.stringify({ versao: 999999 }) }) },
    { nome: 'Apagar os dados', deve: 'recusar', f: () => semLogin('/rest/v1/dataset?id=eq.1', { method: 'DELETE' }) },
    { nome: 'Inserir dados', deve: 'recusar', f: () => semLogin('/rest/v1/dataset', { method: 'POST', body: JSON.stringify({ id: 2, versao: 0 }) }) },
    { nome: 'Ler o histórico direto', deve: 'recusar', f: () => semLogin('/rest/v1/dataset_historico?select=id&limit=1') },
    { nome: 'Ver usuários (perfis)', deve: 'recusar', f: () => semLogin('/rest/v1/perfis?select=email&limit=1') },
    { nome: 'Ver convites', deve: 'recusar', f: () => semLogin('/rest/v1/convites?select=email&limit=1') },
    { nome: 'Listar usuários pela função', deve: 'recusar', f: () => semLogin('/rest/v1/rpc/listar_usuarios', { method: 'POST', body: '{}' }) },
    { nome: 'Dar-se o papel de Gestor', deve: 'recusar', f: () => semLogin('/rest/v1/rpc/definir_papel', { method: 'POST', body: JSON.stringify({ p_email: 'teste@exemplo.com', p_papel: 'gestor' }) }) },
    { nome: 'Restaurar versão', deve: 'recusar', f: () => semLogin('/rest/v1/rpc/restaurar_versao', { method: 'POST', body: JSON.stringify({ p_id: 1 }) }) },
    { nome: 'Ler versão anterior', deve: 'recusar', f: () => semLogin('/rest/v1/rpc/ler_versao', { method: 'POST', body: JSON.stringify({ p_id: 1 }) }) },
  ];
  const linhas: string[] = [];
  let ok = 0;
  for (const c of casos) {
    const r = await c.f();
    const passou = r.status !== 0 && (c.deve === 'ler' ? r.status < 300 && Array.isArray(r.corpo) && r.corpo.length === 1 : recusou(r));
    if (passou) ok++;
    linhas.push(`<tr><td>${esc(c.nome)}</td><td>${c.deve === 'ler' ? 'pode ler' : 'tem que recusar'}</td><td>${r.status === 0 ? 'sem conexão' : `HTTP ${r.status}`}</td><td>${passou ? '<span class="selo selo-ok">PASSOU</span>' : '<span class="selo selo-critico">FALHOU</span>'}</td></tr>`);
  }
  // confere que nada mudou
  const depois = await semLogin('/rest/v1/dataset?id=eq.1&select=versao');
  const v = Array.isArray(depois.corpo) ? (depois.corpo[0] as { versao?: number } | undefined)?.versao : undefined;
  const intacto = v === nuvem.versao || v === undefined ? true : v !== 999999;
  if (intacto) ok++;
  linhas.push(`<tr><td>Dados continuam intactos após as tentativas</td><td>versão sem mudança</td><td>versão ${v ?? '—'}</td><td>${intacto ? '<span class="selo selo-ok">PASSOU</span>' : '<span class="selo selo-critico">FALHOU</span>'}</td></tr>`);
  const total = casos.length + 1;
  el.innerHTML = `${ok === total ? aviso('info', `<b>${ok}/${total} verificações passaram.</b> Sem login, a nuvem só permite ler.`) : aviso('critico', `<b>${ok}/${total} passaram.</b> Algo não está protegido: confira se o script do banco foi aplicado inteiro e me envie esta tela.`)}
    <div class="tabela-rolagem"><table class="tabela tabela-simples" data-np-teste-tab><thead><tr><th>Tentativa sem login</th><th>Esperado</th><th>Resposta</th><th>Resultado</th></tr></thead><tbody>${linhas.join('')}</tbody></table></div>`;
}


/** Recuperar voos de uma versão anterior (só o Gestor): mostra o que sumiu e devolve só o que for marcado. */
async function abrirRecuperar(id: number, versao: number) {
  let antigo: Dataset | null = null;
  try {
    const r = await rpc<{ versao: number; salvo_em: string; dados: Dataset } | null>('ler_versao', { p_id: id });
    antigo = r?.dados ?? null;
  } catch (e) { toast((e as Error).message.includes('ler_versao') || (e as Error).message.includes('Could not find') ? 'Falta atualizar o banco: rode no SQL Editor o script de atualização (supabase-atualizacao-v1.7.3.sql).' : (e as Error).message, 'erro'); return; }
  if (!antigo) { toast('Versão não encontrada.', 'erro'); return; }
  const aus = voosAusentes(estado.ds, antigo);
  const nomeAc = (idA: string) => antigo!.aeronaves?.find((a) => a.id === idA)?.identificacao ?? estado.ds.aeronaves.find((a) => a.id === idA)?.identificacao ?? '—';
  const nomeTurno = (idT: string) => antigo!.turnos?.find((t) => t.id === idT)?.nome ?? estado.ds.turnos.find((t) => t.id === idT)?.nome ?? '—';
  const nomeOS = (o: Operacao) => { const os = estado.ds.ordens.find((x) => x.id === o.osId) ?? antigo!.ordens?.find((x) => x.id === o.osId); const fz = os ? (estado.ds.fazendas.find((f) => f.id === os.fazendaId) ?? antigo!.fazendas?.find((f) => f.id === os.fazendaId)) : null; return `${fz?.nome ?? '—'} · OS ${os?.numero ?? '?'}`; };
  const m = abrirModal(`Recuperar voos da versão ${versao}`, aus.length
    ? `<p class="nota">Voos que existiam na versão ${versao} e <b>não existem mais</b> hoje. Marque os que devem voltar; nada do que existe hoje é alterado.</p>
      <div class="tabela-rolagem"><table class="tabela tabela-simples"><thead><tr><th></th><th>Data</th><th>Turno</th><th>Drone</th><th>Fazenda / OS</th><th>Horário</th><th class="dir">Área</th></tr></thead><tbody>
      ${aus.map((a) => `<tr><td><input type="checkbox" data-rv="${esc(a.op.id)}"></td><td>${esc(fmtDataBR(a.op.data))}</td><td>${esc(nomeTurno(a.op.turnoId))}</td><td>${esc(nomeAc(a.op.aeronaveId))}</td><td>${esc(nomeOS(a.op))}</td><td>${esc(a.op.horaInicio)}–${esc(a.op.horaFim ?? '')}</td><td class="dir">${esc(a.area.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))} ha</td></tr>`).join('')}
      </tbody></table></div><div data-rv-tot class="nota"></div><div data-rv-msg></div>`
    : `<p class="nota">Nenhum voo dessa versão está faltando hoje.</p>`,
  { largura: 'lg', rodapeHTML: `<button class="btn btn-sec" data-fechar>Fechar</button>${aus.length ? '<button class="btn btn-pri" data-rv-ok disabled>Recuperar marcados</button>' : ''}` });
  const marcados = () => [...m.el.querySelectorAll<HTMLInputElement>('[data-rv]:checked')].map((x) => x.dataset.rv!);
  const tot = () => {
    const ids = marcados(); const area = aus.filter((a) => ids.includes(a.op.id)).reduce((s2, a) => s2 + a.area, 0);
    const t = m.el.querySelector('[data-rv-tot]') as HTMLElement | null; if (t) t.textContent = ids.length ? `${ids.length} voo(s) · ${area.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha marcados` : '';
    const b = m.el.querySelector('[data-rv-ok]') as HTMLButtonElement | null; if (b) b.disabled = !ids.length;
  };
  m.el.addEventListener('change', tot);
  m.el.querySelector('[data-rv-ok]')?.addEventListener('click', () => {
    const erro = alterar((ds) => recuperarVoos(ds, antigo!, marcados(), versao));
    if (erro) { (m.el.querySelector('[data-rv-msg]') as HTMLElement).innerHTML = aviso('critico', esc(erro)); return; }
    m.fechar(); toast('Voos recuperados. A nuvem é atualizada em seguida.', 'ok'); redesenhar();
  });
}
const fmtDataBR = (d: string) => d.split('-').reverse().join('/');
