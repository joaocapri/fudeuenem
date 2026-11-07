/* =====================================================================
   Calculadora do 2º Dia — ENEM 2026 · Prof. João Capri
   ---------------------------------------------------------------------
   Fluxo: acertos LC/CH → faculdade → curso → "Ver minha meta" →
          slider da redação → balança Matemática × Natureza → card do story.

   Dados (pasta /data):
     - tri_tabela.json   → acertos → percentis da nota TRI (por área)
     - distribuicao.json → distribuição nacional das notas (ponto de partida da balança)
     - cursos.json       → ofertas do Sisu (nota de corte, pesos, mínimos)
   Nenhum dado do aluno sai do navegador.
   ===================================================================== */
(function () {
  'use strict';

  const CFG = window.CONFIG || {};
  const AREAS = ['LC', 'CH', 'CN', 'MT', 'RED'];

  const S = {
    tri: null, dist: null, cursos: null,
    ies: [], iesSel: null, ofertaSel: null,
    curso: null,          // {nome, pesos, min, mediaMin, corte, modalidade, edicao}
    desvio: 0,            // quanto o aluno moveu a balança (em acertos de MT) a partir do ponto de equilíbrio
    ultimo: null,         // último resultado (card e plano)
  };

  const $ = (id) => document.getElementById(id);
  const fmt0 = (x) => Math.round(x).toLocaleString('pt-BR');
  const fmt2 = (x) => Number(x).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // "ENGENHARIA DA COMPUTAÇÃO" → "Engenharia da Computação"
  const MINUSC = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'a', 'o', 'para', 'com']);
  const titulo = (s) => String(s || '').toLowerCase().split(/(\s+|-|\/)/).map((w, i) =>
    (i > 0 && MINUSC.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join('');

  /* ===================================================================
     1) TABELA TRI: acertos ↔ nota (mediana P50)
     Acima de 45 acertos a tabela é estendida em linha reta com a
     inclinação do trecho 40→45. Serve só para o "humor" de mostrar
     metas impossíveis como "52 de 45".
     =================================================================== */
  const P50 = (area) => S.tri.areas[area].pct.map((l) => l[2]);
  const inclinacao = (area) => { const p = P50(area); return (p[45] - p[40]) / 5; };

  function notaDe(area, k) {
    const p = P50(area);
    if (k <= 0) return p[0];
    if (k >= 45) return p[45] + (k - 45) * inclinacao(area);
    const i = Math.floor(k), f = k - i;
    return p[i] + (p[i + 1] - p[i]) * f;
  }

  // Menor nº inteiro de acertos cuja nota mediana alcança `nota` (pode passar de 45)
  function acertosDe(area, nota) {
    const p = P50(area);
    if (nota <= p[0]) return 0;
    for (let k = 1; k <= 45; k++) if (p[k] >= nota) return k;
    return 45 + Math.ceil((nota - p[45]) / inclinacao(area));
  }

  function faixa(area, k) {
    const [, p25, , p75] = S.tri.areas[area].pct[clamp(k, 0, 45)];
    return [p25, p75];
  }

  // Nota no percentil p (0..100) da distribuição nacional
  function notaNoPercentil(area, p) {
    const q = S.dist.areas[area].q;
    const i = clamp(Math.floor(p), 0, 99), f = clamp(p - i, 0, 1);
    return q[i] + (q[i + 1] - q[i]) * f;
  }

  /* ===================================================================
     2) CÁLCULO
     Nota Sisu = Σ(peso × nota) ÷ Σ pesos. Com LC, CH e redação fixos:
       falta = corte × Σpesos − (pLC×LC + pCH×CH + pRED×RED)
       pMT×MT + pCN×CN = falta      ← a "balança"
     Ponto de equilíbrio: mesma posição no ranking nacional nas duas áreas.
     O aluno pode deslocar a balança; cada acerto a mais em MT reduz o
     que precisa em CN (e vice-versa).
     =================================================================== */
  function calcular() {
    const c = S.curso;
    const lc = clamp(+$('lc').value || 0, 0, 45), ch = clamp(+$('ch').value || 0, 0, 45);
    const red = +$('red').value;
    const p = c.pesos, wMT = p.MT || 0, wCN = p.CN || 0;
    const W = AREAS.reduce((s, a) => s + (p[a] || 0), 0);
    const LC = notaDe('LC', lc), CH = notaDe('CH', ch);
    const falta = c.corte * W - ((p.LC || 0) * LC + (p.CH || 0) * CH + (p.RED || 0) * red);
    const minMT = (c.min && c.min.MT) || 0, minCN = (c.min && c.min.CN) || 0;
    const R = { lc, ch, red, LC, CH, falta, wMT, wCN, kMT: null, kCN: null, kMin: 0, kMax: 0, k0: 0 };

    if (wMT && wCN) {
      // ponto de equilíbrio por percentil (busca binária); se nem o topo basta, iguala acertos acima de 45
      const soma = (pc) => wMT * notaNoPercentil('MT', pc) + wCN * notaNoPercentil('CN', pc);
      let k0;
      if (falta <= soma(0)) k0 = 0;
      else if (falta <= soma(100)) {
        let lo = 0, hi = 100;
        for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (soma(m) < falta) lo = m; else hi = m; }
        k0 = acertosDe('MT', notaNoPercentil('MT', hi));
      } else {
        k0 = 45;
        while (wMT * notaDe('MT', k0) + wCN * notaDe('CN', k0) < falta && k0 < 200) k0++;
      }
      // limites da balança: de "MT no mínimo" até "CN no mínimo"
      R.kMin = acertosDe('MT', minMT);
      R.kMax = Math.max(R.kMin, acertosDe('MT', (falta - wCN * Math.max(notaDe('CN', 0), minCN)) / wMT));
      R.k0 = clamp(k0, R.kMin, R.kMax);
      R.kMT = clamp(R.k0 + S.desvio, R.kMin, R.kMax);
      const cnNota = Math.max((falta - wMT * notaDe('MT', R.kMT)) / wCN, minCN);
      R.kCN = acertosDe('CN', cnNota);
    } else if (wMT) {
      R.kMT = acertosDe('MT', Math.max(falta / wMT, minMT));
      if (minCN) R.kCN = acertosDe('CN', minCN);
    } else if (wCN) {
      R.kCN = acertosDe('CN', Math.max(falta / wCN, minCN));
      if (minMT) R.kMT = acertosDe('MT', minMT);
    }
    return R;
  }

  /* ===================================================================
     3) TELA
     =================================================================== */
  function atualizarEstimativas() {
    if (!S.tri) return;
    for (const [id, area] of [['lc', 'LC'], ['ch', 'CH']]) {
      const k = clamp(+$(id).value || 0, 0, 45);
      const [a, b] = faixa(area, k);
      $(id + '_est').textContent = `de 45 · ≈ ${fmt0(a)}–${fmt0(b)}`;
    }
  }

  function atualizarMeta() {
    if (!S.curso || !S.tri) return;
    $('red_v').textContent = $('red').value;
    const R = calcular();
    const c = S.curso;

    // números nos pratos
    const pinta = (id, k) => {
      const el = $(id);
      el.textContent = k === null ? '—' : String(k);
      el.classList.toggle('estourou', k !== null && k > 45);
    };
    pinta('r_mt', R.kMT); pinta('r_cn', R.kCN);

    // inclinação: o lado que precisa de mais acertos desce
    const ang = (R.kMT === null || R.kCN === null) ? 0 : clamp((R.kCN - R.kMT) * 0.6, -8, 8);
    const bal = $('balanca'), larg = bal.offsetWidth || 360;
    const d = larg * 0.25; // distância do centro de cada prato ao pivô
    const dy = Math.sin(ang * Math.PI / 180) * d;
    $('travessao').style.transform = `rotate(${ang}deg)`;
    $('prato_mt').style.transform = `translateY(${-dy}px)`;
    $('prato_cn').style.transform = `translateY(${dy}px)`;

    // slider de equilíbrio (esquerda = mais Matemática)
    const eq = $('equilibrio'), temBalanca = R.wMT && R.wCN && R.kMax > R.kMin;
    $('equilibrio_box').hidden = !temBalanca;
    if (temBalanca) { eq.min = 0; eq.max = R.kMax - R.kMin; eq.value = R.kMax - R.kMT; }

    // uma linha só de observação, quando necessário
    const obs = [];
    if (c.min) {
      const fora = [['LC', R.LC], ['CH', R.CH], ['RED', R.red]].filter(([a, v]) => c.min[a] && v < c.min[a]);
      for (const [a] of fora) obs.push(`mínimo de ${fmt0(c.min[a])} em ${{ LC: 'Linguagens', CH: 'Humanas', RED: 'Redação' }[a]}`);
    }
    if (R.red === 0) obs.push('redação zerada elimina');
    if (c.sobrou) obs.unshift((R.kMT || R.kCN) ? 'sobrou vaga em 2025: basta a nota mínima do curso' : 'sobrou vaga em 2025: você já passaria');
    else if (R.kMT === 0 && R.kCN === 0) obs.push('com esse 1º dia, já daria');
    $('r_aviso').textContent = obs.join(' · ');

    S.ultimo = { ...R, curso: c };
    agendarCard();
    if ($('plano').innerHTML) gerarPlano();
  }

  /* ===================================================================
     4) BUSCA: FACULDADE → CURSO
     Registro em cursos.json:
       {s: sigla, n: nome IES, c: campus, m: município, u: UF, k: curso, g: grau, t: turno,
        p: [LC,CH,CN,MT,RED], mn: [mínimos]|null, mm: média mínima|null,
        o: [[índice da modalidade, nota de corte], ...]}   (corte 0 = sobrou vaga)
     Nomes das modalidades: cursos.json → modalidades[] (0 = ampla concorrência).
     =================================================================== */
  const nomeMod = (i) => (S.cursos.modalidades && S.cursos.modalidades[i]) || String(i);

  function prepararBase() {
    const mapa = new Map();
    S.cursos.cursos.forEach((r, i) => {
      const chave = `${r.s}|${r.n}`;
      if (!mapa.has(chave)) mapa.set(chave, { s: r.s, n: r.n, ufs: new Set(), cidades: new Set(), idx: [] });
      const e = mapa.get(chave); e.ufs.add(r.u); e.cidades.add(r.m); e.idx.push(i);
    });
    S.ies = [...mapa.values()].map((e) => ({ ...e, ufs: [...e.ufs].join('/'), busca: norm(`${e.s} ${e.n} ${[...e.ufs].join(' ')} ${[...e.cidades].join(' ')}`) }));
  }

  function listarIES(q) {
    const ul = $('ies_lista');
    const termos = norm(q).split(/\s+/).filter(Boolean);
    if (!termos.length) { ul.innerHTML = ''; return; }
    const pri = (e) => (norm(e.s) === termos[0] ? 0 : norm(e.s).startsWith(termos[0]) ? 1 : 2);
    const out = S.ies.filter((e) => termos.every((t) => e.busca.includes(t)))
      .sort((a, b) => pri(a) - pri(b) || a.s.localeCompare(b.s)).slice(0, 20);
    ul.innerHTML = out.length
      ? out.map((e) => `<li tabindex="0" data-s="${esc(e.s)}" data-n="${esc(e.n)}"><div class="t1">${esc(e.s)}</div><div class="t2">${esc(titulo(e.n))} · ${esc(e.ufs)}</div></li>`).join('')
      : '<li class="vazio">Nada encontrado. Use a opção manual abaixo.</li>';
  }

  function escolherIES(s, n) {
    S.iesSel = S.ies.find((e) => e.s === s && e.n === n);
    $('ies_lista').innerHTML = ''; $('ies_box').hidden = true;
    $('ies_sel').hidden = false;
    $('ies_sel').innerHTML = `<div class="t1">${esc(s)}</div><button type="button" class="trocar" data-trocar="ies">trocar</button><div class="t2">${esc(titulo(n))}</div>`;
    $('curso_box').hidden = false; $('curso_busca').value = '';
    listarCursos('');
    limparCurso();
  }

  function listarCursos(q) {
    const termos = norm(q).split(/\s+/).filter(Boolean);
    const C = S.cursos.cursos;
    const idx = S.iesSel.idx.filter((i) => {
      const r = C[i];
      return termos.every((t) => norm(`${r.k} ${r.g} ${r.t} ${r.c} ${r.m}`).includes(t));
    });
    const comeca = (i) => (termos.length && norm(C[i].k).startsWith(termos[0]) ? 0 : 1);
    idx.sort((a, b) => comeca(a) - comeca(b) || C[a].k.localeCompare(C[b].k) || C[a].m.localeCompare(C[b].m));
    $('curso_lista').innerHTML = idx.length
      ? idx.slice(0, 80).map((i) => {
        const r = C[i];
        return `<li tabindex="0" data-i="${i}"><div class="t1">${esc(titulo(r.k))}</div><div class="t2">${esc([r.g, r.t, r.m].filter(Boolean).join(' · '))}</div></li>`;
      }).join('')
      : '<li class="vazio">Nenhum curso com esse nome aqui.</li>';
  }

  function escolherCurso(i) {
    const r = S.cursos.cursos[i];
    S.ofertaSel = r;
    $('curso_lista').innerHTML = ''; $('curso_box').hidden = true;
    // padrão: ampla concorrência (ou a primeira modalidade listada)
    const sel = Math.max(0, r.o.findIndex((o) => o[0] === 0));
    const opcoes = r.o.map((o, j) =>
      `<option value="${j}" ${j === sel ? 'selected' : ''}>${esc(nomeMod(o[0]))}: ${o[1] > 0 ? fmt2(o[1]) : 'sobrou vaga em 2025'}</option>`).join('');
    const ab = ['LC', 'CH', 'CN', 'MT', 'RED'];
    const min = r.mn ? ab.map((a, j) => r.mn[j] ? `${a} ${r.mn[j]}` : '').filter(Boolean).join(' · ') : '';
    $('curso_sel').hidden = false;
    $('curso_sel').innerHTML = `<div class="t1">${esc(titulo(r.k))}</div><button type="button" class="trocar" data-trocar="curso">trocar</button>
      <div class="t2">${esc([r.g, r.t, titulo(r.c), `${r.m}/${r.u}`].filter(Boolean).join(' · '))}</div>
      <select id="modalidade" aria-label="Modalidade de concorrência">${opcoes}</select>
      <p class="ficha">pesos <b>LC ${r.p[0]} · CH ${r.p[1]} · CN ${r.p[2]} · MT ${r.p[3]} · RED ${r.p[4]}</b>${min ? `<br>mínimos <b>${esc(min)}</b>` : ''}${r.mm ? `<br>média mínima <b>${r.mm}</b>` : ''}</p>`;
    $('modalidade').addEventListener('change', aplicarOferta);
    aplicarOferta();
  }

  function aplicarOferta() {
    const r = S.ofertaSel; if (!r) return;
    const o = r.o[+$('modalidade').value];
    const toObj = (arr) => arr ? Object.fromEntries(AREAS.map((a, j) => [a, arr[j] || 0])) : null;
    S.curso = {
      nome: `${titulo(r.k)} · ${r.s}`, pesos: toObj(r.p), min: toObj(r.mn), mediaMin: r.mm || 0,
      corte: o[1], sobrou: !(o[1] > 0), modalidade: o[0] === 0 ? '' : 'cota', edicao: S.cursos.meta && S.cursos.meta.edicao_corte,
    };
    $('btn_ok').disabled = false;
    if (!$('etapa2').hidden) atualizarMeta();
  }

  function limparCurso() {
    S.ofertaSel = null; S.curso = null;
    $('curso_sel').hidden = true; $('curso_sel').innerHTML = '';
    $('btn_ok').disabled = true;
  }

  function usarManual() {
    const erro = $('m_erro'); erro.textContent = '';
    const corte = parseFloat(String($('m_corte').value).replace(',', '.'));
    if (!(corte > 0 && corte <= 1000)) { erro.textContent = 'Digite a nota de corte, entre 0 e 1000.'; return; }
    const pesos = {}, min = {}; let temMin = false;
    document.querySelectorAll('.m_peso').forEach((el) => { pesos[el.dataset.a] = Math.max(0, +el.value || 0); });
    document.querySelectorAll('.m_min').forEach((el) => { const v = +el.value || 0; min[el.dataset.a] = v; if (v) temMin = true; });
    if (!AREAS.some((a) => pesos[a] > 0)) { erro.textContent = 'Pelo menos um peso precisa ser maior que zero.'; return; }
    S.ofertaSel = null;
    S.curso = { nome: $('m_nome').value.trim() || 'Meu curso', pesos, min: temMin ? min : null, mediaMin: 0, corte, modalidade: '', edicao: '' };
    confirmar();
  }

  function confirmar() {
    if (!S.curso) return;
    const lc = clamp(+$('lc').value || 0, 0, 45), ch = clamp(+$('ch').value || 0, 0, 45);
    S.desvio = 0;
    $('resumo_txt').innerHTML = `LC <b>${lc}</b> · CH <b>${ch}</b> · <b>${esc(S.curso.nome)}</b> · ${S.curso.sobrou ? '<b>sobrou vaga em 2025</b>' : `corte <b>${fmt2(S.curso.corte)}</b>`}${S.curso.modalidade ? ' (cota)' : ''}`;
    $('etapa1').hidden = true; $('resumo').hidden = false;
    for (const id of ['etapa2', 'etapa3', 'etapa4']) $(id).hidden = false;
    atualizarMeta();
    $('resumo').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function editar() {
    $('etapa1').hidden = false; $('resumo').hidden = true;
    for (const id of ['etapa2', 'etapa3', 'etapa4']) $(id).hidden = true;
  }

  /* ===================================================================
     5) CARD DO STORY (1080×1920): folha branca, números com marca-texto
        e as bolinhas do cartão-resposta preenchidas com a meta.
     =================================================================== */
  let tmrCard, fontesProntas = null;
  function agendarCard() { clearTimeout(tmrCard); tmrCard = setTimeout(desenharCard, 140); }

  function carregarFontes() {
    if (!fontesProntas) {
      fontesProntas = (document.fonts && document.fonts.load)
        ? Promise.all(['850 300px Archivo', '700 60px Archivo', '600 30px "IBM Plex Mono"'].map((f) => document.fonts.load(f))).catch(() => {})
        : Promise.resolve();
    }
    return fontesProntas;
  }

  function quebrar(ctx, txt, maxW) {
    const ps = String(txt).split(' '); const out = []; let l = '';
    for (const p of ps) { const t = l ? l + ' ' + p : p; if (ctx.measureText(t).width > maxW && l) { out.push(l); l = p; } else l = t; }
    if (l) out.push(l);
    return out;
  }

  async function desenharCard() {
    const R = S.ultimo; if (!R) return;
    await carregarFontes();
    const W = 1080, H = 1920, M = 90;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const D = 'Archivo, "Helvetica Neue", Arial, sans-serif', MONO = '"IBM Plex Mono", Menlo, monospace';
    const TINTA = '#121212', CINZA = '#6a6a6a', MARCA = '#ffe94a', ESTOURO = '#d93025';

    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'alphabetic';

    // cabeçalho + título (a pergunta do site)
    ctx.fillStyle = TINTA; ctx.font = `600 30px ${MONO}`; ctx.textAlign = 'left';
    ctx.fillText('ENEM 2026 · 15/11', M, 140);
    // título em 4 linhas fixas, no maior tamanho que caiba na largura
    const tit = ['QUANTAS PRECISO', 'ACERTAR NO', 'SEGUNDO DIA', 'DO ENEM'];
    let tt = 130;
    ctx.font = `850 ${tt}px ${D}`;
    while (Math.max(...tit.map((l) => ctx.measureText(l).width)) > W - 2 * M && tt > 60) { tt -= 2; ctx.font = `850 ${tt}px ${D}`; }
    const ent = Math.round(tt * 1.02);
    tit.forEach((l, i) => ctx.fillText(l, M, 165 + tt + i * ent));
    const fimTitulo = 165 + tt + (tit.length - 1) * ent;

    const marca = (txt, x, y, alt) => { // marca-texto atrás da metade de baixo do texto
      const w = ctx.measureText(txt).width;
      const x0 = ctx.textAlign === 'center' ? x - w / 2 : x;
      ctx.fillStyle = MARCA; ctx.fillRect(x0 - 12, y - alt * 0.46, w + 24, alt * 0.4);
    };

    let fimBloco;
    if (R.curso.sobrou && !R.kMT && !R.kCN) {
      // sobrou vaga e não há nota mínima a cumprir: "já passaria"
      const y = fimTitulo + 300;
      ctx.textAlign = 'left';
      let tj = 170;
      ctx.font = `850 ${tj}px ${D}`;
      while (ctx.measureText('JÁ PASSARIA').width > W - 2 * M && tj > 80) { tj -= 4; ctx.font = `850 ${tj}px ${D}`; }
      marca('JÁ PASSARIA', M, y, tj);
      ctx.fillStyle = TINTA; ctx.fillText('JÁ PASSARIA', M, y);
      ctx.fillStyle = CINZA; ctx.font = `600 34px ${MONO}`;
      ctx.fillText('em 2025 sobrou vaga nessa modalidade', M, y + 80);
      fimBloco = y + 160;
    } else {
      const base = fimTitulo + 340;
      // duas colunas: Matemática e Natureza
      const col = (x0, k, area) => {
        const cx = x0 + 210;
        const txt = k === null ? '—' : String(k);
        ctx.textAlign = 'center';
        let tam = 300; // encolhe para caber 3 dígitos
        ctx.font = `850 ${tam}px ${D}`;
        while (ctx.measureText(txt).width > 380 && tam > 160) { tam -= 10; ctx.font = `850 ${tam}px ${D}`; }
        const w = ctx.measureText(txt).width;
        ctx.fillStyle = MARCA; ctx.fillRect(cx - w / 2 - 14, base - 100, w + 28, 92);
        ctx.fillStyle = k !== null && k > 45 ? ESTOURO : TINTA;
        ctx.fillText(txt, cx, base);
        ctx.fillStyle = CINZA; ctx.font = `600 30px ${MONO}`; ctx.fillText('DE 45', cx, base + 60);
        ctx.fillStyle = TINTA; ctx.font = `700 46px ${D}`; ctx.fillText(area, cx, base + 125);

        // cartão-resposta: 45 bolinhas (9 × 5), preenchidas com a meta
        const r = 15, passo = 46, gx = cx - (8 * passo) / 2, gy = base + 195;
        for (let i = 0; i < 45; i++) {
          const x = gx + (i % 9) * passo, y = gy + Math.floor(i / 9) * passo;
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
          if (k !== null && i < k) { ctx.fillStyle = TINTA; ctx.fill(); }
          else { ctx.lineWidth = 2.5; ctx.strokeStyle = '#c9c9c9'; ctx.stroke(); }
        }
        if (k !== null && k > 45) {
          ctx.fillStyle = ESTOURO; ctx.font = `600 30px ${MONO}`;
          ctx.fillText(`${k - 45} além do possível kkkk`, cx, gy + 5 * passo + 18);
        }
      };
      col(M - 20, R.kMT, 'Matemática');
      col(W / 2 + 10, R.kCN, 'Natureza');
      fimBloco = base + 195 + 5 * 46 + 60;
    }

    // curso (só o nome)
    ctx.textAlign = 'left'; ctx.fillStyle = TINTA;
    ctx.fillRect(M, fimBloco, W - 2 * M, 4);
    ctx.font = `800 62px ${D}`;
    quebrar(ctx, R.curso.nome, W - 2 * M).slice(0, 2).forEach((l, i) => ctx.fillText(l, M, fimBloco + 95 + i * 72));

    // rodapé: assinatura + site com marca-texto
    ctx.fillStyle = TINTA; ctx.font = `800 46px ${D}`;
    ctx.fillText('Calcule a sua', M, 1690);
    ctx.font = `600 34px ${MONO}`;
    ctx.fillText(`Prof. João Capri ${CFG.ARROBA || ''}`.trim(), M, 1745);
    ctx.font = `850 64px ${D}`;
    marca(CFG.SITE || '', M, 1835, 64);
    ctx.fillStyle = TINTA; ctx.fillText(CFG.SITE || '', M, 1835);

    cv.toBlob((blob) => {
      if (!blob) return;
      S.cardBlob = blob;
      const img = $('story_img'), old = img.src;
      img.src = URL.createObjectURL(blob);
      if (old && old.startsWith('blob:')) URL.revokeObjectURL(old);
    }, 'image/png');
  }

  async function compartilhar() {
    const blob = S.cardBlob; if (!blob) return;
    const file = new File([blob], 'minha-meta-enem.png', { type: 'image/png' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Minha meta no 2º dia do ENEM' });
        return;
      }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'minha-meta-enem.png';
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ===================================================================
     6) PLANO DE MATEMÁTICA (09/11 a 14/11; prova em 15/11)
     freq = quão frequente o assunto é no ENEM (3 = cai sempre)
     =================================================================== */
  const TOPICOS = [
    { id: 'porc', nome: 'Porcentagem e proporção', freq: 3, dica: 'aumentos e descontos sucessivos, regra de três' },
    { id: 'graf', nome: 'Gráficos e tabelas', freq: 3, dica: 'leitura de eixos, variação percentual' },
    { id: 'est', nome: 'Estatística', freq: 3, dica: 'média ponderada, mediana, moda' },
    { id: 'gplana', nome: 'Geometria plana', freq: 3, dica: 'áreas compostas, semelhança, Pitágoras' },
    { id: 'gesp', nome: 'Geometria espacial', freq: 3, dica: 'volumes de prismas, cilindros, cones e esferas' },
    { id: 'escala', nome: 'Escalas e unidades', freq: 2, dica: 'escala de mapas, conversões de área e volume' },
    { id: 'func', nome: 'Funções', freq: 2, dica: 'leitura de gráfico, vértice da parábola' },
    { id: 'prob', nome: 'Probabilidade', freq: 2, dica: 'casos favoráveis/possíveis, eventos independentes' },
    { id: 'comb', nome: 'Combinatória', freq: 2, dica: 'princípio multiplicativo, permutações, combinações' },
    { id: 'finan', nome: 'Matemática financeira', freq: 2, dica: 'juros simples e compostos, parcelamento' },
    { id: 'pa', nome: 'PA e PG', freq: 1, dica: 'termo geral, soma dos termos' },
    { id: 'trig', nome: 'Trigonometria', freq: 1, dica: 'triângulo retângulo, funções periódicas' },
    { id: 'log', nome: 'Exponencial e log', freq: 1, dica: 'crescimento e decaimento' },
    { id: 'geoan', nome: 'Geometria analítica', freq: 1, dica: 'distância entre pontos, equação da reta' },
  ];
  const marcados = new Set();

  function montarTopicos() {
    $('topicos').innerHTML = TOPICOS.map((t) => `<button type="button" class="chip" data-id="${t.id}">${esc(t.nome)}</button>`).join('');
    $('topicos').addEventListener('click', (e) => {
      const b = e.target.closest('.chip'); if (!b) return;
      const id = b.dataset.id;
      if (marcados.has(id)) marcados.delete(id); else if (marcados.size < 5) marcados.add(id);
      document.querySelectorAll('#topicos .chip').forEach((c) => {
        c.classList.toggle('ativo', marcados.has(c.dataset.id));
        c.disabled = !marcados.has(c.dataset.id) && marcados.size >= 5;
      });
    });
  }

  function gerarPlano() {
    const R = S.ultimo;
    const meta = !R || R.kMT === null ? 25 : clamp(R.kMT, 5, 45);
    const perfil = meta <= 18
      ? { q: 10, txt: `Meta de ${meta}: garanta as fáceis e médias. Questões curtas primeiro, nada em branco.` }
      : meta <= 30
        ? { q: 15, txt: `Meta de ${meta}: domine o que mais cai. Duas passadas na prova, nada em branco.` }
        : { q: 20, txt: `Meta de ${meta}: dá para errar pouco. Ritmo de 3 min por questão e revisão das contas.` };
    const fracos = TOPICOS.filter((t) => marcados.has(t.id));
    const resto = TOPICOS.filter((t) => !marcados.has(t.id)).sort((a, b) => b.freq - a.freq);
    const foco = [...fracos, ...resto].filter((t) => marcados.has(t.id) || meta > 18 || t.freq >= 2);
    const dias = [['09/11', 'seg'], ['10/11', 'ter'], ['11/11', 'qua'], ['12/11', 'qui'], ['13/11', 'sex'], ['14/11', 'sáb']];

    let html = `<p class="estrategia">${perfil.txt}</p>`;
    for (let i = 0; i < 4; i++) {
      const t = foco[i];
      html += `<div class="dia"><h3><small>${dias[i][0]} ${dias[i][1]}</small>${esc(t.nome)}</h3><ul>
        <li>40 min de teoria: ${esc(t.dica)}</li>
        <li>${perfil.q} questões de ENEM anteriores, 3 min cada</li>
        <li>20 min corrigindo os erros</li></ul></div>`;
    }
    const quinto = fracos[4] || foco[4];
    html += `<div class="dia"><h3><small>${dias[4][0]} ${dias[4][1]}</small>Simulado</h3><ul>
      <li>45 questões de Matemática em 2h30</li>
      <li>Compare com a meta de ${meta}${quinto ? ` e revise ${esc(quinto.nome.toLowerCase())}` : ''}</li></ul></div>
      <div class="dia"><h3><small>${dias[5][0]} ${dias[5][1]}</small>Dia leve</h3><ul>
      <li>1 hora de revisão de fórmulas, no máximo</li>
      <li>Documento com foto, caneta preta de tubo transparente, local da prova</li>
      <li>Dormir cedo</li></ul></div>`;
    $('plano').innerHTML = html;

    const u = new URL(CFG.EXATOO_URL || 'https://app.exatoo.com');
    u.searchParams.set('utm_source', 'calculadora2dia'); u.searchParams.set('utm_medium', 'instagram'); u.searchParams.set('utm_campaign', 'enem2026');
    if (fracos.length) u.searchParams.set('utm_content', fracos.map((t) => t.id).join(','));
    $('btn_exatoo').href = u.toString();
  }

  /* ===================================================================
     7) INTERFACE
     =================================================================== */
  function ligarUI() {
    document.querySelectorAll('[data-arroba]').forEach((el) => { el.textContent = CFG.ARROBA || ''; });

    for (const id of ['lc', 'ch']) {
      const n = $(id);
      n.addEventListener('input', atualizarEstimativas);
      n.addEventListener('blur', () => { n.value = clamp(Math.round(+n.value || 0), 0, 45); atualizarEstimativas(); });
    }
    document.querySelectorAll('.pm').forEach((b) => b.addEventListener('click', () => {
      const n = $(b.dataset.alvo); n.value = clamp((+n.value || 0) + +b.dataset.d, 0, 45); atualizarEstimativas();
    }));

    let t1, t2;
    $('ies_busca').addEventListener('input', (e) => { clearTimeout(t1); t1 = setTimeout(() => listarIES(e.target.value), 100); });
    $('curso_busca').addEventListener('input', (e) => { clearTimeout(t2); t2 = setTimeout(() => listarCursos(e.target.value), 100); });
    const escolhe = (e) => {
      const li = e.target.closest('li[data-s], li[data-i]'); if (!li) return;
      if (li.dataset.s !== undefined) escolherIES(li.dataset.s, li.dataset.n); else escolherCurso(+li.dataset.i);
    };
    for (const ul of ['ies_lista', 'curso_lista']) {
      $(ul).addEventListener('click', escolhe);
      $(ul).addEventListener('keydown', (e) => { if (e.key === 'Enter') escolhe(e); });
    }
    $('busca_box').addEventListener('click', (e) => {
      const b = e.target.closest('[data-trocar]'); if (!b) return;
      limparCurso();
      if (b.dataset.trocar === 'ies') {
        $('ies_sel').hidden = true; $('curso_box').hidden = true; $('ies_box').hidden = false;
        $('ies_busca').value = ''; $('ies_busca').focus();
      } else {
        $('curso_box').hidden = false; $('curso_busca').value = ''; listarCursos(''); $('curso_busca').focus();
      }
    });

    $('m_usar').addEventListener('click', usarManual);
    $('btn_ok').addEventListener('click', confirmar);
    $('btn_editar').addEventListener('click', editar);
    $('red').addEventListener('input', atualizarMeta);
    $('equilibrio').addEventListener('input', () => {
      const R = S.ultimo; if (!R) return;
      const kMT = R.kMax - +$('equilibrio').value;
      S.desvio = kMT - R.k0;
      atualizarMeta();
    });
    window.addEventListener('resize', () => { if (S.ultimo) atualizarMeta(); });

    montarTopicos();
    $('btn_plano').addEventListener('click', gerarPlano);
    $('btn_share').addEventListener('click', compartilhar);

    const bc = $('btn_contato');
    if (!CFG.FORM_URL) $('contato').hidden = true; else bc.href = CFG.FORM_URL;
    $('lgpd').addEventListener('change', (e) => { bc.classList.toggle('desativado', !e.target.checked); bc.setAttribute('aria-disabled', String(!e.target.checked)); });
    bc.addEventListener('click', (e) => { if (!$('lgpd').checked) e.preventDefault(); });
  }

  /* ===================================================================
     8) DADOS
     =================================================================== */
  async function carregarJSON(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
    return r.json();
  }

  async function iniciar() {
    ligarUI();
    carregarFontes();
    const [tri, dist, cursos] = await Promise.allSettled([
      carregarJSON('data/tri_tabela.json'), carregarJSON('data/distribuicao.json'), carregarJSON('data/cursos.json'),
    ]);
    if (tri.status !== 'fulfilled' || dist.status !== 'fulfilled') {
      $('fontes').textContent = 'Não foi possível carregar a tabela de notas. Recarregue a página.';
      return;
    }
    S.tri = tri.value; S.dist = dist.value;
    const fontes = [`Notas: microdados do ENEM ${S.tri.edicoes.join(' e ')} (Inep)`];
    if (cursos.status === 'fulfilled' && cursos.value.cursos && cursos.value.cursos.length) {
      S.cursos = cursos.value; prepararBase();
      fontes.push(`cortes e pesos: ${S.cursos.meta.edicao_corte} (MEC), ${S.cursos.cursos.length.toLocaleString('pt-BR')} cursos`);
    } else {
      $('busca_box').hidden = true; $('btn_ok').hidden = true;
      $('manual').open = true;
    }
    $('fontes').textContent = fontes.join(' · ') + '.';
    atualizarEstimativas();
  }

  iniciar();
})();
