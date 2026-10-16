(function () {
"use strict";
const $ = s => document.querySelector(s);
let pacote = null;
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function decifrar(o, senha) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveKey"]);
  const k = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: unb64(o.salt), iterations: o.iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(o.iv) }, k, unb64(o.dados)));
}
function msg(t, cls) { const m = $("#msg"); m.textContent = t; m.className = cls || ""; }
function baixar(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement("a"); a.href = url; a.download = nome; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}
$("#abrir").addEventListener("click", async () => {
  $("#res").hidden = true; pacote = null;
  const f = $("#arq").files[0]; if (!f) return msg("Escolha o arquivo.", "bad");
  msg("Abrindo…");
  try {
    let o = JSON.parse(await f.text());
    if (o.formato === "financeiro-imobiliaria-cripto") {
      if (!$("#senha").value) return msg("Este arquivo é protegido: informe a senha.", "bad");
      try { o = JSON.parse(await decifrar(o, $("#senha").value)); } catch (e) { return msg("Senha incorreta ou arquivo corrompido.", "bad"); }
    }
    if (o.formato !== "financeiro-imobiliaria" || !o.tabelas) return msg("Este arquivo não é um backup do Financeiro.", "bad");
    pacote = o;
    $("#lista").innerHTML = "";
    Object.entries(o.tabelas).forEach(([t, l]) => { const li = document.createElement("li"); li.textContent = `${t}: ${l.length} linhas`; $("#lista").appendChild(li); });
    msg("Backup de " + new Date(o.gerado_em).toLocaleString("pt-BR") + " aberto.", "ok");
    $("#res").hidden = false;
  } catch (e) { msg("Arquivo inválido.", "bad"); }
});
$("#xlsx").addEventListener("click", () => {
  const wb = XLSX.utils.book_new();
  for (const [t, linhas] of Object.entries(pacote.tabelas)) {
    const rows = linhas.map(l => { const o = {}; for (const [k, v] of Object.entries(l)) o[k] = v != null && typeof v === "object" ? JSON.stringify(v) : v; return o; });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ vazio: "" }]), t.slice(0, 31));
  }
  XLSX.writeFile(wb, "backup-financeiro-" + pacote.gerado_em.slice(0, 10) + ".xlsx");
});
$("#json").addEventListener("click", () => baixar("backup-financeiro-" + pacote.gerado_em.slice(0, 10) + ".json", JSON.stringify(pacote), "application/json"));
})();
