#!/usr/bin/env python3
"""
gera_mapa.py — Gera data/mapa.json: contorno dos estados e posição das cidades da base
do Sisu, já projetados para um SVG (viewBox 0 0 1000 H). Usado pela página /2dia.

Fontes (derivadas das malhas e do cadastro de municípios do IBGE):
  * estados:    https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/brazil-states.geojson
  * municípios: https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/csv/municipios.csv
                https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/csv/estados.csv

Uso:
    python3 scripts/gera_mapa.py raw/geo/brazil-states.geojson raw/geo/municipios.csv raw/geo/estados.csv

Projeção: equiretangular com correção de cos(latitude média) — suficiente para o Brasil
num mapa ilustrativo. Os contornos são simplificados (Douglas-Peucker) para o arquivo ficar leve.
"""
import csv
import json
import math
import sys
import unicodedata
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
LARG = 1000.0
TOL = 1.1          # tolerância da simplificação, em unidades do viewBox
AREA_MIN = 14.0    # descarta ilhas minúsculas


def norm(s):
    s = unicodedata.normalize("NFD", str(s)).encode("ascii", "ignore").decode().lower()
    return "".join(ch if ch.isalnum() else " " for ch in s).split()


def chave(s):
    return " ".join(norm(s))


def simplifica(pts, tol):
    """Douglas-Peucker iterativo."""
    if len(pts) < 3:
        return pts
    manter = [False] * len(pts)
    manter[0] = manter[-1] = True
    pilha = [(0, len(pts) - 1)]
    while pilha:
        a, b = pilha.pop()
        (x1, y1), (x2, y2) = pts[a], pts[b]
        dx, dy = x2 - x1, y2 - y1
        d2 = dx * dx + dy * dy
        maior, idx = 0.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if d2 == 0:
                d = math.hypot(px - x1, py - y1)
            else:
                t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / d2))
                d = math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
            if d > maior:
                maior, idx = d, i
        if maior > tol and idx > 0:
            manter[idx] = True
            pilha += [(a, idx), (idx, b)]
    return [p for p, m in zip(pts, manter) if m]


def area(pts):
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]))) / 2


def main(arq_estados, arq_mun, arq_uf):
    geo = json.load(open(arq_estados, encoding="utf-8"))
    aneis = []  # (uf, [(lon, lat), ...])
    for f in geo["features"]:
        g = f["geometry"]
        polis = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for poli in polis:
            aneis.append((f["properties"]["sigla"], [(p[0], p[1]) for p in poli[0]]))  # só o anel externo

    lons = [p[0] for _, a in aneis for p in a]
    lats = [p[1] for _, a in aneis for p in a]
    lon0, lon1, lat0, lat1 = min(lons), max(lons), min(lats), max(lats)
    k = math.cos(math.radians((lat0 + lat1) / 2))
    esc = LARG / ((lon1 - lon0) * k)
    alt = (lat1 - lat0) * esc
    proj = lambda lon, lat: ((lon - lon0) * k * esc, (lat1 - lat) * esc)

    estados = {}
    for uf, anel in aneis:
        pts = simplifica([proj(*p) for p in anel], TOL)
        if len(pts) < 4 or area(pts) < AREA_MIN:
            continue
        d = "M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in pts) + "Z"
        estados.setdefault(uf, {"d": "", "pts": []})
        estados[uf]["d"] += d
        estados[uf]["pts"].append(pts)
    saida_estados = {}
    for uf, e in estados.items():
        maior = max(e["pts"], key=area)                      # rótulo no "centro" do maior polígono
        cx = sum(p[0] for p in maior) / len(maior)
        cy = sum(p[1] for p in maior) / len(maior)
        saida_estados[uf] = {"d": e["d"], "c": [round(cx, 1), round(cy, 1)]}

    # municípios da base do Sisu → coordenadas
    ufs = {r["codigo_uf"]: r["uf"] for r in csv.DictReader(open(arq_uf, encoding="utf-8-sig"))}
    coord = {}
    for r in csv.DictReader(open(arq_mun, encoding="utf-8-sig")):
        coord[(chave(r["nome"]), ufs[r["codigo_uf"]])] = (float(r["longitude"]), float(r["latitude"]))
    cursos = json.load(open(RAIZ / "data" / "cursos.json", encoding="utf-8"))["cursos"]
    cidades, faltando = {}, set()
    ALIAS = {("itapage", "CE"): "itapaje"}   # grafia diferente entre MEC e IBGE
    for c in cursos:
        ch = (chave(c["m"]), c["u"])
        ch = (ALIAS.get(ch, ch[0]), c["u"])
        if ch in coord:
            x, y = proj(*coord[ch])
            cidades[f'{c["m"]}|{c["u"]}'] = [round(x, 1), round(y, 1)]
        else:
            faltando.add((c["m"], c["u"]))
    # cidade não encontrada: usa o centro do estado (raro; nomes com grafia diferente)
    for m, u in faltando:
        cidades[f"{m}|{u}"] = saida_estados[u]["c"]

    out = {"fonte": "Malhas e cadastro de municípios do IBGE", "w": int(LARG), "h": round(alt),
           "estados": saida_estados, "cidades": cidades}
    destino = RAIZ / "data" / "mapa.json"
    destino.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"OK → {destino}: {len(saida_estados)} estados, {len(cidades)} cidades, "
          f"{destino.stat().st_size / 1024:.0f} KB; sem coordenada: {sorted(faltando)}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    main(*sys.argv[1:])
