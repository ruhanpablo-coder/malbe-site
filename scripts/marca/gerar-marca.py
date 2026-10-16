"""Gera as versões vetoriais da marca Malbê: selo completo e ícone simplificado."""
import pathlib, sys

AQUI = pathlib.Path(__file__).parent
DESTINO = pathlib.Path(sys.argv[1])
DESTINO.mkdir(parents=True, exist_ok=True)
FONTE = (AQUI / "cinzel.b64").read_text().strip()

BORDO = "#6b1022"
BORDO_ESC = "#4a0816"
OURO = "#b98a3e"
OURO_CLARO = "#d9b46a"
CREME = "#f6efe3"

ESTILO = f"""<style>@font-face{{font-family:"MalbeCinzel";font-weight:700;src:url(data:font/woff2;base64,{FONTE}) format("woff2")}}
.t{{font-family:"MalbeCinzel","Cinzel","Trajan Pro",Georgia,serif;font-weight:700;text-anchor:middle}}</style>"""


def cacho(cx, cy, r, cor, brilho):
    """Cacho de uva em pirâmide (3, 2, 1) centrado em cx; cy é o topo da primeira fileira."""
    passo = r * 2.02
    linhas = [(-1, 0), (0, 0), (1, 0), (-0.5, 1), (0.5, 1), (0, 2)]
    out = []
    for dx, dy in linhas:
        x, y = cx + dx * passo, cy + dy * passo * 0.88
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="{cor}"/>')
        out.append(f'<circle cx="{x - r*0.32:.1f}" cy="{y - r*0.34:.1f}" r="{r*0.26:.1f}" fill="{brilho}" opacity=".55"/>')
    return "\n".join(out)


def folha(x, y, s, cor, veia, giro=18):
    """Folha de videira com cinco lobos pontudos. (x, y) é o pé do talo; s é a escala; giro em graus."""
    pts = [(0,0),(-19,-7),(-12,-14),(-23,-27),(-8,-26),(0,-43),(8,-26),(23,-27),(12,-14),(19,-7)]
    d = "M" + " L".join(f"{px},{py}" for px, py in pts) + " Z"
    veias = " ".join(f"M0,0 L{px*0.78:.1f},{py*0.78:.1f}" for px, py in [(-19,-7),(-23,-27),(0,-43),(23,-27),(19,-7)])
    return (f'<g transform="translate({x},{y}) rotate({giro}) scale({s})">'
            f'<path d="{d}" fill="{cor}" stroke="{cor}" stroke-width="3" stroke-linejoin="round"/>'
            f'<path d="{veias}" stroke="{veia}" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".55"/></g>')


def gavinha(x, y, s, cor):
    return (f'<path d="M{x},{y} c{-8*s},{-6*s} {-20*s},{-4*s} {-20*s},{6*s} c0,{7*s} {9*s},{8*s} {11*s},{2*s} '
            f'c{1.5*s},{-4*s} {-2*s},{-7*s} {-5*s},{-5*s}" stroke="{cor}" stroke-width="{2.4*s:.2f}" '
            f'fill="none" stroke-linecap="round"/>')


def ramo(cx, cy, raio, inicio, fim, lado, cor):
    """Ramo dourado de folhinhas acompanhando o círculo, do ângulo inicio ao fim (graus)."""
    import math
    out = []
    pts = []
    n = 7
    for i in range(n + 1):
        a = math.radians(inicio + (fim - inicio) * i / n)
        pts.append((cx + raio * math.cos(a), cy + raio * math.sin(a)))
    d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    out.append(f'<path d="{d}" stroke="{cor}" stroke-width="2" fill="none" stroke-linecap="round"/>')
    for i in range(1, n):
        a = math.radians(inicio + (fim - inicio) * i / n)
        x, y = cx + raio * math.cos(a), cy + raio * math.sin(a)
        ang = math.degrees(a) + (90 if lado > 0 else -90)
        for desvio in (-38, 38):
            out.append(f'<ellipse cx="0" cy="-7" rx="3.6" ry="7.5" fill="{cor}" '
                       f'transform="translate({x:.1f},{y:.1f}) rotate({ang + desvio:.1f})"/>')
    return "\n".join(out)


def selo():
    c = 260
    partes = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 520" role="img" aria-label="Malbê Vinhos Selecionados">',
        ESTILO,
        f'<defs><linearGradient id="ouro" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{OURO_CLARO}"/>'
        f'<stop offset=".5" stop-color="{OURO}"/><stop offset="1" stop-color="#8f6a2a"/></linearGradient></defs>',
        f'<circle cx="{c}" cy="{c}" r="252" fill="url(#ouro)"/>',
        f'<circle cx="{c}" cy="{c}" r="238" fill="{CREME}"/>',
        f'<circle cx="{c}" cy="{c}" r="226" fill="none" stroke="{BORDO}" stroke-width="2.5"/>',
        f'<circle cx="{c}" cy="{c}" r="218" fill="none" stroke="{OURO}" stroke-width="1" stroke-dasharray="2 6" stroke-linecap="round"/>',
        ramo(c, c, 196, 200, 250, -1, OURO),
        ramo(c, c, 196, 340, 290, 1, OURO),
        gavinha(256, 134, 1.5, BORDO),
        f'<path d="M260,152 C260,142 262,136 266,130" stroke="{BORDO}" stroke-width="4.5" fill="none" stroke-linecap="round"/>',
        folha(266, 132, 1.45, BORDO, CREME, 22),
        cacho(c, 166, 15.5, BORDO, CREME),
        f'<text class="t" x="{c}" y="318" font-size="96" fill="{BORDO}" letter-spacing="2">MALBÊ</text>',
        f'<path d="M120,344 H190 M330,344 H400" stroke="{OURO}" stroke-width="2"/>',
        f'<text class="t" x="{c}" y="356" font-size="32" fill="{BORDO_ESC}" letter-spacing="8">VINHOS</text>',
        f'<text class="t" x="{c}" y="392" font-size="21" fill="{BORDO_ESC}" letter-spacing="7">SELECIONADOS</text>',
        f'<path d="M210,424 H248 M272,424 H310" stroke="{OURO}" stroke-width="1.6"/>',
        f'<path d="M260,414 l9,10 l-9,10 l-9,-10 z" fill="{OURO}"/>',
        '</svg>',
    ]
    return "\n".join(partes)


def icone(fundo=True):
    """Ícone simplificado: cacho + folha, legível a partir de 16px."""
    c = 32
    partes = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Malbê">']
    if fundo:
        partes += [f'<circle cx="{c}" cy="{c}" r="32" fill="{BORDO}"/>',
                   f'<circle cx="{c}" cy="{c}" r="29.2" fill="none" stroke="{OURO_CLARO}" stroke-width="1.6"/>']
        uva, brilho, verde = CREME, BORDO, OURO_CLARO
    else:
        uva, brilho, verde = BORDO, CREME, OURO
    partes += [
        f'<path d="M32,27 C32,24.5 32.6,22.8 33.6,21.4" stroke="{verde}" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
        folha(33.6, 22, 0.36, verde, BORDO if fundo else CREME, 22),
        cacho(c, 31, 4.9, uva, brilho),
        '</svg>',
    ]
    return "\n".join(partes)


(DESTINO / "selo.svg").write_text(selo())
(DESTINO / "icone.svg").write_text(icone(True))
(DESTINO / "icone-transparente.svg").write_text(icone(False))
print("ok", [p.name for p in DESTINO.iterdir()])
