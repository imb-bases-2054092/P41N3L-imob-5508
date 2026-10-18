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
    html = html.replace(/<head[^>]*>/i, function (m) { return m + dados; });
    html = html.replace(/<body[^>]*>/i, function (m) { return m + aviso; });
    html = html.replace(/<\/body>/i, auto + "</body>");
    document.open(); document.write(html); document.close();
  });
  window.parent.postMessage({ tipo: "termo-pronto" }, "*");
})();
