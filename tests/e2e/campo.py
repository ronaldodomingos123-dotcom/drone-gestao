"""Turno completo no registro de campo: 2 drones, pausa, mudança de área, virada da meia-noite e drone impedido por chuva."""
import sys, pathlib, re
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri() + '?modo=local'  # sem nuvem nos testes de tela
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c

def turno(vp, rot, mobile=False):
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport=vp, is_mobile=mobile, has_touch=mobile)
        erros = []; pg.on('pageerror', lambda e: erros.append(str(e)))
        pg.goto(URL + '#/campo'); pg.wait_for_selector('#campo')
        n0 = pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:dataset')).operacoes.length")
        pg.select_option('[data-k="turnoId"]', 'tn-a')
        ok(f'[{rot}] líder e responsável vêm do turno', pg.locator('[data-k="liderId"]').input_value() == 'ld-1' and pg.locator('[data-k="responsavel"]').input_value() == 'Joana Ribeiro')
        pg.select_option('[data-k="campanhaId"]', 'cp-mat')
        pg.click('[data-a="add-clima"][data-m="inicio"]')
        pg.fill('[data-k="clima.0.temperaturaC"]', '24'); pg.fill('[data-k="clima.0.umidadePct"]', '70'); pg.fill('[data-k="clima.0.ventoKmh"]', '6')
        pg.fill('[data-k="clima.0.hora"]', '18:00')
        def drone(i): return pg.locator('.campo-drone').nth(i)
        def hora(i, h):
            el = drone(i).locator('[data-ui$=".hora"]'); el.fill(h)
        # drone 1
        pg.click('[data-a="add-drone"]')
        drone(0).locator('[data-k$=".pilotoId"]').select_option('pl-1')
        os_opts = drone(0).locator('select.campo-os option').all()
        os1 = os_opts[1].get_attribute('value'); os2 = os_opts[2].get_attribute('value')
        drone(0).locator('select.campo-os').select_option(os1)
        hora(0, '18:00'); drone(0).locator('[data-a="iniciar"]').click()
        ok(f'[{rot}] drone inicia e mostra "Aplicando"', 'Aplicando' in drone(0).inner_text())
        drone(0).locator('summary').click(); drone(0).locator('[data-a="add-talhao"]').first.click()
        drone(0).locator('[data-k$=".itens.0.areaHa"]').fill('20')
        hora(0, '19:00')
        ok(f'[{rot}] parciais usam a hora da ação (1h efetivo até 19:00)', 'Efetivo 1h 00min' in drone(0).locator('.campo-drone-met').inner_text().replace('\n', ' ') and 'parciais até 19:00' in drone(0).locator('.campo-drone-met').inner_text())
        drone(0).locator('[data-a="painel-pausar"]').click(); drone(0).locator('[data-a="pausar"][data-m="Vento acima do limite"]').click()
        ok(f'[{rot}] pausa registra motivo e horário', 'Vento acima do limite desde 19:00' in drone(0).inner_text())
        hora(0, '19:30'); drone(0).locator('[data-a="retomar"]').click()
        hora(0, '21:00'); drone(0).locator('[data-a="painel-mudar"]').click()
        drone(0).locator('.campo-painel select.campo-os').select_option(os2); drone(0).locator('[data-a="mudar"]').click()
        ok(f'[{rot}] mudança de área abre trecho 2', 'Trecho 2' in drone(0).inner_text())
        drone(0).locator('.campo-trecho').nth(1).locator('summary').click(); drone(0).locator('.campo-trecho').nth(1).locator('[data-a="add-talhao"]').first.click()
        drone(0).locator('[data-k$=".trechos.1.itens.0.areaHa"]').fill('15,5')
        hora(0, '00:30'); drone(0).locator('[data-a="finalizar"]').click()
        met = drone(0).locator('.campo-drone-met').inner_text()
        ok(f'[{rot}] métricas do drone: jornada 6h30, parado 30min, efetivo 6h', '6h 30min' in met and 'Parado 30min' in met.replace('\n', ' ') and '6h 00min' in met)
        # recarregar no meio do turno não perde nada
        pg.reload(); pg.wait_for_selector('.campo-drone')
        ok(f'[{rot}] boletim preservado após recarregar', 'Trecho 2' in drone(0).inner_text() and pg.locator('[data-k="turnoId"]').input_value() == 'tn-a')
        # drone 2 impedido por chuva
        pg.click('[data-a="add-drone"]')
        drone(1).locator('[data-k$=".pilotoId"]').select_option('pl-2')
        drone(1).locator('select.campo-os').select_option(os1)
        hora(1, '18:10'); drone(1).locator('[data-a="iniciar"]').click()
        hora(1, '18:15'); drone(1).locator('[data-a="painel-pausar"]').click(); drone(1).locator('[data-a="pausar"][data-m="Chuva"]').click()
        # tentar fechar com drone 2 em aberto
        pg.click('[data-a="fechar"]')
        ok(f'[{rot}] fechar bloqueado com drone não finalizado', 'finalize o drone' in pg.locator('#campo-msgs').inner_text())
        hora(1, '19:00'); drone(1).locator('[data-a="finalizar"]').click()
        ok(f'[{rot}] linha do tempo do turno montada', pg.locator('[data-met="tempo"] .ev').count() >= 7)
        if SHOTS: pg.screenshot(path=str(SHOTS / f'{rot}-campo.png'), full_page=True)
        pg.click('[data-a="fechar"]'); pg.wait_for_selector('.modal')
        modal = pg.locator('.modal').inner_text()
        ok(f'[{rot}] resumo de fechamento: 3 operações, 35,50 ha', '3' in modal and '35,50 ha' in modal and 'impedida' in modal)
        pg.click('[data-ok]'); pg.wait_for_url(re.compile('#/relatorios/diario'))
        ds = pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:dataset'))")
        novas = [o for o in ds['operacoes'] if o['origem'] == 'registro_prototipo']
        ok(f'[{rot}] 3 operações gravadas de uma vez', len(ds['operacoes']) == n0 + 3 and len(novas) == 3)
        t1 = [o for o in novas if o['horaInicio'] == '18:00'][0]; t2 = [o for o in novas if o['horaInicio'] == '21:00'][0]
        ok(f'[{rot}] trecho 1: 18:00–21:00, efetivo 150 min', t1['horaFim'] == '21:00' and t1['tempoEfetivoMin'] == 150)
        ok(f'[{rot}] trecho 2: 21:00–00:30, efetivo 210 min', t2['horaFim'] == '00:30' and t2['tempoEfetivoMin'] == 210)
        ok(f'[{rot}] drone 2 gravado como impedido por clima', any(o['status'] == 'impedida_clima' for o in novas))
        ok(f'[{rot}] turno e líder gravados', all(o['turnoId'] == 'tn-a' and o['liderId'] == 'ld-1' for o in novas))
        pg.wait_for_selector('.dia-cab')
        ok(f'[{rot}] diário abre no dia do turno com a área gravada', '35,5' in pg.locator('.dia-linha').first.inner_text())
        ok(f'[{rot}] boletim limpo após gravar', pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:boletim')).drones.length") == 0)
        ok(f'[{rot}] sem erros de JavaScript', not erros)
        if erros: print(erros)
        b.close()

turno({'width': 1440, 'height': 900}, 'desktop')
turno({'width': 390, 'height': 844}, 'iphone', True)
for s, n in res: print(f'{s}  {n}')
print(f"\n{sum(1 for s,_ in res if s=='PASSOU')}/{len(res)} verificações passaram")
sys.exit(0 if all(s == 'PASSOU' for s, _ in res) else 1)
