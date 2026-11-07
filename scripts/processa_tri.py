#!/usr/bin/env python3
"""
processa_tri.py — Gera a tabela "acertos → nota TRI" e a distribuição de notas
a partir dos MICRODADOS OFICIAIS DO ENEM (Inep).

Uso:
    python3 scripts/processa_tri.py raw/microdados_enem_2025.zip raw/microdados_enem_2024.zip

Saídas (em data/):
    tri_tabela.json              -> percentis P10/P25/P50/P75/P90 da nota para cada nº de acertos
                                    (edições somadas), por área LC/CH/CN/MT. É o que o site usa.
    tri_tabela_por_edicao.json   -> a mesma tabela separada por edição (transparência/conferência)
    distribuicao.json            -> percentis P0..P100 da nota de cada área (inclusive redação)
                                    na edição MAIS RECENTE informada (selo de viabilidade)

Como os acertos são contados:
    * Para CN, CH e MT: compara TX_RESPOSTAS_xx com TX_GABARITO_xx posição a posição
      (cada participante já traz o gabarito da cor da prova dele).
    * Para LC: TX_RESPOSTAS_LC tem 45 caracteres (5 de língua estrangeira + 40);
      TX_GABARITO_LC tem 50 (5 de inglês + 5 de espanhol + 40). Usa TP_LINGUA
      (0 = inglês, 1 = espanhol) para montar o gabarito de 45 do participante.
      O script imprime a correlação acertos×nota para validar essa regra.
    * Itens anulados aparecem como 'X' no gabarito e contam como acerto para todos
      (mantém a escala 0–45 que o aluno usa ao conferir o gabarito).
    * Entram só participantes presentes na prova (TP_PRESENCA_xx = 1) com nota > 0.
"""
import json
import subprocess
import sys
import zipfile
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

AREAS = ["LC", "CH", "CN", "MT"]
PCTS = [10, 25, 50, 75, 90]
RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "data"


def abrir_resultados(caminho_zip):
    """Localiza o CSV de resultados dentro do zip (2024+: RESULTADOS_AAAA.csv;
    edições antigas: MICRODADOS_ENEM_AAAA.csv)."""
    z = zipfile.ZipFile(caminho_zip)
    nomes = [n for n in z.namelist() if n.lower().endswith(".csv")]
    alvo = [n for n in nomes if "RESULTADOS_" in n.upper()] or [n for n in nomes if "MICRODADOS_ENEM" in n.upper()]
    if not alvo:
        raise SystemExit(f"CSV de resultados não encontrado em {caminho_zip}: {nomes}")
    return z, alvo[0]


def matriz(serie, tamanho):
    """Converte uma Series de strings de tamanho fixo em matriz uint8 (linhas × tamanho)."""
    buf = "".join(serie.tolist()).encode("latin-1")
    return np.frombuffer(buf, dtype=np.uint8).reshape(-1, tamanho)


def acertos_area(df, area):
    """Retorna (acertos, notas) dos participantes válidos na área."""
    pres = df[f"TP_PRESENCA_{area}"] == "1"
    resp = df[f"TX_RESPOSTAS_{area}"]
    gab = df[f"TX_GABARITO_{area}"]
    nota = pd.to_numeric(df[f"NU_NOTA_{area}"], errors="coerce")
    ok = pres & resp.notna() & gab.notna() & (nota > 0)
    if area == "LC":
        ok &= df["TP_LINGUA"].isin(["0", "1"]) & (resp.str.len() == 45) & (gab.str.len() == 50)
    else:
        ok &= (resp.str.len() == 45) & (gab.str.len() == 45)
    sub = df.loc[ok]
    if sub.empty:
        return np.empty(0, np.uint8), np.empty(0, np.float32)
    R = matriz(sub[f"TX_RESPOSTAS_{area}"], 45)
    G = matriz(sub[f"TX_GABARITO_{area}"], 50 if area == "LC" else 45)
    if area == "LC":
        ing = (sub["TP_LINGUA"] == "0").to_numpy()[:, None]
        lingua = np.where(ing, G[:, 0:5], G[:, 5:10])
        G = np.concatenate([lingua, G[:, 10:50]], axis=1)
    # Item anulado ('X' no gabarito) conta como acerto para todos: assim a escala vai de 0 a 45,
    # como o aluno conta ao conferir com o gabarito (que tem as 45 questões).
    ac = ((R == G) | (G == ord("X"))).sum(axis=1).astype(np.uint8)
    return ac, nota.loc[ok].to_numpy(np.float32)


