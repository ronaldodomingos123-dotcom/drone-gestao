"""Gera PDFs de OS FICTÍCIOS para testar o importador (layout presumido — a calibrar com um PDF real).
Uso: python3 tests/fixtures/gerar_pdfs.py tests/fixtures"""
import sys, pathlib
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')

def tabela(c, x0, y, cols, linhas, larg):
    c.setFont('Helvetica-Bold', 8)
    for i, h in enumerate(cols): c.drawString(x0 + sum(larg[:i]), y, h)
    c.setFont('Helvetica', 8)
    for ln in linhas:
        y -= 13
        for i, v in enumerate(ln): c.drawString(x0 + sum(larg[:i]), y, v)
    return y

def os_dupla(arq):
    c = canvas.Canvas(str(arq), pagesize=A4); W, H = A4
    c.setFont('Helvetica-Bold', 13); c.drawString(40, H - 50, 'ORDEM DE SERVIÇO - APLICAÇÃO AÉREA (DRONE)')
    c.setFont('Helvetica', 9)
    c.drawString(40, H - 70, 'O.S Nº: 3410'); c.drawString(200, H - 70, 'Emissão: 13/10/2026'); c.drawString(360, H - 70, 'Operação: FUNGICIDA')
    c.drawString(40, H - 84, 'FN: 094 / 095'); c.drawString(200, H - 84, 'Unidade: UNIDADE EXEMPLO')
    y = tabela(c, 40, H - 115, ['Fazenda', 'Nome', 'ZONA', 'Talhão', 'Variedade', 'Área (ha)'], [
        ['094', 'SITIO EXEMPLO A', '90', '19', 'CTC4', '7,36'],
        ['094', 'SITIO EXEMPLO A', '90', '20', 'CTC4', '12,33'],
        ['094', 'SITIO EXEMPLO A', '90', '21', 'RB975201', '7,71'],
        ['095', 'SITIO EXEMPLO B', '91', '01', 'CTC9001', '5,30'],
        ['095', 'SITIO EXEMPLO B', '91', '02', 'CTC9001', '31,75'],
    ], [55, 120, 45, 50, 80, 60])
    c.setFont('Helvetica-Bold', 9); c.drawString(40, y - 16, 'TOTAL'); c.drawString(390, y - 16, '64,45')
    y = tabela(c, 40, y - 50, ['TRATAMENTO 1 - 64,4500 HA', 'DOSE', 'TOTAL'], [
        ['AUREO', '0,0200 L/ha', '1,2890 L'], ['CARAVAN KOPPERT', '0,5000 L/ha', '32,2250 L'], ['DNA GRID', '0,5000 L/ha', '32,2250 L'],
        ['PRIORI TOP SYNGENTA', '0,6000 L/ha', '38,6700 L'], ['RE-LEAF', '1,0000 L/ha', '64,4500 L'], ['SPRAYD FLEX DIRECT', '0,0200 L/ha', '1,2890 L'],
    ], [220, 110, 90])
    tabela(c, 40, y - 30, ['CODIGO', 'RESUMO DE INSUMOS', 'TOTAL'], [
        ['21162', 'AUREO', '1,2890 L'], ['36423', 'CARAVAN KOPPERT', '32,2250 L'], ['17609', 'DNA GRID', '32,2250 L'],
        ['34067', 'PRIORI TOP SYNGENTA', '38,6700 L'], ['19140', 'RE-LEAF', '64,4500 L'], ['21013', 'SPRAYD FLEX DIRECT', '1,2890 L'],
    ], [60, 220, 90])
    c.showPage()
    c.setFont('Helvetica', 9); c.drawString(40, H - 50, 'MAPA DA ÁREA (página ilustrativa)'); c.rect(40, 200, 500, 550)
    c.save()

def os_simples(arq):
    c = canvas.Canvas(str(arq), pagesize=A4); W, H = A4
    c.setFont('Helvetica-Bold', 13); c.drawString(40, H - 50, 'ORDEM DE SERVIÇO')
    c.setFont('Helvetica', 9); c.drawString(40, H - 70, 'OS 3416'); c.drawString(160, H - 70, 'Fazenda: 090 - FAZENDA EXEMPLO C')
    y = tabela(c, 40, H - 100, ['Zona', 'Tn', 'há', 'ñ aplicado'], [['12', '1', '10,10', ''], ['12', '2', '12,60', '0,40'], ['12', '3', '10,00', '']], [50, 50, 60, 60])
    c.drawString(40, y - 20, 'Área total: 32,70 ha')
    c.save()

def os_imagem(arq):
    c = canvas.Canvas(str(arq), pagesize=A4); c.rect(40, 200, 500, 550, fill=1); c.save()

