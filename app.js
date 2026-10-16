/* =====================================================================
   FINANCEIRO · IMOBILIÁRIA — aplicação
   Dados no Supabase; as regras de acesso valem no BANCO (RLS), não aqui.
   ===================================================================== */
(function () {
"use strict";

if (window.top !== window.self) { document.body.innerHTML = ""; return; } // não roda dentro de iframe

const CFG = window.APP_CONFIG || {};
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
  auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

/* ---------------- utilidades ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const NUM = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = v => BRL.format(+v || 0);
const n2 = v => NUM.format(+v || 0);
const r2 = v => Math.round((+v || 0) * 100) / 100;
function parseMoney(s) {
  s = String(s == null ? "" : s).replace(/[R$\s]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? r2(n) : null;
}
const pad = n => String(n).padStart(2, "0");
const iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const hoje = () => iso(new Date());
const dt = s => s ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : "";
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MES3 = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesTxt = c => MESES[+c.slice(5, 7) - 1] + " " + c.slice(0, 4);
const mesCurto = c => MES3[+c.slice(5, 7) - 1] + "/" + c.slice(2, 4);
function addMes(c, k) { const d = new Date(+c.slice(0, 4), +c.slice(5, 7) - 1 + k, 1); return iso(d); }
const fimMes = c => iso(new Date(+c.slice(0, 4), +c.slice(5, 7), 0));
const inicioMes = s => s.slice(0, 7) + "-01";
const diasEntre = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function lsGet(k, d) { try { const v = localStorage.getItem("fin." + k); return v == null ? d : v; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem("fin." + k, v); } catch (e) { /* sem armazenamento */ } }
function ssGet(k, d) { try { const v = sessionStorage.getItem("fin." + k); return v == null ? d : v; } catch (e) { return d; } }
function ssSet(k, v) { try { sessionStorage.setItem("fin." + k, v); } catch (e) { /* sem armazenamento */ } }

function toast(msg, bad) {
  const t = document.createElement("div");
  t.className = "toast" + (bad ? " bad" : "");
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), bad ? 7000 : 3500);
}
function erroMsg(e) {
  const m = (e && (e.message || e.error_description || e.msg)) || String(e);
  if (/JWT|expired|refresh/i.test(m)) return "Sua sessão expirou. Entre novamente.";
  if (/row-level security|permission denied|42501/i.test(m)) return "Sem permissão para esta ação.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Sem conexão com o servidor. Verifique a internet.";
  return m;
}
function falha(e) { console.error(e); toast(erroMsg(e), true); }
async function q(p) { const { data, error } = await p; if (error) throw error; return data; }
async function rpc(fn, args) { return q(sb.rpc(fn, args || {})); }
async function fetchAll(table, build, cols) {
  let out = [], i = 0;
  for (;;) {
    let b = sb.from(table).select(cols || "*");
    if (build) b = build(b);
    const data = await q(b.range(i, i + 999));
    out = out.concat(data);
    if (data.length < 1000) break;
    i += 1000;
  }
  return out;
}

/* ---------------- estado ---------------- */
const S = {
  user: null, membro: null, papel: "", contas: [], categorias: [], imoveis: [], imovelPor: {},
  mes: ssGet("mes", inicioMes(hoje())), page: "painel", f: {}
};
const pode = {
  editar: () => ["admin", "financeiro"].includes(S.papel),
  receber: () => ["admin", "financeiro", "recepcao"].includes(S.papel),
  admin: () => S.papel === "admin",
  lancar: () => ["admin", "financeiro", "recepcao"].includes(S.papel)
};
const PAPEIS = { admin: "Administrador", financeiro: "Financeiro", recepcao: "Recepção", leitura: "Somente leitura", backup: "Backup automático" };
const GRUPOS = {
  receita: "Receita", imposto: "Imposto", custo: "Custo", despesa: "Despesa", retirada: "Retirada dos sócios",
  terceiros_entrada: "Proprietários (entrada)", terceiros_saida: "Proprietários (saída)", transferencia: "Transferência"
};
const STATUS_IMV = { ALG: ["Alugado", "ok"], LVR: ["Livre", "warn"], OCP: ["Ocupado", "info"], INTV: ["Inativo", "idle"] };
const catPor = id => S.categorias.find(c => c.id === id) || {};
const contaPor = id => S.contas.find(c => c.id === id) || {};

async function carregarBase() {
  const [contas, cats, imv] = await Promise.all([
    q(sb.from("contas").select("*").order("ordem").order("nome")),
    q(sb.from("categorias").select("*").order("grupo").order("nome")),
    fetchAll("imoveis", b => b.order("endereco").order("id"))
  ]);
  S.contas = contas; S.categorias = cats; setImoveis(imv);
}
const soMinhasContas = l => S.papel === "recepcao" ? l.filter(s => s.tipo === "caixa") : l;
function setImoveis(list) { S.imoveis = list; S.imovelPor = {}; list.forEach(i => (S.imovelPor[i.id] = i)); }
async function recarregarImoveis() { setImoveis(await fetchAll("imoveis", b => b.order("endereco").order("id"))); }

/* ---------------- telas de acesso ---------------- */
function mostrar(v) {
  ["login", "mfa", "bloq", "app"].forEach(k => ($("#v-" + k).hidden = k !== v));
  if (v === "login") setTimeout(() => $("#f-login input[name=email]").focus(), 30);
  if (v === "mfa") setTimeout(() => $("#f-mfa input").focus(), 30);
}

let tentativas = 0;
$("#f-login").addEventListener("submit", async ev => {
  ev.preventDefault();
  const f = ev.target, btn = f.querySelector("button");
  $("#login-err").textContent = "";
  if (tentativas >= 5) { $("#login-err").textContent = "Muitas tentativas. Aguarde 1 minuto."; return; }
  btn.disabled = true;
  try {
    const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.senha.value });
    if (error) {
      tentativas++;
      if (tentativas >= 5) setTimeout(() => (tentativas = 0), 60000);
      $("#login-err").textContent = /invalid/i.test(error.message) ? "E-mail ou senha incorretos." : erroMsg(error);
      return;
    }
    tentativas = 0; f.senha.value = "";
    await posLogin();
  } catch (e) { $("#login-err").textContent = erroMsg(e); }
  finally { btn.disabled = false; }
});

let mfaFator = null;
async function posLogin() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return mostrar("login");
  S.user = user;
  const m = await q(sb.from("membros").select("*").eq("id", user.id).maybeSingle());
  if (!m || !m.ativo) return mostrar("bloq");
  if (m.exige_mfa) {
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!aal || aal.currentLevel !== "aal2") return iniciarMfa();
  }
  S.membro = m; S.papel = m.papel;
  if (S.papel === "backup") { await sb.auth.signOut(); return mostrar("login"); }
  await carregarBase();
  montarApp();
}

async function iniciarMfa() {
  mostrar("mfa");
  $("#mfa-err").textContent = ""; $("#f-mfa").code.value = "";
  const fatores = await q(sb.auth.mfa.listFactors());
  const ok = (fatores.totp || []).find(f => f.status === "verified");
  if (ok) {
    mfaFator = ok.id; $("#mfa-qr").hidden = true;
    $("#mfa-msg").textContent = "Digite o código de 6 dígitos do seu aplicativo autenticador.";
    return;
  }
  for (const f of fatores.all || []) if (f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id });
  const d = await q(sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Financeiro " + new Date().toISOString().slice(0, 16) }));
  mfaFator = d.id;
  $("#mfa-msg").textContent = "Primeiro acesso: instale um aplicativo autenticador (Google Authenticator, Microsoft Authenticator ou Authy), leia o QR code abaixo e digite o código gerado.";
  $("#mfa-qr-img").src = d.totp.qr_code;
  $("#mfa-secret").textContent = d.totp.secret;
  $("#mfa-qr").hidden = false;
}
$("#f-mfa").addEventListener("submit", async ev => {
  ev.preventDefault();
  const code = ev.target.code.value.trim(), btn = ev.target.querySelector("button");
  btn.disabled = true; $("#mfa-err").textContent = "";
  try {
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: mfaFator, code });
    if (error) { $("#mfa-err").textContent = "Código inválido. Confira a hora do celular e tente de novo."; return; }
    await posLogin();
  } catch (e) { $("#mfa-err").textContent = erroMsg(e); }
  finally { btn.disabled = false; }
});

async function sair(msg) {
  try { await sb.auth.signOut(); } catch (e) { /* ignora */ }
  S.user = S.membro = null; S.papel = "";
  $("#page").innerHTML = "";
  mostrar("login");
  if (msg) $("#login-err").textContent = msg;
}
sb.auth.onAuthStateChange(ev => { if (ev === "SIGNED_OUT" && !$("#v-app").hidden) sair(); });

// encerra a sessão por inatividade
let ultimoUso = Date.now();
["mousemove", "keydown", "click", "touchstart", "scroll"].forEach(e => document.addEventListener(e, () => (ultimoUso = Date.now()), { passive: true }));
setInterval(() => {
  if (S.user && Date.now() - ultimoUso > (CFG.MINUTOS_INATIVIDADE || 20) * 60000) sair("Sessão encerrada por inatividade.");
}, 30000);