def processar_edicao(caminho_zip):
    z, nome = abrir_resultados(caminho_zip)
    print(f"[{caminho_zip}] lendo {nome} …", flush=True)
    cols = ["NU_ANO", "TP_LINGUA", "NU_NOTA_REDACAO"]
    for a in AREAS:
        cols += [f"TP_PRESENCA_{a}", f"NU_NOTA_{a}", f"TX_RESPOSTAS_{a}", f"TX_GABARITO_{a}"]
    dados = {a: ([], []) for a in AREAS}
    red = []
    ano = None
    # O Inep às vezes compacta com Deflate64 (método 9), que o zipfile do Python não lê.
    # Nesse caso, usa o `unzip -p` (Info-ZIP) em streaming, sem extrair para o disco.
    if z.getinfo(nome).compress_type == 9:
        proc = subprocess.Popen(["unzip", "-p", str(caminho_zip), nome], stdout=subprocess.PIPE)
        fonte_csv = proc.stdout
    else:
        proc, fonte_csv = None, z.open(nome)
    with fonte_csv as f:
        for i, df in enumerate(pd.read_csv(f, sep=";", encoding="latin-1", usecols=cols, dtype=str,
                                           chunksize=400_000, keep_default_na=False, na_values=[""])):
            ano = ano or int(df["NU_ANO"].dropna().iloc[0])
            for a in AREAS:
                ac, nt = acertos_area(df, a)
                dados[a][0].append(ac)
                dados[a][1].append(nt)
            r = pd.to_numeric(df["NU_NOTA_REDACAO"], errors="coerce")
            red.append(r[r.notna()].to_numpy(np.float32))
            print(f"  bloco {i + 1}: {len(df):,} linhas", flush=True)
    if proc is not None and proc.wait() != 0:
        raise SystemExit(f"unzip falhou ao ler {nome}")
    res = {a: (np.concatenate(dados[a][0]), np.concatenate(dados[a][1])) for a in AREAS}
    res["RED"] = np.concatenate(red)
    for a in AREAS:
        ac, nt = res[a]
        print(f"  {ano} {a}: n={len(ac):,}  corr(acertos, nota)={np.corrcoef(ac, nt)[0, 1]:.3f}")
    return ano, res


def tabela(ac, nt):
    """Percentis da nota por nº de acertos (0..45), com correção de monotonicidade."""
    pct, n = [], []
    for k in range(46):
        sel = nt[ac == k]
        n.append(int(sel.size))
        pct.append([float(v) for v in np.percentile(sel, PCTS)] if sel.size else None)
    # Preenche acertos sem nenhum participante (raro, nas pontas) com o vizinho mais próximo
    for k in range(46):
        if pct[k] is None:
            viz = sorted((abs(j - k), j) for j in range(46) if pct[j] is not None)[0][1]
            pct[k] = list(pct[viz])
    # Garante que cada percentil não diminua com mais acertos (ruído nas pontas com n pequeno)
    arr = np.maximum.accumulate(np.array(pct), axis=0)
    return [[round(float(v), 1) for v in linha] for linha in arr], n


def main(zips):
    edicoes = [processar_edicao(z) for z in zips]
    edicoes.sort(key=lambda e: e[0], reverse=True)
    anos = [e[0] for e in edicoes]
    fonte = (f"Microdados do ENEM {', '.join(map(str, sorted(anos)))} — Inep "
             f"(https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/microdados/enem)")

    # Tabela somando as edições
    tri = {"fonte": fonte, "edicoes": sorted(anos), "gerado_em": date.today().isoformat(),
           "percentis": PCTS, "areas": {}}
    por_ed = {"fonte": fonte, "percentis": PCTS, "edicoes": {}}
    for a in AREAS:
        ac = np.concatenate([e[1][a][0] for e in edicoes])
        nt = np.concatenate([e[1][a][1] for e in edicoes])
        p, n = tabela(ac, nt)
        tri["areas"][a] = {"pct": p, "n": n}
    for ano, res in edicoes:
        por_ed["edicoes"][str(ano)] = {}
        for a in AREAS:
            p, n = tabela(*res[a])
            por_ed["edicoes"][str(ano)][a] = {"pct": p, "n": n}

    # Distribuição nacional (edição mais recente)
    ano_rec, res_rec = edicoes[0]
    dist = {"fonte": fonte, "edicao": ano_rec, "areas": {}}
    for a in AREAS + ["RED"]:
        nt = res_rec[a][1] if a != "RED" else res_rec["RED"]
        if a == "RED":
            nt = nt[nt > 0]  # sem redações zeradas/faltosos
        q = np.percentile(nt, list(range(101)))
        dist["areas"][a] = {"q": [round(float(v), 1) for v in q], "n": int(nt.size)}

    SAIDA.mkdir(exist_ok=True)
    (SAIDA / "tri_tabela.json").write_text(json.dumps(tri, ensure_ascii=False, separators=(",", ":")))
    (SAIDA / "tri_tabela_por_edicao.json").write_text(json.dumps(por_ed, ensure_ascii=False, separators=(",", ":")))
    (SAIDA / "distribuicao.json").write_text(json.dumps(dist, ensure_ascii=False, separators=(",", ":")))
    print("OK → data/tri_tabela.json, data/tri_tabela_por_edicao.json, data/distribuicao.json")

    # Resumo legível para conferência
    for a in AREAS:
        t = tri["areas"][a]
        print(a, " ".join(f"{k}:{t['pct'][k][2]:.0f}" for k in (5, 10, 15, 20, 25, 30, 35, 40, 45)))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    main(sys.argv[1:])
