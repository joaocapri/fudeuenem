/* =====================================================================
   /2dia — "Onde eu passo?" · Fudeu ENEM?! · Prof. João Capri
   ---------------------------------------------------------------------
   Depois do 2º dia: o aluno informa os acertos (ou as notas) das 4 áreas
   e a redação, e vê em quais cursos passaria na 1ª chamada do Sisu, com
   filtros (curso, estado, cidade, universidade, modalidade), mapa do
   Brasil e cards para o story.

   Dados (pasta /data):
     - tri_tabela.json → acertos → nota TRI (mediana, ENEM 2022–2025)
     - cursos.json     → ofertas do Sisu 2025 (corte, pesos, mínimos)
     - mapa.json       → contorno dos estados e posição das cidades
   Nada do que o aluno digita sai do navegador.
   ===================================================================== */
(function () {
  'use strict';

  const CFG = window.CONFIG || {};
  const AREAS = ['LC', 'CH', 'CN', 'MT'];                 // ordem dos pesos em cursos.json: LC, CH, CN, MT, RED
  const NOME = { LC: 'Linguagens', CH: 'Humanas', CN: 'Natureza', MT: 'Matemática' };
  const QUASE = 15;      // "por pouco": faltaram até 15 pontos
  const LIMITE = 5;      // "no limite": passou com menos de 5 pontos de folga
  const CHAVE = 'fudeuenem_2dia';

  const S = {
    tri: null, cursos: null, mapa: null,
    modo: 'acertos',                                      // 'acertos' | 'notas'
    val: { acertos: { LC: '', CH: '', CN: '', MT: '' }, notas: { LC: '', CH: '', CN: '', MT: '' } },
    f: { curso: null, uf: '', cidade: '', ies: '', mod: 0 },
    aba: 'passa', lim: 10, card: 'mapa',
    res: null, nomesCurso: [], bbox: {}, icone: null, blob: null, ultimoN: null,
  };

  const $ = (id) => document.getElementById(id);
  const fmt0 = (x) => Math.round(x).toLocaleString('pt-BR');
  const fmt2 = (x) => Number(x).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const MINUSC = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'a', 'o', 'para', 'com']);
  const titulo = (s) => String(s || '').toLowerCase().split(/(\s+|-|\/)/).map((w, i) =>
    (i > 0 && MINUSC.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join('');
  const chaveCurso = (k) => norm(k).replace(/[^a-z0-9 ]/g, ' ').replace(/\b(de|da|do|das|dos|e|em)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const plural = (n, um, varios) => (n === 1 ? um : varios);

  function evento(caminho) {
    try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: caminho, title: caminho, event: true }); } catch (e) { /* nunca quebra o site */ }
  }

  /* ===================================================================
     1) NOTAS: dos acertos (mediana da TRI) ou digitadas
     =================================================================== */
  const notaDe = (area, k) => S.tri.areas[area].pct[clamp(Math.round(k), 0, 45)][2];

  // Retorna [LC, CH, CN, MT, RED] ou null se faltar alguma área
  function lerNotas() {
    const out = [];
    for (const a of AREAS) {
      const v = $('in_' + a).value.trim().replace(',', '.');
      if (v === '' || isNaN(+v)) return null;
      out.push(S.modo === 'acertos' ? notaDe(a, +v) : clamp(+v, 0, 1000));
    }
    out.push(+$('red').value);
    return out;
  }

  function atualizarAux() {
    for (const a of AREAS) {
      const v = $('in_' + a).value.trim();
      const el = $('est_' + a);
      if (S.modo === 'notas') el.textContent = 'nota de 0 a 1000';
      else if (v === '') el.textContent = 'acertos de 45';
      else {
        const t = S.tri.areas[a], k = clamp(Math.round(+v), 0, 45);
        const lo = Math.min(t.pct[k][1], t.anos ? t.anos[k][0] : t.pct[k][1]);
        const hi = Math.max(t.pct[k][3], t.anos ? t.anos[k][1] : t.pct[k][3]);
        el.textContent = `de 45 · ≈ ${fmt0(lo)}–${fmt0(hi)}`;
      }
    }
  }

  function trocarModo(modo) {
    for (const a of AREAS) S.val[S.modo][a] = $('in_' + a).value;
    S.modo = modo;
    document.body.classList.toggle('modo-notas', modo === 'notas');
    document.querySelectorAll('#ficha_notas .seg button').forEach((b) => b.classList.toggle('ativo', b.dataset.modo === modo));
    for (const a of AREAS) {
      const el = $('in_' + a);
      el.max = modo === 'notas' ? 1000 : 45;
      el.step = modo === 'notas' ? '0.1' : '1';
      el.inputMode = modo === 'notas' ? 'decimal' : 'numeric';
      el.value = S.val[modo][a];
    }
    atualizar();
  }

  /* ===================================================================
     2) CÁLCULO: para cada oferta, na modalidade escolhida
        nota Sisu = Σ(peso × nota) ÷ Σ pesos; confere corte, notas mínimas
        e média mínima do curso.
     =================================================================== */
  function avaliar(notas) {
    const media = notas.reduce((a, b) => a + b, 0) / 5;
    const mod = S.f.mod, itens = [];
    for (const r of S.cursos.cursos) {
      const o = r.o.find((m) => m[0] === mod);
      if (!o) continue;
      const W = r.p.reduce((a, b) => a + b, 0);
      if (!W) continue;
      if (r.mn && r.mn.some((m, i) => m && notas[i] < m)) continue;   // eliminado por nota mínima
      if (r.mm && media < r.mm) continue;                              // eliminado por média mínima
      const nota = r.p.reduce((s, w, i) => s + w * notas[i], 0) / W;
      itens.push({ r, corte: o[1], nota, folga: nota - o[1], semCorte: !(o[1] > 0) });
    }
    return itens;
  }

  function filtrar(itens) {
    const f = S.f;
    return itens.filter((i) => (!f.curso || i.r.ck === f.curso.ck)
      && (!f.uf || i.r.u === f.uf) && (!f.cidade || i.r.m === f.cidade) && (!f.ies || i.r.ik === f.ies));
  }

  /* ===================================================================
     3) TELA
     =================================================================== */
  function atualizar() {
    if (!S.tri || !S.cursos || !S.mapa) return;
    $('red_v').textContent = $('red').value;
    atualizarAux();
    salvar();
    const notas = lerNotas();
    const pronto = !!notas;
    $('corpo').hidden = !pronto;
    $('res_num').hidden = $('res_det').hidden = !pronto;
    $('res_pre').hidden = pronto;
    if (!pronto) { S.res = null; return; }

    const todos = avaliar(notas);
    const vis = filtrar(todos);
    const passa = vis.filter((i) => i.semCorte || i.folga >= 0)
      .sort((a, b) => (a.semCorte - b.semCorte) || (b.corte - a.corte));          // mais concorridos primeiro
    const quase = vis.filter((i) => !i.semCorte && i.folga < 0 && i.folga >= -QUASE).sort((a, b) => b.folga - a.folga);
    const conta = (l, fn) => new Set(l.map(fn)).size;
    const R = { notas, todos, passa, quase,
      nIes: conta(passa, (i) => i.r.ik), nUf: conta(passa, (i) => i.r.u), nCid: conta(passa, (i) => i.r.m + '|' + i.r.u) };
    S.res = R;

    // número gigante: universidades (se há curso escolhido) ou cursos
    const f = S.f, porIes = !!f.curso;
    const n = porIes ? R.nIes : passa.length;
    const el = $('res_n');
    el.textContent = n.toLocaleString('pt-BR');
    if (S.ultimoN !== null && S.ultimoN !== n) { el.classList.remove('pisca'); void el.offsetWidth; el.classList.add('pisca'); }
    S.ultimoN = n;
    $('res_un').textContent = porIes ? plural(n, 'universidade', 'universidades') : plural(n, 'curso', 'cursos');
    const onde = f.cidade ? ` em ${f.cidade}/${f.uf}` : f.uf ? ` no ${f.uf}` : '';
    const iesTxt = f.ies ? ` na ${esc(f.ies.split('|')[0])}` : '';
    let det;
    if (!n) det = `Nenhuma opção${porIes ? ` de <b>${esc(f.curso.nome)}</b>` : ''}${iesTxt}${onde} por enquanto. Veja a aba “Por pouco” ou mude os filtros.`;
    else if (porIes) det = `com <b>${esc(f.curso.nome)}</b>${iesTxt}${onde}: ${passa.length} ${plural(passa.length, 'opção', 'opções')} de campus e turno em ${R.nCid} ${plural(R.nCid, 'cidade', 'cidades')}.`;
    else det = `em <b>${R.nIes}</b> ${plural(R.nIes, 'universidade', 'universidades')}${f.uf ? '' : ` de <b>${R.nUf}</b> ${plural(R.nUf, 'estado', 'estados')}`}${iesTxt}${onde}, na 1ª chamada.`;
    $('res_det').innerHTML = det;

    renderSonho(todos);
    renderFiltros();
    renderMapa();
    renderLista();
    $('cards').hidden = !R.passa.length;   // sem resultado, não há card para compartilhar
    agendarCard();
  }

  // O curso que o aluno escolheu na calculadora do 2º dia (guardado no navegador)
  function renderSonho(todos) {
    const box = $('sonho');
    let sonho = null;
    try { sonho = JSON.parse(localStorage.getItem('fudeuenem_sonho') || 'null'); } catch (e) { /* sem armazenamento */ }
    const r = sonho && S.cursos.cursos.find((x) => x.id === sonho.id);
    if (!r || sonho.mod !== S.f.mod) { box.hidden = true; return; }
    const it = todos.find((i) => i.r === r);
    box.hidden = false;
    const cab = `<p class="rot">O curso que você queria</p><p class="s-curso">${esc(titulo(r.k))} · ${esc(r.s)} <span class="aux">(${esc(r.m)}/${esc(r.u)})</span></p>`;
    if (!it) box.innerHTML = `${cab}<p class="s-ver nao"><b>Não passaria:</b> ficou abaixo de uma nota mínima do curso.</p>`;
    else if (it.semCorte) box.innerHTML = `${cab}<p class="s-ver"><b>Pode ser sua:</b> não teve nota de corte em 2025.</p>`;
    else if (it.folga >= 0) box.innerHTML = `${cab}<p class="s-ver"><b>Passaria!</b> Sua nota estimada: ${fmt2(it.nota)} · corte ${fmt2(it.corte)} (+${fmt0(it.folga)} de folga).</p>`;
    else box.innerHTML = `${cab}<p class="s-ver nao"><b>Faltaram ${fmt0(-it.folga) || 1} ${plural(Math.round(-it.folga) || 1, 'ponto', 'pontos')}.</b> Sua nota estimada: ${fmt2(it.nota)} · corte ${fmt2(it.corte)}.${-it.folga <= QUASE ? ' A lista de espera pode chegar em você.' : ''}</p>`;
  }

  /* ---------- filtros ---------- */
  function prepararBase() {
    const C = S.cursos.cursos, nomes = new Map();
    for (const r of C) {
      r.ck = chaveCurso(r.k);
      r.ik = `${r.s}|${r.n}`;
      if (!nomes.has(r.ck)) nomes.set(r.ck, { ck: r.ck, nome: titulo(r.k), n: 0, busca: norm(r.k) });
      nomes.get(r.ck).n++;
    }
    S.nomesCurso = [...nomes.values()].sort((a, b) => b.n - a.n);
    // modalidades: ampla + as da Lei de Cotas (iguais em todo o país)
    const mods = S.cursos.modalidades.map((t, i) => [i, t]).filter(([i, t]) => i === 0 || t.startsWith('Escola pública'));
    $('f_mod').innerHTML = mods.map(([i, t]) => `<option value="${i}">${esc(t)}</option>`).join('');
    const ufs = [...new Set(C.map((r) => r.u))].sort();
    $('f_uf').innerHTML = '<option value="">Todo o Brasil</option>' + ufs.map((u) => `<option>${u}</option>`).join('');
    // caixas delimitadoras dos estados (para o zoom do mapa)
    for (const [uf, e] of Object.entries(S.mapa.estados)) {
      const nums = e.d.match(/-?\d+\.?\d*/g).map(Number);
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let i = 0; i < nums.length; i += 2) { x0 = Math.min(x0, nums[i]); x1 = Math.max(x1, nums[i]); y0 = Math.min(y0, nums[i + 1]); y1 = Math.max(y1, nums[i + 1]); }
      S.bbox[uf] = [x0, y0, x1, y1];
    }
  }

  function renderFiltros() {
    const f = S.f, C = S.cursos.cursos;
    // cidades do estado escolhido
    const cid = $('f_cidade');
    if (!f.uf) { cid.disabled = true; cid.innerHTML = '<option value="">—</option>'; }
    else {
      const cidades = [...new Set(C.filter((r) => r.u === f.uf).map((r) => r.m))].sort((a, b) => a.localeCompare(b));
      cid.disabled = false;
      cid.innerHTML = '<option value="">Todas</option>' + cidades.map((m) => `<option ${m === f.cidade ? 'selected' : ''}>${esc(m)}</option>`).join('');
    }
    // universidades (do estado, se houver)
    const ies = new Map();
    for (const r of C) if (!f.uf || r.u === f.uf) ies.set(r.ik, r.s);
    const lista = [...ies.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    $('f_ies').innerHTML = '<option value="">Todas</option>' + lista.map(([k, s]) => `<option value="${esc(k)}" ${k === f.ies ? 'selected' : ''}>${esc(s)} · ${esc(titulo(k.split('|')[1]))}</option>`).join('');
    $('f_uf').value = f.uf;
    $('f_mod').value = String(f.mod);
    // curso escolhido
    $('curso_box').hidden = !!f.curso;
    $('curso_sel').hidden = !f.curso;
    if (f.curso) $('curso_sel').innerHTML = `<div class="t1">${esc(f.curso.nome)}</div><button type="button" class="trocar" id="curso_x">trocar</button>`;
    $('f_limpar').hidden = !(f.curso || f.uf || f.cidade || f.ies || f.mod);
  }

  function sugerirCursos(q) {
    const ul = $('f_curso_lista');
    const termos = norm(q).split(/\s+/).filter(Boolean);
    if (!termos.length) { ul.innerHTML = ''; return; }
    const pri = (c) => (c.busca.startsWith(termos[0]) ? 0 : 1);
    const out = S.nomesCurso.filter((c) => termos.every((t) => c.busca.includes(t))).sort((a, b) => pri(a) - pri(b) || b.n - a.n).slice(0, 12);
    ul.innerHTML = out.length
      ? out.map((c) => `<li tabindex="0" data-ck="${esc(c.ck)}"><div class="t1">${esc(c.nome)}</div><div class="t2">${c.n} ${plural(c.n, 'oferta', 'ofertas')} no Sisu</div></li>`).join('')
      : '<li class="vazio">Nenhum curso com esse nome.</li>';
  }

  /* ---------- mapa (SVG) ---------- */
  function contagens() {
    const cid = new Map(), uf = new Map();
    for (const i of S.res.passa) {
      const k = `${i.r.m}|${i.r.u}`;
      cid.set(k, (cid.get(k) || 0) + 1);
      uf.set(i.r.u, (uf.get(i.r.u) || 0) + 1);
    }
    return { cid, uf };
  }
  // bolinhas menores quando há muitas cidades, para o mapa não virar um borrão
  const raio = (n, total) => Math.min(17, 4.5 + 2.4 * Math.sqrt(n)) * clamp(1.2 - (total || 0) / 260, 0.45, 1);

  function renderMapa() {
    const M = S.mapa, f = S.f, { cid, uf } = contagens();
    let vb = [0, 0, M.w, M.h];
    if (f.uf && S.bbox[f.uf]) {
      const [x0, y0, x1, y1] = S.bbox[f.uf], lado = Math.max(x1 - x0, y1 - y0) * 1.25, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      vb = [cx - lado / 2, cy - lado / 2, lado, lado];
    }
    const k = vb[2] / M.w;   // fator de zoom: mantém bolinhas e rótulos do mesmo tamanho na tela
    let h = '';
    for (const [sig, e] of Object.entries(M.estados)) {
      const cls = ['uf', uf.get(sig) ? 'tem' : '', f.uf === sig ? 'sel' : '', f.uf && f.uf !== sig ? 'fora' : ''].join(' ');
      h += `<path class="${cls}" d="${e.d}" data-uf="${sig}"><title>${sig}: ${uf.get(sig) || 0}</title></path>`;
    }
    const pts = [...cid.entries()].sort((a, b) => b[1] - a[1]);
    for (const [key, n] of pts) {
      const p = M.cidades[key]; if (!p) continue;
      const [m, u] = key.split('|');
      h += `<circle class="pt${f.cidade === m && f.uf === u ? ' sel' : ''}" cx="${p[0]}" cy="${p[1]}" r="${(raio(n, f.uf ? 0 : cid.size) * k * (f.uf ? 1.9 : 1)).toFixed(1)}" data-c="${esc(key)}"><title>${esc(m)}/${u}: ${n}</title></circle>`;
    }
    if (f.uf) { // com zoom, nomeia as cidades
      for (const [key] of pts.slice(0, 12)) {
        const p = M.cidades[key]; if (!p) continue;
        h += `<text class="rotulo" x="${p[0]}" y="${(p[1] - 14 * k).toFixed(1)}" text-anchor="middle" style="font-size:${(26 * k).toFixed(1)}px;stroke-width:${(6 * k).toFixed(1)}px">${esc(key.split('|')[0])}</text>`;
      }
    }
    const svg = $('mapa');
    svg.setAttribute('viewBox', vb.map((v) => v.toFixed(1)).join(' '));
    svg.innerHTML = h;
    $('mapa_br').hidden = !f.uf;
    $('mapa_leg').textContent = f.uf
      ? `${cid.size} ${plural(cid.size, 'cidade', 'cidades')} no ${f.uf}. Toque numa bolinha para ver só aquela cidade.`
      : 'Cada bolinha é uma cidade onde você passaria. Toque num estado para filtrar.';
  }

  /* ---------- lista ---------- */
  function renderLista() {
    const R = S.res;
    $('aba_passa').textContent = `Passaria (${R.passa.length.toLocaleString('pt-BR')})`;
    $('aba_quase').textContent = `Por pouco (${R.quase.length.toLocaleString('pt-BR')})`;
    document.querySelectorAll('#abas button').forEach((b) => b.classList.toggle('ativo', b.dataset.aba === S.aba));
    const lista = S.aba === 'passa' ? R.passa : R.quase;
    const linha = (i) => {
      const r = i.r;
      const lado = i.semCorte ? '<span>sem corte</span><b>em 2025</b>'
        : `<span>corte</span><b>${fmt2(i.corte)}</b><em class="${i.folga < 0 ? 'falta' : i.folga < LIMITE ? 'limite' : 'folga'}">${
          i.folga < 0 ? `faltaram ${Math.max(1, Math.round(-i.folga))}` : i.folga < LIMITE ? 'no limite' : `+${fmt0(i.folga)} de folga`}</em>`;
      return `<li><div class="onde-q"><b>${esc(titulo(r.k))} · ${esc(r.s)}</b><span>${esc(r.m)}/${esc(r.u)} · ${esc(r.t)} · ${esc(r.g)}</span></div><div class="onde-c">${lado}</div></li>`;
    };
    $('lista').innerHTML = lista.length ? lista.slice(0, S.lim).map(linha).join('')
      : `<li><span class="vazio">${S.aba === 'passa' ? 'Nada por aqui com esses filtros. Veja a aba “Por pouco”.' : `Nenhum curso a até ${QUASE} pontos do corte com esses filtros.`}</span></li>`;
    const resto = lista.length - S.lim;
    $('mais').hidden = resto <= 0;
    $('mais').textContent = `ver mais ${Math.min(resto, 20)}`;
  }

  /* ===================================================================
     4) CARDS (1080×1920): "mapa" e "ranking"
     =================================================================== */
  let tmrCard, recursos = null;
  function agendarCard() { clearTimeout(tmrCard); tmrCard = setTimeout(desenharCard, 180); }
  function carregarRecursos() {
    if (!recursos) {
      const fontes = (document.fonts && document.fonts.load)
        ? Promise.all(['850 300px Archivo', '700 60px Archivo', '600 30px "IBM Plex Mono"'].map((f) => document.fonts.load(f))).catch(() => {})
        : Promise.resolve();
      const icone = new Promise((ok) => { const img = new Image(); img.onload = () => { S.icone = img; ok(); }; img.onerror = () => ok(); img.src = '../assets/icone.svg'; });
      recursos = Promise.all([fontes, icone]);
    }
    return recursos;
  }
  // corta o texto com "…" para caber na largura
  function cabe(ctx, txt, maxW) {
    if (ctx.measureText(txt).width <= maxW) return txt;
    let t = txt;
    while (t.length > 3 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t.trimEnd() + '…';
  }

  async function desenharCard() {
    const R = S.res; if (!R) return;
    await carregarRecursos();
    const W = 1080, H = 1920, M = 90, f = S.f;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const D = 'Archivo, "Helvetica Neue", Arial, sans-serif', MONO = '"IBM Plex Mono", Menlo, monospace';
    const TINTA = '#121212', CINZA = '#6a6a6a', MARCA = '#ffe94a';
    const grifo = (txt, x, y, alt) => { const w = ctx.measureText(txt).width; ctx.fillStyle = MARCA; ctx.fillRect(x - 12, y - alt * 0.44, w + 24, alt * 0.38); ctx.fillStyle = TINTA; };

    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = TINTA; ctx.font = `600 30px ${MONO}`;
    ctx.fillText('ENEM 2026 · PÓS-PROVA', M, 130);
    ctx.font = `850 104px ${D}`;
    ctx.fillText('ONDE EU', M, 240);
    grifo('PASSO?', M, 340, 104); ctx.fillText('PASSO?', M, 340);

    // número + legenda
    const porIes = !!f.curso, n = porIes ? R.nIes : R.passa.length;
    const nTxt = n.toLocaleString('pt-BR');
    let tam = 250; ctx.font = `850 ${tam}px ${D}`;
    while (ctx.measureText(nTxt).width > 460 && tam > 130) { tam -= 10; ctx.font = `850 ${tam}px ${D}`; }
    const wN = ctx.measureText(nTxt).width;
    ctx.fillStyle = MARCA; ctx.fillRect(M - 14, 590 - tam * 0.33, wN + 28, tam * 0.3);
    ctx.fillStyle = TINTA; ctx.fillText(nTxt, M, 590);
    const xL = M + wN + 36, maxL = W - M - xL;
    ctx.font = `850 54px ${D}`;
    ctx.fillText(cabe(ctx, porIes ? plural(n, 'universidade', 'universidades') : plural(n, 'curso', 'cursos'), maxL), xL, 500);
    ctx.font = `700 38px ${D}`; ctx.fillStyle = CINZA;
    const onde = f.cidade ? `em ${f.cidade}/${f.uf}` : f.uf ? `no ${f.uf}` : 'pelo Brasil';
    const l2 = porIes ? `em ${f.curso.nome}` : `${R.nIes} ${plural(R.nIes, 'universidade', 'universidades')}`;
    ctx.fillText(cabe(ctx, l2, maxL), xL, 552);
    ctx.fillText(cabe(ctx, onde, maxL), xL, 598);
    ctx.fillStyle = TINTA;
    ctx.font = `600 28px ${MONO}`; ctx.fillStyle = CINZA;
    ctx.fillText('onde eu passaria na 1ª chamada do Sisu', M, 668);

    if (S.card === 'mapa') {
      // mapa do Brasil com as cidades
      const Mp = S.mapa, { cid, uf } = contagens();
      const topo = 710, alt = 800, esc_ = Math.min((W - 2 * M) / Mp.w, alt / Mp.h);
      const ox = (W - Mp.w * esc_) / 2, oy = topo + (alt - Mp.h * esc_) / 2;
      ctx.save(); ctx.translate(ox, oy); ctx.scale(esc_, esc_);
      ctx.lineJoin = 'round';
      for (const [sig, e] of Object.entries(Mp.estados)) {
        const p = new Path2D(e.d);
        ctx.fillStyle = uf.get(sig) ? '#fff6b0' : '#ffffff'; ctx.fill(p);
        ctx.lineWidth = 1.6 / esc_; ctx.strokeStyle = TINTA; ctx.stroke(p);
      }
      for (const [key, q] of [...cid.entries()].sort((a, b) => b[1] - a[1])) {
        const p = Mp.cidades[key]; if (!p) continue;
        ctx.beginPath(); ctx.arc(p[0], p[1], raio(q, cid.size) * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = MARCA; ctx.fill(); ctx.lineWidth = 2.2 / esc_; ctx.strokeStyle = TINTA; ctx.stroke();
      }
      ctx.restore();
      // destaque: a mais concorrida
      const top = R.passa.find((i) => !i.semCorte);
      if (top) {
        ctx.fillStyle = CINZA; ctx.font = `600 26px ${MONO}`; ctx.fillText('A MAIS CONCORRIDA EM QUE EU PASSARIA', M, 1560);
        ctx.fillStyle = TINTA; ctx.font = `800 44px ${D}`;
        ctx.fillText(cabe(ctx, `${titulo(top.r.k)} · ${top.r.s}`, W - 2 * M), M, 1612);
      }
    } else {
      // ranking: as mais concorridas
      ctx.fillStyle = TINTA; ctx.fillRect(M, 716, W - 2 * M, 4);
      const top = R.passa.filter((i) => !i.semCorte).slice(0, 7);
      let y = 800;
      top.forEach((i, idx) => {
        ctx.fillStyle = CINZA; ctx.font = `600 30px ${MONO}`; ctx.fillText(String(idx + 1).padStart(2, '0'), M, y);
        ctx.fillStyle = TINTA; ctx.font = `800 42px ${D}`;
        ctx.fillText(cabe(ctx, `${titulo(i.r.k)} · ${i.r.s}`, W - 2 * M - 300), M + 70, y);
        ctx.fillStyle = CINZA; ctx.font = `500 28px ${D}`;
        ctx.fillText(cabe(ctx, `${i.r.m}/${i.r.u} · ${i.r.t}`, W - 2 * M - 300), M + 70, y + 40);
        ctx.textAlign = 'right'; ctx.fillStyle = TINTA; ctx.font = `600 34px ${MONO}`;
        ctx.fillText(fmt2(i.corte), W - M, y);
        ctx.fillStyle = CINZA; ctx.font = `500 22px ${MONO}`; ctx.fillText('corte', W - M, y + 36);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#e4e4e4'; ctx.fillRect(M, y + 66, W - 2 * M, 2);
        y += 118;
      });
      if (!top.length) { ctx.fillStyle = CINZA; ctx.font = `600 34px ${D}`; ctx.fillText('Nenhuma opção com esses filtros (ainda).', M, 820); }
    }

    // rodapé
    ctx.fillStyle = TINTA; ctx.font = `800 46px ${D}`; ctx.fillText('Descubra onde você passa', M, 1704);
    ctx.font = `600 34px ${MONO}`; ctx.fillText(`Prof. João Capri ${CFG.ARROBA || ''}`.trim(), M, 1756);
    if (S.icone) { try { ctx.drawImage(S.icone, W - M - 180, 1678, 180, 180); } catch (e) { /* sem ícone */ } }
    ctx.font = `850 64px ${D}`;
    grifo(CFG.SITE || '', M, 1842, 64); ctx.fillText(CFG.SITE || '', M, 1842);

    cv.toBlob((blob) => {
      if (!blob) return;
      S.blob = blob;
      const img = $('card_img'), old = img.src;
      img.src = URL.createObjectURL(blob);
      if (old && old.startsWith('blob:')) URL.revokeObjectURL(old);
    }, 'image/png');
  }

  async function compartilhar() {
    const blob = S.blob; if (!blob) return;
    evento(`2dia/compartilhou card ${S.card}`);
    const file = new File([blob], 'onde-eu-passo.png', { type: 'image/png' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Onde eu passo no Sisu' }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'onde-eu-passo.png';
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ===================================================================
     5) GUARDA O QUE FOI DIGITADO (só no navegador do aluno)
     =================================================================== */
  function salvar() {
    try {
      const val = JSON.parse(JSON.stringify(S.val));
      for (const a of AREAS) val[S.modo][a] = $('in_' + a).value;
      localStorage.setItem(CHAVE, JSON.stringify({ modo: S.modo, val, red: $('red').value }));
    } catch (e) { /* sem armazenamento: tudo bem */ }
  }
  function restaurar() {
    try {
      const d = JSON.parse(localStorage.getItem(CHAVE) || 'null');
      if (!d) return;
      S.val = d.val || S.val; S.modo = d.modo === 'notas' ? 'notas' : 'acertos';
      if (d.red) $('red').value = d.red;
    } catch (e) { /* ignora */ }
  }

  /* ===================================================================
     6) INTERFACE
     =================================================================== */
  function ligarUI() {
    document.querySelectorAll('[data-arroba]').forEach((el) => { el.textContent = CFG.ARROBA || ''; });
    let jaCalculou = false;
    const mudou = () => {
      S.lim = 10; atualizar();
      if (S.res && !jaCalculou) { jaCalculou = true; evento(`2dia/calculou (${S.modo})`); }
    };

    for (const a of AREAS) {
      const el = $('in_' + a);
      el.addEventListener('input', mudou);
      el.addEventListener('blur', () => {
        if (el.value.trim() === '') return;
        const max = S.modo === 'notas' ? 1000 : 45;
        const v = clamp(+String(el.value).replace(',', '.') || 0, 0, max);
        el.value = S.modo === 'notas' ? String(Math.round(v * 10) / 10) : String(Math.round(v));
        mudou();
      });
    }
    // + e −: um toque = 1; segurar = repete, acelerando
    document.querySelectorAll('.pm').forEach((b) => {
      const passo = () => {
        const n = $(b.dataset.alvo);
        n.value = n.value.trim() === '' ? (+b.dataset.d > 0 ? 1 : 0) : clamp((+n.value || 0) + +b.dataset.d, 0, 45);
        mudou();
      };
      let tmr = null, toque = false;
      const parar = () => { clearTimeout(tmr); tmr = null; };
      const repetir = (ms) => { tmr = setTimeout(() => { passo(); repetir(Math.max(60, ms * 0.8)); }, ms); };
      b.addEventListener('pointerdown', (e) => { if (e.button !== undefined && e.button !== 0) return; e.preventDefault(); toque = true; passo(); repetir(420); });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, parar);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      b.addEventListener('click', () => { if (toque) { toque = false; return; } passo(); });
    });
    $('red').addEventListener('input', mudou);
    document.querySelectorAll('#ficha_notas .seg button').forEach((b) => b.addEventListener('click', () => trocarModo(b.dataset.modo)));

    // filtros
    const setF = (obj, ev) => { Object.assign(S.f, obj); S.lim = 10; atualizar(); if (ev) evento(ev); };
    let t;
    $('f_curso').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => sugerirCursos(e.target.value), 100); });
    const pegaCurso = (e) => {
      const li = e.target.closest('li[data-ck]'); if (!li) return;
      const c = S.nomesCurso.find((x) => x.ck === li.dataset.ck);
      $('f_curso').value = ''; $('f_curso_lista').innerHTML = '';
      setF({ curso: c }, `2dia/curso/${c.nome}`);
    };
    $('f_curso_lista').addEventListener('click', pegaCurso);
    $('f_curso_lista').addEventListener('keydown', (e) => { if (e.key === 'Enter') pegaCurso(e); });
    $('curso_sel').addEventListener('click', (e) => { if (e.target.id === 'curso_x') setF({ curso: null }); });
    $('f_uf').addEventListener('change', (e) => setF({ uf: e.target.value, cidade: '', ies: '' }, e.target.value ? `2dia/estado/${e.target.value}` : ''));
    $('f_cidade').addEventListener('change', (e) => setF({ cidade: e.target.value }));
    $('f_ies').addEventListener('change', (e) => setF({ ies: e.target.value }, e.target.value ? `2dia/universidade/${e.target.value.split('|')[0]}` : ''));
    $('f_mod').addEventListener('change', (e) => setF({ mod: +e.target.value }, `2dia/modalidade/${+e.target.value === 0 ? 'ampla' : 'cota'}`));
    $('f_limpar').addEventListener('click', () => setF({ curso: null, uf: '', cidade: '', ies: '', mod: 0 }));

    // mapa: toque no estado filtra; toque na bolinha filtra a cidade
    $('mapa').addEventListener('click', (e) => {
      const pt = e.target.closest('[data-c]'), uf = e.target.closest('[data-uf]');
      if (pt) {
        const [m, u] = pt.dataset.c.split('|');
        setF(S.f.cidade === m && S.f.uf === u ? { cidade: '' } : { uf: u, cidade: m, ies: '' }, '2dia/mapa/cidade');
      } else if (uf) {
        setF(S.f.uf === uf.dataset.uf ? { uf: '', cidade: '', ies: '' } : { uf: uf.dataset.uf, cidade: '', ies: '' }, '2dia/mapa/estado');
      }
    });
    $('mapa_br').addEventListener('click', () => setF({ uf: '', cidade: '', ies: '' }));

    // lista e cards
    document.querySelectorAll('#abas button').forEach((b) => b.addEventListener('click', () => { S.aba = b.dataset.aba; S.lim = 10; renderLista(); if (S.aba === 'quase') evento('2dia/aba por pouco'); }));
    $('mais').addEventListener('click', () => { S.lim += 20; renderLista(); });
    document.querySelectorAll('#cards .seg button').forEach((b) => b.addEventListener('click', () => {
      S.card = b.dataset.card;
      document.querySelectorAll('#cards .seg button').forEach((x) => x.classList.toggle('ativo', x === b));
      desenharCard();
    }));
    $('btn_share').addEventListener('click', compartilhar);
    $('btn_exatoo').addEventListener('click', () => evento('2dia/clique exatoo'));
    const u = new URL(CFG.EXATOO_URL || 'https://exatoo.com');
    u.searchParams.set('utm_source', 'fudeuenem'); u.searchParams.set('utm_medium', 'instagram'); u.searchParams.set('utm_campaign', 'enem2026-posprova');
    $('btn_exatoo').href = u.toString();
  }

  async function iniciar() {
    restaurar();
    ligarUI();
    carregarRecursos();
    const pega = (u) => fetch(u, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(u); return r.json(); });
    try {
      [S.tri, S.cursos, S.mapa] = await Promise.all([pega('../data/tri_tabela.json'), pega('../data/cursos.json'), pega('../data/mapa.json')]);
    } catch (e) {
      $('res_pre').textContent = 'Não foi possível carregar os dados. Recarregue a página.';
      return;
    }
    prepararBase();
    // aplica o que estava guardado
    const modo = S.modo; S.modo = 'acertos';
    for (const a of AREAS) $('in_' + a).value = S.val.acertos[a] || '';
    if (modo === 'notas') trocarModo('notas'); else atualizar();
  }

  iniciar();
})();
