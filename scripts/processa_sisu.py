#!/usr/bin/env python3
"""
processa_sisu.py — Gera data/cursos.json a partir das planilhas OFICIAIS do Sisu (MEC).

Fonte: gov.br/mec → Sisu → Relatórios  (https://www.gov.br/mec/pt-br/sisu/relatorios)
       ou Portal de Dados Abertos do MEC (https://dadosabertos.mec.gov.br/sisu)
Arquivos usados (edição 2025, mesmo formato desde 2024):
  1) portal-sisu-2025-vagas-ofertadas.xlsx
       uma linha por curso × modalidade, com PESO_* e NOTA_MINIMA_* (iguais em todas as
       modalidades do curso) e NU_MEDIA_MINIMA_ENEM
  2) portal-sisu-sisu-2025-inscricoes-e-notas-de-corte.xlsx
       uma linha por curso × modalidade, com NU_NOTACORTE (corte da chamada regular)
       e QT_INSCRICAO

Uso:
    python3 scripts/processa_sisu.py --vagas raw/sisu/vagas_2025.xlsx \
        --corte raw/sisu/cortes_2025.xlsx --edicao "Sisu 2025"

Regras:
  * Pesos e mínimos: 1 registro por curso (CO_IES_CURSO), vindo do arquivo de vagas.
  * Cortes: todas as modalidades com vaga ofertada (QT_VAGAS_OFERTADAS > 0).
    Corte 0 = sobrou vaga (menos inscritos que vagas): entra com corte 0 e o site mostra
    "sobrou vaga em 2025". Modalidades sem nenhuma vaga ficam fora.
  * Rótulos de modalidade: códigos da Lei de Cotas viram nomes curtos; ações afirmativas
    próprias da instituição (código V/B) usam a descrição oficial (encurtada).
  * Notas mínimas e média mínima ≤ 1 (o MEC usa 0,01 para "sem mínimo") são ignoradas.
  * Cursos com o mesmo código repetido (entradas de 1º/2º semestre) ficam com o maior corte.
  * Cursos em que todas as modalidades têm corte 0 entram (para aparecer na busca), e o
    site avisa que não houve nota de corte.
"""
import argparse
import json
import re
from datetime import date
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent

# Nomes curtos para os códigos da Lei nº 12.711/2012
ROTULOS_LEI = {
    "AC": "Ampla concorrência",
    "LB_PPI": "Escola pública, renda ≤ 1 SM, pretos/pardos/indígenas",
    "LI_PPI": "Escola pública, pretos/pardos/indígenas (qualquer renda)",
    "LB_PP": "Escola pública, renda ≤ 1 SM, pretos/pardos",
    "LI_PP": "Escola pública, pretos/pardos (qualquer renda)",
    "LB_I": "Escola pública, renda ≤ 1 SM, indígenas",
    "LI_I": "Escola pública, indígenas (qualquer renda)",
    "LB_Q": "Escola pública, renda ≤ 1 SM, quilombolas",
    "LI_Q": "Escola pública, quilombolas (qualquer renda)",
    "LB_PCD": "Escola pública, renda ≤ 1 SM, com deficiência",
    "LI_PCD": "Escola pública, com deficiência (qualquer renda)",
    "LB_EP": "Escola pública, renda ≤ 1 SM",
    "LI_EP": "Escola pública (qualquer renda)",
}


def ler_planilha(caminho):
    """Lê a aba de dados (a maior; a outra é o dicionário de dados)."""
    abas = pd.read_excel(caminho, sheet_name=None, dtype=str)
    nome, df = max(abas.items(), key=lambda kv: len(kv[1]))
    print(f"[{Path(caminho).name}] aba '{nome}': {len(df):,} linhas")
    df.columns = [c.strip().upper() for c in df.columns]
    return df


def num(s):
    return pd.to_numeric(s.astype(str).str.replace(",", ".", regex=False).str.strip(), errors="coerce").fillna(0)


def r2(x):
    x = float(x)
    return int(x) if x == int(x) else round(x, 2)


