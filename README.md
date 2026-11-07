# Calculadora do 2º Dia — ENEM 2026

Ferramenta gratuita do **Prof. João Capri**: o aluno informa como foi o 1º dia do ENEM
(acertos em Linguagens e Humanas + estimativa da Redação), escolhe o curso, e descobre
**quantas questões de Matemática (e de Natureza) precisa acertar no 2º dia** para alcançar a nota de corte.

Site 100% estático (HTML + CSS + JS + JSON), sem backend e sem custo de servidor.

```
calculadora/
├── index.html              página única
├── assets/
│   ├── config.js           ← SEU @, URL do formulário, link do Exatoo (edite aqui)
│   ├── app.js              lógica da calculadora, story, plano de 7 dias
│   └── style.css
├── data/
│   ├── tri_tabela.json             acertos → percentis da nota TRI (usado pelo site)
│   ├── tri_tabela_por_edicao.json  mesma tabela por edição (conferência)
│   ├── distribuicao.json           distribuição nacional das notas (selo de viabilidade)
│   └── cursos.json                 ofertas do SISU (nota de corte, pesos, mínimos)
└── scripts/
    ├── processa_tri.py     microdados ENEM → tri_tabela.json + distribuicao.json
    └── processa_sisu.py    dados abertos SISU → cursos.json
```

## Configuração rápida

Edite `assets/config.js`:

- `ARROBA`: seu @ do Instagram (aparece no site e no card do story);
- `SITE`: endereço exibido no card (`fudeuenem.com`);
- `FORM_URL`: URL de um Google Forms para quem quiser receber o plano (vazio = esconde o bloco);
- `EXATOO_URL`: link do CTA final (o site acrescenta parâmetros UTM e os assuntos marcados).

**Analytics:** cole o script do seu analytics gratuito (GoatCounter, Umami, Cloudflare Web Analytics…)
no lugar indicado no `<head>` do `index.html`.

## Como atualizar os dados

Requisitos: Python 3.10+ com `pandas` e `numpy` (`pip install pandas numpy openpyxl`).

### Tabela TRI (microdados do ENEM)

1. Baixe os microdados das 2 edições mais recentes em
   <https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/microdados/enem>
   (links diretos: `https://download.inep.gov.br/microdados/microdados_enem_AAAA.zip`).
2. Rode (não precisa descompactar):
   ```bash
   python3 scripts/processa_tri.py raw/microdados_enem_2025.zip raw/microdados_enem_2024.zip
   ```
3. O script conta os acertos de cada participante comparando `TX_RESPOSTAS_xx` com
   `TX_GABARITO_xx` (o gabarito já é o da cor da prova do participante). Em LC, monta o gabarito
   de 45 itens a partir de `TP_LINGUA` (inglês/espanhol). Para cada nº de acertos, calcula
   P10, P25, P50, P75 e P90 da nota. O site mostra a faixa **P25–P75** e usa a **mediana (P50)** no inverso
   (nota → acertos).

### Notas de corte, pesos e mínimos (SISU)

1. Em <https://www.gov.br/mec/pt-br/sisu/relatorios> (ou <https://dadosabertos.mec.gov.br/sisu>), baixe
   da edição mais recente as planilhas **"vagas ofertadas"** (pesos e notas mínimas) e
   **"inscrições e notas de corte"** (`NU_NOTACORTE` por curso e modalidade).
   Esses sites bloqueiam download automático, então baixe pelo navegador.
2. Rode:
   ```bash
   python3 scripts/processa_sisu.py --vagas raw/sisu/vagas_2025.xlsx --corte raw/sisu/cortes_2025.xlsx --edicao "Sisu 2025"
   ```
3. Regras aplicadas: mínimos de 0,01 = "sem mínimo"; curso repetido com o mesmo código (entradas de
   1º/2º semestre) fica com o maior corte; cursos em que todas as modalidades têm corte 0 (menos
   inscritos que vagas) ficam fora da busca.

Ao alterar `assets/*.js` ou `assets/style.css`, aumente o `?v=` no `index.html` (ex.: `?v=8` → `?v=9`) para os celulares baixarem a versão nova.

Sem `data/cursos.json` o site continua funcionando: o aluno digita a nota de corte e os pesos manualmente.

## Testar localmente

O site carrega os JSON via `fetch`, então abra por um servidor (não com duplo clique):

```bash
python3 -m http.server 8000
```

Depois acesse <http://localhost:8000>.

## Publicar (GitHub Pages + fudeuenem.com)

O site é publicado do repositório `joaocapri/fudeuenem`, branch `main`, pasta raiz.

1. **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)`**.
2. Em **Custom domain**, use `fudeuenem.com` (o arquivo `CNAME` já está no repositório).
3. No DNS do domínio:

   | Tipo | Nome | Valor |
   |---|---|---|
   | A | @ | 185.199.108.153 |
   | A | @ | 185.199.109.153 |
   | A | @ | 185.199.110.153 |
   | A | @ | 185.199.111.153 |
   | CNAME | www | joaocapri.github.io |

4. Quando o DNS propagar, marque **Enforce HTTPS**.

Para atualizar o site, basta enviar as alterações para a `main`: o Pages republica em ~1 minuto.

> Os microdados (`raw/`) **não** devem ir para o repositório: são grandes e desnecessários para o site.

## Fontes usadas

| Dado | Fonte | Edição |
|---|---|---|
| Acertos → nota TRI; distribuição de notas | Microdados do ENEM — Inep — <https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/microdados/enem> | ENEM 2024 e ENEM 2025 |
| Notas de corte, pesos, notas mínimas | Planilhas oficiais do Sisu (vagas ofertadas; inscrições e notas de corte) — MEC — <https://www.gov.br/mec/pt-br/sisu/relatorios> | Sisu 2025 (5.778 cursos, 124 instituições) |

## Como o cálculo funciona

- Nota SISU = Σ(peso × nota) ÷ Σ pesos.
- LC e CH: mediana histórica da nota para o nº de acertos informado; a faixa P25–P75 gera um cenário
  pessimista e um otimista.
- MT e CN são duas incógnitas: supõe-se a mesma posição no ranking nacional nas duas áreas e procura-se
  a posição em que a soma ponderada fecha a nota de corte (busca binária sobre a distribuição real).
- Nota → acertos: menor nº de acertos cuja nota mediana alcança a nota necessária.
- Selo de viabilidade: % dos participantes da última edição que tiraram aquela nota ou mais
  (≥15% confortável; 2–15% desafiadora; <2% muito difícil).

**Aviso:** Estimativa baseada em edições anteriores; a TRI depende do padrão de respostas; notas de corte mudam a cada edição.
