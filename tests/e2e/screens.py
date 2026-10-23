"""Capturas de tela em 3 dispositivos + coleta de erros de console em todas as rotas."""
import sys, pathlib
from playwright.sync_api import sync_playwright
OUT = pathlib.Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
URL = pathlib.Path('dist/index.html').resolve().as_uri() + '?modo=local'  # sem nuvem nos testes de tela
ROTAS = ['dashboard','campo','campanhas','relatorios/sequencia','aplicacoes','aplicacoes/nova','ordens','paradas','clima','planejamento','turnos','fazendas','aeronaves','colaboradores','produtos','relatorios','relatorios/diario','auditoria','configuracoes']
DISP = {'desktop': dict(viewport={'width':1440,'height':900}), 'tablet': dict(viewport={'width':800,'height':1280}, device_scale_factor=2, has_touch=True), 'iphone': dict(viewport={'width':390,'height':844}, device_scale_factor=3, is_mobile=True, has_touch=True)}
erros = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for nome, cfg in DISP.items():
        ctx = b.new_context(**cfg, locale='pt-BR')
        pg = ctx.new_page()
        pg.on('console', lambda m, n=nome: erros.append(f'[{n}] console.{m.type}: {m.text}') if m.type in ('error','warning') else None)
        pg.on('pageerror', lambda e, n=nome: erros.append(f'[{n}] pageerror: {e}'))
        pg.goto(URL); pg.wait_for_timeout(300)
        for r in ROTAS:
            pg.evaluate(f"location.hash = '#/{r}'"); pg.wait_for_timeout(250)
            # sem rolagem horizontal da página
            sw = pg.evaluate('document.documentElement.scrollWidth'); cw = pg.evaluate('document.documentElement.clientWidth')
            if sw > cw + 1: erros.append(f'[{nome}] rolagem horizontal em #{r}: {sw} > {cw}')
            if r in ('relatorios/sequencia','campanhas','auditoria') :
                pg.screenshot(path=str(OUT/f"{nome}-{r.replace('/','-')}.png"), full_page=(nome!='desktop' or r=='dashboard'))
        ctx.close()
    b.close()
print('\n'.join(erros) if erros else 'Sem erros de console/rolagem horizontal.')
