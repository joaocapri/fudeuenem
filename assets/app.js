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
  // Registra um evento anônimo no GoatCounter (aparece no painel como uma "página" com o nome do evento).
  // Nunca envia dados pessoais: só o tipo de ação, o curso escolhido e faixas de acertos.
  function evento(caminho, titulo) {
    try {
      if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: caminho, title: titulo || caminho, event: true });
    } catch (e) { /* analytics nunca pode quebrar o site */ }
  }
  const faixa10 = (n) => n > 45 ? 'acima de 45' : `${Math.floor(n / 10) * 10}-${Math.floor(n / 10) * 10 + 9}`;

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

  // Faixa estimada: junta a variação entre alunos (P25–P75) com a variação entre
  // anos (menor e maior mediana entre as edições), que vem da dificuldade de cada prova.
  function faixa(area, k) {
    const t = S.tri.areas[area], i = clamp(k, 0, 45);
    const [, p25, , p75] = t.pct[i];
    const [aMin, aMax] = t.anos ? t.anos[i] : [p25, p75];
    return [Math.min(p25, aMin), Math.max(p75, aMax)];
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
  // Acertos para cumprir uma nota MÍNIMA (eliminatória) com folga: usa o P25, ou seja,
  // 3 em cada 4 participantes com esse nº de acertos ficaram acima do mínimo.
  function acertosMinimo(area, nota) {
    if (!nota) return 0;
    const pct = S.tri.areas[area].pct;
    for (let k = 0; k <= 45; k++) if (pct[k][1] >= nota) return k;
    return Math.max(46, acertosDe(area, nota) + 1);
  }

  function calcular() {
    const c = S.curso;
    const lc = clamp(+$('lc').value || 0, 0, 45), ch = clamp(+$('ch').value || 0, 0, 45);
    const red = +$('red').value;
    const p = c.pesos, wMT = p.MT || 0, wCN = p.CN || 0;
    const W = AREAS.reduce((s, a) => s + (p[a] || 0), 0);
    const LC = notaDe('LC', lc), CH = notaDe('CH', ch);
    // 1) nota de corte: Σ(peso × nota) ≥ corte × Σpesos
    const falta = c.corte * W - ((p.LC || 0) * LC + (p.CH || 0) * CH + (p.RED || 0) * red);
    // 2) notas mínimas por área (eliminatórias), com folga
    const minMT = (c.min && c.min.MT) || 0, minCN = (c.min && c.min.CN) || 0;
    const kMinMT = acertosMinimo('MT', minMT), kMinCN = acertosMinimo('CN', minCN);
    // 3) média simples mínima: (LC + CH + CN + MT + RED) / 5 ≥ média  →  MT + CN ≥ somaMin
    const somaMin = c.mediaMin ? 5 * c.mediaMin - (LC + CH + red) : -Infinity;
    const R = { lc, ch, red, LC, CH, falta, wMT, wCN, minMT, minCN, kMinMT, kMinCN, kMT: null, kCN: null, kMin: 0, kMax: 0, k0: 0 };
    const atende = (mt, cn) => wMT * mt + wCN * cn >= falta - 1e-6 && mt + cn >= somaMin - 1e-6;

    if (wMT && wCN) {
      // ponto de equilíbrio: mesma posição no ranking nacional nas duas áreas (busca binária)
      let k0;
      const mtP = (pc) => notaNoPercentil('MT', pc), cnP = (pc) => notaNoPercentil('CN', pc);
      if (atende(mtP(0), cnP(0))) k0 = 0;
      else if (atende(mtP(100), cnP(100))) {
        let lo = 0, hi = 100;
        for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (atende(mtP(m), cnP(m))) hi = m; else lo = m; }
        k0 = acertosDe('MT', mtP(hi));
      } else {
        k0 = 45; // nem o topo basta: iguala acertos acima de 45 (o "humor")
        while (!atende(notaDe('MT', k0), notaDe('CN', k0)) && k0 < 200) k0++;
      }
      // limites da balança: de "MT no mínimo" até "CN no mínimo"
      const cnPiso = notaDe('CN', kMinCN);
      R.kMin = kMinMT;
      R.kMax = Math.max(R.kMin, acertosDe('MT', Math.max((falta - wCN * cnPiso) / wMT, somaMin - cnPiso)));
      R.k0 = clamp(k0, R.kMin, R.kMax);
      R.kMT = clamp(R.k0 + S.desvio, R.kMin, R.kMax);
      const mt = notaDe('MT', R.kMT);
      R.kCN = Math.max(acertosDe('CN', Math.max((falta - wMT * mt) / wCN, somaMin - mt)), kMinCN);
    } else if (wMT) {
      // CN não tem peso; para a média mínima, supõe CN no mínimo exigido (ou na mediana nacional)
      const cnRef = minCN ? notaDe('CN', kMinCN) : notaNoPercentil('CN', 50);
      R.kMT = Math.max(acertosDe('MT', Math.max(falta / wMT, somaMin - cnRef)), kMinMT);
      if (minCN) R.kCN = kMinCN;
    } else if (wCN) {
      const mtRef = minMT ? notaDe('MT', kMinMT) : notaNoPercentil('MT', 50);
      R.kCN = Math.max(acertosDe('CN', Math.max(falta / wCN, somaMin - mtRef)), kMinCN);
      if (minMT) R.kMT = kMinMT;
    }
    // a meta foi definida pelo mínimo do curso (e não pela nota de corte)?
    R.porMinMT = kMinMT > 0 && R.kMT === kMinMT;
    R.porMinCN = kMinCN > 0 && R.kCN === kMinCN;
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

    // observações curtas: eliminação (vermelho), mínimos e média do curso
    const NOME = { LC: 'Linguagens', CH: 'Humanas', RED: 'Redação' };
    const alerta = [], obs = [];
    if (c.min) {
      for (const [a, v] of [['LC', R.LC], ['CH', R.CH], ['RED', R.red]]) {
        if (c.min[a] && v < c.min[a]) alerta.push(`${NOME[a]} estimada (~${fmt0(v)}) abaixo do mínimo de ${fmt0(c.min[a])}: o curso elimina`);
      }
    }
    if (R.red === 0) alerta.push('redação zerada elimina');
    if (R.minMT) obs.push(`mínimo em Matemática: ${fmt0(R.minMT)} (≥ ${R.kMinMT} acertos)`);
    if (R.minCN) obs.push(`mínimo em Natureza: ${fmt0(R.minCN)} (≥ ${R.kMinCN} acertos)`);
    if (c.mediaMin) obs.push(`média mínima do curso: ${fmt0(c.mediaMin)}`);
    if (obs.length) obs[obs.length - 1] += ' · já incluído na meta';
    if (c.sobrou) obs.unshift((R.kMT || R.kCN) ? 'sobrou vaga em 2025: basta cumprir o mínimo' : 'sobrou vaga em 2025: você já passaria');
    else if (R.kMT === 0 && R.kCN === 0) obs.push('com esse 1º dia, já daria');
    $('r_aviso').innerHTML = [...alerta.map((x) => `<span class="alerta">${esc(x)}</span>`), ...obs.map(esc)].join('<br>');

    // botões de plano mostram a meta de cada área
    const metaTxt = (k) => k === null ? '6 dias de estudo' : k > 45 ? '6 dias · meta acima de 45' : `6 dias · meta de ${k} acertos`;
    $('pb_mt').textContent = metaTxt(R.kMT);
    $('pb_cn').textContent = metaTxt(R.kCN);

    S.ultimo = { ...R, curso: c };
    agendarCard();
    if (!$('plano_saida').hidden) gerarPlano();
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

    const r = S.ofertaSel;
    evento(r ? `curso/${r.s}/${titulo(r.k)} (${r.m})` : 'curso/digitado à mão', r ? `${titulo(r.k)} · ${r.s} · ${r.m}` : 'Curso digitado à mão');
    evento(`faculdade/${r ? r.s : 'digitado à mão'}`);
    evento(`modalidade/${!r ? 'digitado à mão' : S.curso.sobrou ? 'sobrou vaga' : S.curso.modalidade ? 'cota' : 'ampla'}`);
    const t = lc + ch, f = Math.floor(t / 10) * 10;
    evento(`acertos-1o-dia/LC+CH ${f}-${f + 9} (de 90)`);
  }

  function editar() {
    $('etapa1').hidden = false; $('resumo').hidden = true;
    $('plano_painel').hidden = true; S.planoArea = null;
    document.querySelectorAll('.plano-btn').forEach((b) => b.classList.remove('ativo'));
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
      const fontes = (document.fonts && document.fonts.load)
        ? Promise.all(['850 300px Archivo', '700 60px Archivo', '600 30px "IBM Plex Mono"'].map((f) => document.fonts.load(f))).catch(() => {})
        : Promise.resolve();
      // ícone da marca (desenhado no canto dos cards); se falhar, os cards saem sem ele
      const icone = new Promise((ok) => {
        const img = new Image();
        img.onload = () => { S.icone = img; ok(); };
        img.onerror = () => ok();
        img.src = 'assets/icone.svg';
      });
      fontesProntas = Promise.all([fontes, icone]);
    }
    return fontesProntas;
  }
  // desenha o ícone da marca no canto inferior direito de um card 1080×1920
  function desenharIcone(ctx, x, y, tam) {
    if (S.icone) { try { ctx.drawImage(S.icone, x, y, tam, tam); } catch (e) { /* segue sem ícone */ } }
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
    tit.forEach((l, i) => {
      const y = 165 + tt + i * ent;
      if (i === 2) { // grifa "SEGUNDO DIA"
        const w = ctx.measureText(l).width;
        ctx.fillStyle = MARCA; ctx.fillRect(M - 10, y - tt * 0.42, w + 20, tt * 0.38);
        ctx.fillStyle = TINTA;
      }
      ctx.fillText(l, M, y);
    });
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
    const lCurso = quebrar(ctx, R.curso.nome, W - 2 * M).slice(0, 2);
    lCurso.forEach((l, i) => ctx.fillText(l, M, fimBloco + 95 + i * 72));
    // aviso técnico (curto)
    ctx.fillStyle = CINZA; ctx.font = `500 22px ${MONO}`;
    const yAviso = fimBloco + 95 + lCurso.length * 72;
    ['Valores estimados. Na TRI, a nota depende de quais itens você',
     'acerta e da coerência das respostas, não só do nº de acertos.',
     `Base: microdados ENEM ${S.tri.edicoes[0]}–${S.tri.edicoes[S.tri.edicoes.length - 1]} (Inep) e cortes Sisu 2025 (MEC).`]
      .forEach((l, i) => ctx.fillText(l, M, yAviso + i * 32));

    // rodapé: assinatura + site com marca-texto
    ctx.fillStyle = TINTA; ctx.font = `800 46px ${D}`;
    ctx.fillText('Calcule a sua', M, 1690);
    ctx.font = `600 34px ${MONO}`;
    ctx.fillText(`Prof. João Capri ${CFG.ARROBA || ''}`.trim(), M, 1745);
    ctx.font = `850 64px ${D}`;
    desenharIcone(ctx, 1080 - M - 190, 1660, 190);
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

  // Abre o menu de compartilhar do celular; se não houver, baixa o arquivo
  async function compartilhar(blob, nome, titulo) {
    if (!blob) return;
    const file = new File([blob], nome, { type: 'image/png' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: titulo });
        return;
      }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ===================================================================
     6) PLANO DE MATEMÁTICA (09/11 a 14/11; prova em 15/11)
     freq  = quão frequente o assunto é no ENEM (3 = cai todo ano)
     nivel = dificuldade típica das questões (1 = base, 3 = avançado)
     Gera o plano em texto e uma imagem 1080×1920 para baixar.
     =================================================================== */
  const PLANOS = {
    MT: {
      nome: 'Matemática',
      simulado: '45 questões de Matemática de uma prova anterior, em até 2h30',
      leve: 'No máximo 1 hora: fórmulas e o caderno de erros.',
      prova: [
        'Comece pelas questões curtas e de leitura de gráfico. Na TRI, acertar as fáceis pesa mais do que arriscar as difíceis. Não deixe nenhuma em branco.',
        'Faça duas passadas: primeiro as que você domina, depois as trabalhosas. Guarde 30 minutos para elas e não deixe nenhuma em branco.',
        'Mantenha ritmo de ~3 min por questão e revise as contas de geometria e combinatória, onde mais se perde ponto.',
      ],
      topicos: [
        { id: 'porc', nome: 'Porcentagem e proporção', freq: 3, nivel: 1, revisar: 'aumentos e descontos sucessivos (multiplique os fatores), regra de três direta e inversa', treinar: 'preço, desconto e misturas', cuidado: 'somar porcentagens sucessivas em vez de multiplicar' },
        { id: 'graf', nome: 'Gráficos e tabelas', freq: 3, nivel: 1, revisar: 'variação absoluta × percentual, leitura de eixos, escalas e legendas', treinar: 'infográficos e tabelas', cuidado: 'confundir pontos percentuais com variação percentual' },
        { id: 'est', nome: 'Estatística', freq: 3, nivel: 1, revisar: 'média ponderada, mediana (ordene antes), moda, noção de desvio padrão', treinar: 'tabelas de frequência', cuidado: 'calcular a mediana sem ordenar os dados' },
        { id: 'gplana', nome: 'Geometria plana', freq: 3, nivel: 2, revisar: 'áreas de figuras compostas, semelhança de triângulos, Pitágoras', treinar: 'terrenos, pisos e plantas baixas', cuidado: 'esquecer de converter unidades de área' },
        { id: 'gesp', nome: 'Geometria espacial', freq: 3, nivel: 2, revisar: 'volume de prisma, cilindro, cone e esfera; planificações', treinar: 'caixas d’água, embalagens e recipientes', cuidado: 'usar o diâmetro no lugar do raio' },
        { id: 'escala', nome: 'Escalas e unidades', freq: 2, nivel: 1, revisar: 'escala de mapas; área converte ×100 e volume ×1000; 1 L = 1 dm³', treinar: 'mapas, maquetes e medidas', cuidado: 'converter área como se fosse comprimento' },
        { id: 'func', nome: 'Funções', freq: 2, nivel: 2, revisar: 'afim (taxa de variação), quadrática (vértice = máximo ou mínimo), leitura de gráfico', treinar: 'lucro máximo e tarifas', cuidado: 'confundir o x do vértice com o y do vértice' },
        { id: 'prob', nome: 'Probabilidade', freq: 2, nivel: 2, revisar: 'favoráveis ÷ possíveis; "e" multiplica; "ou" soma e tira a interseção', treinar: 'sorteios, urnas e dados', cuidado: 'esquecer que, sem reposição, o total diminui' },
        { id: 'comb', nome: 'Combinatória', freq: 2, nivel: 3, revisar: 'princípio multiplicativo, permutação com repetição, combinação (ordem não importa)', treinar: 'senhas, filas e comissões', cuidado: 'usar arranjo quando a ordem não importa' },
        { id: 'finan', nome: 'Matemática financeira', freq: 2, nivel: 2, revisar: 'juros simples × compostos, parcelas e comparação de planos', treinar: 'financiamentos e investimentos', cuidado: 'aplicar juros simples quando o enunciado diz compostos' },
        { id: 'pa', nome: 'PA e PG', freq: 1, nivel: 2, revisar: 'termo geral e soma dos termos; padrões em figuras', treinar: 'sequências de figuras', cuidado: 'errar o número de termos (n)' },
        { id: 'trig', nome: 'Trigonometria', freq: 1, nivel: 3, revisar: 'seno, cosseno e tangente no triângulo retângulo; funções periódicas', treinar: 'rampas, sombras e marés', cuidado: 'usar o cateto errado na razão' },
        { id: 'log', nome: 'Exponencial e logaritmo', freq: 1, nivel: 3, revisar: 'crescimento e decaimento, meia-vida, propriedades do log', treinar: 'populações, pH e juros', cuidado: 'tratar log da soma como soma dos logs' },
        { id: 'geoan', nome: 'Geometria analítica', freq: 1, nivel: 3, revisar: 'distância entre pontos, ponto médio, equação da reta', treinar: 'mapas no plano cartesiano', cuidado: 'trocar x e y' },
      ],
    },
    CN: {
      nome: 'Natureza',
      simulado: '45 questões de Natureza de uma prova anterior, em até 2h30',
      leve: 'No máximo 1 hora: fórmulas de Física, funções orgânicas e o caderno de erros.',
      prova: [
        'Comece pelas questões de Biologia e de leitura de gráfico, em geral mais diretas. Na TRI, garantir as fáceis pesa mais. Não deixe nenhuma em branco.',
        'Natureza é a prova mais longa de ler: faça duas passadas e deixe os cálculos longos de Física e Química para o final.',
        'Mantenha ritmo de ~3 min por questão e confira unidades e ordens de grandeza em Física e estequiometria.',
      ],
      topicos: [
        { id: 'ecol', nome: 'Ecologia', freq: 3, nivel: 1, revisar: 'cadeias e teias alimentares, ciclos biogeoquímicos, impactos ambientais', treinar: 'questões ambientais com gráficos', cuidado: 'confundir nível trófico com posição na cadeia' },
        { id: 'eletr', nome: 'Eletricidade', freq: 3, nivel: 2, revisar: 'lei de Ohm, potência (P = U·i), consumo em kWh, associação de resistores', treinar: 'contas de luz e circuitos residenciais', cuidado: 'confundir potência (W) com energia (kWh)' },
        { id: 'esteq', nome: 'Estequiometria', freq: 3, nivel: 2, revisar: 'mol, massa molar, proporção da equação balanceada, rendimento', treinar: 'cálculos com reações', cuidado: 'usar a equação sem balancear' },
        { id: 'organ', nome: 'Química orgânica', freq: 3, nivel: 2, revisar: 'funções orgânicas, isomeria, reações e polímeros', treinar: 'combustíveis, fármacos e plásticos', cuidado: 'confundir éster com éter' },
        { id: 'gen', nome: 'Genética', freq: 3, nivel: 2, revisar: '1ª lei de Mendel, heredogramas, grupos sanguíneos', treinar: 'cruzamentos e heredogramas', cuidado: 'esquecer de restringir aos descendentes possíveis no cálculo da probabilidade' },
        { id: 'mec', nome: 'Mecânica', freq: 3, nivel: 2, revisar: 'velocidade média, leis de Newton, energia mecânica e trabalho', treinar: 'movimentos, freios e rampas', cuidado: 'esquecer de converter km/h em m/s (÷ 3,6)' },
        { id: 'fisio', nome: 'Fisiologia humana', freq: 2, nivel: 1, revisar: 'sistemas digestório, circulatório e imunológico; vacinas e soros', treinar: 'saúde e doenças', cuidado: 'confundir vacina (imunização ativa) com soro (passiva)' },
        { id: 'solu', nome: 'Soluções e concentração', freq: 2, nivel: 1, revisar: 'g/L, mol/L, diluição (C₁V₁ = C₂V₂), ppm', treinar: 'rótulos, soro e água', cuidado: 'esquecer de converter mL em L' },
        { id: 'amb', nome: 'Química ambiental', freq: 2, nivel: 1, revisar: 'efeito estufa, chuva ácida, tratamento de água e esgoto', treinar: 'impactos e soluções ambientais', cuidado: 'confundir efeito estufa com camada de ozônio' },
        { id: 'celula', nome: 'Citologia e bioquímica', freq: 2, nivel: 2, revisar: 'organelas, DNA/RNA e síntese de proteínas, fotossíntese e respiração', treinar: 'processos celulares', cuidado: 'trocar as equações de fotossíntese e respiração' },
        { id: 'evol', nome: 'Evolução', freq: 2, nivel: 2, revisar: 'seleção natural, Lamarck × Darwin, especiação', treinar: 'resistência a antibióticos e pesticidas', cuidado: 'dizer que o ambiente provoca a mutação' },
        { id: 'ondas', nome: 'Ondulatória e óptica', freq: 2, nivel: 2, revisar: 'v = λ·f, som, espectro eletromagnético, espelhos e lentes', treinar: 'som, luz e telecomunicações', cuidado: 'achar que a frequência muda quando a onda troca de meio' },
        { id: 'termo', nome: 'Termologia', freq: 2, nivel: 2, revisar: 'calor sensível e latente (Q = m·c·ΔT), dilatação, máquinas térmicas', treinar: 'aquecimento e trocas de calor', cuidado: 'confundir calor com temperatura' },
        { id: 'eletroq', nome: 'Eletroquímica', freq: 2, nivel: 3, revisar: 'pilhas (quem oxida e quem reduz), eletrólise, corrosão', treinar: 'baterias e galvanização', cuidado: 'trocar ânodo e cátodo' },
        { id: 'equil', nome: 'Cinética e equilíbrio', freq: 2, nivel: 3, revisar: 'velocidade de reação, Le Chatelier, pH e pOH', treinar: 'reações do cotidiano', cuidado: 'achar que o catalisador desloca o equilíbrio' },
        { id: 'hidro', nome: 'Hidrostática', freq: 1, nivel: 3, revisar: 'pressão, empuxo, princípio de Pascal', treinar: 'objetos que boiam e prensas hidráulicas', cuidado: 'usar a massa do objeto no lugar da do líquido deslocado' },
      ],
    },
  };
  const DIAS = [['09/11', 'seg'], ['10/11', 'ter'], ['11/11', 'qua'], ['12/11', 'qui'], ['13/11', 'sex'], ['14/11', 'sáb']];
  const marcados = { MT: [], CN: [] };   // assuntos marcados, em ordem, por área

  // Abre o painel do plano da área escolhida (MT ou CN)
  function abrirPlano(area) {
    S.planoArea = area;
    evento(`plano/abriu ${PLANOS[area].nome}`);
    const A = PLANOS[area];
    document.querySelectorAll('.plano-btn').forEach((b) => b.classList.toggle('ativo', b.dataset.area === area));
    $('plano_titulo').innerHTML = `Plano de <mark class="grifo">${A.nome}</mark>`;
    $('topicos').innerHTML = A.topicos.map((t) => `<button type="button" class="chip" data-id="${t.id}">${esc(t.nome)}</button>`).join('');
    atualizarChips();
    $('plano_saida').hidden = true;
    $('plano_painel').hidden = false;
    requestAnimationFrame(() => $('plano_painel').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function atualizarChips() {
    const m = marcados[S.planoArea];
    document.querySelectorAll('#topicos .chip').forEach((c) => {
      const on = m.includes(c.dataset.id);
      c.classList.toggle('ativo', on);
      c.disabled = !on && m.length >= 5;
    });
  }

  function ligarTopicos() {
    $('topicos').addEventListener('click', (e) => {
      const b = e.target.closest('.chip'); if (!b || !S.planoArea) return;
      const m = marcados[S.planoArea];
      const i = m.indexOf(b.dataset.id);
      if (i >= 0) m.splice(i, 1); else if (m.length < 5) m.push(b.dataset.id);
      atualizarChips();
    });
  }

  // Estrutura do plano a partir da meta da área e dos assuntos marcados
  function montarPlano(area) {
    const A = PLANOS[area], R = S.ultimo;
    const k = !R ? null : (area === 'MT' ? R.kMT : R.kCN);
    const metaReal = k === null ? 25 : k;
    const meta = clamp(metaReal, 5, 45);
    const nivel = meta <= 20 ? 0 : meta <= 32 ? 1 : 2;
    const perfil = [{ q: 12, maxNivel: 2 }, { q: 15, maxNivel: 3 }, { q: 20, maxNivel: 3 }][nivel];
    perfil.prova = A.prova[nivel];

    const m = marcados[area];
    const fracos = m.map((id) => A.topicos.find((t) => t.id === id));
    const resto = A.topicos.filter((t) => !m.includes(t.id) && t.nivel <= perfil.maxNivel && (meta > 32 || t.freq >= 2))
      .sort((a, b) => b.freq - a.freq || a.nivel - b.nivel);
    const fila = [...fracos, ...resto];
    const principais = fila.slice(0, 4);
    const aquec = A.topicos.filter((t) => t.freq === 3 && !principais.includes(t));
    const aq = (i) => aquec.length ? aquec[i % aquec.length] : null;

    const dias = principais.map((t, i) => ({
      data: DIAS[i][0], sem: DIAS[i][1], titulo: t.nome, fraco: m.includes(t.id),
      itens: [`Revisar: ${t.revisar}.`, `Treinar: ${perfil.q} questões de ENEM anteriores (${t.treinar}).`,
        `Cuidado: ${t.cuidado}.`, aq(i) ? `Aquecimento: 5 questões de ${aq(i).nome.toLowerCase()}.` : ''].filter(Boolean),
      resumo: `${perfil.q} questões · cuidado: ${t.cuidado}`,
    }));
    const quinto = fila[4];
    dias.push({
      data: DIAS[4][0], sem: DIAS[4][1], titulo: 'Simulado', fraco: false,
      itens: [`${A.simulado}, no horário da prova.`, `Conte os acertos e compare com a meta de ${meta}.`,
        quinto ? `Revise ${quinto.nome.toLowerCase()} (30 min).` : 'Revise os erros da semana.'],
      resumo: `45 questões em 2h30 · compare com a meta de ${meta}`,
    });
    dias.push({
      data: DIAS[5][0], sem: DIAS[5][1], titulo: 'Dia leve', fraco: false,
      itens: [A.leve, 'Documento com foto, caneta preta de tubo transparente, local de prova.', 'Dormir cedo.'],
      resumo: '1 hora de revisão · separar documento e caneta · dormir cedo',
    });
    return { area, nome: A.nome, meta, metaReal, semMeta: k === null, perfil, dias };
  }

  function gerarPlano() {
    if (!S.planoArea) return;
    const P = montarPlano(S.planoArea);
    let html = `<p class="estrategia"><b>Na prova:</b> ${P.perfil.prova}</p>`;
    for (const d of P.dias) {
      html += `<div class="dia"><h3><small>${d.data} ${d.sem}</small>${esc(d.titulo)}</h3><ul>${d.itens.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
    }
    $('plano').innerHTML = html;
    $('plano_saida').hidden = false;
    desenharPlano(P);

    const u = new URL(CFG.EXATOO_URL || 'https://exatoo.com');
    u.searchParams.set('utm_source', 'calculadora2dia'); u.searchParams.set('utm_medium', 'instagram'); u.searchParams.set('utm_campaign', 'enem2026');
    const m = marcados[S.planoArea];
    if (m.length) u.searchParams.set('utm_content', `${S.planoArea.toLowerCase()}:${m.join(',')}`);
    $('btn_exatoo').href = u.toString();
  }

  // Imagem do plano (1080×1920), no mesmo estilo do card
  async function desenharPlano(P) {
    await carregarFontes();
    const W = 1080, H = 1920, M = 90;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const D = 'Archivo, "Helvetica Neue", Arial, sans-serif', MONO = '"IBM Plex Mono", Menlo, monospace';
    const TINTA = '#121212', CINZA = '#6a6a6a', MARCA = '#ffe94a';
    const grifo = (txt, x, y, alt) => { const w = ctx.measureText(txt).width; ctx.fillStyle = MARCA; ctx.fillRect(x - 10, y - alt * 0.44, w + 20, alt * 0.38); };

    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'left';
    ctx.fillStyle = TINTA; ctx.font = `600 30px ${MONO}`;
    ctx.fillText('09 A 14/11 · ATÉ A PROVA DE 15/11', M, 140);
    ctx.font = `850 118px ${D}`;
    ctx.fillText('PLANO DE', M, 275);
    desenharIcone(ctx, W - M - 135, 128, 135);
    const area = P.nome.toUpperCase();
    let ta = 118;
    while (ctx.measureText(area).width > W - 2 * M && ta > 70) { ta -= 4; ctx.font = `850 ${ta}px ${D}`; }
    grifo(area, M, 395, ta);
    ctx.fillStyle = TINTA; ctx.fillText(area, M, 395);

    ctx.font = `700 40px ${D}`;
    const metaTxt = P.semMeta ? `até domingo · ${P.nome}` : `meta: ${P.metaReal > 45 ? '45 (o máximo)' : P.meta} de 45 em ${P.nome}`;
    ctx.fillText(metaTxt, M, 470);
    if (P.dias.some((d) => d.fraco)) {
      ctx.fillStyle = CINZA; ctx.font = `500 24px ${MONO}`;
      ctx.fillText('grifado: assuntos que você marcou como fracos', M, 512);
    }

    // seis dias
    let y = 590;
    const passo = 184, colTxt = M + 190, largTxt = W - colTxt - M;
    for (const d of P.dias) {
      ctx.fillStyle = TINTA; ctx.fillRect(M, y - 50, W - 2 * M, 2);
      ctx.font = `600 30px ${MONO}`; ctx.fillText(d.data, M, y + 6);
      ctx.fillStyle = CINZA; ctx.font = `500 26px ${MONO}`; ctx.fillText(d.sem.toUpperCase(), M, y + 44);
      ctx.font = `800 46px ${D}`;
      const tit = quebrar(ctx, d.titulo, largTxt)[0];
      if (d.fraco) { // grifo na base da palavra (no tamanho pequeno o grifo alto parece risco)
        const w = ctx.measureText(tit).width;
        ctx.fillStyle = MARCA; ctx.fillRect(colTxt - 8, y - 10, w + 16, 22);
      }
      ctx.fillStyle = TINTA; ctx.fillText(tit, colTxt, y + 6);
      ctx.fillStyle = CINZA; ctx.font = `500 27px ${D}`;
      quebrar(ctx, d.resumo, largTxt).slice(0, 2).forEach((l, i) => ctx.fillText(l, colTxt, y + 50 + i * 36));
      y += passo;
    }

    // rodapé
    ctx.fillStyle = TINTA; ctx.font = `600 30px ${MONO}`;
    ctx.fillText(`Prof. João Capri ${CFG.ARROBA || ''} · treine no exatoo.com`.trim(), M, 1775);
    ctx.font = `850 60px ${D}`;
    grifo(CFG.SITE || '', M, 1860, 60);
    ctx.fillStyle = TINTA; ctx.fillText(CFG.SITE || '', M, 1860);

    cv.toBlob((blob) => {
      if (!blob) return;
      S.planoBlob = blob; S.planoNome = P.nome;
      const img = $('plano_img'), old = img.src;
      img.src = URL.createObjectURL(blob);
      if (old && old.startsWith('blob:')) URL.revokeObjectURL(old);
    }, 'image/png');
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
    // Botões + e −: um toque = 1 passo; segurar = repete, acelerando.
    // (o zoom por toque duplo é desligado no CSS com touch-action: manipulation)
    document.querySelectorAll('.pm').forEach((b) => {
      const passo = () => {
        const n = $(b.dataset.alvo);
        n.value = clamp((+n.value || 0) + +b.dataset.d, 0, 45);
        atualizarEstimativas();
      };
      let tmr = null, veioDoToque = false;
      const parar = () => { clearTimeout(tmr); tmr = null; };
      const repetir = (espera) => { tmr = setTimeout(() => { passo(); repetir(Math.max(60, espera * 0.8)); }, espera); };
      b.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();               // evita seleção de texto e o menu de toque longo
        veioDoToque = true;
        passo();
        repetir(420);                     // começa a repetir depois de ~0,4 s segurando
      });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, parar);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      // teclado (Enter/Espaço) gera só "click": conta 1 passo; o click que vem depois do toque é ignorado
      b.addEventListener('click', () => { if (veioDoToque) { veioDoToque = false; return; } passo(); });
    });

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

    ligarTopicos();
    document.querySelectorAll('.plano-btn').forEach((b) => b.addEventListener('click', () => abrirPlano(b.dataset.area)));
    $('btn_plano').addEventListener('click', () => {
      gerarPlano();
      if (S.planoArea) evento(`plano/montou ${PLANOS[S.planoArea].nome}`);
      for (const id of marcados[S.planoArea] || []) evento(`assunto-fraco/${PLANOS[S.planoArea].nome}/${PLANOS[S.planoArea].topicos.find((t) => t.id === id).nome}`);
    });
    $('btn_share').addEventListener('click', () => {
      compartilhar(S.cardBlob, 'minha-meta-enem.png', 'Minha meta no 2º dia do ENEM');
      const R = S.ultimo || {};
      evento('compartilhou/card');
      if (R.kMT !== null && R.kMT !== undefined) evento(`meta-compartilhada/Matemática ${faixa10(R.kMT)}`);
      if (R.kCN !== null && R.kCN !== undefined) evento(`meta-compartilhada/Natureza ${faixa10(R.kCN)}`);
      evento(`redacao-estimada/${faixa10(+$('red').value / 20).replace(/\d+/g, (d) => +d * 20)}`);
    });
    $('btn_plano_baixar').addEventListener('click', () => {
      evento(`plano/baixou ${S.planoNome || ''}`.trim());
      const nome = (S.planoNome || 'estudos').toLowerCase();
      compartilhar(S.planoBlob, `meu-plano-${nome}.png`, `Meu plano de ${S.planoNome || 'estudos'} até o 2º dia`);
    });

    const bc = $('btn_contato');
    if (!CFG.FORM_URL) $('contato').hidden = true; else bc.href = CFG.FORM_URL;
    $('lgpd').addEventListener('change', (e) => { bc.classList.toggle('desativado', !e.target.checked); bc.setAttribute('aria-disabled', String(!e.target.checked)); });
    bc.addEventListener('click', (e) => { if (!$('lgpd').checked) e.preventDefault(); else evento('clique/quero receber o plano'); });
    $('btn_exatoo').addEventListener('click', () => evento('clique/exatoo'));
    $('manual').addEventListener('toggle', () => { if ($('manual').open) evento('abriu/entrada manual'); });
    $('equilibrio').addEventListener('change', () => evento('usou/balança MT × CN'));
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
    const ed = S.tri.edicoes, anosTxt = ed.length > 2 ? `de ${ed[0]} a ${ed[ed.length - 1]}` : ed.join(' e ');
    const fontes = [`Notas: microdados do ENEM ${anosTxt} (Inep)`];
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