out.mkdir(parents=True, exist_ok=True)
os_dupla(out / 'OS 3410 - FN 094-095 (ficticia).pdf'); os_simples(out / 'OS 3416 - FN 090 (ficticia).pdf'); os_imagem(out / 'OS 9999 - digitalizada (ficticia).pdf')
print('ok')

# ---- PDFs no ESTILO DA OS REAL (quadro "Zonas", tabela FN·ZN·TN·AREA OS·AREA TN·GLEBA·TRATAMENTO
#      com a tabela do tratamento AO LADO, resumo de insumos, "Área Total" e "Área total do KML") ----
import random
PRODUTOS = [('AUREO', 0.02, '21162'), ('CARAVAN KOPPERT', 0.5, '36423'), ('DNA GRID', 0.5, '17609'), ('PRIORI TOP SYNGENTA', 0.6, '34067'), ('RE-LEAF', 1.0, '19140'), ('SPRAYD FLEX DIRECT', 0.02, '21013')]
def br(x, d=2): return f'{x:,.{d}f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
def os_estilo_real(arq, os_n, zonas, rnd):
    """zonas: [(codigo, nome, [(tn, area_os, area_tn)])]"""
    c = canvas.Canvas(str(arq), pagesize=(842, 595)); W, H = 842, 595
    c.setFont('Helvetica', 7); c.drawString(30, H - 20, 'Legendas:'); c.drawString(650, H - 20, 'Lon: -49.0000 // Lat: -22.0000')
    c.rect(30, 330, 780, 230)  # "mapa"
    total = sum(a for _, _, ts in zonas for _, a, _ in ts)
    c.setFont('Helvetica', 8)
    c.drawString(30, 300, 'Data de Emissão:'); c.drawString(110, 300, '13/10/2026')
    c.drawString(250, 305, 'Título: Mapa de O.S APLIC. FUNGICIDA DRONE I')
    c.drawString(30, 285, 'Ordem de Serviço:'); c.drawString(110, 285, str(os_n))
    c.drawString(250, 290, 'Doc. n°:XX-0000-000'); c.drawString(420, 290, 'Versão: 01')
    c.drawString(250, 275, 'Data: 01/01/2020'); c.drawString(420, 275, 'Página: 01/02')
    c.drawString(560, 270, 'Zonas'); c.drawString(760, 270, 'Área (ha)')
    c.drawString(30, 260, 'Centro de Custo:'); c.drawString(110, 260, '95')
    for k, (cod, nome, ts) in enumerate(zonas):
        c.drawString(520, 260 - k * 11, f'{cod} - {nome}'); c.drawString(765, 260 - k * 11, br(sum(a for _, a, _ in ts)))
    c.drawString(30, 245, 'Área Total:'); c.drawString(110, 245, f'{br(total)} ha')
    c.drawString(30, 230, 'Operação:'); c.drawString(110, 230, '118')
    y = 210
    c.setFont('Helvetica-Bold', 7)
    for x, h in [(30, 'FN'), (60, 'ZN'), (85, 'TN'), (110, 'AREA OS'), (150, 'AREA TN'), (195, 'GLEBA'), (230, 'TRATAMENTO'), (330, f'TRATAMENTO 1 - {br(total, 4)} HA'), (560, 'DOSE'), (640, 'TOTAL')]: c.drawString(x, y, h)
    c.setFont('Helvetica', 7)
    linhas = [(cod, tn, a, at) for cod, _, ts in zonas for tn, a, at in ts]
    ys = y
    for i, (cod, tn, a, at) in enumerate(linhas):
        ys = y - 12 - i * 12
        for x, v in [(30, str(1000 + int(cod))), (60, str(int(cod))), (85, str(tn)), (110, br(a)), (150, br(at)), (195, str(300 + rnd.randint(0, 99))), (230, 'Trat. 1')]: c.drawString(x, ys, v)
    for i, (nome, dose, _) in enumerate(PRODUTOS):
        yy = y - 12 - i * 17  # espaçamento diferente: às vezes cai na mesma linha de um talhão
        c.drawString(330, yy, nome); c.drawString(560, yy, f'{br(dose, 4)} L/ha'); c.drawString(640, yy, f'{br(dose * total, 4)} L')
    yr = min(ys, y - 12 - len(PRODUTOS) * 17) - 14
    c.setFont('Helvetica-Bold', 7); c.drawString(335, yr, 'CODIGO'); c.drawString(450, yr, 'RESUMO DE INSUMOS'); c.drawString(640, yr, 'TOTAL'); c.setFont('Helvetica', 7)
    for i, (nome, dose, cod) in enumerate(PRODUTOS):
        c.drawString(340, yr - 11 - i * 11, cod); c.drawString(400, yr - 11 - i * 11, nome); c.drawString(640, yr - 11 - i * 11, f'{br(dose * total, 4)} L')
    c.drawString(500, yr - 11 - 6 * 11, 'ÁREA TOTAL'); c.drawString(640, yr - 11 - 6 * 11, f'{br(total)} ha')
    c.drawString(300, 20, f'Área total do KML: {br(total * 1.04)} ha')
    c.showPage(); c.setFont('Helvetica', 8); c.drawString(30, 560, 'Data da emissão: 13/10/2026'); c.save()

