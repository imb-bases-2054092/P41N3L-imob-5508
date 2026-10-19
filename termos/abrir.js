/* Abre um dos seus apps (termos e gerador de contratos) dentro da janela isolada do sistema.
   - O cadastro de contratos vem do sistema (nunca de planilha externa / Worker).
   - As bibliotecas (PDF, Word, Excel) são as cópias locais da pasta vendor.
   - Para atualizar um app, basta trocar o arquivo .html desta pasta pela versão nova (mesmo nome). */
(function () {
  "use strict";
  var msg = document.getElementById("msg");
  if (window.parent === window) { msg.textContent = "Abra estes documentos pelo sistema Financeiro (tela Contratos ou saída do locatário)."; return; }

  var LOCAL = { "pdf-lib.min.js": "vendor/pdf-lib.min.js", "pdf.min.js": "vendor/pdf.min.js", "mammoth.browser.min.js": "vendor/mammoth.browser.min.js",
    "jszip.min.js": "vendor/jszip.min.js", "xlsx.full.min.js": "../vendor/xlsx-0.18.5.mini.js", "xlsx.mini.min.js": "../vendor/xlsx-0.18.5.mini.js" };

  // Respostas locais para os "downloads" que os apps fazem: cadastro (planilha) e modelos .docx
  function instalarFetch(cadastro, arquivos) {
    var orig = window.fetch ? window.fetch.bind(window) : null;
    window.fetch = function (u, o) {
      var url = String(u && u.url ? u.url : (u == null ? "" : u));
      var h = (o && o.headers) || {};
      var temChave = (typeof h.get === "function") ? h.get("X-App-Key") !== null : Object.prototype.hasOwnProperty.call(h, "X-App-Key");
      if (temChave || /workers\.dev/i.test(url) || url === "") return Promise.resolve(new Response(cadastro.slice(0), { status: 200 }));
      var nome = decodeURIComponent(url.split("?")[0].split("#")[0].split("/").pop() || "");
      if (arquivos && arquivos[nome]) return Promise.resolve(new Response(arquivos[nome].slice(0), { status: 200 }));
      if (/^https?:/i.test(url) && url.indexOf(location.origin) !== 0) return Promise.reject(new TypeError("Acesso externo bloqueado pelo sistema."));
      return orig ? orig(u, o) : Promise.reject(new TypeError("fetch indisponível"));
    };
  }

  // avisa o sistema quando o termo (PDF) é baixado — é assim que o termo obrigatório fica "feito"
  function avisarDownload() {
    var orig = HTMLAnchorElement.prototype.click;
    if (orig.__lico) return;
    var novo = function () {
      try { if (this.hasAttribute("download")) window.parent.postMessage({ tipo: "termo-baixado", arquivo: this.getAttribute("download") || "" }, "*"); } catch (e) {}
      return orig.apply(this, arguments);
    };
    novo.__lico = true; HTMLAnchorElement.prototype.click = novo;
  }
  window.addEventListener("message", function (ev) {
    if (ev.source !== window.parent || !ev.data) return;
    var d = ev.data;
    if (d.tipo === "aviso") { if (typeof window.mostrarToast === "function") window.mostrarToast(d.texto); else alert(d.texto); return; }
    if (d.tipo !== "termo") return;
    var html = String(d.html || ""), avisos = [];
    if (/CADASTRO_APP_KEY\s*=\s*'[^']+'/.test(html)) avisos.push("este arquivo contém a chave da planilha externa. Apague a linha CADASTRO_APP_KEY antes de publicá-lo.");
    // termos: aceitar também contratos com débito ou encerrados na busca
    html = html.replace(/if \(status !== 'ATIVO'\) continue;/, "if (['ATIVO', 'DÉBITO EM ABERTO', 'ENCERRADO'].indexOf(status) < 0) continue;");
    // bibliotecas locais
    html = html.replace(/<script([^>]*)src="https?:\/\/[^"]+\/([^"\/]+\.js)"([^>]*)><\/script>/g, function (m, a, nome, b) {
      if (LOCAL[nome]) return '<script' + a + 'src="' + LOCAL[nome] + '"' + b + '></script>';
      avisos.push("a biblioteca " + nome + " não está disponível no sistema.");
      return "";
    });
    html = html.replace(/https?:\/\/[^'"]+\/pdf\.worker\.min\.js/g, "vendor/pdf.worker.min.js");
    // ao abrir já com um contrato: termos -> busca e preenche; gerador -> carrega a ficha do contrato
    var auto = "<script>(function(){var COD=" + JSON.stringify(d.codigo || "") + ",NOVO=" + JSON.stringify(d.novoCodigo || "") + ";" +
      "function ir(){" +
      "if(typeof buildDataRow==='function'){var cid=document.getElementById('contractId');" +
      " if(COD&&typeof carregarCadastroContratos==='function'){carregarCadastroContratos().then(function(l){var it=(l||[]).find(function(x){return x.contractId===COD;});" +
      "  if(it){aplicarDadosFormulario(it.campos);if(typeof reformatarCamposImportados==='function')reformatarCamposImportados(it.campos);}if(cid){cid.value=COD;}});}" +
      " else if(NOVO&&cid&&!cid.value){cid.value=NOVO;}" +
      " var bx=document.querySelector('[onclick^=\"gerarExcel\"]');if(bx){var b=document.createElement('button');b.type='button';b.className=bx.className;b.id='btn-salvar-sistema';b.textContent='💾 Salvar no sistema';" +
      "  b.onclick=function(){if(typeof validarAntesDeGerar==='function'&&!validarAntesDeGerar())return;parent.postMessage({tipo:'gerador-salvar',linha:buildDataRow()},'*');};bx.parentNode.insertBefore(b,bx);bx.style.display='none';}" +
      " return;}" +
      "if(!COD||typeof carregarCadastro!=='function')return;carregarCadastro().then(function(l){var it=(l||[]).find(function(x){return x.codigo===COD;});if(it&&typeof selecionarResultadoBusca==='function')selecionarResultadoBusca(it);});}" +
      "if(document.readyState==='complete')setTimeout(ir,0);else window.addEventListener('load',function(){setTimeout(ir,0);});})();<\/script>";
    var aviso = avisos.length ? '<div style="background:#fde8ea;color:#c8192e;padding:8px 14px;font:600 13px system-ui">Aviso: ' + avisos.join(" ") + "</div>" : "";
    // visual igual ao do sistema (sem cabeçalho próprio, letras menores, página mais larga)
    var estilo = "<style>header{display:none!important}.intro{display:none!important}body{font-size:14px;line-height:1.45;background:#f0f4fb}" +
      ".main,.container{max-width:1180px!important;padding:14px 18px 130px!important}" +
      ".card,.section{border-radius:8px!important;box-shadow:none!important;border:1px solid #cfdcf0!important;margin-bottom:12px!important}" +
      ".card-header,.section-header{padding:9px 16px!important;border-radius:8px 8px 0 0!important;background:#e8eef8!important}" +
      ".card-header h2,.section-title{font-family:'Source Sans 3',system-ui,sans-serif!important;font-size:15px!important;font-weight:700!important;color:#1a2d6b!important}" +
      ".card-body,.section-body{padding:14px 16px!important}.field-group{margin-bottom:12px!important}.grid2,.grid3,.grid-2,.grid-3,.grid-4{gap:12px!important}" +
      "label{font-size:12px!important;letter-spacing:.04em!important;color:#5f6b85!important;margin-bottom:4px!important}" +
      "input[type=text],input[type=date],input[type=number],select,textarea{padding:7px 10px!important;border:1px solid #cfdcf0!important;border-radius:6px!important;font-size:14px!important}" +
      ".opcao{padding:4px 11px!important;font-size:13px!important;border-width:1px!important}" +
      ".subbloco-titulo{font-family:'Source Sans 3',system-ui,sans-serif!important;font-size:13px!important;text-transform:uppercase;letter-spacing:.04em;color:#1a2d6b!important}" +
      ".btn{padding:8px 16px!important;border-radius:6px!important;font-size:13.5px!important}.barra-acoes{padding:8px 16px!important}.barra-conteudo{max-width:1180px!important}" +
      ".dropzone,.dropzone-import{padding:12px!important}.preview-card{padding:24px 28px!important}</style>";
    html = html.replace(/<\/head>/i, function (m) { return estilo + m; });
    html = html.replace(/<body[^>]*>/i, function (m) { return m + aviso; });
    html = html.replace(/<\/body>/i, auto + "</body>");
    instalarFetch(d.xlsx, d.arquivos || {});
    document.open(); document.write(html); document.close();
    instalarFetch(d.xlsx, d.arquivos || {}); // garante a troca também depois da reabertura do documento
    avisarDownload();
  });
  window.parent.postMessage({ tipo: "termo-pronto" }, "*");
})();
