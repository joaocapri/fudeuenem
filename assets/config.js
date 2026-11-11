/* =====================================================================
   CONFIGURAÇÕES EDITÁVEIS — altere aqui sem mexer no resto do código
   ===================================================================== */
window.CONFIG = {
  // Seu @ do Instagram (aparece no site e na imagem do story)
  ARROBA: '@joa.capri',

  // Endereço do site (aparece no card do story, grifado)
  SITE: 'fudeuenem.com',

  // URL do formulário (ex.: Google Forms) para quem quiser receber o plano.
  // Deixe vazio ('') para esconder o botão de contato.
  FORM_URL: '',

  // Link do CTA final
  EXATOO_URL: 'https://exatoo.com',

  // Datas do plano de estudos (2º dia do ENEM 2026 = 15/11)
  DATA_PROVA: '2026-11-15',

  // VIRADA PÓS-PROVA: a partir deste momento (horário de Brasília) a página inicial leva
  // direto para o "Onde eu passo?" (/2dia), que vira a função principal do site.
  //  - testar antes: fudeuenem.com/?previa
  //  - usar a calculadora antiga depois da virada: fudeuenem.com/?calculadora
  //  - voltar ao modo "antes da prova" (ex.: ENEM do ano que vem): troque para a nova data.
  POS_PROVA_EM: '2026-11-15T14:00:00-03:00',
};