def lote_estilo_real(pasta, n=12, semente=7):
    rnd = random.Random(semente); pasta.mkdir(parents=True, exist_ok=True); arqs = []
    for k in range(n):
        os_n = 5000 + k
        nz = 2 if k % 5 == 0 else 1
        zonas = []
        for z in range(nz):
            cod = f'{100 + k * 3 + z:03d}'
            ts = []
            for t in range(rnd.randint(2, 7)):
                at = round(rnd.uniform(3, 25), 2); a = at if rnd.random() > .2 else round(at * rnd.uniform(.6, .95), 2)
                ts.append((t + 1, a, at))
            zonas.append((cod, f'Fazenda Ficticia {cod}', ts))
        nome = f"OS {os_n} - FN {'-'.join(z[0] for z in zonas)}.pdf"
        os_estilo_real(pasta / nome, os_n, zonas, rnd); arqs.append((nome, zonas))
    return arqs

if __name__ == '__main__' and len(sys.argv) > 2 and sys.argv[2] == 'lote':
    import json
    arqs = lote_estilo_real(out / 'lote', int(sys.argv[3]) if len(sys.argv) > 3 else 12)
    (out / 'lote' / 'esperado.json').write_text(json.dumps([{'arquivo': n, 'zonas': [{'cod': c, 'talhoes': [[t, a, at] for t, a, at in ts]} for c, _, ts in z]} for n, z in arqs]))
    print('lote ok', len(arqs))

