"""Menu lateral recolhível no computador: recolher dá a largura toda ao conteúdo (e à imagem exportada);
o ☰ abre como gaveta; "fixar" volta ao normal; a escolha fica gravada no aparelho."""
import sys, pathlib, struct
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri() + '?modo=local'  # sem nuvem nos testes de tela
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c
def largura_png(caminho):
    d = open(caminho, 'rb').read(32); return struct.unpack('>II', d[16:24])[0] if d[:8] == b'\x89PNG\r\n\x1a\n' else 0

with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    pg = ctx.new_page(); erros = []; pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.goto(URL + '#/relatorios/diario'); pg.wait_for_selector('[data-acao="imagem"]')
    x0 = pg.evaluate("document.querySelector('.principal').getBoundingClientRect().left"); w0 = pg.evaluate("document.querySelector('#conteudo').getBoundingClientRect().width")
    ok('menu fixo por padrão: conteúdo começa depois do menu', x0 > 200 and pg.is_visible('.fixar-menu') and not pg.is_visible('.topo .abrir-menu'))
    with pg.expect_download() as d1: pg.click('[data-acao="imagem"]')
    l1 = largura_png(d1.value.path())
    pg.click('.fixar-menu'); pg.wait_for_selector('[data-acao="imagem"]'); pg.wait_for_timeout(400)
    x1 = pg.evaluate("document.querySelector('.principal').getBoundingClientRect().left"); w1 = pg.evaluate("document.querySelector('#conteudo').getBoundingClientRect().width")
    ok(f'recolher: conteúdo usa a largura toda ({round(w0)} → {round(w1)} px) e aparece o ☰', x1 == 0 and w1 > w0 + 200 and pg.is_visible('.topo .abrir-menu'))
    ok('menu fica fora da tela', pg.evaluate("document.querySelector('.lateral').getBoundingClientRect().right") <= 0)
    with pg.expect_download() as d2: pg.click('[data-acao="imagem"]')
    l2 = largura_png(d2.value.path())
    ok(f'imagem exportada do Diário fica mais larga ({l1} → {l2} px)', l2 > l1 + 300)
    pg.reload(); pg.wait_for_selector('[data-acao="imagem"]')
    ok('a escolha fica gravada (continua recolhido após recarregar)', pg.evaluate("document.body.classList.contains('menu-recolhido')") and pg.evaluate("document.querySelector('.principal').getBoundingClientRect().left") == 0)
    pg.click('.topo .abrir-menu'); pg.wait_for_timeout(300)
    ok('☰ abre o menu como gaveta por cima', pg.evaluate("document.querySelector('.lateral').getBoundingClientRect().left") == 0 and pg.is_visible('.fundo-menu'))
    pg.click('.lateral nav a[data-rota="dashboard"]'); pg.wait_for_selector('.destaque-valor'); pg.wait_for_timeout(300)
    ok('escolher uma tela fecha a gaveta', pg.evaluate("document.querySelector('.lateral').getBoundingClientRect().right") <= 0)
    pg.click('.topo .abrir-menu'); pg.wait_for_timeout(300); pg.click('.fixar-menu'); pg.wait_for_timeout(400)
    ok('"fixar" volta o menu fixo ao lado do conteúdo', not pg.evaluate("document.body.classList.contains('menu-recolhido')") and pg.evaluate("document.querySelector('.principal').getBoundingClientRect().left") > 200)
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(300)
    ok('no celular: sem o botão de fixar (menu já é gaveta)', not pg.is_visible('.fixar-menu') and pg.is_visible('.topo .abrir-menu'))
    ok('sem erros de página', not erros)
    b.close()
for r, n in res: print(r, n)
print(f"{sum(1 for r, _ in res if r == 'PASSOU')}/{len(res)} passaram")
