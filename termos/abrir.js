/* Carrega um termo (HTML dos seus apps) dentro da janela isolada, trocando a busca na
   planilha externa pelo cadastro que vem do sistema. Para atualizar um termo, basta
   substituir o arquivo .html desta pasta pela versão nova (mesmo nome). */
(function () {
  "use strict";
  var msg = document.getElementById("msg");
  if (window.parent === window) { msg.textContent = "Abra os termos pelo sistema Financeiro (tela Contratos ou saída do locatário)."; return; }
  window.addEventListener("message", function (ev) {
    if (ev.source !== window.parent || !ev.data || ev.data.tipo !== "termo") return;
    var html = String(ev.data.html || ""), avisos = [];
    if (/CADASTRO_APP_KEY\s*=\s*'[^']+'/.test(html)) avisos.push("este arquivo contém a chave da planilha externa. Apague a linha CADASTRO_APP_KEY antes de publicá-lo.");
    // 1) dados do cadastro: vêm do sistema, não da planilha externa
    var dados = "<script>window.__CAD = " + JSON.stringify(ev.data.linhas || []).replace(/</g, "\\u003c") +
      "; window.__COD = " + JSON.stringify(ev.data.codigo || "").replace(/</g, "\\u003c") + ";<\/script>";
    var antes = html;
    html = html.replace(/const resp = await fetch\(CADASTRO_URL[\s\S]*?sheet_to_json\([^;]*\);/, "const linhas = window.__CAD || [];");
    if (html === antes) avisos.push("não foi possível ligar a busca do cadastro nesta versão do termo (preencha manualmente).");
    html = html.replace(/typeof XLSX === 'undefined'/g, "false");
    html = html.replace(/if \(status !== 'ATIVO'\) continue;/, "if (['ATIVO', 'DÉBITO EM ABERTO', 'ENCERRADO'].indexOf(status) < 0) continue;");
    html = html.replace(/const CADASTRO_APP_KEY = '[^']*';/, "const CADASTRO_APP_KEY = '';");
    // 2) bibliotecas locais (sem depender de sites externos)
    html = html.replace(/<script[^>]*src="https:\/\/cdn\.jsdelivr\.net\/npm\/pdf-lib@[^"]*"[^>]*><\/script>/, '<script src="vendor/pdf-lib.min.js"></script>')
      .replace(/<script[^>]*src="https:\/\/cdn\.jsdelivr\.net\/npm\/pdfjs-dist@[^"]*\/pdf\.min\.js"[^>]*><\/script>/, '<script src="vendor/pdf.min.js"></script>')
      .replace(/<script[^>]*src="https:\/\/cdn\.jsdelivr\.net\/npm\/mammoth@[^"]*"[^>]*><\/script>/, '<script src="vendor/mammoth.browser.min.js"></script>')
      .replace(/<script[^>]*src="https:\/\/cdn\.jsdelivr\.net\/npm\/xlsx@[^"]*"[^>]*><\/script>/, "")
      .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/pdfjs-dist@[^'"]*\/pdf\.worker\.min\.js/g, "vendor/pdf.worker.min.js");
    // 3) já abre com o contrato escolhido no sistema
    var auto = "<script>(function(){function ir(){if(!window.__COD||typeof carregarCadastro!=='function')return;carregarCadastro().then(function(d){var it=(d||[]).find(function(x){return x.codigo===window.__COD;});if(it&&typeof selecionarResultadoBusca==='function')selecionarResultadoBusca(it);});}" +
      "if(document.readyState==='complete')setTimeout(ir,0);else window.addEventListener('load',function(){setTimeout(ir,0);});})();<\/script>";
    var aviso = avisos.length ? '<div style="background:#fde8ea;color:#c8192e;padding:8px 14px;font:600 13px system-ui">Aviso: ' + avisos.join(" ") + "</div>" : "";
    // visual igual ao do sistema (sem cabeçalho próprio, letras menores, página mais larga)
    var estilo = "<style>" + "header{display:none!important}.intro{display:none!important}body{font-size:14px;line-height:1.45;background:#f0f4fb}.main{max-width:1180px!important;padding:14px 18px 130px!important}.card{border-radius:8px!important;box-shadow:none!important;border:1px solid #cfdcf0!important;margin-bottom:12px!important}.card-header{padding:9px 16px!important;border-radius:8px 8px 0 0!important;background:#e8eef8!important}.card-header h2{font-family:'Source Sans 3',system-ui,sans-serif!important;font-size:15px!important;font-weight:700!important;color:#1a2d6b!important}.card-body{padding:14px 16px!important;border-radius:0 0 8px 8px!important}.field-group{margin-bottom:12px!important}.grid2,.grid3{gap:12px!important}label{font-size:12px!important;letter-spacing:.04em!important;color:#5f6b85!important;margin-bottom:4px!important}input[type=text],input[type=date],select,textarea{padding:7px 10px!important;border:1px solid #cfdcf0!important;border-radius:6px!important;font-size:14px!important}.opcao{padding:4px 11px!important;font-size:13px!important;border-width:1px!important}.subbloco-titulo{font-family:'Source Sans 3',system-ui,sans-serif!important;font-size:13px!important;text-transform:uppercase;letter-spacing:.04em;color:#1a2d6b!important}.btn{padding:8px 16px!important;border-radius:6px!important;font-size:13.5px!important}.barra-acoes{padding:8px 16px!important}.barra-conteudo{max-width:1180px!important}.dropzone{padding:12px!important}.preview-card{padding:24px 28px!important}" + "</style>";
    html = html.replace(/<head[^>]*>/i, function (m) { return m + dados; });
    html = html.replace(/<\/head>/i, function (m) { return estilo + m; });
    html = html.replace(/<body[^>]*>/i, function (m) { return m + aviso; });
    html = html.replace(/<\/body>/i, auto + "</body>");
    document.open(); document.write(html); document.close();
  });
  window.parent.postMessage({ tipo: "termo-pronto" }, "*");
})();