# ---- RÉPLICA GEOMÉTRICA da OS real (posições medidas no PDF da OS 3416): página 1 = mapa + cabeçalho
#      + quadro Zonas; página 2 = tabela de talhões (valores CENTRALIZADOS nas colunas, linhas a cada 10,2 pt)
#      com a tabela do tratamento ao lado (linhas a cada 13,6 pt) e o resumo de insumos logo abaixo —
#      com muitos talhões a tabela passa pelo resumo e pode continuar em outra página. ----
def os_replica(arq, os_n, zonas, rnd, repetir_cabecalho=True):
    W, H = 595.28, 841.89
    Y = lambda top: H - top - 6  # converte "topo" (como no pdftotext) para a base do texto
    c = canvas.Canvas(str(arq), pagesize=(W, H))
    total = round(sum(a for _, _, ts in zonas for _, a, _ in ts), 2)
    c.setFont('Helvetica', 8); c.drawString(39, Y(25), 'Legendas:'); c.drawString(50, Y(39), 'Trat 1')
    c.drawString(432, Y(21), 'Lon: -49.00000 // Lat: -22.00000')
    c.setFont('Helvetica', 7.5)
    for x, t in [(9, 'Data de Emissão:'), (92, '13/10/2026')]: c.drawString(x, Y(746), t)
    for x, t in [(9, 'Ordem de Serviço:'), (92, str(os_n))]: c.drawString(x, Y(766), t)
    for x, t in [(9, 'Centro de Custo:'), (92, '95')]: c.drawString(x, Y(786), t)
    for x, t in [(9, 'Área Total:'), (92, f'{br(total)} ha')]: c.drawString(x, Y(806), t)
    for x, t in [(9, 'Operação:'), (92, '118')]: c.drawString(x, Y(826), t)
    c.drawString(231, Y(743), 'Título: Mapa de O.S APLIC. FUNGICIDA DRONE I'); c.drawString(231, Y(752), 'Doc. n°:XX-0000-000'); c.drawString(381, Y(752), 'Versão: 01')
    c.drawString(231, Y(762), 'Data: 01/01/2020'); c.drawString(381, Y(762), 'Página: 01/02')
    c.setFont('Helvetica', 9); c.drawCentredString(351, Y(772), 'Zonas'); c.drawCentredString(534, Y(772), 'Área (ha)')
    for k, (cod, nome, ts) in enumerate(zonas[:4]):
        c.drawString(300, Y(784 + k * 11.3), f'{cod} - {nome}'); c.drawRightString(546, Y(784 + k * 11.3), br(sum(a for _, a, _ in ts)))
    for k in range(len(zonas), 5): c.drawCentredString(351, Y(784 + k * 11.3), '-'); c.drawCentredString(534, Y(784 + k * 11.3), '-')
    c.showPage()
    cols = [('FN', 20), ('ZN', 40), ('TN', 59.4), ('AREA OS', 87), ('AREA TN', 123), ('GLEBA', 169.3), ('TRATAMENTO', 241.9)]
    def cab(top):
        c.setFont('Helvetica-Bold', 6.5)
        for t, x in cols: c.drawCentredString(x, Y(top), t)
    cab(18.1)
    c.setFont('Helvetica-Bold', 7); c.drawString(322, Y(17.4), f'TRATAMENTO 1 - {br(total, 4)} HA'); c.drawString(480, Y(17.4), 'DOSE'); c.drawString(540, Y(17.4), 'TOTAL')
    c.setFont('Helvetica', 7)
    for i, (nome, dose, _) in enumerate(PRODUTOS):
        top = 30.9 + i * 13.6
        c.drawString(292, Y(top), nome); c.drawString(472.5, Y(top), f'{br(dose, 4)} L/ha'); c.drawRightString(561, Y(top), f'{br(dose * total, 4)}'); c.drawString(563, Y(top), 'L')
    c.setFont('Helvetica-Bold', 7); c.drawString(307, Y(113.4), 'CODIGO'); c.drawString(394.7, Y(113.4), 'RESUMO DE INSUMOS'); c.drawString(540, Y(113.4), 'TOTAL'); c.setFont('Helvetica', 7)
    for i, (nome, dose, cod) in enumerate(PRODUTOS):
        top = 125.9 + i * 13.6
        c.drawString(313, Y(top), cod); c.drawString(357, Y(top), nome); c.drawRightString(561, Y(top), br(dose * total, 4)); c.drawString(563, Y(top), 'L')
    c.drawString(382.7, Y(205.6), 'ÁREA TOTAL'); c.drawRightString(557, Y(205.6), br(total)); c.drawString(559.4, Y(205.6), 'ha')
    c.drawString(242.6, Y(764.4), f'Área total do KML: {br(total * 1.04)} ha'); c.drawString(242.3, Y(799.2), 'Data da emissão: 13/10/2026')
    linhas = [(cod, tn, a, at) for cod, _, ts in zonas for tn, a, at in ts]
    top = 27.9
    c.setFont('Helvetica', 6.8)
    for cod, tn, a, at in linhas:
        if top > 740:  # continua na página seguinte
            c.showPage(); top = 27.9
            if repetir_cabecalho: cab(18.1)
            c.setFont('Helvetica', 6.8)
        for (t, x), v in zip(cols, [str(1000 + int(cod)), str(int(cod)), str(tn), br(a), br(at), str(300 + rnd.randint(0, 99)), 'Trat. 1']):
            c.drawCentredString(x, Y(top), v)
        top += 10.2
    c.save()

def lote_replica(pasta, semente=11):
    """Casos: poucos talhões; muitos (passam pelo resumo); 2 zonas; ~110 talhões em 3 páginas com e sem cabeçalho repetido."""
    rnd = random.Random(semente); pasta.mkdir(parents=True, exist_ok=True); arqs = []
    casos = [(4, 1, True), (12, 1, True), (25, 1, True), (40, 2, True), (8, 2, True), (75, 1, True), (110, 2, True), (110, 1, False), (1, 1, True), (33, 3, True)]
    for k, (nt, nz, rep) in enumerate(casos):
        os_n = 6000 + k
        zonas = []
        por = [nt // nz + (1 if z < nt % nz else 0) for z in range(nz)]
        for z in range(nz):
            cod = f'{200 + k * 4 + z:03d}'
            ts = []
            for t in range(por[z]):
                at = round(rnd.uniform(1.5, 25), 2); a = at if rnd.random() > .2 else round(at * rnd.uniform(.6, .95), 2)
                ts.append((t + 1 + (100 if t > 98 else 0), a, at))
            zonas.append((cod, f'Fazenda Ficticia {cod}', ts))
        nome = f"OS {os_n} - FN {'-'.join(z[0] for z in zonas)}.pdf"
        os_replica(pasta / nome, os_n, zonas, rnd, rep); arqs.append((nome, zonas))
    return arqs

if __name__ == '__main__' and len(sys.argv) > 2 and sys.argv[2] == 'replica':
    import json
    arqs = lote_replica(out / 'replica')
    (out / 'replica' / 'esperado.json').write_text(json.dumps([{'arquivo': n, 'zonas': [{'cod': c, 'talhoes': [[t, a, at] for t, a, at in ts]} for c, _, ts in z]} for n, z in arqs]))
    print('replica ok', len(arqs))