/* ---------------- tema ---------------- */
function aplicarTema() { const t = lsGet("tema", ""); if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
aplicarTema();

/* ---------------- app / rotas ---------------- */
const PAGES = {};
const TITULOS = { painel: "Painel", alugueis: "Aluguéis do mês", atrasados: "Inadimplência", caixa: "Caixa e lançamentos",
  dre: "Resultado (DRE)", imoveis: "Imóveis (mapa do aluguel)", contratos: "Contratos", backup: "Backup", config: "Configurações" };
const SEM_MES = ["atrasados", "contratos", "backup", "config"];

function montarApp() {
  $("#brand-name").textContent = CFG.NOME_EMPRESA || "Financeiro";
  document.title = "Financeiro · " + (CFG.NOME_EMPRESA || "");
  $("#me-nome").textContent = S.membro.nome || S.membro.email;
  $("#me-papel").textContent = PAPEIS[S.papel] || S.papel;
  $$("#nav a").forEach(a => {
    a.hidden = (a.dataset.so === "admin" && !pode.admin()) || (a.dataset.nao && a.dataset.nao === S.papel);
  });
  $$("#nav .nav-h").forEach(h => { let n = h.nextElementSibling, vis = false; while (n && !n.classList.contains("nav-h")) { if (!n.hidden) vis = true; n = n.nextElementSibling; } h.hidden = !vis; });
  mostrar("app");
  ir();
}
function ir() {
  let p = (location.hash || "#painel").slice(1).split("?")[0];
  if (!PAGES[p]) p = "painel";
  const a = $(`#nav a[data-p="${p}"]`);
  if (a && a.hidden) p = "painel";
  S.page = p;
  $$("#nav a").forEach(x => x.classList.toggle("on", x.dataset.p === p));
  $("#titulo").textContent = TITULOS[p];
  $("#mes-sel").hidden = SEM_MES.includes(p);
  $("#mes-txt").textContent = p === "dre" ? "ano " + S.mes.slice(0, 4) : mesTxt(S.mes);
  document.body.classList.remove("nav-open");
  render();
}
async function render() {
  const pg = $("#page");
  pg.classList.add("loading");
  try { await PAGES[S.page](pg); }
  catch (e) { falha(e); pg.innerHTML = `<div class="card empty">Não foi possível carregar: ${esc(erroMsg(e))}</div>`; }
  finally { pg.classList.remove("loading"); }
}
window.addEventListener("hashchange", () => { if (S.user && S.membro) ir(); });

/* ---------------- ações (cliques) ---------------- */
const ACT = {};
document.addEventListener("click", ev => {
  const el = ev.target.closest("[data-act]");
  if (!el || !ACT[el.dataset.act]) return;
  ev.preventDefault();
  Promise.resolve(ACT[el.dataset.act](el, ev)).catch(falha);
});
ACT.sair = () => sair();
ACT.menu = () => document.body.classList.toggle("nav-open");
ACT.tema = () => {
  const atual = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  lsSet("tema", atual === "dark" ? "light" : "dark"); aplicarTema();
};
ACT["mes-ant"] = () => { S.mes = addMes(S.mes, S.page === "dre" ? -12 : -1); ssSet("mes", S.mes); ir(); };
ACT["mes-prox"] = () => { S.mes = addMes(S.mes, S.page === "dre" ? 12 : 1); ssSet("mes", S.mes); ir(); };
ACT.chip = el => { S.f[el.dataset.k] = el.dataset.v; render(); };
ACT.senha = () => modal({
  titulo: "Trocar senha",
  corpo: `<label class="fl"><span>Nova senha</span><input type="password" name="s1" minlength="12" required autocomplete="new-password"></label>
          <label class="fl"><span>Repita a nova senha</span><input type="password" name="s2" minlength="12" required autocomplete="new-password"></label>
          <p class="hint">Mínimo de 12 caracteres. Use uma frase longa ou um gerenciador de senhas.</p>`,
  ok: "Trocar senha",
  salvar: async f => {
    if (f.s1.value !== f.s2.value) throw new Error("As senhas não conferem.");
    if (f.s1.value.length < 12) throw new Error("Use pelo menos 12 caracteres.");
    const { error } = await sb.auth.updateUser({ password: f.s1.value });
    if (error) throw error;
    toast("Senha alterada.");
  }
});

/* ---------------- modal ---------------- */
function modal({ titulo, corpo, ok = "Salvar", salvar, extra = "", largo = false, semOk = false, aoAbrir }) {
  const d = $("#dlg");
  d.style.width = largo ? "min(860px, calc(100vw - 32px))" : "";
  d.innerHTML = `<form novalidate>
    <div class="dlg-h"><h2>${esc(titulo)}</h2><button type="button" class="x" data-x aria-label="Fechar">×</button></div>
    <div class="dlg-b">${corpo}<p class="err" data-err></p></div>
    <div class="dlg-f">${extra}<button type="button" class="btn" data-x>${semOk ? "Fechar" : "Cancelar"}</button>${semOk ? "" : `<button type="submit" class="btn pri">${esc(ok)}</button>`}</div>
  </form>`;
  const f = d.querySelector("form");
  $$("[data-x]", d).forEach(b => b.addEventListener("click", () => d.close()));
  f.addEventListener("submit", async ev => {
    ev.preventDefault();
    if (!f.checkValidity()) { f.reportValidity(); return; }
    const btn = f.querySelector("button[type=submit]");
    btn.disabled = true; f.querySelector("[data-err]").textContent = "";
    try { const r = await salvar(f); if (r !== false) d.close(); }
    catch (e) { console.error(e); f.querySelector("[data-err]").textContent = erroMsg(e); }
    finally { btn.disabled = false; }
  });
  d.showModal();
  if (aoAbrir) aoAbrir(f, d);
  const first = f.querySelector(".dlg-b input:not([type=hidden]),.dlg-b select");
  if (first) first.focus();
  return f;
}
async function confirmar(titulo, texto, ok = "Confirmar") {
  await new Promise(r => setTimeout(r, 0)); // deixa terminar o fechamento do diálogo anterior
  return new Promise(res => {
    let feito = false;
    modal({ titulo, corpo: `<p>${texto}</p>`, ok, salvar: async () => { feito = true; } });
    $("#dlg").addEventListener("close", () => res(feito), { once: true });
  });
}
const opt = (v, t, sel) => `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(t)}</option>`;
const contasOpts = (sel, soCaixa) => S.contas.filter(c => c.ativa && (!soCaixa || c.tipo === "caixa")).map(c => opt(c.id, c.nome, c.id === sel)).join("");
function imovelDatalist() {
  return `<datalist id="dl-imv">${S.imoveis.map(i => `<option value="${esc(i.endereco)}">`).join("")}</datalist>`;
}
function imovelPorEndereco(txt) { const t = norm(txt).trim(); return S.imoveis.find(i => norm(i.endereco).trim() === t); }

/* ---------------- planilha (exportar) ---------------- */
let xlsxCarregado = null;
function carregarXLSX() {
  if (window.XLSX) return Promise.resolve();
  if (!xlsxCarregado) xlsxCarregado = new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "vendor/xlsx-0.18.5.mini.js"; s.onload = res; s.onerror = () => rej(new Error("Não foi possível carregar o gerador de planilhas."));
    document.head.appendChild(s);
  });
  return xlsxCarregado;
}
async function baixarXLSX(nome, abas) {
  await carregarXLSX();
  const wb = XLSX.utils.book_new();
  for (const [aba, linhas] of Object.entries(abas)) {
    const ws = XLSX.utils.json_to_sheet(linhas.length ? linhas : [{ vazio: "" }]);
    XLSX.utils.book_append_sheet(wb, ws, aba.slice(0, 31));
  }
  XLSX.writeFile(wb, nome);
}
function baixarArquivo(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement("a"); a.href = url; a.download = nome; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

/* =====================================================================
   COBRANÇAS (aluguéis)
   ===================================================================== */
function devido(c) { return r2(+c.valor + +(c.acrescimos || 0) - +(c.descontos || 0)); }
function stCob(c) {
  if (c.data_pagamento) {
    if (+c.valor_pago < devido(c) - 0.005) return "parcial";
    if (precisaRepasse(c)) return "pago";
    return "quitado";
  }
  return c.vencimento < hoje() ? "atrasado" : "aberto";
}
function precisaRepasse(c) { return c.data_pagamento && !c.repasse_data && r2(+c.valor_pago - +(c.taxa_valor || 0)) > 0; }
const ST_COB = { aberto: ["A vencer", "idle"], atrasado: ["Atrasado", "bad"], parcial: ["Pago parcial", "warn"], pago: ["A repassar", "info"], quitado: ["Concluído", "ok"] };
function tagCob(c) { const s = stCob(c); const [t, k] = ST_COB[s]; return `<span class="tag ${k}">${t}</span>`; }

/* =====================================================================
   PÁGINA: PAINEL
   ===================================================================== */
PAGES.painel = async pg => {
  const ini = addMes(S.mes, -11), fim = fimMes(S.mes);
  const tarefas = [
    rpc("resumo_lancamentos", { p_ini: ini, p_fim: fim }),
    fetchAll("cobrancas", b => b.eq("competencia", S.mes).order("id"), "id,valor,acrescimos,descontos,valor_pago,data_pagamento,vencimento,taxa_valor,repasse_data"),
    fetchAll("cobrancas", b => b.is("data_pagamento", null).lt("vencimento", hoje()).order("id"), "id,imovel_id,valor,acrescimos,descontos"),
    rpc("saldos_contas", { p_ate: fim < hoje() ? fim : hoje() }),
    q(sb.from("reajustes").select("id,competencia,valor_novo,imovel_id").is("aplicado_em", null).lte("competencia", S.mes)),
    q(sb.from("config").select("chave,valor")),
    S.papel === "recepcao" ? Promise.resolve([]) :
      q(sb.from("contratos").select("codigo,endereco,locatario,termino").eq("situacao", "ATIVO").gte("termino", hoje()).lte("termino", iso(new Date(Date.now() + 60 * 86400000))).order("termino"))
  ];
  const [res, cobMes, atras, saldosTodos, reaj, cfg, vencendo] = await Promise.all(tarefas);
  const saldos = soMinhasContas(saldosTodos);

  // DRE por mês (realizado)
  const meses = []; for (let i = 0; i < 12; i++) meses.push(addMes(ini, i));
  const porMes = {}; meses.forEach(m => (porMes[m] = { receita: 0, imposto: 0, custo: 0, despesa: 0, retirada: 0 }));
  res.filter(r => r.pago).forEach(r => {
    const m = porMes[r.competencia]; if (!m || !(r.grupo in m)) return;
    m[r.grupo] += r.tipo === "entrada" ? +r.total : -+r.total;
  });
  // receita entra positiva; demais grupos são saídas (negativos) -> inverter sinal
  Object.values(porMes).forEach(m => { ["imposto", "custo", "despesa", "retirada"].forEach(k => (m[k] = -m[k])); });
  const cur = porMes[S.mes];
  const liq = cur.receita - cur.imposto, res_ = liq - cur.custo - cur.despesa;

  const prev = cobMes.reduce((a, c) => a + devido(c), 0);
  const receb = cobMes.reduce((a, c) => a + (+c.valor_pago || 0), 0);
  const nAberto = cobMes.filter(c => !c.data_pagamento).length;
  const repPend = cobMes.filter(precisaRepasse);
  const repPendV = repPend.reduce((a, c) => a + +c.valor_pago - +(c.taxa_valor || 0), 0);
  const atrasV = atras.reduce((a, c) => a + devido(c), 0);
  const atrasImv = new Set(atras.map(c => c.imovel_id)).size;
  const terceiros = saldos.reduce((a, s) => a + +s.terceiros, 0);
  const cfgMap = Object.fromEntries(cfg.map(c => [c.chave, c.valor]));

  const cont = { ALG: 0, LVR: 0, OCP: 0, INTV: 0 }; let potencial = 0;
  S.imoveis.forEach(i => { cont[i.status]++; if (i.status === "ALG") potencial += +i.valor || 0; });
  const disp = cont.ALG + cont.LVR;

  const alertas = [];
  const ub = cfgMap.ultimo_backup ? new Date(cfgMap.ultimo_backup) : null;
  if (!ub || Date.now() - ub > 7 * 86400000) alertas.push(["bad", `Backup: ${ub ? "último há " + Math.floor((Date.now() - ub) / 86400000) + " dias" : "nenhum backup baixado ainda"}.`, "#backup", "Fazer backup"]);
  if (!cobMes.length) alertas.push(["warn", `Os aluguéis de ${mesTxt(S.mes)} ainda não foram gerados.`, "#alugueis", "Gerar"]);
  if (reaj.length) alertas.push(["warn", `${reaj.length} reajuste(s) programado(s) até ${mesTxt(S.mes)} ainda não aplicado(s).`, "#imoveis", "Ver imóveis"]);
  if (atras.length) alertas.push(["bad", `${atras.length} aluguel(éis) em atraso (${atrasImv} imóveis) somando ${brl(atrasV)}.`, "#atrasados", "Ver lista"]);
  if (repPend.length) alertas.push(["", `${repPend.length} repasse(s) a proprietários pendente(s) neste mês: ${brl(repPendV)}.`, "#alugueis", "Ver"]);
  if (vencendo.length) alertas.push(["", `${vencendo.length} contrato(s) terminam nos próximos 60 dias.`, "#contratos", "Ver"]);

  const fin = S.papel !== "recepcao";
  pg.innerHTML = `
  <div class="grid">
    <div class="kpis" ${fin ? "" : "hidden"}>
      ${kpi("Receita bruta", brl(cur.receita), "taxas, comissões e aluguéis próprios")}
      ${kpi("Impostos", brl(cur.imposto), cur.receita ? (cur.imposto / cur.receita * 100).toFixed(1).replace(".", ",") + "% da receita" : "")}
      ${kpi("Receita líquida", brl(liq), "")}
      ${kpi("Custos + despesas", brl(cur.custo + cur.despesa), "")}
      ${kpi("Resultado do mês", `<span class="${res_ < 0 ? "neg" : ""}">${brl(res_)}</span>`, cur.retirada ? "retiradas dos sócios: " + brl(cur.retirada) : "antes das retiradas", true)}
    </div>
    ${alertas.length ? `<div class="alerts">${alertas.map(a => `<div class="alert ${a[0]}"><span>${esc(a[1])}</span><a class="btn sm" href="${a[2]}">${a[3]}</a></div>`).join("")}</div>` : ""}
    <div class="grid g3">
      <div class="card"><div class="card-h"><h2>Aluguéis de ${esc(mesTxt(S.mes))}</h2></div>
        <div class="lst">
          <div><span>Previsto (${cobMes.length})</span><b class="num">${brl(prev)}</b></div>
          <div><span>Recebido</span><b class="num pos">${brl(receb)}</b></div>
          <div><span>Falta receber (${nAberto})</span><b class="num">${brl(Math.max(prev - receb, 0))}</b></div>
          <div><span>Repasses pendentes (${repPend.length})</span><b class="num">${brl(repPendV)}</b></div>
          <div><span>Inadimplência total</span><b class="num neg">${brl(atrasV)}</b></div>
        </div>
        ${prev ? `<div class="bar" style="margin-top:10px" title="Recebido ${Math.round(receb / prev * 100)}%"><i style="width:${Math.min(receb / prev * 100, 100)}%;background:var(--ok)"></i></div><p class="hint" style="margin-top:4px">${Math.round(receb / prev * 100)}% recebido</p>` : ""}
      </div>
      <div class="card"><div class="card-h"><h2>Saldos</h2><a class="btn sm" href="#caixa">Caixa</a></div>
        <div class="lst">
          ${saldos.map(s => `<div><span>${esc(s.nome)}</span><b class="num ${+s.saldo < 0 ? "neg" : ""}">${brl(s.saldo)}</b></div>`).join("") || `<div class="muted">Nenhuma conta cadastrada.</div>`}
          <div><span><b>Total</b></span><b class="num">${brl(saldos.reduce((a, s) => a + +s.saldo, 0))}</b></div>
          <div><span class="muted">Desse total, é dos proprietários</span><span class="num muted">${brl(terceiros)}</span></div>
          <div><span class="muted">Disponível da imobiliária</span><span class="num muted">${brl(saldos.reduce((a, s) => a + +s.saldo, 0) - terceiros)}</span></div>
        </div>
      </div>
      <div class="card"><div class="card-h"><h2>Mapa dos imóveis</h2><a class="btn sm" href="#imoveis">Abrir</a></div>
        <div class="lst">
          ${Object.entries(cont).map(([k, v]) => `<div><span><span class="tag ${STATUS_IMV[k][1]}">${STATUS_IMV[k][0]}</span></span><b class="num">${v}</b></div>`).join("")}
          <div><span>Ocupação (alugados ÷ disponíveis)</span><b class="num">${disp ? (cont.ALG / disp * 100).toFixed(1).replace(".", ",") : 0}%</b></div>
          <div><span>Aluguel total da carteira</span><b class="num">${brl(potencial)}</b></div>
        </div>
      </div>
    </div>
    <div class="card" ${fin ? "" : "hidden"}><div class="card-h"><h2>Receita líquida × custos e despesas — 12 meses</h2><a class="btn sm" href="#dre">Ver DRE</a></div>
      ${grafico(meses, porMes)}
    </div>
    ${vencendo.length ? `<div class="card"><div class="card-h"><h2>Contratos terminando em 60 dias</h2></div><div class="tw"><table><thead><tr><th>Contrato</th><th>Imóvel</th><th>Locatário</th><th>Término</th></tr></thead><tbody>
      ${vencendo.map(c => `<tr><td class="mono">${esc(c.codigo)}</td><td class="trunc">${esc(c.endereco)}</td><td class="trunc">${esc(c.locatario)}</td><td>${dt(c.termino)}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
  </div>`;
  ligarGrafico(pg);
};
function kpi(l, v, s, hl) { return `<div class="kpi${hl ? " hl" : ""}"><div class="l">${esc(l)}</div><div class="v">${v}</div><div class="s">${esc(s || "")}</div></div>`; }

function grafico(meses, porMes) {
  const W = 760, H = 240, L = 64, B = 26, T = 10, R = 8;
  const v1 = meses.map(m => porMes[m].receita - porMes[m].imposto), v2 = meses.map(m => porMes[m].custo + porMes[m].despesa);
  const max = Math.max(1, ...v1, ...v2), min = Math.min(0, ...v1, ...v2);
  const passo = (() => { const raw = (max - min) / 4, p = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 2.5, 5, 10].map(k => k * p).find(k => k >= raw); })();
  const top = Math.ceil(max / passo) * passo, bot = Math.floor(min / passo) * passo;
  const y = v => T + (top - v) / (top - bot) * (H - T - B);
  const cw = (W - L - R) / meses.length, bw = Math.min(16, (cw - 10) / 2);
  let g = "";
  for (let v = bot; v <= top + 1e-6; v += passo) g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v >= 1000 || v <= -1000 ? (v / 1000).toLocaleString("pt-BR") + " mil" : v.toLocaleString("pt-BR")}</text>`;
  const bar = (x, v, cls) => { const y0 = y(0), y1 = y(v), h = Math.abs(y1 - y0); if (h < 0.5) return ""; const yy = Math.min(y0, y1), r = Math.min(4, h, bw / 2);
    return v >= 0 ? `<path class="${cls}" d="M${x},${yy + h} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${yy + h}Z"/>`
                  : `<path class="${cls}" d="M${x},${yy} V${yy + h - r} Q${x},${yy + h} ${x + r},${yy + h} H${x + bw - r} Q${x + bw},${yy + h} ${x + bw},${yy + h - r} V${yy}Z"/>`; };
  meses.forEach((m, i) => {
    const x = L + i * cw + (cw - 2 * bw - 2) / 2;
    g += bar(x, v1[i], "b1") + bar(x + bw + 2, v2[i], "b2");
    g += `<text class="ax" x="${L + i * cw + cw / 2}" y="${H - 8}" text-anchor="middle">${mesCurto(m)}</text>`;
    g += `<rect class="hit" x="${L + i * cw}" y="${T}" width="${cw}" height="${H - T - B}" data-tip="<b>${mesTxt(m)}</b><br>Receita líquida: ${brl(v1[i])}<br>Custos + despesas: ${brl(v2[i])}<br>Resultado: ${brl(v1[i] - v2[i])}"/>`;
  });
  return `<div class="legend"><span><i style="background:var(--s1)"></i>Receita líquida</span><span><i style="background:var(--s2)"></i>Custos + despesas</span></div>
    <div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de barras mensal">${g}<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--muted)" stroke-width="1"/></svg><div class="tip" hidden></div></div>`;
}
function ligarGrafico(pg) {
  $$(".chart", pg).forEach(ch => {
    const tip = $(".tip", ch);
    ch.addEventListener("mousemove", ev => {
      const h = ev.target.closest(".hit");
      if (!h) { tip.hidden = true; return; }
      tip.innerHTML = h.dataset.tip; tip.hidden = false;
      const r = ch.getBoundingClientRect();
      let x = ev.clientX - r.left + 14; if (x + tip.offsetWidth > r.width) x = ev.clientX - r.left - tip.offsetWidth - 14;
      tip.style.left = x + "px"; tip.style.top = (ev.clientY - r.top - 10) + "px";
    });
    ch.addEventListener("mouseleave", () => (tip.hidden = true));
  });
}

/* =====================================================================
   PÁGINA: ALUGUÉIS DO MÊS
   ===================================================================== */
let COB = [];
PAGES.alugueis = async pg => {
  COB = await fetchAll("cobrancas", b => b.eq("competencia", S.mes).order("vencimento").order("id"));
  const reajPend = pode.editar() ? await q(sb.from("reajustes").select("id").is("aplicado_em", null).lte("competencia", S.mes)) : [];
  const f = S.f.cob || "todos", busca = S.f.cobBusca || "";
  const conta = { todos: COB.length, aberto: 0, atrasado: 0, pago: 0, quitado: 0, parcial: 0 };
  COB.forEach(c => conta[stCob(c)]++);
  let lista = COB.filter(c => f === "todos" || stCob(c) === f || (f === "aberto" && stCob(c) === "atrasado"));
  if (busca) { const b = norm(busca); lista = lista.filter(c => norm((S.imovelPor[c.imovel_id] || {}).endereco + " " + c.locatario + " " + c.locador).includes(b)); }
  const tot = k => lista.reduce((a, c) => a + (+c[k] || 0), 0);

  const chips = [["todos", "Todos"], ["aberto", "Em aberto"], ["atrasado", "Atrasados"], ["parcial", "Parcial"], ["pago", "Repasse pendente"], ["quitado", "Concluídos"]];
  pg.innerHTML = `
  <div class="grid">
    ${!COB.length ? `<div class="card empty"><p>Os aluguéis de <b>${esc(mesTxt(S.mes))}</b> ainda não foram gerados.</p>
      ${pode.editar() ? `<p class="hint">O sistema cria uma cobrança para cada imóvel <b>alugado</b> no mapa, com o valor e o dia de vencimento cadastrados${reajPend.length ? `, depois de aplicar <b>${reajPend.length} reajuste(s) programado(s)</b>` : ""}.</p><button class="btn pri" data-act="gerar-cob">Gerar aluguéis de ${esc(mesTxt(S.mes))}</button>
      <p class="hint" style="margin-top:12px">Começando no meio do mês? Gere, filtre <b>Em aberto</b>, marque os que já foram pagos e use <b>Receber selecionados</b> para dar baixa de uma vez.</p>` : `<p class="hint">Peça ao financeiro para gerar.</p>`}</div>` : `
    <div class="filters">
      <div class="chips">${chips.map(([k, t]) => `<button class="chip${f === k ? " on" : ""}" data-act="chip" data-k="cob" data-v="${k}">${t}<span class="c">${k === "aberto" ? conta.aberto + conta.atrasado : conta[k]}</span></button>`).join("")}</div>
      <input type="search" placeholder="Buscar imóvel, locatário, locador…" value="${esc(busca)}" data-busca="cobBusca">
      <span class="spacer"></span>
      ${pode.editar() ? `<button class="btn" data-act="gerar-cob" title="Inclui imóveis alugados que ainda não têm cobrança neste mês">Atualizar lista</button>` : ""}
      ${pode.receber() ? `<button class="btn" data-act="receber-lote">Receber selecionados</button>` : ""}
      ${pode.editar() ? `<button class="btn" data-act="repassar-lote">Repassar selecionados</button>` : ""}
      <button class="btn" data-act="xls-cob">Excel</button>
    </div>
    <div class="tw"><table>
      <thead><tr><th><input type="checkbox" data-sel-todos aria-label="Selecionar todos"></th><th>Venc.</th><th>Imóvel · inquilino → proprietário</th><th class="num">Valor</th><th class="num">Taxa</th><th class="num">Recebido</th><th class="num">Repasse</th><th>Situação</th><th></th></tr></thead>
      <tbody>${lista.map(linhaCob).join("") || `<tr><td colspan="9" class="empty">Nada encontrado.</td></tr>`}</tbody>
      <tfoot><tr><td></td><td colspan="2">${lista.length} aluguéis</td><td class="num">${n2(lista.reduce((a, c) => a + devido(c), 0))}</td><td class="num">${n2(tot("taxa_valor"))}</td><td class="num">${n2(tot("valor_pago"))}</td><td class="num">${n2(tot("repasse_valor"))}</td><td colspan="2"></td></tr></tfoot>
    </table></div>`}
  </div>`;
  ligarBusca(pg);
  const todos = $("[data-sel-todos]", pg);
  if (todos) todos.addEventListener("change", () => $$("[data-sel]", pg).forEach(c => (c.checked = todos.checked)));
};
function linhaCob(c) {
  const im = S.imovelPor[c.imovel_id] || {}, s = stCob(c);
  const atraso = s === "atrasado" ? ` <span class="sub neg">${diasEntre(c.vencimento, hoje())} dias</span>` : "";
  let acts = "";
  if (!c.data_pagamento && pode.receber()) acts += `<button class="btn sm pri" data-act="receber" data-id="${c.id}">Receber</button> `;
  if (precisaRepasse(c) && pode.editar()) acts += `<button class="btn sm" data-act="repassar" data-id="${c.id}">Repassar</button> `;
  acts += `<button class="btn sm" data-act="cob-det" data-id="${c.id}" aria-label="Detalhes">⋯</button>`;
  return `<tr>
    <td><input type="checkbox" data-sel="${c.id}" aria-label="Selecionar"></td>
    <td>${dt(c.vencimento)}${atraso}</td>
    <td><span class="trunc" style="display:block;max-width:340px">${esc(im.endereco || "?")}</span><span class="sub trunc" style="max-width:340px" title="Inquilino: ${esc(c.locatario)} · Proprietário: ${esc(c.locador)}">${esc(c.locatario)} → ${esc(c.locador)}</span></td>
    <td class="num">${n2(devido(c))}${+c.acrescimos || +c.descontos ? `<span class="sub">aluguel ${n2(c.valor)}</span>` : ""}</td>
    <td class="num">${c.taxa_valor != null ? n2(c.taxa_valor) : `<span class="muted">${n2(+c.taxa_adm_pct)}%</span>`}</td>
    <td class="num">${c.data_pagamento ? `${n2(c.valor_pago)}<span class="sub" title="${esc(contaPor(c.conta_pgto_id).nome || "")}">${dt(c.data_pagamento)}</span>` : ""}</td>
    <td class="num">${c.repasse_data ? `${n2(c.repasse_valor)}<span class="sub">${dt(c.repasse_data)}</span>` : ""}</td>
    <td>${tagCob(c)}</td>
    <td class="acts">${acts}</td></tr>`;
}
function ligarBusca(pg) {
  $$("[data-busca]", pg).forEach(inp => {
    let t; inp.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { S.f[inp.dataset.busca] = inp.value; render().then(() => { const n = $(`[data-busca="${inp.dataset.busca}"]`); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }, 300); });
  });
}
const selecionados = () => $$("[data-sel]:checked").map(c => COB.find(x => x.id === c.dataset.sel)).filter(Boolean);

ACT["gerar-cob"] = async () => {
  const nReaj = await rpc("aplicar_reajustes", { p_comp: S.mes });
  const n = await rpc("gerar_cobrancas", { p_comp: S.mes });
  await recarregarImoveis();
  toast(`${n} aluguel(éis) gerado(s)` + (nReaj ? ` · ${nReaj} reajuste(s) aplicado(s)` : "") + ".");
  render();
};
ACT.receber = el => {
  const c = COB.find(x => x.id === el.dataset.id); const im = S.imovelPor[c.imovel_id] || {};
  const soCaixa = S.papel === "recepcao";
  const taxaSug = r2(Math.min(devido(c), +c.valor - +c.descontos) * +c.taxa_adm_pct / 100);
  modal({
    titulo: "Registrar recebimento",
    corpo: `<div class="box"><b>${esc(im.endereco)}</b><br>${esc(c.locatario)} · venc. ${dt(c.vencimento)} · valor devido <b>${brl(devido(c))}</b></div>
      <div class="row">
        <label class="fl"><span>Data do recebimento</span><input type="date" name="data" value="${hoje()}" required></label>
        <label class="fl"><span>Valor recebido</span><input name="valor" inputmode="decimal" value="${n2(devido(c))}" required></label>
      </div>
      <div class="row">
        <label class="fl"><span>Entrou na conta</span><select name="conta" required>${contasOpts(null, soCaixa)}</select></label>
        ${soCaixa ? "" : `<label class="fl"><span>Taxa de administração</span><input name="taxa" inputmode="decimal" value="${n2(taxaSug)}"></label>`}
      </div>
      <p class="hint">A taxa (${n2(+c.taxa_adm_pct)}%) vira receita da imobiliária; o restante fica registrado como dinheiro do proprietário, a repassar.</p>`,
    ok: "Registrar",
    salvar: async f => {
      const v = parseMoney(f.valor.value); if (!v || v <= 0) throw new Error("Valor inválido.");
      const args = { p_id: c.id, p_data: f.data.value, p_valor: v, p_conta: f.conta.value };
      if (f.taxa) { const t = parseMoney(f.taxa.value); if (t == null || t < 0 || t > v) throw new Error("Taxa inválida."); args.p_taxa = t; }
      await rpc("registrar_pagamento", args);
      toast("Recebimento registrado."); render();
    }
  });
};
ACT.repassar = el => {
  const c = COB.find(x => x.id === el.dataset.id); const im = S.imovelPor[c.imovel_id] || {};
  const sug = r2(+c.valor_pago - +(c.taxa_valor || 0));
  modal({
    titulo: "Registrar repasse ao proprietário",
    corpo: `<div class="box"><b>${esc(c.locador)}</b><br>${esc(im.endereco)}<br>Recebido ${brl(c.valor_pago)} − taxa ${brl(c.taxa_valor)} = <b>${brl(sug)}</b></div>
      <div class="row">
        <label class="fl"><span>Data do repasse</span><input type="date" name="data" value="${hoje()}" required></label>
        <label class="fl"><span>Valor repassado</span><input name="valor" inputmode="decimal" value="${n2(sug)}" required></label>
      </div>
      <label class="fl"><span>Saiu da conta</span><select name="conta" required>${contasOpts(c.conta_pgto_id)}</select></label>
      <p class="hint">Se descontou alguma despesa do proprietário (reparo, IPTU…), informe o valor líquido e lance a despesa no caixa como "Proprietários (saída)".</p>`,
    ok: "Registrar repasse",
    salvar: async f => {
      const v = parseMoney(f.valor.value); if (!v || v <= 0) throw new Error("Valor inválido.");
      await rpc("registrar_repasse", { p_id: c.id, p_data: f.data.value, p_valor: v, p_conta: f.conta.value });
      toast("Repasse registrado."); render();
    }
  });
};
ACT["receber-lote"] = () => {
  const sel = selecionados().filter(c => !c.data_pagamento);
  if (!sel.length) return toast("Marque na lista os aluguéis em aberto que foram recebidos.", true);
  const soCaixa = S.papel === "recepcao";
  modal({
    titulo: `Receber ${sel.length} aluguel(éis)`,
    corpo: `<div class="box">Total: <b>${brl(sel.reduce((a, c) => a + devido(c), 0))}</b>. Cada um será registrado pelo valor devido, com a taxa de administração padrão.</div>
      <div class="row"><label class="fl"><span>Data</span><input type="date" name="data" value="${hoje()}" required></label>
      <label class="fl"><span>Conta</span><select name="conta">${contasOpts(null, soCaixa)}</select></label></div>`,
    ok: "Registrar todos",
    salvar: async f => {
      let ok = 0; const erros = [];
      for (const c of sel) {
        try { await rpc("registrar_pagamento", { p_id: c.id, p_data: f.data.value, p_valor: devido(c), p_conta: f.conta.value }); ok++; }
        catch (e) { erros.push((S.imovelPor[c.imovel_id] || {}).endereco + ": " + erroMsg(e)); }
      }
      toast(`${ok} recebimento(s) registrado(s).` + (erros.length ? ` ${erros.length} com erro.` : ""), !!erros.length);
      if (erros.length) console.warn(erros);
      render();
    }
  });
};
ACT["repassar-lote"] = () => {
  const sel = selecionados().filter(precisaRepasse);
  if (!sel.length) return toast("Marque na lista os aluguéis recebidos com repasse pendente.", true);
  modal({
    titulo: `Repassar ${sel.length} aluguel(éis)`,
    corpo: `<div class="box">Total a repassar: <b>${brl(sel.reduce((a, c) => a + +c.valor_pago - +(c.taxa_valor || 0), 0))}</b> (recebido − taxa, para cada um).</div>
      <div class="row"><label class="fl"><span>Data</span><input type="date" name="data" value="${hoje()}" required></label>
      <label class="fl"><span>Conta</span><select name="conta">${contasOpts()}</select></label></div>`,
    ok: "Registrar repasses",
    salvar: async f => {
      let ok = 0, err = 0;
      for (const c of sel) {
        try { await rpc("registrar_repasse", { p_id: c.id, p_data: f.data.value, p_valor: r2(+c.valor_pago - +(c.taxa_valor || 0)), p_conta: f.conta.value }); ok++; }
        catch (e) { err++; console.warn(e); }
      }
      toast(`${ok} repasse(s) registrado(s).` + (err ? ` ${err} com erro.` : ""), !!err);
      render();
    }
  });
};
ACT["cob-det"] = el => {
  const c = COB.find(x => x.id === el.dataset.id); const im = S.imovelPor[c.imovel_id] || {};
  const ed = pode.editar() && !c.data_pagamento;
  let extra = "";
  if (pode.editar() && c.repasse_data) extra += `<button type="button" class="btn danger left" data-x2="estornar_repasse">Estornar repasse</button>`;
  else if (pode.editar() && c.data_pagamento) extra += `<button type="button" class="btn danger left" data-x2="estornar_pagamento">Estornar recebimento</button>`;
  if (pode.admin() && !c.data_pagamento) extra += `<button type="button" class="btn danger left" data-x2="excluir">Excluir cobrança</button>`;
  modal({
    titulo: "Aluguel " + mesTxt(c.competencia),
    corpo: `<div class="box"><b>${esc(im.endereco)}</b><br>Locatário: ${esc(c.locatario)}<br>Locador: ${esc(c.locador)}</div>
      <div class="row">
        <label class="fl"><span>Vencimento</span><input type="date" name="vencimento" value="${c.vencimento}" ${ed ? "" : "disabled"}></label>
        <label class="fl"><span>Aluguel</span><input name="valor" inputmode="decimal" value="${n2(c.valor)}" ${ed ? "" : "disabled"}></label>
        <label class="fl"><span>Taxa adm. %</span><input name="taxa" inputmode="decimal" value="${n2(c.taxa_adm_pct)}" ${ed ? "" : "disabled"}></label>
      </div>
      <div class="row">
        <label class="fl"><span>Acréscimos (multa, juros, IPTU…)</span><input name="acrescimos" inputmode="decimal" value="${n2(c.acrescimos)}" ${ed ? "" : "disabled"}></label>
        <label class="fl"><span>Descontos</span><input name="descontos" inputmode="decimal" value="${n2(c.descontos)}" ${ed ? "" : "disabled"}></label>
      </div>
      <label class="fl"><span>Observações</span><textarea name="obs" ${pode.editar() ? "" : "disabled"}>${esc(c.obs)}</textarea></label>
      ${c.data_pagamento ? `<div class="box">Recebido ${brl(c.valor_pago)} em ${dt(c.data_pagamento)} (${esc(contaPor(c.conta_pgto_id).nome || "")}) · taxa ${brl(c.taxa_valor)}${c.repasse_data ? `<br>Repassado ${brl(c.repasse_valor)} em ${dt(c.repasse_data)}` : ""}</div>` : ""}`,
    extra, ok: "Salvar", semOk: !pode.editar(),
    salvar: async f => {
      const upd = { obs: f.obs.value };
      if (ed) Object.assign(upd, { vencimento: f.vencimento.value, valor: parseMoney(f.valor.value), taxa_adm_pct: parseMoney(f.taxa.value), acrescimos: parseMoney(f.acrescimos.value) || 0, descontos: parseMoney(f.descontos.value) || 0 });
      if (ed && (upd.valor == null || upd.valor < 0)) throw new Error("Valor inválido.");
      await q(sb.from("cobrancas").update(upd).eq("id", c.id));
      toast("Salvo."); render();
    },
    aoAbrir: (f, d) => $$("[data-x2]", d).forEach(b => b.addEventListener("click", async () => {
      const a = b.dataset.x2;
      d.close();
      const txt = { estornar_pagamento: "Desfazer o recebimento? Os lançamentos no caixa serão apagados.", estornar_repasse: "Desfazer o repasse? O lançamento de saída será apagado.", excluir: "Excluir esta cobrança do mês?" }[a];
      if (!(await confirmar("Confirmar", esc(txt)))) return;
      try {
        if (a === "excluir") await q(sb.from("cobrancas").delete().eq("id", c.id));
        else await rpc(a, { p_id: c.id });
        toast("Feito."); render();
      } catch (e) { falha(e); }
    }))
  });
};
ACT["xls-cob"] = () => baixarXLSX(`alugueis-${S.mes.slice(0, 7)}.xlsx`, {
  [mesCurto(S.mes).replace("/", "-")]: COB.map(c => ({
    Vencimento: dt(c.vencimento), Imovel: (S.imovelPor[c.imovel_id] || {}).endereco, Locatario: c.locatario, Locador: c.locador,
    Aluguel: +c.valor, Acrescimos: +c.acrescimos, Descontos: +c.descontos, Devido: devido(c), "Taxa %": +c.taxa_adm_pct,
    Recebido: c.valor_pago == null ? "" : +c.valor_pago, "Data receb.": dt(c.data_pagamento), Taxa: c.taxa_valor == null ? "" : +c.taxa_valor,
    Repasse: c.repasse_valor == null ? "" : +c.repasse_valor, "Data repasse": dt(c.repasse_data), Situacao: ST_COB[stCob(c)][0], Obs: c.obs
  }))
});

/* =====================================================================
   PÁGINA: INADIMPLÊNCIA
   ===================================================================== */
let INAD = [];
PAGES.atrasados = async pg => {
  const [cobs, ctts] = await Promise.all([
    fetchAll("cobrancas", b => b.is("data_pagamento", null).lt("vencimento", hoje()).order("vencimento").order("id")),
    S.papel === "recepcao" ? [] : q(sb.from("contratos").select("codigo,endereco,locatario,situacao,saldo_devedor,pendencias").or("situacao.eq.DÉBITO EM ABERTO,saldo_devedor.gt.0").order("codigo"))
  ]);
  const grupos = {};
  cobs.forEach(c => { (grupos[c.imovel_id] = grupos[c.imovel_id] || []).push(c); });
  INAD = Object.entries(grupos).map(([id, cs]) => ({
    id, imovel: (S.imovelPor[id] || {}).endereco || "?", locatario: cs[cs.length - 1].locatario, locador: cs[0].locador,
    meses: cs.map(c => mesCurto(c.competencia)), total: cs.reduce((a, c) => a + devido(c), 0), desde: cs[0].vencimento, dias: diasEntre(cs[0].vencimento, hoje()), cobs: cs
  })).sort((a, b) => b.dias - a.dias);
  const total = INAD.reduce((a, x) => a + x.total, 0);
  const faixa = { "até 30 dias": 0, "31 a 60": 0, "61 a 90": 0, "mais de 90": 0 };
  INAD.forEach(x => { faixa[x.dias <= 30 ? "até 30 dias" : x.dias <= 60 ? "31 a 60" : x.dias <= 90 ? "61 a 90" : "mais de 90"] += x.total; });
  pg.innerHTML = `<div class="grid">
    <div class="kpis">${kpi("Total em atraso", `<span class="neg">${brl(total)}</span>`, `${cobs.length} aluguéis · ${INAD.length} imóveis`, true)}
      ${Object.entries(faixa).map(([k, v]) => kpi(k, brl(v), "")).join("")}</div>
    <div class="filters"><span class="hint">Aluguéis vencidos sem recebimento, de todos os meses. Para dar baixa, abra o mês em "Aluguéis do mês".</span><span class="spacer"></span><button class="btn" data-act="xls-inad">Excel</button></div>
    <div class="tw"><table><thead><tr><th>Imóvel</th><th>Locatário</th><th>Locador</th><th>Meses em aberto</th><th>Desde</th><th class="num">Dias</th><th class="num">Total</th><th></th></tr></thead><tbody>
      ${INAD.map(x => `<tr><td class="trunc">${esc(x.imovel)}</td><td class="trunc">${esc(x.locatario)}</td><td class="trunc">${esc(x.locador)}</td><td>${x.meses.map(m => `<span class="tag bad">${m}</span>`).join(" ")}</td><td>${dt(x.desde)}</td><td class="num">${x.dias}</td><td class="num">${n2(x.total)}</td>
        <td class="acts"><button class="btn sm" data-act="ir-mes" data-m="${x.cobs[0].competencia}">Abrir mês</button></td></tr>`).join("") || `<tr><td colspan="8" class="empty">Nenhum aluguel em atraso. 🎉</td></tr>`}
    </tbody></table></div>
    ${ctts.length ? `<div class="card"><div class="card-h"><h2>Débitos registrados nos contratos</h2><span class="hint">importados da planilha de contratos</span></div><div class="tw"><table><thead><tr><th>Contrato</th><th>Imóvel</th><th>Locatário</th><th>Situação</th><th class="num">Saldo</th><th>Pendências</th></tr></thead><tbody>
      ${ctts.map(c => `<tr><td class="mono">${esc(c.codigo)}</td><td class="trunc">${esc(c.endereco)}</td><td class="trunc">${esc(c.locatario)}</td><td><span class="tag bad">${esc(c.situacao)}</span></td><td class="num">${c.saldo_devedor ? n2(c.saldo_devedor) : ""}</td><td class="trunc" title="${esc(c.pendencias)}">${esc(c.pendencias)}</td></tr>`).join("")}
    </tbody></table></div></div>` : ""}
  </div>`;
};
ACT["ir-mes"] = el => { S.mes = el.dataset.m; ssSet("mes", S.mes); S.f.cob = "aberto"; location.hash = "#alugueis"; };
ACT["xls-inad"] = () => baixarXLSX(`inadimplencia-${hoje()}.xlsx`, { Inadimplencia: INAD.map(x => ({ Imovel: x.imovel, Locatario: x.locatario, Locador: x.locador, Meses: x.meses.join(", "), Desde: dt(x.desde), Dias: x.dias, Total: r2(x.total) })) });

/* =====================================================================
   PÁGINA: CAIXA E LANÇAMENTOS
   ===================================================================== */
let LANC = [];
PAGES.caixa = async pg => {
  const fim = fimMes(S.mes);
  const [lanc, saldosFimT, saldosIniT] = await Promise.all([
    fetchAll("lancamentos", b => b.gte("data", S.mes).lte("data", fim).order("data").order("criado_em").order("id")),
    rpc("saldos_contas", { p_ate: fim }),
    rpc("saldos_contas", { p_ate: iso(new Date(+S.mes.slice(0, 4), +S.mes.slice(5, 7) - 1, 0)) })
  ]);
  LANC = lanc;
  const saldosFim = soMinhasContas(saldosFimT), saldosIni = soMinhasContas(saldosIniT);
  const fc = S.f.lcConta || "", fg = S.f.lcGrupo || "", fs = S.f.lcSit || "", busca = S.f.lcBusca || "";
  let lista = lanc.filter(l => (!fc || l.conta_id === fc) && (!fg || catPor(l.categoria_id).grupo === fg) && (!fs || (fs === "previsto" ? !l.pago : l.pago)));
  if (busca) { const b = norm(busca); lista = lista.filter(l => norm(l.descricao + " " + l.documento + " " + catPor(l.categoria_id).nome).includes(b)); }
  const ent = lista.filter(l => l.tipo === "entrada" && l.pago).reduce((a, l) => a + +l.valor, 0);
  const sai = lista.filter(l => l.tipo === "saida" && l.pago).reduce((a, l) => a + +l.valor, 0);
  const previstos = lista.filter(l => !l.pago);
  const ini = Object.fromEntries(saldosIni.map(s => [s.conta_id, +s.saldo]));
  pg.innerHTML = `<div class="grid">
    <div class="kpis">${saldosFim.map(s => kpi(s.nome, brl(s.saldo), `início do mês: ${brl(ini[s.conta_id] || 0)}`)).join("")}</div>
    <div class="filters">
      <select data-f="lcConta" aria-label="Conta"><option value="">Todas as contas</option>${soMinhasContas(S.contas).map(c => opt(c.id, c.nome, c.id === fc)).join("")}</select>
      <select data-f="lcGrupo" aria-label="Grupo"><option value="">Todos os grupos</option>${Object.entries(GRUPOS).map(([k, v]) => opt(k, v, k === fg)).join("")}</select>
      <select data-f="lcSit" aria-label="Situação"><option value="">Pagos e previstos</option>${opt("pago", "Só realizados", fs === "pago")}${opt("previsto", "Só previstos (a pagar/receber)", fs === "previsto")}</select>
      <input type="search" placeholder="Buscar descrição…" value="${esc(busca)}" data-busca="lcBusca">
      <span class="spacer"></span>
      ${pode.lancar() ? `<button class="btn pri" data-act="lanc-novo" data-tipo="entrada">+ Entrada</button><button class="btn pri" data-act="lanc-novo" data-tipo="saida">+ Saída</button>` : ""}
      ${pode.editar() ? `<button class="btn" data-act="transf">⇄ Transferência</button>` : ""}
      <button class="btn" data-act="xls-lanc">Excel</button>
    </div>
    <div class="tw"><table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Conta</th><th class="num">Entrada</th><th class="num">Saída</th><th></th></tr></thead><tbody>
      ${lista.map(l => { const c = catPor(l.categoria_id);
        return `<tr><td>${dt(l.data)}${l.pago ? "" : ` <span class="tag warn">Previsto</span>`}</td>
        <td class="trunc">${esc(l.descricao)}${l.documento ? `<span class="sub">${esc(l.documento)}</span>` : ""}</td>
        <td><span class="trunc" style="display:block">${esc(c.nome)}</span><span class="sub">${esc(GRUPOS[c.grupo] || "")}</span></td>
        <td>${esc(contaPor(l.conta_id).nome || "")}</td>
        <td class="num pos">${l.tipo === "entrada" ? n2(l.valor) : ""}</td><td class="num neg">${l.tipo === "saida" ? n2(l.valor) : ""}</td>
        <td class="acts">${!l.pago && pode.editar() ? `<button class="btn sm" data-act="lanc-pagar" data-id="${l.id}">Pagar</button> ` : ""}<button class="btn sm" data-act="lanc-ed" data-id="${l.id}" aria-label="Abrir">⋯</button></td></tr>`; }).join("") || `<tr><td colspan="7" class="empty">Nenhum lançamento neste mês.</td></tr>`}
    </tbody><tfoot><tr><td colspan="4">${lista.length} lançamentos · realizados</td><td class="num">${n2(ent)}</td><td class="num">${n2(sai)}</td><td class="num">${n2(ent - sai)}</td></tr>
      ${previstos.length ? `<tr><td colspan="4">Previstos (ainda não pagos)</td><td class="num">${n2(previstos.filter(l => l.tipo === "entrada").reduce((a, l) => a + +l.valor, 0))}</td><td class="num">${n2(previstos.filter(l => l.tipo === "saida").reduce((a, l) => a + +l.valor, 0))}</td><td></td></tr>` : ""}</tfoot></table></div>
    <p class="hint">Recebimentos e repasses de aluguel entram aqui automaticamente pela tela "Aluguéis do mês". "Proprietários (entrada/saída)" é dinheiro de terceiros: aparece no caixa mas não na DRE.</p>
  </div>`;
  ligarBusca(pg);
  $$("[data-f]", pg).forEach(s => s.addEventListener("change", () => { S.f[s.dataset.f] = s.value; render(); }));
};
const GRUPOS_TIPO = { entrada: ["receita", "terceiros_entrada"], saida: ["imposto", "custo", "despesa", "retirada", "terceiros_saida"] };
function formLanc(l, tipo) {
  const ro = l && (l.origem !== "manual" || !pode.editar());
  const soCaixa = S.papel === "recepcao";
  const cats = S.categorias.filter(c => (c.ativa || (l && c.id === l.categoria_id)) && GRUPOS_TIPO[tipo].includes(c.grupo));
  const porGrupo = GRUPOS_TIPO[tipo].map(g => `<optgroup label="${esc(GRUPOS[g])}">${cats.filter(c => c.grupo === g).map(c => opt(c.id, c.nome, l && l.categoria_id === c.id)).join("")}</optgroup>`).join("");
  const im = l && l.imovel_id ? S.imovelPor[l.imovel_id] : null;
  const dis = ro ? "disabled" : "";
  return `${l && l.origem !== "manual" ? `<div class="box">Lançamento automático (${esc(l.origem)}). Para mudar, estorne pela tela de aluguéis.</div>` : ""}
    <div class="row">
      <label class="fl"><span>Data</span><input type="date" name="data" value="${l ? l.data : hoje()}" required ${dis}></label>
      <label class="fl"><span>Valor</span><input name="valor" inputmode="decimal" value="${l ? n2(l.valor) : ""}" required ${dis}></label>
    </div>
    <label class="fl"><span>Categoria</span><select name="categoria" required ${dis}><option value="">Escolha…</option>${porGrupo}</select></label>
    <div class="row">
      <label class="fl"><span>Conta</span><select name="conta" required ${dis}>${contasOpts(l ? l.conta_id : null, soCaixa)}</select></label>
      <label class="fl"><span>Competência (mês de referência)</span><input type="month" name="comp" value="${(l ? l.competencia : S.mes).slice(0, 7)}" ${dis}></label>
    </div>
    <label class="fl"><span>Descrição</span><input name="descricao" value="${esc(l ? l.descricao : "")}" maxlength="300" ${dis}></label>
    <div class="row">
      <label class="fl"><span>Documento / nota</span><input name="documento" value="${esc(l ? l.documento : "")}" maxlength="100" ${dis}></label>
      <label class="fl"><span>Imóvel (opcional)</span><input name="imovel" list="dl-imv" value="${esc(im ? im.endereco : "")}" ${dis}></label>
    </div>${imovelDatalist()}
    ${soCaixa ? "" : `<label class="chk"><input type="checkbox" name="pago" ${!l || l.pago ? "checked" : ""} ${dis}> Já foi ${tipo === "entrada" ? "recebido" : "pago"} (desmarque para deixar como previsto / conta a pagar)</label>`}
    ${!l && !soCaixa ? `<label class="fl"><span>Repetir nos meses seguintes (como previsto)</span><input type="number" name="repetir" min="0" max="36" value="0"></label>` : ""}`;
}
function lerLanc(f, tipo) {
  const v = parseMoney(f.valor.value); if (!v || v <= 0) throw new Error("Valor inválido.");
  if (!f.categoria.value) throw new Error("Escolha a categoria.");
  let imovel_id = null;
  if (f.imovel.value.trim()) { const im = imovelPorEndereco(f.imovel.value); if (!im) throw new Error("Imóvel não encontrado: escolha um endereço da lista."); imovel_id = im.id; }
  return { data: f.data.value, valor: v, tipo, categoria_id: f.categoria.value, conta_id: f.conta.value, competencia: (f.comp.value || f.data.value.slice(0, 7)) + "-01",
    descricao: f.descricao.value.trim(), documento: f.documento.value.trim(), imovel_id, pago: f.pago ? f.pago.checked : true };
}
ACT["lanc-novo"] = el => {
  const tipo = el.dataset.tipo;
  modal({
    titulo: tipo === "entrada" ? "Nova entrada" : "Nova saída", corpo: formLanc(null, tipo), ok: "Lançar",
    salvar: async f => {
      const base = lerLanc(f, tipo); const rep = f.repetir ? Math.max(0, Math.min(36, +f.repetir.value || 0)) : 0;
      const linhas = [base];
      for (let i = 1; i <= rep; i++) {
        const d = new Date(+base.data.slice(0, 4), +base.data.slice(5, 7) - 1 + i, 1);
        const dia = Math.min(+base.data.slice(8, 10), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
        linhas.push(Object.assign({}, base, { data: iso(new Date(d.getFullYear(), d.getMonth(), dia)), competencia: addMes(base.competencia, i), pago: false }));
      }
      await q(sb.from("lancamentos").insert(linhas));
      toast(linhas.length > 1 ? `${linhas.length} lançamentos criados.` : "Lançado."); render();
    }
  });
};
ACT["lanc-ed"] = el => {
  const l = LANC.find(x => x.id === el.dataset.id);
  const editavel = pode.editar() && l.origem === "manual";
  modal({
    titulo: l.tipo === "entrada" ? "Entrada" : "Saída", corpo: formLanc(l, l.tipo), semOk: !editavel,
    extra: pode.editar() && ["manual", "transferencia"].includes(l.origem) ? `<button type="button" class="btn danger left" data-del>Excluir</button>` : "",
    salvar: async f => { const u = lerLanc(f, l.tipo); delete u.tipo; await q(sb.from("lancamentos").update(u).eq("id", l.id)); toast("Salvo."); render(); },
    aoAbrir: (f, d) => { const b = $("[data-del]", d); if (b) b.addEventListener("click", async () => {
      d.close();
      if (!(await confirmar("Excluir lançamento", l.origem === "transferencia" ? "Excluir a transferência (as duas pontas)?" : "Excluir este lançamento?", "Excluir"))) return;
      try {
        if (l.origem === "transferencia" && l.transferencia_id) await q(sb.from("lancamentos").delete().eq("transferencia_id", l.transferencia_id));
        else await q(sb.from("lancamentos").delete().eq("id", l.id));
        toast("Excluído."); render();
      } catch (e) { falha(e); }
    }); }
  });
};
ACT["lanc-pagar"] = el => {
  const l = LANC.find(x => x.id === el.dataset.id);
  modal({
    titulo: "Confirmar pagamento", corpo: `<div class="box">${esc(l.descricao || catPor(l.categoria_id).nome)} · ${brl(l.valor)}</div>
      <div class="row"><label class="fl"><span>Data</span><input type="date" name="data" value="${hoje()}"></label><label class="fl"><span>Valor</span><input name="valor" inputmode="decimal" value="${n2(l.valor)}"></label></div>`,
    ok: "Marcar como pago",
    salvar: async f => { const v = parseMoney(f.valor.value); if (!v) throw new Error("Valor inválido."); await q(sb.from("lancamentos").update({ pago: true, data: f.data.value, valor: v }).eq("id", l.id)); toast("Pago."); render(); }
  });
};
ACT.transf = () => {
  modal({
    titulo: "Transferência entre contas",
    corpo: `<p class="hint">Ex.: depósito do dinheiro do caixa da recepção no banco. Não afeta a DRE.</p>
      <div class="row"><label class="fl"><span>Data</span><input type="date" name="data" value="${hoje()}" required></label><label class="fl"><span>Valor</span><input name="valor" inputmode="decimal" required></label></div>
      <div class="row"><label class="fl"><span>De</span><select name="de">${contasOpts()}</select></label><label class="fl"><span>Para</span><select name="para">${contasOpts()}</select></label></div>
      <label class="fl"><span>Descrição</span><input name="descricao" value="Transferência"></label>`,
    ok: "Transferir",
    salvar: async f => {
      const v = parseMoney(f.valor.value); if (!v || v <= 0) throw new Error("Valor inválido.");
      if (f.de.value === f.para.value) throw new Error("Escolha contas diferentes.");
      let cat = S.categorias.find(c => c.grupo === "transferencia");
      if (!cat) throw new Error("Crie uma categoria do grupo Transferência em Configurações.");
      const tid = crypto.randomUUID();
      const b = { data: f.data.value, valor: v, categoria_id: cat.id, descricao: f.descricao.value, origem: "transferencia", transferencia_id: tid, pago: true };
      await q(sb.from("lancamentos").insert([Object.assign({ tipo: "saida", conta_id: f.de.value }, b), Object.assign({ tipo: "entrada", conta_id: f.para.value }, b)]));
      toast("Transferência registrada."); render();
    }
  });
};
ACT["xls-lanc"] = () => baixarXLSX(`caixa-${S.mes.slice(0, 7)}.xlsx`, {
  Lancamentos: LANC.map(l => ({ Data: dt(l.data), Competencia: l.competencia.slice(0, 7), Tipo: l.tipo, Categoria: catPor(l.categoria_id).nome, Grupo: GRUPOS[catPor(l.categoria_id).grupo],
    Conta: contaPor(l.conta_id).nome, Valor: l.tipo === "entrada" ? +l.valor : -l.valor, Descricao: l.descricao, Documento: l.documento,
    Imovel: l.imovel_id ? (S.imovelPor[l.imovel_id] || {}).endereco : "", Situacao: l.pago ? "Realizado" : "Previsto", Origem: l.origem }))
});

/* =====================================================================
   PÁGINA: DRE
   ===================================================================== */
let DRE_LINHAS = [];
PAGES.dre = async pg => {
  const ano = S.mes.slice(0, 4), ini = ano + "-01-01", fim = ano + "-12-31";
  const res = await rpc("resumo_lancamentos", { p_ini: ini, p_fim: fim });
  const prev = S.f.drePrev === "1";
  const meses = Array.from({ length: 12 }, (_, i) => ano + "-" + pad(i + 1) + "-01");
  const val = {}; // grupo -> categoria -> mes -> valor (positivo)
  res.filter(r => prev || r.pago).forEach(r => {
    const sinal = (r.grupo === "receita" || r.grupo === "terceiros_entrada") ? (r.tipo === "entrada" ? 1 : -1) : (r.tipo === "saida" ? 1 : -1);
    ((val[r.grupo] = val[r.grupo] || {})[r.categoria] = val[r.grupo][r.categoria] || {});
    val[r.grupo][r.categoria][r.competencia] = (val[r.grupo][r.categoria][r.competencia] || 0) + sinal * +r.total;
  });
  const somaG = g => meses.map(m => Object.values(val[g] || {}).reduce((a, c) => a + (c[m] || 0), 0));
  const op = (a, b, s) => a.map((v, i) => v + s * b[i]);
  const rec = somaG("receita"), imp = somaG("imposto"), cus = somaG("custo"), des = somaG("despesa"), ret = somaG("retirada");
  const liq = op(rec, imp, -1), bruto = op(liq, cus, -1), oper = op(bruto, des, -1), fin = op(oper, ret, -1);
  const te = somaG("terceiros_entrada"), ts = somaG("terceiros_saida");
  DRE_LINHAS = [];
  const cel = (v, suf) => `<td class="num ${v < -0.004 ? "neg" : ""}">${Math.abs(v) < 0.005 ? "–" : n2(v) + (suf || "")}</td>`;
  const L = (rotulo, vals, cls, total, suf) => {
    const t = total != null ? total : vals.reduce((a, b) => a + b, 0);
    DRE_LINHAS.push({ rotulo, vals, total: t });
    return `<tr class="${cls || ""}"><td>${esc(rotulo)}</td>${vals.map(v => cel(v, suf)).join("")}${cel(t, suf).replace(/>([^<]*)<\/td>$/, "><b>$1</b></td>")}</tr>`;
  };
  const cats = g => Object.entries(val[g] || {}).sort((a, b) => a[0].localeCompare(b[0])).map(([n, m]) => L(n, meses.map(x => m[x] || 0), "sub")).join("");
  const pct = (a, b) => a.map((v, i) => b[i] ? v / b[i] * 100 : 0);
  pg.innerHTML = `<div class="grid">
    <div class="filters"><label class="chk"><input type="checkbox" data-prev ${prev ? "checked" : ""}> Incluir lançamentos previstos (ainda não pagos)</label>
      <span class="spacer"></span><button class="btn" data-act="xls-dre">Excel</button><button class="btn" data-act="imprimir">Imprimir</button></div>
    <div class="tw"><table class="dre"><thead><tr><th>${ano}</th>${meses.map(m => `<th class="num">${MES3[+m.slice(5, 7) - 1]}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>
      ${L("Receita bruta", rec, "grp")}${cats("receita")}
      ${L("(−) Impostos sobre a receita", imp, "grp")}${cats("imposto")}
      ${L("= Receita líquida", liq, "tot")}
      ${L("(−) Custos (comissões etc.)", cus, "grp")}${cats("custo")}
      ${L("= Lucro bruto", bruto, "tot")}
      ${L("(−) Despesas operacionais", des, "grp")}${cats("despesa")}
      ${L("= Resultado operacional", oper, "tot")}
      ${L("Margem (% da receita bruta)", pct(oper, rec), "memo", (() => { const r = rec.reduce((a, b) => a + b, 0); return r ? oper.reduce((a, b) => a + b, 0) / r * 100 : 0; })(), "%")}
      ${L("(−) Retiradas dos sócios", ret, "grp")}${cats("retirada")}
      ${L("= Resultado após retiradas", fin, "tot")}
      <tr><td colspan="14" class="hint" style="padding-top:16px">Dinheiro de proprietários (não entra no resultado)</td></tr>
      ${L("Recebido de inquilinos p/ proprietários", te, "memo")}
      ${L("Repassado / pago p/ proprietários", ts, "memo")}
      ${L("Diferença no mês (fica a repassar)", op(te, ts, -1), "memo")}
    </tbody></table></div>
    <p class="hint">Regime de competência: cada lançamento entra no mês de referência (ex.: aluguel de outubro recebido em novembro conta em outubro).</p>
  </div>`;
  $("[data-prev]", pg).addEventListener("change", e => { S.f.drePrev = e.target.checked ? "1" : ""; render(); });
};
ACT["xls-dre"] = () => baixarXLSX(`dre-${S.mes.slice(0, 4)}.xlsx`, { DRE: DRE_LINHAS.map(l => Object.assign({ Linha: l.rotulo }, Object.fromEntries(MES3.map((m, i) => [m, r2(l.vals[i])])), { Total: r2(l.total) })) });
ACT.imprimir = () => window.print();

/* =====================================================================
   PÁGINA: IMÓVEIS (mapa)
   ===================================================================== */
PAGES.imoveis = async pg => {
  const reaj = await q(sb.from("reajustes").select("imovel_id,competencia,valor_novo").is("aplicado_em", null));
  const reajPor = {}; reaj.forEach(r => { (reajPor[r.imovel_id] = reajPor[r.imovel_id] || []).push(r); });
  const f = S.f.imv || "ALG", busca = S.f.imvBusca || "";
  const cont = { todos: S.imoveis.length, ALG: 0, LVR: 0, OCP: 0, INTV: 0, reaj: Object.keys(reajPor).length };
  S.imoveis.forEach(i => cont[i.status]++);
  let lista = S.imoveis.filter(i => f === "todos" || i.status === f || (f === "reaj" && reajPor[i.id]));
  if (busca) { const b = norm(busca); lista = lista.filter(i => norm(i.endereco + " " + i.locador + " " + i.locatario + " " + i.codigo_site + " " + i.contrato_codigo).includes(b)); }
  const limite = +(S.f.imvLim || 200);
  const chips = [["ALG", "Alugados"], ["LVR", "Livres"], ["OCP", "Ocupados"], ["INTV", "Inativos"], ["todos", "Todos"], ["reaj", "Com reajuste programado"]];
  pg.innerHTML = `<div class="grid">
    <div class="filters">
      <div class="chips">${chips.map(([k, t]) => `<button class="chip${f === k ? " on" : ""}" data-act="chip" data-k="imv" data-v="${k}">${t}<span class="c">${cont[k]}</span></button>`).join("")}</div>
      <input type="search" placeholder="Buscar endereço, locador, locatário…" value="${esc(busca)}" data-busca="imvBusca">
      <span class="spacer"></span>
      ${pode.editar() ? `<button class="btn pri" data-act="imv-novo">+ Imóvel</button><button class="btn" data-act="fechar-mapa" title="Guarda a situação atual como histórico do mês">Fechar mapa de ${esc(mesCurto(S.mes))}</button>` : ""}
      <button class="btn" data-act="xls-imv">Excel</button>
    </div>
    <div class="tw"><table><thead><tr><th>Situação</th><th>Endereço</th><th>Tipo</th><th>Locador</th><th>Locatário</th><th class="num">Aluguel</th><th class="num">Taxa</th><th class="num">Dia</th><th>Contrato</th></tr></thead><tbody>
      ${lista.slice(0, limite).map(i => `<tr data-act="imv-ed" data-id="${i.id}" style="cursor:pointer">
        <td><span class="tag ${STATUS_IMV[i.status][1]}">${STATUS_IMV[i.status][0]}</span></td>
        <td class="trunc">${esc(i.endereco)}${i.codigo_site ? `<span class="sub">site ${esc(i.codigo_site)}</span>` : ""}</td>
        <td>${esc(i.tipo)}</td><td class="trunc">${esc(i.locador)}</td><td class="trunc">${esc(i.locatario)}</td>
        <td class="num">${i.valor != null ? n2(i.valor) : ""}${reajPor[i.id] ? reajPor[i.id].map(r => `<span class="sub" style="color:var(--warn)">${mesCurto(r.competencia)} → ${n2(r.valor_novo)}</span>`).join("") : ""}</td>
        <td class="num">${n2(i.taxa_adm)}%</td><td class="num">${i.dia_venc || ""}</td><td class="mono">${esc(i.contrato_codigo)}</td></tr>`).join("") || `<tr><td colspan="9" class="empty">Nada encontrado.</td></tr>`}
    </tbody><tfoot><tr><td colspan="5">${lista.length} imóveis</td><td class="num">${n2(lista.reduce((a, i) => a + (i.status === "ALG" ? +i.valor || 0 : 0), 0))}</td><td class="num">${n2(lista.reduce((a, i) => a + (i.status === "ALG" ? (+i.valor || 0) * i.taxa_adm / 100 : 0), 0))}</td><td colspan="2" class="muted">← comissão/mês</td></tr></tfoot></table>
    ${lista.length > limite ? `<div class="mais"><button class="btn" data-act="imv-mais">Mostrar mais (${lista.length - limite})</button></div>` : ""}</div>
  </div>`;
  ligarBusca(pg);
};
ACT["imv-mais"] = () => { S.f.imvLim = (+(S.f.imvLim || 200) + 400); render(); };
function formImovel(i) {
  i = i || { status: "LVR", tipo: "Casa", taxa_adm: 10 };
  const dis = pode.editar() ? "" : "disabled";
  return `<div class="row">
      <label class="fl"><span>Situação</span><select name="status" ${dis}>${Object.entries(STATUS_IMV).map(([k, v]) => opt(k, v[0], i.status === k)).join("")}</select></label>
      <label class="fl"><span>Tipo</span><input name="tipo" list="dl-tipos" value="${esc(i.tipo)}" ${dis}></label>
      <label class="fl"><span>Código no site</span><input name="codigo_site" value="${esc(i.codigo_site || "")}" ${dis}></label>
    </div><datalist id="dl-tipos">${["Casa", "Apto", "Sala", "Salão", "Barracão", "C. Com.", "Terreno"].map(t => `<option value="${t}">`).join("")}</datalist>
    <label class="fl"><span>Endereço</span><input name="endereco" value="${esc(i.endereco || "")}" required ${dis}></label>
    <label class="fl"><span>Locador (proprietário)</span><input name="locador" value="${esc(i.locador || "")}" ${dis}></label>
    <label class="fl"><span>Locatário (inquilino atual)</span><input name="locatario" value="${esc(i.locatario || "")}" ${dis}></label>
    <div class="row">
      <label class="fl"><span>Aluguel</span><input name="valor" inputmode="decimal" value="${i.valor != null ? n2(i.valor) : ""}" ${dis}></label>
      <label class="fl"><span>Taxa adm. %</span><input name="taxa_adm" inputmode="decimal" value="${n2(i.taxa_adm)}" ${dis}></label>
      <label class="fl"><span>Dia venc.</span><input type="number" name="dia_venc" min="1" max="31" value="${i.dia_venc || ""}" ${dis}></label>
    </div>
    <div class="row">
      <label class="fl"><span>Entrada do locatário</span><input type="date" name="data_entrada" value="${i.data_entrada || ""}" ${dis}></label>
      <label class="fl"><span>Contrato</span><input name="contrato_codigo" value="${esc(i.contrato_codigo || "")}" placeholder="L.26.001" ${dis}></label>
      <label class="fl"><span>Declarar IR?</span><select name="declarar_ir" ${dis}>${opt("", "—", !i.declarar_ir)}${opt("Sim", "Sim", i.declarar_ir === "Sim")}${opt("Não", "Não", i.declarar_ir === "Não")}</select></label>
    </div>
    <label class="fl"><span>Observações</span><textarea name="obs" ${dis}>${esc(i.obs || "")}</textarea></label>
    <p class="hint">Taxa: 10% = administração normal · 100% = imóvel da própria imobiliária (aluguel inteiro é receita) · 0% = sem comissão.</p>`;
}
function lerImovel(f) {
  const valor = f.valor.value.trim() ? parseMoney(f.valor.value) : null;
  const taxa = parseMoney(f.taxa_adm.value);
  if (taxa == null || taxa < 0 || taxa > 100) throw new Error("Taxa deve estar entre 0 e 100.");
  const d = { status: f.status.value, tipo: f.tipo.value.trim() || "Casa", codigo_site: f.codigo_site.value.trim(), endereco: f.endereco.value.trim(),
    locador: f.locador.value.trim(), locatario: f.locatario.value.trim(), valor, taxa_adm: taxa, dia_venc: +f.dia_venc.value || null,
    data_entrada: f.data_entrada.value || null, contrato_codigo: f.contrato_codigo.value.trim(), declarar_ir: f.declarar_ir.value, obs: f.obs.value.trim() };
  if (!d.endereco) throw new Error("Informe o endereço.");
  if (d.status === "ALG" && (!d.valor || !d.locatario)) throw new Error("Imóvel alugado precisa de locatário e valor.");
  return d;
}
ACT["imv-novo"] = () => modal({ titulo: "Novo imóvel", corpo: formImovel(), salvar: async f => { await q(sb.from("imoveis").insert(lerImovel(f))); await recarregarImoveis(); toast("Imóvel cadastrado."); render(); } });
ACT["imv-ed"] = async el => {
  const i = S.imovelPor[el.dataset.id];
  const [reaj, hist, cobs] = await Promise.all([
    q(sb.from("reajustes").select("*").eq("imovel_id", i.id).order("competencia", { ascending: false })),
    q(sb.from("mapa_mensal").select("competencia,status,valor,locatario").eq("imovel_id", i.id).order("competencia", { ascending: false }).limit(14)),
    q(sb.from("cobrancas").select("competencia,vencimento,valor,acrescimos,descontos,valor_pago,data_pagamento,taxa_valor,repasse_data,locatario").eq("imovel_id", i.id).order("competencia", { ascending: false }).limit(12))
  ]);
  const liberar = pode.editar() && i.status === "ALG" ? `<button type="button" class="btn left" data-liberar>Desocupou → Livre</button>` : "";
  const excluir = pode.admin() ? `<button type="button" class="btn danger left" data-del>Excluir</button>` : "";
  modal({
    titulo: i.endereco, largo: true, semOk: !pode.editar(), extra: liberar + excluir,
    corpo: formImovel(i) + `
      <h3 style="margin-top:8px">Reajustes programados</h3>
      <div class="tw"><table><thead><tr><th>A partir de</th><th class="num">Novo valor</th><th>Situação</th><th></th></tr></thead><tbody>
        ${reaj.map(r => `<tr><td>${mesTxt(r.competencia)}</td><td class="num">${n2(r.valor_novo)}</td><td>${r.aplicado_em ? `<span class="tag ok">Aplicado</span>` : `<span class="tag warn">Pendente</span>`}</td><td class="acts">${pode.editar() && !r.aplicado_em ? `<button type="button" class="btn sm" data-reaj-del="${r.id}">Remover</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">Nenhum.</td></tr>`}
      </tbody></table></div>
      ${pode.editar() ? `<div class="row"><label class="fl"><span>Novo reajuste a partir de</span><input type="month" data-rj-mes value="${addMes(S.mes, 1).slice(0, 7)}"></label><label class="fl"><span>Novo valor</span><input data-rj-val inputmode="decimal"></label><label class="fl"><span>&nbsp;</span><button type="button" class="btn" data-reaj-add>Programar reajuste</button></label></div>` : ""}
      <h3 style="margin-top:8px">Últimos aluguéis</h3>
      <div class="tw"><table><thead><tr><th>Mês</th><th>Locatário</th><th class="num">Devido</th><th>Situação</th></tr></thead><tbody>
        ${cobs.map(c => `<tr><td>${mesCurto(c.competencia)}</td><td class="trunc">${esc(c.locatario)}</td><td class="num">${n2(devido(c))}</td><td>${tagCob(c)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">Nenhum.</td></tr>`}
      </tbody></table></div>
      <h3 style="margin-top:8px">Histórico do mapa</h3>
      <div class="tw"><table><thead><tr><th>Mês</th><th>Situação</th><th class="num">Valor</th><th>Locatário</th></tr></thead><tbody>
        ${hist.map(h => `<tr><td>${mesCurto(h.competencia)}</td><td><span class="tag ${(STATUS_IMV[h.status] || ["", "idle"])[1]}">${(STATUS_IMV[h.status] || [h.status])[0]}</span></td><td class="num">${h.valor != null ? n2(h.valor) : ""}</td><td class="trunc">${esc(h.locatario)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">Sem histórico.</td></tr>`}
      </tbody></table></div>`,
    salvar: async f => { await q(sb.from("imoveis").update(lerImovel(f)).eq("id", i.id)); await recarregarImoveis(); toast("Salvo."); render(); },
    aoAbrir: (f, d) => {
      const lib = $("[data-liberar]", d);
      if (lib) lib.addEventListener("click", () => { f.status.value = "LVR"; f.locatario.value = ""; f.data_entrada.value = ""; f.contrato_codigo.value = ""; toast("Marcado como livre. Clique em Salvar para confirmar."); });
      const del = $("[data-del]", d);
      if (del) del.addEventListener("click", async () => { d.close(); if (!(await confirmar("Excluir imóvel", `Excluir <b>${esc(i.endereco)}</b>? Só é possível se não houver aluguéis lançados. Prefira marcar como Inativo.`, "Excluir"))) return; try { await q(sb.from("imoveis").delete().eq("id", i.id)); await recarregarImoveis(); toast("Excluído."); render(); } catch (e) { falha(e); } });
      const add = $("[data-reaj-add]", d);
      if (add) add.addEventListener("click", async () => {
        const v = parseMoney($("[data-rj-val]", d).value), m = $("[data-rj-mes]", d).value;
        if (!v || !m) return toast("Informe mês e valor.", true);
        try { await q(sb.from("reajustes").insert({ imovel_id: i.id, competencia: m + "-01", valor_novo: v })); toast("Reajuste programado."); d.close(); ACT["imv-ed"](el); } catch (e) { falha(e); }
      });
      $$("[data-reaj-del]", d).forEach(b => b.addEventListener("click", async () => { try { await q(sb.from("reajustes").delete().eq("id", b.dataset.reajDel)); d.close(); ACT["imv-ed"](el); } catch (e) { falha(e); } }));
    }
  });
};
ACT["fechar-mapa"] = async () => {
  if (!(await confirmar("Fechar mapa do mês", `Guardar a situação atual de todos os imóveis como o mapa de <b>${esc(mesTxt(S.mes))}</b>? Se já existir, será substituído.`))) return;
  const n = await rpc("fechar_mapa", { p_comp: S.mes }); toast(`Mapa de ${mesTxt(S.mes)} guardado (${n} imóveis).`);
};
ACT["xls-imv"] = () => baixarXLSX(`mapa-aluguel-${S.mes.slice(0, 7)}.xlsx`, { Mapa: S.imoveis.map(i => ({ Status: i.status, Site: i.codigo_site, Contrato: i.contrato_codigo, Endereco: i.endereco, Tipo: i.tipo, Valor: i.valor == null ? "" : +i.valor, Locador: i.locador, Locatario: i.locatario, Entrada: dt(i.data_entrada), "Dia venc.": i.dia_venc || "", "Taxa %": +i.taxa_adm, "Declarar IR": i.declarar_ir, Obs: i.obs })) });

/* =====================================================================
   PÁGINA: CONTRATOS
   ===================================================================== */
let CTT = [];
const SIT_CTT = { "ATIVO": "ok", "EM ELABORAÇÃO": "info", "DÉBITO EM ABERTO": "bad", "ENCERRADO": "idle", "CANCELADO": "idle" };
PAGES.contratos = async pg => {
  CTT = await fetchAll("contratos", b => b.order("codigo", { ascending: false }));
  const f = S.f.ctt || "ATIVO", busca = S.f.cttBusca || "";
  const lim60 = iso(new Date(Date.now() + 60 * 86400000));
  const testa = { todos: () => true, vencendo: c => c.situacao === "ATIVO" && c.termino && c.termino >= hoje() && c.termino <= lim60, pend: c => c.pendencias && c.situacao !== "CANCELADO" };
  const filtro = c => testa[f] ? testa[f](c) : c.situacao === f;
  const cont = k => CTT.filter(c => testa[k] ? testa[k](c) : c.situacao === k).length;
  let lista = CTT.filter(filtro);
  if (busca) { const b = norm(busca); lista = lista.filter(c => norm(c.codigo + " " + c.endereco + " " + c.locador + " " + c.locatario + " " + c.fiador).includes(b)); }
  const chips = [["ATIVO", "Ativos"], ["vencendo", "Terminam em 60 dias"], ["pend", "Com pendências"], ["DÉBITO EM ABERTO", "Débito em aberto"], ["EM ELABORAÇÃO", "Em elaboração"], ["ENCERRADO", "Encerrados"], ["CANCELADO", "Cancelados"], ["todos", "Todos"]];
  pg.innerHTML = `<div class="grid">
    <div class="filters">
      <div class="chips">${chips.map(([k, t]) => `<button class="chip${f === k ? " on" : ""}" data-act="chip" data-k="ctt" data-v="${esc(k)}">${t}<span class="c">${cont(k)}</span></button>`).join("")}</div>
      <input type="search" placeholder="Buscar código, endereço, nomes…" value="${esc(busca)}" data-busca="cttBusca">
      <span class="spacer"></span>${pode.editar() ? `<button class="btn pri" data-act="ctt-novo">+ Contrato</button>` : ""}<button class="btn" data-act="xls-ctt">Excel</button>
    </div>
    <div class="tw"><table><thead><tr><th>Contrato</th><th>Imóvel</th><th>Locatário</th><th>Locador</th><th>Início</th><th>Término</th><th class="num">Valor</th><th>Garantia</th><th>Situação</th></tr></thead><tbody>
      ${lista.map(c => `<tr data-act="ctt-ed" data-id="${esc(c.codigo)}" style="cursor:pointer"><td class="mono">${esc(c.codigo)}${c.pendencias ? ` <span class="tag warn" title="${esc(c.pendencias)}">!</span>` : ""}</td>
        <td class="trunc">${esc(c.endereco)}</td><td class="trunc">${esc(c.locatario)}</td><td class="trunc">${esc(c.locador)}</td>
        <td>${dt(c.inicio)}</td><td>${dt(c.termino)}</td><td class="num">${c.valor != null ? n2(c.valor) : ""}</td><td>${esc(c.garantia)}</td>
        <td><span class="tag ${SIT_CTT[c.situacao] || "idle"}">${esc(c.situacao)}</span></td></tr>`).join("") || `<tr><td colspan="9" class="empty">Nada encontrado.</td></tr>`}
    </tbody></table></div></div>`;
  ligarBusca(pg);
};
function proximoCodigo() {
  const yy = hoje().slice(2, 4);
  const n = CTT.filter(c => c.codigo.startsWith("L." + yy + ".")).map(c => +c.codigo.slice(5)).filter(x => x < 900);
  return "L." + yy + "." + String((n.length ? Math.max(...n) : 0) + 1).padStart(3, "0");
}
function formContrato(c) {
  const novo = !c; c = c || { codigo: proximoCodigo(), situacao: "EM ELABORAÇÃO", finalidade: "Residenciais", garantia: "Fiador", prazo_meses: 30 };
  const dis = pode.editar() ? "" : "disabled";
  const im = c.imovel_id ? S.imovelPor[c.imovel_id] : null;
  return `<div class="row">
      <label class="fl"><span>Código</span><input name="codigo" value="${esc(c.codigo)}" required pattern="L\\.\\d{2}\\.\\d{3}" ${novo ? "" : "disabled"}></label>
      <label class="fl"><span>Situação</span><select name="situacao" ${dis}>${Object.keys(SIT_CTT).map(k => opt(k, k, c.situacao === k)).join("")}</select></label>
      <label class="fl"><span>Finalidade</span><select name="finalidade" ${dis}>${["Residenciais", "Comerciais"].map(k => opt(k, k, c.finalidade === k)).join("")}</select></label>
    </div>
    <label class="fl"><span>Imóvel (do mapa)</span><input name="imovel" list="dl-imv" value="${esc(im ? im.endereco : "")}" placeholder="Digite e escolha o endereço" ${dis}></label>${imovelDatalist()}
    <label class="fl"><span>Endereço como no contrato</span><input name="endereco" value="${esc(c.endereco || "")}" ${dis}></label>
    <label class="fl"><span>Locador(es)</span><input name="locador" value="${esc(c.locador || "")}" ${dis}></label>
    <label class="fl"><span>Locatário(s)</span><input name="locatario" value="${esc(c.locatario || "")}" ${dis}></label>
    <div class="row"><label class="fl"><span>Garantia</span><select name="garantia" ${dis}>${["Fiador", "Caução", "Seguro fiança", "Título de capitalização", "Sem garantia"].map(k => opt(k, k, c.garantia === k)).join("")}</select></label>
      <label class="fl"><span>Fiador(es)</span><input name="fiador" value="${esc(c.fiador || "")}" ${dis}></label></div>
    <div class="row">
      <label class="fl"><span>Data do contrato</span><input type="date" name="data_contrato" value="${c.data_contrato || ""}" ${dis}></label>
      <label class="fl"><span>Início</span><input type="date" name="inicio" value="${c.inicio || ""}" ${dis}></label>
      <label class="fl"><span>Término</span><input type="date" name="termino" value="${c.termino || ""}" ${dis}></label>
    </div>
    <div class="row">
      <label class="fl"><span>Prazo (meses)</span><input type="number" name="prazo_meses" min="1" value="${c.prazo_meses || ""}" ${dis}></label>
      <label class="fl"><span>Aluguel</span><input name="valor" inputmode="decimal" value="${c.valor != null ? n2(c.valor) : ""}" ${dis}></label>
      <label class="fl"><span>Dia venc.</span><input type="number" name="dia_venc" min="1" max="31" value="${c.dia_venc || ""}" ${dis}></label>
      <label class="fl"><span>Saldo devedor</span><input name="saldo_devedor" inputmode="decimal" value="${c.saldo_devedor != null ? n2(c.saldo_devedor) : ""}" ${dis}></label>
    </div>
    <label class="fl"><span>Pendências (assinaturas, CPFL, cadastro…)</span><textarea name="pendencias" ${dis}>${esc(c.pendencias || "")}</textarea></label>
    <label class="fl"><span>Observações</span><textarea name="obs" ${dis}>${esc(c.obs || "")}</textarea></label>
    ${pode.editar() ? `<label class="chk"><input type="checkbox" name="atualizar_mapa" ${novo ? "checked" : ""}> Atualizar o mapa: marcar o imóvel como <b>alugado</b> com este locatário, valor, dia e data de início</label>` : ""}`;
}
async function salvarContrato(f, novo) {
  let imovel_id = null;
  if (f.imovel.value.trim()) { const im = imovelPorEndereco(f.imovel.value); if (!im) throw new Error("Imóvel não encontrado no mapa: escolha da lista (ou cadastre o imóvel antes)."); imovel_id = im.id; }
  const d = { imovel_id, situacao: f.situacao.value, finalidade: f.finalidade.value, endereco: f.endereco.value.trim() || (imovel_id ? S.imovelPor[imovel_id].endereco : ""),
    locador: f.locador.value.trim(), locatario: f.locatario.value.trim(), garantia: f.garantia.value, fiador: f.fiador.value.trim(),
    data_contrato: f.data_contrato.value || null, inicio: f.inicio.value || null, termino: f.termino.value || null, prazo_meses: +f.prazo_meses.value || null,
    valor: f.valor.value.trim() ? parseMoney(f.valor.value) : null, dia_venc: +f.dia_venc.value || null,
    saldo_devedor: f.saldo_devedor.value.trim() ? parseMoney(f.saldo_devedor.value) : null, pendencias: f.pendencias.value.trim(), obs: f.obs.value.trim() };
  const codigo = novo ? f.codigo.value.trim() : f.codigo.value;
  if (!/^L\.\d{2}\.\d{3}$/.test(codigo)) throw new Error("Código no formato L.26.001");
  if (novo) await q(sb.from("contratos").insert(Object.assign({ codigo }, d)));
  else await q(sb.from("contratos").update(d).eq("codigo", codigo));
  if (f.atualizar_mapa && f.atualizar_mapa.checked) {
    if (!imovel_id) throw new Error("Contrato salvo, mas para atualizar o mapa escolha o imóvel.");
    if (!d.valor || !d.locatario) throw new Error("Contrato salvo, mas para atualizar o mapa informe locatário e valor.");
    await q(sb.from("imoveis").update({ status: "ALG", locatario: d.locatario, locador: d.locador || S.imovelPor[imovel_id].locador, valor: d.valor, dia_venc: d.dia_venc, data_entrada: d.inicio, contrato_codigo: codigo }).eq("id", imovel_id));
    await recarregarImoveis();
  }
}
ACT["ctt-novo"] = () => modal({ titulo: "Novo contrato", largo: true, corpo: formContrato(null), salvar: async f => { await salvarContrato(f, true); toast("Contrato salvo."); render(); } });
ACT["ctt-ed"] = el => {
  const c = CTT.find(x => x.codigo === el.dataset.id);
  modal({ titulo: "Contrato " + c.codigo, largo: true, corpo: formContrato(c), semOk: !pode.editar(),
    extra: pode.admin() ? `<button type="button" class="btn danger left" data-del>Excluir</button>` : "",
    salvar: async f => { await salvarContrato(f, false); toast("Salvo."); render(); },
    aoAbrir: (f, d) => { const b = $("[data-del]", d); if (b) b.addEventListener("click", async () => { d.close(); if (!(await confirmar("Excluir contrato", `Excluir o contrato ${esc(c.codigo)}? Prefira mudar a situação para Cancelado.`, "Excluir"))) return; try { await q(sb.from("contratos").delete().eq("codigo", c.codigo)); toast("Excluído."); render(); } catch (e) { falha(e); } }); }
  });
};
ACT["xls-ctt"] = () => baixarXLSX(`contratos-${hoje()}.xlsx`, { Contratos: CTT.map(c => ({ Codigo: c.codigo, Situacao: c.situacao, Endereco: c.endereco, Finalidade: c.finalidade, Locador: c.locador, Locatario: c.locatario, Fiador: c.fiador, Garantia: c.garantia, "Data contrato": dt(c.data_contrato), Inicio: dt(c.inicio), Termino: dt(c.termino), "Prazo (meses)": c.prazo_meses, Valor: c.valor == null ? "" : +c.valor, "Dia venc.": c.dia_venc, "Saldo devedor": c.saldo_devedor == null ? "" : +c.saldo_devedor, Pendencias: c.pendencias, Obs: c.obs })) });

/* =====================================================================
   PÁGINA: CONFIGURAÇÕES (admin)
   ===================================================================== */
PAGES.config = async pg => {
  if (!pode.admin()) { pg.innerHTML = `<div class="card empty">Somente o administrador.</div>`; return; }
  const aba = S.f.cfg || "contas";
  const abas = [["contas", "Contas"], ["categorias", "Plano de contas"], ["usuarios", "Usuários"], ["fechamento", "Fechamento"], ["auditoria", "Auditoria"]];
  let html = "";
  if (aba === "contas") {
    const linha = c => `<tr data-act="conta-ed" data-id="${c.id}" style="cursor:pointer"${c.ativa ? "" : ` class="inativa"`}><td class="num">${c.ordem}</td><td>${esc(c.nome)}</td><td>${esc({ caixa: "Caixa", banco: "Banco", outro: "Outro" }[c.tipo] || c.tipo)}</td><td class="num">${n2(c.saldo_inicial)}</td><td>${dt(c.data_saldo)}</td><td>${c.ativa ? `<span class="tag ok">Ativa</span>` : `<span class="tag bad">Inativa</span>`}</td></tr>`;
    html = `<div class="filters"><span class="hint">Onde o dinheiro fica. O saldo inicial é o saldo real da conta na data informada (pegue no extrato).</span><span class="spacer"></span><button class="btn pri" data-act="conta-ed">+ Conta</button></div>
      ${tabelaAtivasInativas(S.contas, linha, `<th class="num">Ordem</th><th>Conta</th><th>Tipo</th><th class="num">Saldo inicial</th><th>Em</th><th>Situação</th>`, "Contas inativas", "não aparecem no painel nem nos formulários; o histórico continua guardado")}`;
  } else if (aba === "categorias") {
    const linha = c => `<tr data-act="cat-ed" data-id="${c.id}" style="cursor:pointer"${c.ativa ? "" : ` class="inativa"`}><td>${esc(c.nome)}</td><td>${esc(GRUPOS[c.grupo])}</td><td>${c.ativa ? `<span class="tag ok">Ativa</span>` : `<span class="tag bad">Inativa</span>`}</td></tr>`;
    html = `<div class="filters"><span class="hint">O grupo decide onde a categoria aparece na DRE.</span><span class="spacer"></span><button class="btn pri" data-act="cat-ed">+ Categoria</button></div>
      ${tabelaAtivasInativas(S.categorias, linha, `<th>Categoria</th><th>Grupo</th><th>Situação</th>`, "Categorias inativas", "não aparecem nos formulários; lançamentos antigos continuam na DRE")}`;
  } else if (aba === "usuarios") {
    const ms = await q(sb.from("membros").select("*").order("criado_em"));
    html = `<div class="box">Para criar um usuário: no Supabase, <b>Authentication › Users › Add user</b> (e-mail + senha). Ele aparece aqui <b>inativo</b>; ative e escolha o papel. O cadastro público deve ficar <b>desligado</b>.</div>
      <div class="tw"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Ativo</th><th>Código (2FA)</th></tr></thead><tbody>
      ${ms.map(m => `<tr data-act="membro-ed" data-id="${m.id}" style="cursor:pointer"><td>${esc(m.nome)}</td><td>${esc(m.email)}</td><td>${esc(PAPEIS[m.papel])}</td><td>${m.ativo ? `<span class="tag ok">Ativo</span>` : `<span class="tag idle">Inativo</span>`}</td><td>${m.exige_mfa ? "Exigido" : `<span class="tag warn">Não exigido</span>`}</td></tr>`).join("")}</tbody></table></div>`;
    S.membros = ms;
  } else if (aba === "fechamento") {
    const cfg = await q(sb.from("config").select("*").eq("chave", "bloqueado_ate").maybeSingle());
    const b = cfg && cfg.valor;
    html = `<div class="card"><h2>Fechamento de mês</h2><p>Depois de conferir o caixa com o extrato, feche o mês: ninguém mais consegue criar, alterar ou apagar lançamentos com data até o fim desse mês (nem estornos).</p>
      <p>Situação atual: ${b ? `<b>fechado até ${dt(b)}</b>` : "<b>nenhum mês fechado</b>"}</p>
      <div class="filters"><button class="btn pri" data-act="fechar-ate" data-v="${fimMes(addMes(inicioMes(hoje()), -1))}">Fechar até ${esc(mesTxt(addMes(inicioMes(hoje()), -1)))}</button>
      <button class="btn" data-act="fechar-ate" data-v="${fimMes(S.mes)}">Fechar até ${esc(mesTxt(S.mes))}</button>
      ${b ? `<button class="btn danger" data-act="fechar-ate" data-v="">Reabrir tudo</button>` : ""}</div></div>`;
  } else if (aba === "auditoria") {
    const au = await q(sb.from("auditoria").select("*").order("em", { ascending: false }).limit(300));
    S.audit = au;
    html = `<p class="hint">Últimas 300 alterações. Ninguém consegue apagar este registro.</p><div class="tw"><table><thead><tr><th>Quando</th><th>Quem</th><th>Tabela</th><th>Operação</th><th>Registro</th></tr></thead><tbody>
      ${au.map((a, k) => `<tr data-act="audit-ver" data-k="${k}" style="cursor:pointer"><td>${new Date(a.em).toLocaleString("pt-BR")}</td><td>${esc(a.email || "sistema")}</td><td>${esc(a.tabela)}</td><td>${esc(a.operacao)}</td><td class="mono trunc">${esc(a.registro)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  pg.innerHTML = `<div class="grid"><div class="chips">${abas.map(([k, t]) => `<button class="chip${aba === k ? " on" : ""}" data-act="chip" data-k="cfg" data-v="${k}">${t}</button>`).join("")}</div>${html}</div>`;
};
function tabelaAtivasInativas(lista, linha, ths, tituloInat, dica) {
  const at = lista.filter(x => x.ativa), inat = lista.filter(x => !x.ativa);
  let h = `<div class="tw"><table><thead><tr>${ths}</tr></thead><tbody>${at.map(linha).join("") || `<tr><td colspan="9" class="empty">Nenhuma ativa.</td></tr>`}</tbody></table></div>`;
  if (inat.length) h += `<h3 style="margin-top:8px;color:var(--bad)">${esc(tituloInat)} (${inat.length})</h3><p class="hint">${esc(dica)}. Clique para reativar ou excluir.</p>
    <div class="tw inativas"><table><thead><tr>${ths}</tr></thead><tbody>${inat.map(linha).join("")}</tbody></table></div>`;
  return h;
}
async function excluirCadastro(tabela, id, nome, recarregar) {
  if (!(await confirmar("Excluir", `Excluir <b>${esc(nome)}</b> definitivamente?`, "Excluir"))) return;
  try {
    await q(sb.from(tabela).delete().eq("id", id));
    await recarregar(); toast("Excluído."); render();
  } catch (e) {
    if (e && (e.code === "23503" || /foreign key|violates/i.test(e.message || ""))) toast(`"${nome}" já tem lançamentos ou aluguéis ligados e não pode ser excluída. Desmarque "Ativa" para escondê-la.`, true);
    else falha(e);
  }
}
const recarregarContas = async () => { S.contas = await q(sb.from("contas").select("*").order("ordem").order("nome")); };
const recarregarCategorias = async () => { S.categorias = await q(sb.from("categorias").select("*").order("grupo").order("nome")); };
ACT["conta-ed"] = el => {
  const c = S.contas.find(x => x.id === el.dataset.id) || { tipo: "banco", saldo_inicial: 0, data_saldo: hoje().slice(0, 4) + "-01-01", ativa: true, ordem: S.contas.length + 1 };
  modal({ titulo: c.id ? "Conta" : "Nova conta", corpo: `
    <label class="fl"><span>Nome</span><input name="nome" value="${esc(c.nome || "")}" required></label>
    <div class="row"><label class="fl"><span>Tipo</span><select name="tipo">${opt("caixa", "Caixa (dinheiro)", c.tipo === "caixa")}${opt("banco", "Banco", c.tipo === "banco")}${opt("outro", "Outro", c.tipo === "outro")}</select></label>
    <label class="fl"><span>Ordem</span><input type="number" name="ordem" value="${c.ordem}"></label></div>
    <div class="row"><label class="fl"><span>Saldo inicial</span><input name="saldo" inputmode="decimal" value="${n2(c.saldo_inicial)}"></label>
    <label class="fl"><span>Na data</span><input type="date" name="data" value="${c.data_saldo}" required></label></div>
    <label class="chk"><input type="checkbox" name="ativa" ${c.ativa ? "checked" : ""}> Ativa</label>
    <p class="hint">Lançamentos antes da data do saldo inicial não entram no saldo da conta. Uma conta já usada não pode ser excluída: desmarque "Ativa" para escondê-la.</p>`,
    extra: c.id ? `<button type="button" class="btn danger left" data-del>Excluir</button>` : "",
    aoAbrir: (f, d) => { const b = $("[data-del]", d); if (b) b.addEventListener("click", () => { d.close(); excluirCadastro("contas", c.id, c.nome, recarregarContas); }); },
    salvar: async f => {
      const d = { nome: f.nome.value.trim(), tipo: f.tipo.value, ordem: +f.ordem.value || 0, saldo_inicial: parseMoney(f.saldo.value) || 0, data_saldo: f.data.value, ativa: f.ativa.checked };
      if (c.id) await q(sb.from("contas").update(d).eq("id", c.id)); else await q(sb.from("contas").insert(d));
      await recarregarContas(); toast("Salvo."); render();
    } });
};
ACT["cat-ed"] = el => {
  const c = S.categorias.find(x => x.id === el.dataset.id) || { grupo: "despesa", ativa: true };
  modal({ titulo: c.id ? "Categoria" : "Nova categoria", corpo: `
    <label class="fl"><span>Nome</span><input name="nome" value="${esc(c.nome || "")}" required></label>
    <label class="fl"><span>Grupo</span><select name="grupo">${Object.entries(GRUPOS).map(([k, v]) => opt(k, v, c.grupo === k)).join("")}</select></label>
    <label class="chk"><input type="checkbox" name="ativa" ${c.ativa ? "checked" : ""}> Ativa (aparece nos formulários)</label>
    <p class="hint">Uma categoria já usada não pode ser excluída: desmarque "Ativa" para escondê-la.</p>`,
    extra: c.id ? `<button type="button" class="btn danger left" data-del>Excluir</button>` : "",
    aoAbrir: (f, d) => { const b = $("[data-del]", d); if (b) b.addEventListener("click", () => { d.close(); excluirCadastro("categorias", c.id, c.nome, recarregarCategorias); }); },
    salvar: async f => {
      const d = { nome: f.nome.value.trim(), grupo: f.grupo.value, ativa: f.ativa.checked };
      if (c.id) await q(sb.from("categorias").update(d).eq("id", c.id)); else await q(sb.from("categorias").insert(d));
      await recarregarCategorias(); toast("Salvo."); render();
    } });
};
ACT["membro-ed"] = el => {
  const m = S.membros.find(x => x.id === el.dataset.id); const eu = m.id === S.user.id;
  modal({ titulo: m.email, corpo: `
    <label class="fl"><span>Nome</span><input name="nome" value="${esc(m.nome)}" required></label>
    <label class="fl"><span>Papel</span><select name="papel" ${eu ? "disabled" : ""}>${Object.entries(PAPEIS).map(([k, v]) => opt(k, v, m.papel === k)).join("")}</select></label>
    <label class="chk"><input type="checkbox" name="ativo" ${m.ativo ? "checked" : ""} ${eu ? "disabled" : ""}> Acesso liberado</label>
    <label class="chk"><input type="checkbox" name="mfa" ${m.exige_mfa ? "checked" : ""} ${eu ? "disabled" : ""}> Exigir código do aplicativo autenticador (recomendado)</label>
    <div class="box"><b>Papéis:</b> Administrador — tudo · Financeiro — aluguéis, caixa, imóveis e contratos · Recepção — só registra recebimentos e lançamentos no caixa da recepção · Somente leitura — consulta · Backup automático — usuário técnico do backup semanal.</div>
    ${eu ? `<p class="hint">Você não pode mudar o próprio papel ou acesso.</p>` : ""}`,
    salvar: async f => {
      const d = { nome: f.nome.value.trim() };
      if (!eu) Object.assign(d, { papel: f.papel.value, ativo: f.ativo.checked, exige_mfa: f.mfa.checked });
      await q(sb.from("membros").update(d).eq("id", m.id)); toast("Salvo."); render();
    } });
};
ACT["fechar-ate"] = async el => {
  const v = el.dataset.v;
  if (!(await confirmar(v ? "Fechar mês" : "Reabrir", v ? `Bloquear lançamentos até <b>${dt(v)}</b>?` : "Liberar alterações em todos os meses?"))) return;
  await q(sb.from("config").upsert({ chave: "bloqueado_ate", valor: v })); toast("Feito."); render();
};
ACT["audit-ver"] = el => {
  const a = S.audit[+el.dataset.k];
  const diff = [];
  const A = a.antes || {}, D = a.depois || {};
  new Set([...Object.keys(A), ...Object.keys(D)]).forEach(k => { if (JSON.stringify(A[k]) !== JSON.stringify(D[k]) && !["atualizado_em"].includes(k)) diff.push(`<tr><td class="mono">${esc(k)}</td><td>${esc(A[k] == null ? "" : JSON.stringify(A[k]))}</td><td>${esc(D[k] == null ? "" : JSON.stringify(D[k]))}</td></tr>`); });
  modal({ titulo: `${a.operacao} em ${a.tabela}`, largo: true, semOk: true, corpo: `<p class="hint">${new Date(a.em).toLocaleString("pt-BR")} · ${esc(a.email || "sistema")}</p><div class="tw"><table><thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead><tbody>${diff.join("")}</tbody></table></div>` });
};

/* =====================================================================
   PÁGINA: BACKUP
   ===================================================================== */
const TABELAS_BKP = ["config", "contas", "categorias", "imoveis", "contratos", "reajustes", "cobrancas", "lancamentos", "mapa_mensal"];
const ORDEM_PK = { config: "chave", contratos: "codigo", mapa_mensal: "competencia" };
PAGES.backup = async pg => {
  const cfg = await q(sb.from("config").select("*").eq("chave", "ultimo_backup").maybeSingle());
  const ub = cfg ? new Date(cfg.valor) : null, dias = ub ? Math.floor((Date.now() - ub) / 86400000) : null;
  pg.innerHTML = `<div class="grid">
    <div class="card"><div class="card-h"><h2>Backup manual</h2>${ub ? `<span class="tag ${dias > 7 ? "bad" : "ok"}">último: ${ub.toLocaleDateString("pt-BR")} (${dias} dia${dias === 1 ? "" : "s"})</span>` : `<span class="tag bad">nenhum ainda</span>`}</div>
      <p>Baixa <b>todas as informações</b> em dois arquivos: um <b>.json</b> (para restaurar no sistema) e um <b>.xlsx</b> (para abrir no Excel). Faça pelo menos uma vez por semana e guarde fora do computador (pendrive, Google Drive, OneDrive).</p>
      <label class="fl" style="max-width:420px"><span>Senha para proteger o arquivo de restauração (opcional, recomendado)</span><input type="password" id="bkp-senha" autocomplete="new-password" placeholder="mínimo 10 caracteres"></label>
      <p class="hint">Com senha, o .json é criptografado (AES-256) e só abre com ela. <b>Guarde a senha</b> — sem ela o arquivo não pode ser recuperado. A planilha .xlsx não é protegida: guarde-a em local seguro.</p>
      <div class="filters" style="margin-top:10px"><button class="btn pri" data-act="bkp-baixar">Baixar backup agora</button><label class="chk"><input type="checkbox" id="bkp-xlsx" checked> incluir planilha Excel</label></div>
      <p class="hint" id="bkp-prog"></p>
    </div>
    <div class="card"><div class="card-h"><h2>Abrir / conferir um backup</h2><a class="btn pri" href="abrir-backup.html" target="_blank" rel="noopener">Abrir backup ↗</a></div>
      <p>Abre uma página separada para <b>conferir</b> um arquivo de backup (.json.enc ou .json) e transformá-lo em <b>planilha Excel</b>. Não altera nada no sistema e funciona mesmo se o Supabase estiver fora do ar.</p>
      <p class="hint">Dica: guarde também esse endereço nos favoritos. Em emergência, a página abre sem login.</p>
    </div>
    <div class="card"><div class="card-h"><h2>Backup automático semanal</h2></div>
      <p>Configurado à parte, no GitHub (veja o guia <b>LEIA-ME</b>): toda segunda e quinta-feira um robô baixa todos os dados, criptografa com a sua senha e guarda o arquivo por 90 dias. Os arquivos <b>.json.enc</b> gerados por ele podem ser restaurados abaixo.</p>
    </div>
    <div class="card"><div class="card-h"><h2>Restaurar / importar</h2></div>
      ${pode.admin() ? `<p>Envia um arquivo de backup (.json ou .json.enc) para o banco. Linhas que já existem são <b>atualizadas</b> com a versão do arquivo; nada é apagado. Use também para a <b>importação inicial</b> das planilhas.</p>
      <div class="filters"><input type="file" id="bkp-arq" accept=".json,.enc,application/json"><button class="btn" data-act="bkp-ler">Ler arquivo</button></div>
      <div id="bkp-res"></div>` : `<p class="muted">Somente o administrador pode restaurar.</p>`}
    </div>
  </div>`;
};
async function baixarTudo(prog) {
  const out = {};
  for (const t of TABELAS_BKP) { prog(`Lendo ${t}…`); out[t] = await fetchAll(t, b => b.order(ORDEM_PK[t] || "id").order(t === "mapa_mensal" ? "imovel_id" : (ORDEM_PK[t] || "id"))); }
  if (pode.admin()) { prog("Lendo membros…"); out.membros = await fetchAll("membros", b => b.order("id")); }
  return out;
}
ACT["bkp-baixar"] = async el => {
  const senha = $("#bkp-senha").value, prog = t => ($("#bkp-prog").textContent = t);
  if (senha && senha.length < 10) return toast("Use uma senha com pelo menos 10 caracteres.", true);
  el.disabled = true;
  try {
    const tab = await baixarTudo(prog);
    const pacote = { formato: "financeiro-imobiliaria", versao: 1, gerado_em: new Date().toISOString(), gerado_por: S.membro.email, tabelas: tab };
    const carimbo = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const json = JSON.stringify(pacote);
    if (senha) { prog("Criptografando…"); baixarArquivo(`backup-financeiro-${carimbo}.json.enc`, JSON.stringify(await cifrar(json, senha)), "application/octet-stream"); }
    else baixarArquivo(`backup-financeiro-${carimbo}.json`, json, "application/json");
    if ($("#bkp-xlsx").checked) {
      prog("Gerando planilha…");
      const abas = {};
      for (const [t, linhas] of Object.entries(tab)) abas[t] = linhas.map(l => { const o = {}; for (const [k, v] of Object.entries(l)) o[k] = v != null && typeof v === "object" ? JSON.stringify(v) : v; return o; });
      await baixarXLSX(`backup-financeiro-${carimbo}.xlsx`, abas);
    }
    await rpc("marcar_backup");
    prog(`Pronto: ${Object.entries(tab).map(([t, l]) => `${t} ${l.length}`).join(" · ")}`);
    toast("Backup baixado.");
  } catch (e) { falha(e); prog(""); }
  finally { el.disabled = false; }
};
let RESTAURO = null;
ACT["bkp-ler"] = async () => {
  const arq = $("#bkp-arq").files[0]; const res = $("#bkp-res");
  if (!arq) return toast("Escolha o arquivo.", true);
  let obj;
  try { obj = JSON.parse(await arq.text()); } catch (e) { return toast("Arquivo inválido (não é JSON).", true); }
  if (obj.formato === "financeiro-imobiliaria-cripto") {
    const senha = await pedirSenha(); if (!senha) return;
    try { obj = JSON.parse(await decifrar(obj, senha)); } catch (e) { return toast("Senha incorreta ou arquivo corrompido.", true); }
  }
  if (obj.formato !== "financeiro-imobiliaria" || !obj.tabelas) return toast("Este arquivo não é um backup deste sistema.", true);
  RESTAURO = obj;
  const tabs = TABELAS_BKP.filter(t => Array.isArray(obj.tabelas[t]) && obj.tabelas[t].length);
  res.innerHTML = `<div class="box" style="margin-top:12px"><b>Arquivo de ${esc(obj.gerado_em ? new Date(obj.gerado_em).toLocaleString("pt-BR") : "?")}</b>${obj.origem ? " · " + esc(obj.origem) : ""}<br>
    ${tabs.map(t => `${t}: <b>${obj.tabelas[t].length}</b>`).join(" · ")}</div>
    <div class="box warn" style="margin-top:8px">As linhas do arquivo vão <b>sobrescrever</b> as do banco que tiverem o mesmo identificador. Linhas criadas depois do backup são mantidas. Faça um backup do estado atual antes.</div>
    <div class="filters" style="margin-top:8px"><input id="bkp-conf" placeholder='digite RESTAURAR' style="border:1px solid var(--line);border-radius:6px;padding:6px 10px"><button class="btn danger" data-act="bkp-restaurar">Restaurar agora</button></div><p class="hint" id="bkp-rprog"></p>`;
};
ACT["bkp-restaurar"] = async el => {
  if ($("#bkp-conf").value.trim().toUpperCase() !== "RESTAURAR") return toast('Digite RESTAURAR para confirmar.', true);
  const prog = t => ($("#bkp-rprog").textContent = t);
  el.disabled = true;
  try {
    for (const t of TABELAS_BKP) {
      const linhas = RESTAURO.tabelas[t]; if (!Array.isArray(linhas) || !linhas.length) continue;
      for (let i = 0; i < linhas.length; i += 500) {
        prog(`${t}: ${Math.min(i + 500, linhas.length)} de ${linhas.length}…`);
        await rpc("restaurar_tabela", { p_tabela: t, p_linhas: linhas.slice(i, i + 500) });
      }
    }
    prog("Restauração concluída.");
    await carregarBase(); toast("Dados restaurados.");
  } catch (e) { falha(e); prog("Parou com erro: " + erroMsg(e)); }
  finally { el.disabled = false; }
};
function pedirSenha() {
  return new Promise(res => {
    let v = null;
    modal({ titulo: "Arquivo protegido", corpo: `<label class="fl"><span>Senha do backup</span><input type="password" name="s" required></label>`, ok: "Abrir", salvar: async f => { v = f.s.value; } });
    $("#dlg").addEventListener("close", () => res(v), { once: true });
  });
}

/* ---------- criptografia (AES-256-GCM + PBKDF2) — mesmo formato do backup automático ---------- */
const b64 = buf => { let s = ""; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function chave(senha, salt, iter) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function cifrar(texto, senha) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iter = 310000;
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chave(senha, salt, iter), new TextEncoder().encode(texto));
  return { formato: "financeiro-imobiliaria-cripto", v: 1, kdf: "PBKDF2-SHA256", iter, salt: b64(salt), iv: b64(iv), dados: b64(ct) };
}
async function decifrar(o, senha) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(o.iv) }, await chave(senha, unb64(o.salt), o.iter), unb64(o.dados));
  return new TextDecoder().decode(pt);
}

/* ---------------- início ---------------- */
(async () => {
  if (!CFG.SUPABASE_URL || /SEU-PROJETO/.test(CFG.SUPABASE_URL)) {
    mostrar("login"); $("#login-sub").textContent = "Configure o arquivo config.js com a URL e a chave do seu projeto Supabase."; return;
  }
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return mostrar("login");
    await posLogin();
  } catch (e) { console.error(e); mostrar("login"); }
})();

})();