def rotulo(cod, desc):
    cod = (cod or "").strip()
    if cod in ROTULOS_LEI:
        return ROTULOS_LEI[cod]
    d = re.sub(r"\s+", " ", str(desc or "")).strip().rstrip(".")
    d = d[:1].upper() + d[1:]  # algumas instituições começam a descrição em minúscula
    return d if len(d) <= 110 else d[:107].rstrip() + "…"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vagas", required=True)
    ap.add_argument("--corte", required=True)
    ap.add_argument("--edicao", required=True, help='ex.: "Sisu 2025"')
    ap.add_argument("--saida", default=str(RAIZ / "data" / "cursos.json"))
    a = ap.parse_args()

    vag = ler_planilha(a.vagas)
    cor = ler_planilha(a.corte)

    # ---- pesos/mínimos: um registro por curso ----
    vag["CO_IES_CURSO"] = vag["CO_IES_CURSO"].str.strip()
    p = vag.drop_duplicates("CO_IES_CURSO").set_index("CO_IES_CURSO")
    pesos = pd.DataFrame({
        "LC": num(p["PESO_LINGUAGENS"]), "CH": num(p["PESO_CIENCIAS_HUMANAS"]), "CN": num(p["PESO_CIENCIAS_NATUREZA"]),
        "MT": num(p["PESO_MATEMATICA"]), "RED": num(p["PESO_REDACAO"]),
        "mLC": num(p["NOTA_MINIMA_LINGUAGENS"]), "mCH": num(p["NOTA_MINIMA_CIENCIAS_HUMANAS"]),
        "mCN": num(p["NOTA_MINIMA_CIENCIAS_NATUREZA"]), "mMT": num(p["NOTA_MINIMA_MATEMATICA"]),
        "mRED": num(p["NOTA_MINIMA_REDACAO"]), "mm": num(p["NU_MEDIA_MINIMA_ENEM"]),
    })

    # ---- cortes por modalidade ----
    cor["CO_IES_CURSO"] = cor["CO_IES_CURSO"].str.strip()
    cor["corte"] = num(cor["NU_NOTACORTE"])
    cor["insc"] = num(cor["QT_INSCRICAO"])
    cor["vagas"] = num(cor["QT_VAGAS_OFERTADAS"])
    cor["rot"] = [rotulo(c, d) for c, d in zip(cor["TIPO_CONCORRENCIA"], cor["DS_MOD_CONCORRENCIA"])]
    cor["ampla"] = cor["TIPO_CONCORRENCIA"].str.strip() == "AC"

    rotulos, idx_rot = [], {}
    def id_rot(r):
        if r not in idx_rot:
            idx_rot[r] = len(rotulos); rotulos.append(r)
        return idx_rot[r]
    id_rot(ROTULOS_LEI["AC"])  # índice 0 = ampla concorrência

    saida, sem_pesos = [], 0
    for oferta, g in cor.groupby("CO_IES_CURSO", sort=False):
        if oferta not in pesos.index:
            sem_pesos += 1
            continue
        x = g.iloc[0]
        # Alguns cursos aparecem 2x com o mesmo código (entradas de 1º e 2º semestre, sem
        # identificação na planilha): fica o MAIOR corte de cada modalidade (meta conservadora).
        validos = (g[g["vagas"] > 0].groupby(["rot", "ampla"], as_index=False)["corte"].max()
                   .assign(tem=lambda d: d["corte"] > 0)
                   .sort_values(["ampla", "tem", "corte"], ascending=[False, False, False]))
        if validos.empty:
            continue
        w = pesos.loc[oferta]
        # O MEC usa 0,01 para "sem nota mínima": só conta mínimo acima de 1 ponto
        mins = [r2(w[k]) if w[k] > 1 else 0 for k in ("mLC", "mCH", "mCN", "mMT", "mRED")]
        saida.append({
            "id": oferta,
            "s": str(x["SG_IES"]).strip(), "n": str(x["NO_IES"]).strip(),
            "c": str(x["NO_CAMPUS"]).strip(), "m": str(x["NO_MUNICIPIO_CAMPUS"]).strip(), "u": str(x["SG_UF_CAMPUS"]).strip(),
            "k": str(x["NO_CURSO"]).strip(), "g": str(x["DS_GRAU"]).strip(), "t": str(x["DS_TURNO"]).strip(),
            "p": [r2(w[k]) for k in ("LC", "CH", "CN", "MT", "RED")],
            "mn": mins if any(mins) else None,
            "mm": r2(w["mm"]) if w["mm"] > 1 else None,
            "o": [[id_rot(r), r2(c)] for r, c in zip(validos["rot"], validos["corte"])],
        })
    saida.sort(key=lambda r: (r["s"], r["k"], r["m"]))

    meta = {
        "edicao_corte": a.edicao,
        "metodo_corte": "NU_NOTACORTE da chamada regular (planilha oficial de inscrições e notas de corte)",
        "gerado_em": date.today().isoformat(),
        "fonte": f"{a.edicao}: planilhas oficiais de vagas ofertadas e notas de corte (MEC, https://www.gov.br/mec/pt-br/sisu/relatorios)",
    }
    Path(a.saida).write_text(json.dumps({"meta": meta, "modalidades": rotulos, "cursos": saida},
                                        ensure_ascii=False, separators=(",", ":")))
    tam = Path(a.saida).stat().st_size / 1e6
    print(f"OK → {a.saida}: {len(saida):,} cursos, {len(rotulos)} modalidades, {tam:.2f} MB"
          + (f" ({sem_pesos} cursos sem pesos ignorados)" if sem_pesos else ""))


if __name__ == "__main__":
    main()
