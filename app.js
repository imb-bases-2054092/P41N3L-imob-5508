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
const STATUS_IMV = { ALG: ["Alugado", "info"], LVR: ["Livre", "ok"], OCP: ["Ocupado", "warn"], INTV: ["Inativo", "bad"] };
const catPor = id => S.categorias.find(c => c.id === id) || {};
const contaPor = id => S.contas.find(c => c.id === id) || {};

async function carregarBase() {
  const [contas, cats, imv, padroes] = await Promise.all([
    q(sb.from("contas").select("*").order("ordem").order("nome")),
    q(sb.from("categorias").select("*").order("grupo").order("nome")),
    fetchAll("imoveis", b => b.order("endereco").order("id")),
    q(sb.from("config").select("chave,valor").like("chave", "grade.%"))
  ]);
  S.contas = contas; S.categorias = cats; setImoveis(imv);
  S.gradePadrao = {}; padroes.forEach(r => { try { S.gradePadrao[r.chave.slice(6)] = JSON.parse(r.valor); } catch (e) { /* ignora */ } });
  sb.rpc("garantir_mapa_mes").then(() => {}, () => {}); // foto automática do mapa do mês
}
const soMinhasContas = l => S.papel === "recepcao" ? l.filter(s => s.tipo === "caixa") : l;
const COLL = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
function setImoveis(list) { list.sort((a, b) => COLL.compare(a.endereco, b.endereco)); S.imoveis = list; S.imovelPor = {}; list.forEach(i => (S.imovelPor[i.id] = i)); }
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
  dre: "Resultado (DRE)", indicadores: "Indicadores", devedores: "Devedores (ex-locatários)", imoveis: "Imóveis (mapa do aluguel)", contratos: "Contratos", backup: "Backup", config: "Configurações" };
const SEM_MES = ["atrasados", "contratos", "backup", "config", "devedores"];

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
  S.page = p; S.redesenhar = null; fecharPop();
  $$("#nav a").forEach(x => x.classList.toggle("on", x.dataset.p === p));
  $("#titulo").textContent = TITULOS[p];
  $("#mes-sel").hidden = SEM_MES.includes(p);
  $("#mes-txt").textContent = p === "dre" ? "ano " + S.mes.slice(0, 4) : mesTxt(S.mes);
  faixaTempo();
  document.body.classList.remove("nav-open");
  render();
}
// Cada tela é montada fora da página e só entra se ainda for a tela pedida
// (evita que uma tela lenta sobrescreva outra quando se troca de menu rápido).
S.rtok = 0;
function setRd(pg, fn) { if (pg.dataset.tok === String(S.rtok)) S.redesenhar = fn; }
async function render() {
  const tok = ++S.rtok, real = $("#page"), tmp = document.createElement("div");
  tmp.dataset.tok = String(tok);
  real.classList.add("loading");
  try {
    await PAGES[S.page](tmp);
    if (tok !== S.rtok) return;
    real.replaceChildren(...tmp.childNodes);
    requestAnimationFrame(ajustarAlturas);
  } catch (e) {
    if (tok !== S.rtok) return;
    falha(e); real.innerHTML = `<div class="card empty">Não foi possível carregar: ${esc(erroMsg(e))}</div>`;
  } finally { if (tok === S.rtok) real.classList.remove("loading"); }
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
ACT.chip = el => { S.f[el.dataset.k] = el.dataset.v; if (S.redesenhar) { S.redesenhar(); requestAnimationFrame(ajustarAlturas); } else render(); };
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
function modal({ titulo, corpo, ok = "Salvar", salvar, extra = "", largo = false, xl = false, semOk = false, aoAbrir }) {
  const d = $("#dlg");
  d.style.width = xl ? "min(1180px, calc(100vw - 32px))" : largo ? "min(900px, calc(100vw - 32px))" : "";
  d.classList.toggle("xl", !!xl);
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
  if (c.devedor_id && !c.data_pagamento) return "devedor";
  if (c.data_pagamento) {
    if (+c.valor_pago < devido(c) - 0.005) return "parcial";
    if (precisaRepasse(c)) return "pago";
    return "quitado";
  }
  return c.vencimento < hoje() ? "atrasado" : "aberto";
}
function precisaRepasse(c) { return c.data_pagamento && !c.repasse_data && r2(+c.valor_pago - +(c.taxa_valor || 0)) > 0; }
const ST_COB = { aberto: ["A vencer", "idle"], atrasado: ["Atrasado", "bad"], parcial: ["Pago parcial", "warn"], pago: ["A repassar", "info"], quitado: ["Concluído", "ok"], devedor: ["Em devedores", "idle"] };
function tagCob(c) { const s = stCob(c); const [t, k] = ST_COB[s]; return `<span class="tag ${k}">${t}</span>`; }

/* =====================================================================
   PÁGINA: PAINEL
   ===================================================================== */
PAGES.painel = async pg => {
  const ini = addMes(S.mes, -11), fim = fimMes(S.mes);
  const tarefas = [
    rpc("resumo_lancamentos", { p_ini: ini, p_fim: fim }),
    fetchAll("cobrancas", b => b.eq("competencia", S.mes).order("id"), "id,valor,acrescimos,descontos,valor_pago,data_pagamento,vencimento,taxa_valor,repasse_data"),
    fetchAll("cobrancas", b => b.is("data_pagamento", null).is("devedor_id", null).lt("vencimento", hoje()).order("id"), "id,imovel_id,valor,acrescimos,descontos"),
    rpc("saldos_contas", { p_ate: fim < hoje() ? fim : hoje() }),
    q(sb.from("reajustes").select("id,competencia,valor_novo,imovel_id").is("aplicado_em", null).lte("competencia", S.mes)),
    q(sb.from("config").select("chave,valor")),
    S.papel === "recepcao" ? Promise.resolve([]) :
      q(sb.from("contratos").select("codigo,endereco,locatario,termino").eq("situacao", "ATIVO").gte("termino", hoje()).lte("termino", iso(new Date(Date.now() + 60 * 86400000))).order("termino"))
  ];
  tarefas.push(S.papel === "recepcao" ? Promise.resolve([]) : q(sb.from("devedores").select("valor_total,valor_pago").in("situacao", ["EM ABERTO", "ACORDO"])));
  const [res, cobMes, atras, saldosTodos, reaj, cfg, vencendo, devs] = await Promise.all(tarefas);
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
  const terceiros = saldos.reduce((a, s) => a + +s.terceiros, 0), socio = saldos.reduce((a, s) => a + +(s.socio || 0), 0);
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
  if (devs.length) alertas.push(["", `${devs.length} ex-locatário(s) devedor(es) com saldo de ${brl(devs.reduce((a, d) => a + +d.valor_total - +d.valor_pago, 0))}.`, "#devedores", "Ver devedores"]);
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
          <div><span class="muted">Desse total, é dos proprietários</span><span class="num muted">${brl(terceiros - socio)}</span></div>
          ${socio ? `<div><span class="muted">… e particular do sócio</span><span class="num muted">${brl(socio)}</span></div>` : ""}
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
      const h = ev.target.closest("[data-tip]");
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
const COLS_COB = [
  { k: "sel", t: "Seleção", nf: true, fixo: true, th: `<input type="checkbox" data-sel-todos aria-label="Selecionar todos">`, html: c => `<input type="checkbox" data-sel="${c.id}" aria-label="Selecionar">` },
  { k: "vencimento", t: "Venc.", tipo: "data", html: c => `${dt(c.vencimento)}${stCob(c) === "atrasado" ? ` <span class="sub neg">${diasEntre(c.vencimento, hoje())} dias</span>` : ""}` },
  { k: "imovel", t: "Imóvel", v: c => (S.imovelPor[c.imovel_id] || {}).endereco || "?", cls: "trunc" },
  { k: "locatario", t: "Inquilino", cls: "trunc" },
  { k: "locador", t: "Proprietário", cls: "trunc" },
  { k: "devido", t: "Valor", tipo: "num", v: devido, html: c => `${n2(devido(c))}${+c.acrescimos || +c.descontos ? `<span class="sub">aluguel ${n2(c.valor)}</span>` : ""}` },
  { k: "taxa", t: "Taxa", tipo: "num", v: c => c.taxa_valor, html: c => c.taxa_valor != null ? n2(c.taxa_valor) : `<span class="muted">${n2(+c.taxa_adm_pct)}%</span>` },
  { k: "valor_pago", t: "Recebido", tipo: "num", html: c => c.data_pagamento ? `${n2(c.valor_pago)}<span class="sub" title="${esc(contaPor(c.conta_pgto_id).nome || "")}">${dt(c.data_pagamento)}</span>` : "" },
  { k: "data_pagamento", t: "Data receb.", tipo: "data", oculta: true },
  { k: "conta", t: "Conta receb.", v: c => contaPor(c.conta_pgto_id).nome || "", oculta: true },
  { k: "repasse_valor", t: "Repasse", tipo: "num", html: c => c.repasse_data ? `${n2(c.repasse_valor)}<span class="sub">${dt(c.repasse_data)}</span>` : "" },
  { k: "repasse_data", t: "Data repasse", tipo: "data", oculta: true },
  { k: "situacao", t: "Situação", f: c => ST_COB[stCob(c)][0], html: tagCob },
  { k: "carteira", t: "Carteira", f: c => CARTEIRAS[(S.imovelPor[c.imovel_id] || {}).carteira] || "", oculta: true },
  { k: "obs", t: "Observações", cls: "trunc", oculta: true },
  { k: "acoes", t: "Ações", nf: true, fixo: true, html: c => {
    let a = "";
    if (!c.data_pagamento && !c.devedor_id && pode.receber()) a += `<button class="btn sm pri" data-act="receber" data-id="${c.id}">Receber</button> `;
    if (precisaRepasse(c) && pode.editar()) a += `<button class="btn sm" data-act="repassar" data-id="${c.id}">Repassar</button> `;
    return `<span class="acts">${a}<button class="btn sm" data-act="cob-det" data-id="${c.id}" aria-label="Detalhes">⋯</button></span>`;
  } }
];
let COB_REAJ = [];
PAGES.alugueis = async pg => {
  COB = await fetchAll("cobrancas", b => b.eq("competencia", S.mes).order("vencimento").order("id"));
  COB_REAJ = pode.editar() ? await q(sb.from("reajustes").select("id").is("aplicado_em", null).lte("competencia", S.mes)) : [];
  setRd(pg, () => desenharAlugueis());
  desenharAlugueis(pg);
};
function desenharAlugueis(pg) {
  pg = pg || $("#page");
  const f = S.f.cob || "todos", busca = S.f.cobBusca || "";
  const conta = { todos: COB.length, aberto: 0, atrasado: 0, pago: 0, quitado: 0, parcial: 0, devedor: 0 };
  COB.forEach(c => conta[stCob(c)]++);
  let lista = COB.filter(c => f === "todos" || stCob(c) === f || (f === "aberto" && stCob(c) === "atrasado"));
  if (busca) { const b = norm(busca); lista = lista.filter(c => norm((S.imovelPor[c.imovel_id] || {}).endereco + " " + c.locatario + " " + c.locador).includes(b)); }
  const g = grade("alugueis", COLS_COB, lista, {
    sort: { k: "vencimento", dir: "asc" }, divisor: "vencimento",
    rodape: fl => `${fl.length} aluguéis · valor ${brl(fl.reduce((a, c) => a + devido(c), 0))} · recebido ${brl(fl.reduce((a, c) => a + (+c.valor_pago || 0), 0))} · taxa ${brl(fl.reduce((a, c) => a + (+c.taxa_valor || 0), 0))} · repassado ${brl(fl.reduce((a, c) => a + (+c.repasse_valor || 0), 0))}`
  });
  g.redesenhar = () => desenharAlugueis();
  const chips = [["todos", "Todos"], ["aberto", "Em aberto"], ["atrasado", "Atrasados"], ["parcial", "Parcial"], ["pago", "Repasse pendente"], ["quitado", "Concluídos"]];
  pg.innerHTML = `<div class="grid">
    ${!COB.length ? `<div class="card empty"><p>Os aluguéis de <b>${esc(mesTxt(S.mes))}</b> ainda não foram gerados.</p>
      ${pode.editar() ? `<p class="hint">O sistema cria uma cobrança para cada imóvel <b>alugado</b> no mapa, com o valor e o dia de vencimento cadastrados${COB_REAJ.length ? `, depois de aplicar <b>${COB_REAJ.length} reajuste(s) programado(s)</b>` : ""}.</p><button class="btn pri" data-act="gerar-cob">Gerar aluguéis de ${esc(mesTxt(S.mes))}</button>
      <p class="hint" style="margin-top:12px">Começando no meio do mês? Gere, filtre <b>Em aberto</b>, marque os que já foram pagos e use <b>Receber selecionados</b> para dar baixa de uma vez.</p>` : `<p class="hint">Peça ao financeiro para gerar.</p>`}</div>` : `
    <div class="filters">
      <div class="chips">${chips.map(([k, t]) => `<button class="chip${f === k ? " on" : ""}" data-act="chip" data-k="cob" data-v="${k}">${t}<span class="c">${k === "aberto" ? conta.aberto + conta.atrasado : conta[k]}</span></button>`).join("")}</div>
      <input type="search" placeholder="Buscar imóvel, locatário, locador…" value="${esc(busca)}" data-busca="cobBusca">
      <span class="spacer"></span>
      ${gradeBarra("alugueis")}
      ${pode.editar() ? `<button class="btn" data-act="gerar-cob" title="Inclui imóveis alugados que ainda não têm cobrança neste mês">Atualizar lista</button>` : ""}
      ${pode.receber() ? `<button class="btn" data-act="receber-lote">Receber selecionados</button>` : ""}
      ${pode.editar() ? `<button class="btn" data-act="repassar-lote">Repassar selecionados</button>` : ""}
      <button class="btn" data-act="xls-cob">Excel</button>
    </div>
    ${gradeHTML("alugueis")}`}
  </div>`;
  ligarBusca(pg); ligarSelecao(pg);
}
function ligarBusca(pg) {
  $$("[data-busca]", pg).forEach(inp => {
    let t; inp.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => {
      S.f[inp.dataset.busca] = inp.value;
      Promise.resolve(S.redesenhar ? S.redesenhar() : render()).then(() => { requestAnimationFrame(ajustarAlturas); const n = $(`[data-busca="${inp.dataset.busca}"]`); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } });
    }, 300); });
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
ACT["xls-cob"] = () => exportarGrade("alugueis", `alugueis-${S.mes.slice(0, 7)}.xlsx`, mesCurto(S.mes).replace("/", "-"));


/* =====================================================================
   PÁGINA: INADIMPLÊNCIA
   ===================================================================== */
let INAD = [], INAD_DEVS = [], INAD_CTTS = [];
const COLS_INAD = [
  { k: "imovel", t: "Imóvel", cls: "trunc" },
  { k: "locatario", t: "Locatário", cls: "trunc" },
  { k: "locador", t: "Locador", cls: "trunc" },
  { k: "meses", t: "Meses em aberto", v: x => x.meses.join(", "), html: x => x.meses.map(m => `<span class="tag bad">${m}</span>`).join(" ") },
  { k: "desde", t: "Desde", tipo: "data" },
  { k: "dias", t: "Dias", tipo: "num", int: true },
  { k: "total", t: "Total", tipo: "num", html: x => `<b class="neg">${n2(x.total)}</b>` },
  { k: "acoes", t: "Ações", nf: true, fixo: true, html: x => `<button class="btn sm" data-act="ir-mes" data-m="${x.cobs[0].competencia}">Abrir mês</button>` }
];
PAGES.atrasados = async pg => {
  const [cobs, devs, ctts] = await Promise.all([
    fetchAll("cobrancas", b => b.is("data_pagamento", null).is("devedor_id", null).lt("vencimento", hoje()).order("vencimento").order("id")),
    S.papel === "recepcao" ? [] : q(sb.from("devedores").select("valor_total,valor_pago").in("situacao", ["EM ABERTO", "ACORDO"])),
    S.papel === "recepcao" ? [] : q(sb.from("contratos").select("codigo,endereco,locatario,situacao,saldo_devedor,pendencias").or("situacao.eq.DÉBITO EM ABERTO,saldo_devedor.gt.0").order("codigo"))
  ]);
  const grupos = {};
  cobs.forEach(c => { (grupos[c.imovel_id] = grupos[c.imovel_id] || []).push(c); });
  INAD = Object.entries(grupos).map(([id, cs]) => ({
    id, imovel: (S.imovelPor[id] || {}).endereco || "?", locatario: cs[cs.length - 1].locatario, locador: cs[0].locador,
    meses: cs.map(c => mesCurto(c.competencia)), total: cs.reduce((a, c) => a + devido(c), 0), desde: cs[0].vencimento, dias: diasEntre(cs[0].vencimento, hoje()), cobs: cs
  }));
  INAD_DEVS = devs; INAD_CTTS = ctts;
  setRd(pg, () => desenharAtrasados());
  desenharAtrasados(pg);
};
function desenharAtrasados(pg) {
  pg = pg || $("#page");
  const total = INAD.reduce((a, x) => a + x.total, 0);
  const faixa = { "até 30 dias": 0, "31 a 60": 0, "61 a 90": 0, "mais de 90": 0 };
  INAD.forEach(x => { faixa[x.dias <= 30 ? "até 30 dias" : x.dias <= 60 ? "31 a 60" : x.dias <= 90 ? "61 a 90" : "mais de 90"] += x.total; });
  const g = grade("inad", COLS_INAD, INAD, { sort: { k: "dias", dir: "desc" }, vazio: "Nenhum aluguel em atraso. 🎉",
    rodape: fl => `${fl.length} imóveis · total ${brl(fl.reduce((a, x) => a + x.total, 0))}` });
  g.redesenhar = () => desenharAtrasados();
  const devs = INAD_DEVS, ctts = INAD_CTTS;
  pg.innerHTML = `<div class="grid">
    <div class="kpis">${kpi("Total em atraso", `<span class="neg">${brl(total)}</span>`, `${INAD.reduce((a, x) => a + x.cobs.length, 0)} aluguéis · ${INAD.length} imóveis`, true)}
      ${Object.entries(faixa).map(([k, v]) => kpi(k, brl(v), "")).join("")}</div>
    ${devs.length ? `<div class="alert bad"><span>Ex-locatários que saíram devendo: <b>${devs.length}</b>, saldo de <b>${brl(devs.reduce((a, d) => a + +d.valor_total - +d.valor_pago, 0))}</b>.</span><a class="btn sm" href="#devedores">Ver devedores</a></div>` : ""}
    <div class="filters"><span class="hint">Aluguéis vencidos sem recebimento, de todos os meses. Para dar baixa, abra o mês em "Aluguéis do mês".</span><span class="spacer"></span>${gradeBarra("inad")}<button class="btn" data-act="xls-inad">Excel</button></div>
    ${gradeHTML("inad")}
    ${ctts.length ? `<div class="card"><div class="card-h"><h2>Débitos registrados nos contratos</h2><span class="hint">importados da planilha de contratos</span></div><div class="tw"><table><thead><tr><th>Contrato</th><th>Imóvel</th><th>Locatário</th><th>Situação</th><th class="num">Saldo</th><th>Pendências</th></tr></thead><tbody>
      ${ctts.map(c => `<tr><td class="mono">${esc(c.codigo)}</td><td class="trunc">${esc(c.endereco)}</td><td class="trunc">${esc(c.locatario)}</td><td><span class="tag bad">${esc(c.situacao)}</span></td><td class="num">${c.saldo_devedor ? n2(c.saldo_devedor) : ""}</td><td class="trunc" title="${esc(c.pendencias)}">${esc(c.pendencias)}</td></tr>`).join("")}
    </tbody></table></div></div>` : ""}
  </div>`;
}
ACT["xls-inad"] = () => exportarGrade("inad", `inadimplencia-${hoje()}.xlsx`, "Inadimplencia");


/* =====================================================================
   PÁGINA: CAIXA E LANÇAMENTOS
   ===================================================================== */
let LANC = [];
const ORIGENS = { manual: "Manual", pagamento: "Recebimento de aluguel", taxa: "Taxa de administração", repasse: "Repasse", transferencia: "Transferência", devedor: "Pagamento de devedor" };
const COLS_LANC = [
  { k: "data", t: "Data", tipo: "data", html: l => `${dt(l.data)}${l.pago ? "" : ` <span class="tag warn">Previsto</span>`}` },
  { k: "descricao", t: "Descrição", cls: "trunc" },
  { k: "categoria", t: "Categoria", v: l => catPor(l.categoria_id).nome, cls: "trunc" },
  { k: "grupo", t: "Grupo", f: l => GRUPOS[catPor(l.categoria_id).grupo] || "" },
  { k: "conta", t: "Conta", v: l => contaPor(l.conta_id).nome || "" },
  { k: "entrada", t: "Entrada", tipo: "num", v: l => l.tipo === "entrada" ? +l.valor : null, html: l => l.tipo === "entrada" ? (l.afeta_caixa === false ? `<span class="muted" title="Lançamento interno: não mexe no saldo">(${n2(l.valor)})</span>` : `<span class="pos">${n2(l.valor)}</span>`) : "" },
  { k: "saida", t: "Saída", tipo: "num", v: l => l.tipo === "saida" ? +l.valor : null, html: l => l.tipo === "saida" ? (l.afeta_caixa === false ? `<span class="muted" title="Lançamento interno: não mexe no saldo">(${n2(l.valor)})</span>` : `<span class="neg">${n2(l.valor)}</span>`) : "" },
  { k: "situacao", t: "Situação", f: l => l.pago ? "Realizado" : "Previsto", oculta: true },
  { k: "documento", t: "Documento", oculta: true },
  { k: "imovel", t: "Imóvel", v: l => l.imovel_id ? (S.imovelPor[l.imovel_id] || {}).endereco : "", cls: "trunc", oculta: true },
  { k: "origem", t: "Origem", f: l => ORIGENS[l.origem] || l.origem, oculta: true },
  { k: "competencia", t: "Competência", f: l => mesCurto(l.competencia), v: l => l.competencia, oculta: true }
];
let CAIXA_SALDOS = { fim: [], ini: {} };
PAGES.caixa = async pg => {
  const fim = fimMes(S.mes);
  const [lanc, saldosFimT, saldosIniT] = await Promise.all([
    fetchAll("lancamentos", b => b.gte("data", S.mes).lte("data", fim).order("data").order("criado_em").order("id")),
    rpc("saldos_contas", { p_ate: fim }),
    rpc("saldos_contas", { p_ate: iso(new Date(+S.mes.slice(0, 4), +S.mes.slice(5, 7) - 1, 0)) })
  ]);
  LANC = lanc;
  CAIXA_SALDOS = { fim: soMinhasContas(saldosFimT), ini: Object.fromEntries(soMinhasContas(saldosIniT).map(s => [s.conta_id, +s.saldo])) };
  setRd(pg, () => desenharCaixa());
  desenharCaixa(pg);
};
function desenharCaixa(pg) {
  pg = pg || $("#page");
  const busca = S.f.lcBusca || "", tipo = S.f.lcTipo || "todos", internos = S.f.lcInt === "1";
  let lista = LANC.filter(l => (internos || l.afeta_caixa !== false) && (tipo === "todos" || l.tipo === tipo));
  if (busca) { const b = norm(busca); lista = lista.filter(l => norm(l.descricao + " " + l.documento + " " + catPor(l.categoria_id).nome).includes(b)); }
  const nInt = LANC.filter(l => l.afeta_caixa === false).length;
  const totFim = CAIXA_SALDOS.fim.reduce((a, x) => a + +x.saldo, 0), totIni = CAIXA_SALDOS.fim.reduce((a, x) => a + (CAIXA_SALDOS.ini[x.conta_id] || 0), 0);
  const g = grade("caixa", COLS_LANC, lista, {
    sort: { k: "data", dir: "asc" }, divisor: "data", cls: l => l.afeta_caixa === false ? "interno" : "", attr: l => `data-act="lanc-ed" data-id="${l.id}" style="cursor:pointer"`,
    rodape: fl => { const pg2 = fl.filter(l => l.pago), e = pg2.filter(l => l.tipo === "entrada").reduce((a, l) => a + +l.valor, 0), s = pg2.filter(l => l.tipo === "saida").reduce((a, l) => a + +l.valor, 0), pv = fl.filter(l => !l.pago);
      return `${fl.length} lançamentos · realizados: entradas <span class="pos">${brl(e)}</span> · saídas <span class="neg">${brl(s)}</span> · resultado <b>${brl(e - s)}</b>${pv.length ? ` · previstos: ${pv.length} (${brl(pv.reduce((a, l) => a + (l.tipo === "entrada" ? +l.valor : -l.valor), 0))})` : ""}`; }
  });
  g.redesenhar = () => desenharCaixa();
  pg.innerHTML = `<div class="grid">
    <div class="kpis">${CAIXA_SALDOS.fim.length > 1 ? kpi("Total em caixa (todas as contas)", brl(totFim), `início do mês: ${brl(totIni)}`, true) : ""}${CAIXA_SALDOS.fim.map(s => kpi(s.nome, brl(s.saldo), `início do mês: ${brl(CAIXA_SALDOS.ini[s.conta_id] || 0)}`)).join("")}</div>
    <div class="filters">
      <div class="chips">${[["todos", "Todos"], ["entrada", "Só entradas"], ["saida", "Só saídas"]].map(([k, t]) => `<button class="chip${tipo === k ? " on" : ""}" data-act="chip" data-k="lcTipo" data-v="${k}">${t}</button>`).join("")}</div>
      <input type="search" placeholder="Buscar descrição, documento, categoria…" value="${esc(busca)}" data-busca="lcBusca">
      ${nInt ? `<label class="chk" title="Taxas de administração retidas dos aluguéis: viram receita sem mexer no saldo das contas"><input type="checkbox" data-int ${internos ? "checked" : ""}> mostrar lançamentos internos (${nInt})</label>` : ""}
      <span class="spacer"></span>${gradeBarra("caixa")}
      ${pode.lancar() ? `<button class="btn pri" data-act="lanc-novo" data-tipo="entrada">+ Entrada</button><button class="btn pri" data-act="lanc-novo" data-tipo="saida">+ Saída</button>` : ""}
      ${pode.editar() ? `<button class="btn" data-act="transf">⇄ Transferência</button>` : ""}
      <button class="btn" data-act="xls-lanc">Excel</button>
    </div>
    ${gradeHTML("caixa")}
  </div>`;
  ligarBusca(pg);
  const ci = $("[data-int]", pg); if (ci) ci.addEventListener("change", () => { S.f.lcInt = ci.checked ? "1" : ""; desenharCaixa(); requestAnimationFrame(ajustarAlturas); });
}
const GRUPOS_TIPO = { entrada: ["receita", "terceiros_entrada"], saida: ["imposto", "custo", "despesa", "retirada", "terceiros_saida"] };
function formLanc(l, tipo) {
  const ro = l && (l.origem !== "manual" || !pode.editar());
  const soCaixa = S.papel === "recepcao";
  const cats = S.categorias.filter(c => (c.ativa || (l && c.id === l.categoria_id)) && GRUPOS_TIPO[tipo].includes(c.grupo));
  const porGrupo = GRUPOS_TIPO[tipo].map(g => `<optgroup label="${esc(GRUPOS[g])}">${cats.filter(c => c.grupo === g).map(c => opt(c.id, c.nome, l && l.categoria_id === c.id)).join("")}</optgroup>`).join("");
  const im = l && l.imovel_id ? S.imovelPor[l.imovel_id] : null;
  const dis = ro ? "disabled" : "";
  const msgOrigem = { pagamento: "Recebimento de aluguel: para corrigir, estorne na tela Aluguéis do mês.", taxa: "Lançamento interno (não mexe no saldo das contas): a taxa de administração sai da parte do proprietário e vira receita da imobiliária. Para corrigir, estorne o recebimento na tela Aluguéis do mês.", repasse: "Repasse ao proprietário: para corrigir, estorne na tela Aluguéis do mês.", devedor: "Pagamento de ex-locatário devedor: use os botões abaixo para excluir aqui ou corrigir na tela Devedores.", transferencia: "Transferência entre contas." };
  return `${l && l.origem !== "manual" ? `<div class="box">${esc(msgOrigem[l.origem] || "Lançamento automático.")}</div>` : ""}
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
  const l = LANC.find(x => x.id === el.dataset.id); if (!l) return;
  const editavel = pode.editar() && l.origem === "manual";
  let extra = "";
  if (pode.editar() && ["manual", "transferencia"].includes(l.origem)) extra = `<button type="button" class="btn danger left" data-del>Excluir</button>`;
  if (pode.editar() && l.origem === "devedor") extra = `<button type="button" class="btn danger left" data-est-dev>Excluir este pagamento</button><a class="btn left" href="#devedores">Abrir devedores</a>`;
  if (["pagamento", "taxa", "repasse"].includes(l.origem)) extra = `<button type="button" class="btn left" data-ir-cob>Abrir aluguéis de ${esc(mesCurto(l.competencia))}</button>`;
  if (!l.pago && pode.editar()) extra = `<button type="button" class="btn pri left" data-pagar>Marcar como ${l.tipo === "entrada" ? "recebido" : "pago"}</button>` + extra;
  modal({
    titulo: l.tipo === "entrada" ? "Entrada" : "Saída", corpo: formLanc(l, l.tipo), semOk: !editavel, extra,
    salvar: async f => { const u = lerLanc(f, l.tipo); delete u.tipo; await q(sb.from("lancamentos").update(u).eq("id", l.id)); toast("Salvo."); render(); },
    aoAbrir: (f, d) => {
      const b = $("[data-del]", d); if (b) b.addEventListener("click", async () => {
        d.close();
        if (!(await confirmar("Excluir lançamento", l.origem === "transferencia" ? "Excluir a transferência (as duas pontas)?" : "Excluir este lançamento?", "Excluir"))) return;
        try {
          if (l.origem === "transferencia" && l.transferencia_id) await q(sb.from("lancamentos").delete().eq("transferencia_id", l.transferencia_id));
          else await q(sb.from("lancamentos").delete().eq("id", l.id));
          toast("Excluído."); render();
        } catch (e) { falha(e); }
      });
      const ed = $("[data-est-dev]", d); if (ed) ed.addEventListener("click", async () => {
        d.close();
        if (!(await confirmar("Excluir pagamento de devedor", `Excluir este pagamento de <b>${brl(l.valor)}</b>? Ele sai do caixa e volta a constar como saldo na lista de devedores.`, "Excluir"))) return;
        try { await rpc("estornar_lancamento_devedor", { p_lanc: l.id }); toast("Pagamento excluído e dívida atualizada."); render(); } catch (e) { falha(e); }
      });
      const pgb = $("[data-pagar]", d); if (pgb) pgb.addEventListener("click", () => { d.close(); setTimeout(() => ACT["lanc-pagar"]({ dataset: { id: l.id } }), 0); });
      const ic = $("[data-ir-cob]", d); if (ic) ic.addEventListener("click", () => { d.close(); S.mes = l.competencia; ssSet("mes", S.mes); S.f.cob = "todos"; S.f.cobBusca = (S.imovelPor[l.imovel_id] || {}).endereco || ""; location.hash = "#alugueis"; ir(); });
    }
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
ACT["xls-lanc"] = () => exportarGrade("caixa", `caixa-${S.mes.slice(0, 7)}.xlsx`, "Lancamentos");

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
   GRADE ESTILO EXCEL (ordenar, filtrar por coluna, escolher e arrastar colunas)
   Usada em todas as listas. Colunas: {k, t, tipo:'num'|'data', v, f, html, cls, oculta, nf (sem ordenar/filtrar), fixo (não some), th (cabeçalho)}
   ===================================================================== */
const G = {};
function grade(id, cols, linhas, opts) {
  let g = G[id];
  if (!g) {
    let salvo = null;
    try { salvo = JSON.parse(lsGet("grade." + id, "null")); } catch (e) { salvo = null; }
    if (!salvo) salvo = (S.gradePadrao || {})[id] || {}; // padrão definido pelo administrador para todos
    const todas = cols.map(c => c.k);
    const ordem = (salvo.ordem || []).filter(k => todas.includes(k));
    todas.forEach((k, i) => { if (!ordem.includes(k)) ordem.splice(Math.min(i, ordem.length), 0, k); });
    g = G[id] = { ordem, ocultas: Array.isArray(salvo.ocultas) ? salvo.ocultas.filter(k => todas.includes(k)) : cols.filter(c => c.oculta).map(c => c.k),
      sort: salvo.sort || (opts && opts.sort) || null, filtros: {}, lim: 300 };
  }
  g.cols = cols; g.linhas = linhas; g.opts = opts || {};
  g.ocultas = g.ocultas.filter(k => !(cols.find(c => c.k === k) || {}).fixo);
  return g;
}
function gradeSalvar(id) { const g = G[id]; lsSet("grade." + id, JSON.stringify({ ordem: g.ordem, ocultas: g.ocultas, sort: g.sort })); }
const gCol = (g, k) => g.cols.find(c => c.k === k);
function gVal(c, r) { return c.v ? c.v(r) : r[c.k]; }
function gTxt(c, r) {
  if (c.f) return c.f(r);
  const v = gVal(c, r);
  if (v == null || v === "") return "";
  if (c.tipo === "num") return c.int ? String(v) : n2(v);
  if (c.tipo === "data") return dt(v);
  return String(v).trim();
}
function gFiltrar(g, exceto) {
  const ativos = Object.entries(g.filtros).filter(([k]) => k !== exceto && gCol(g, k));
  if (!ativos.length) return g.linhas;
  return g.linhas.filter(r => ativos.every(([k, set]) => set.has(gTxt(gCol(g, k), r))));
}
function gOrdenar(g, lista) {
  if (!g.sort) return lista;
  const c = gCol(g, g.sort.k); if (!c || c.nf) return lista;
  const dir = g.sort.dir === "desc" ? -1 : 1;
  return lista.slice().sort((a, b) => {
    const x = gVal(c, a), y = gVal(c, b);
    const vx = x == null || x === "", vy = y == null || y === "";
    if (vx || vy) return vx === vy ? 0 : vx ? 1 : -1;
    if (c.tipo === "num") return (x - y) * dir;
    return COLL.compare(String(x), String(y)) * dir;
  });
}
function gradeHTML(id) {
  const g = G[id];
  const vis = g.ordem.filter(k => !g.ocultas.includes(k)).map(k => gCol(g, k)).filter(Boolean);
  const filtradas = gOrdenar(g, gFiltrar(g));
  g.filtradas = filtradas;
  const th = c => {
    if (c.nf) return `<th draggable="true" data-gk="${c.k}" data-g="${id}" class="${c.tipo === "num" ? "num" : ""}">${c.th || esc(c.t)}</th>`;
    const s = g.sort && g.sort.k === c.k ? (g.sort.dir === "asc" ? " ▲" : " ▼") : "";
    return `<th draggable="true" data-gk="${c.k}" data-g="${id}" class="${c.tipo === "num" ? "num" : ""}" title="${esc(c.dica || "Clique para ordenar · arraste para mudar a ordem")}">
      <span class="gh" data-act="g-sort" data-g="${id}" data-k="${c.k}">${esc(c.t)}${s}</span><button type="button" class="gf${g.filtros[c.k] ? " on" : ""}" data-act="g-filtro" data-g="${id}" data-k="${c.k}" aria-label="Filtrar ${esc(c.t)}">▾</button></th>`;
  };
  const td = (c, r) => `<td class="${c.tipo === "num" ? "num " : ""}${c.cls || ""}">${c.html ? c.html(r) : esc(gTxt(c, r))}</td>`;
  // divisória discreta quando a lista está ordenada pela coluna de data indicada (ex.: um dia para o outro)
  const div = g.opts.divisor && g.sort && g.sort.k === g.opts.divisor ? gCol(g, g.opts.divisor) : null;
  let ant = null;
  const linhaHTML = r => {
    const cls = [];
    if (div) { const v = gVal(div, r); if (ant !== null && v !== ant) cls.push("novo-dia"); ant = v; }
    if (g.opts.cls) { const c = g.opts.cls(r); if (c) cls.push(c); }
    return `<tr${cls.length ? ` class="${cls.join(" ")}"` : ""} ${g.opts.attr ? g.opts.attr(r) : ""}>${vis.map(c => td(c, r)).join("")}</tr>`;
  };
  return `<div class="tw fixa"><table class="grade"><thead><tr>${vis.map(th).join("")}</tr></thead><tbody>
    ${filtradas.map(linhaHTML).join("") || `<tr><td colspan="${vis.length}" class="empty">${esc(g.opts.vazio || "Nada encontrado.")}</td></tr>`}
    </tbody>${g.opts.rodape ? `<tfoot><tr><td colspan="${vis.length}">${g.opts.rodape(filtradas)}</td></tr></tfoot>` : ""}</table></div>`;
}
function ajustarAlturas() {
  $$(".tw.fixa").forEach(el => {
    const outras = $$(".tw.fixa").length > 1 || el.closest("dialog");
    if (outras) { el.style.maxHeight = ""; return; }
    const r = el.getBoundingClientRect(), topo = r.top + window.scrollY;
    const resto = Math.max(0, document.documentElement.scrollHeight - (r.bottom + window.scrollY)); // o que vem abaixo da tabela
    el.style.maxHeight = Math.max(320, window.innerHeight - topo - resto - 4) + "px";
  });
}
window.addEventListener("resize", () => { clearTimeout(window.__alt); window.__alt = setTimeout(ajustarAlturas, 120); });
function gradeBarra(id) {
  const g = G[id], n = g ? Object.keys(g.filtros).length : 0;
  return `<button class="btn" data-act="g-cols" data-g="${id}" title="Escolher e ordenar colunas">☰ Colunas</button>${n ? `<button class="btn danger" data-act="g-limpar" data-g="${id}">Limpar filtros (${n})</button>` : ""}`;
}
function gRedesenhar(id) { const g = G[id]; if (g && g.redesenhar) { g.redesenhar(); requestAnimationFrame(ajustarAlturas); } }
ACT["g-sort"] = el => {
  const g = G[el.dataset.g], k = el.dataset.k;
  g.sort = !g.sort || g.sort.k !== k ? { k, dir: "asc" } : g.sort.dir === "asc" ? { k, dir: "desc" } : null;
  gradeSalvar(el.dataset.g); gRedesenhar(el.dataset.g);
};
ACT["g-mais"] = el => { G[el.dataset.g].lim += 500; gRedesenhar(el.dataset.g); };
ACT["g-limpar"] = el => { G[el.dataset.g].filtros = {}; gRedesenhar(el.dataset.g); };

// janelinha flutuante (filtro / colunas / calendário)
function pop(ancora, html, largura) {
  let p = $("#gpop");
  if (!p) { p = document.createElement("div"); p.id = "gpop"; p.className = "gpop"; document.body.appendChild(p); }
  p.innerHTML = html; p.hidden = false;
  const r = ancora.getBoundingClientRect();
  const w = Math.min(largura || 300, window.innerWidth - 16);
  p.style.width = w + "px";
  p.style.left = Math.max(8, Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - w - 8)) + "px";
  p.style.top = (r.bottom + window.scrollY + 4) + "px";
  return p;
}
function fecharPop() { const p = $("#gpop"); if (p) p.hidden = true; }
document.addEventListener("mousedown", ev => { const p = $("#gpop"); if (p && !p.hidden && !p.contains(ev.target) && !ev.target.closest("[data-act=g-filtro],[data-act=g-cols],[data-act=mes-cal]")) fecharPop(); });
document.addEventListener("keydown", ev => { if (ev.key === "Escape") fecharPop(); });

ACT["g-filtro"] = el => {
  const id = el.dataset.g, k = el.dataset.k, g = G[id], c = gCol(g, k);
  const base = gFiltrar(g, k), cont = new Map();
  base.forEach(r => { const t = gTxt(c, r); cont.set(t, (cont.get(t) || 0) + 1); });
  const vals = Array.from(cont.keys()).sort((a, b) => {
    if (a === "" || b === "") return a === "" ? 1 : -1;
    if (c.tipo === "num") return parseMoney(a) - parseMoney(b);
    if (c.tipo === "data") return a.split("/").reverse().join("").localeCompare(b.split("/").reverse().join(""));
    return a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });
  });
  const atual = g.filtros[k];
  const p = pop(el, `<div class="gp-h">${esc(c.t)}</div>
    <div class="gp-sort"><button type="button" class="btn sm" data-o="asc">${c.tipo === "num" ? "Menor → maior" : c.tipo === "data" ? "Mais antigo primeiro" : "A → Z"}</button><button type="button" class="btn sm" data-o="desc">${c.tipo === "num" ? "Maior → menor" : c.tipo === "data" ? "Mais novo primeiro" : "Z → A"}</button></div>
    <input type="search" placeholder="Pesquisar…" class="gp-busca">
    <label class="gp-tudo"><input type="checkbox" data-tudo> (Selecionar tudo)</label>
    <div class="gp-lista">${vals.map((v, i) => `<label data-txt="${esc(norm(v))}"><input type="checkbox" data-i="${i}" ${!atual || atual.has(v) ? "checked" : ""}> <span>${v === "" ? "<i>(Vazias)</i>" : esc(v)}</span><small>${cont.get(v)}</small></label>`).join("")}</div>
    <div class="gp-f"><button type="button" class="btn sm" data-limpa>Limpar filtro</button><button type="button" class="btn sm pri" data-ok>OK</button></div>`);
  const caixas = () => $$(".gp-lista input", p);
  const syncTudo = () => { const vis = caixas().filter(x => !x.closest("label").hidden); $("[data-tudo]", p).checked = vis.length && vis.every(x => x.checked); };
  syncTudo();
  $(".gp-busca", p).addEventListener("input", e => {
    const t = norm(e.target.value);
    caixas().forEach(x => { const l = x.closest("label"); l.hidden = !!t && !l.dataset.txt.includes(t); });
    if (t) caixas().forEach(x => (x.checked = !x.closest("label").hidden));
    syncTudo();
  });
  $("[data-tudo]", p).addEventListener("change", e => { caixas().filter(x => !x.closest("label").hidden).forEach(x => (x.checked = e.target.checked)); });
  p.querySelector(".gp-lista").addEventListener("change", syncTudo);
  $$("[data-o]", p).forEach(b => b.addEventListener("click", () => { g.sort = { k, dir: b.dataset.o }; gradeSalvar(id); fecharPop(); gRedesenhar(id); }));
  $("[data-limpa]", p).addEventListener("click", () => { delete g.filtros[k]; fecharPop(); gRedesenhar(id); });
  $("[data-ok]", p).addEventListener("click", () => {
    const sel = new Set(caixas().filter(x => x.checked).map(x => vals[+x.dataset.i]));
    if (sel.size === vals.length) delete g.filtros[k];
    else { if (atual) atual.forEach(v => { if (!cont.has(v)) sel.add(v); }); g.filtros[k] = sel; }
    fecharPop(); gRedesenhar(id);
  });
  setTimeout(() => $(".gp-busca", p).focus(), 20);
};
ACT["g-cols"] = el => {
  const id = el.dataset.g, g = G[id];
  const desenhar = () => {
    const p = pop(el, `<div class="gp-h">Colunas exibidas</div><p class="hint" style="margin:0 0 6px">Marque as que quer ver. Use as setas, ou arraste o título da coluna na tabela, para mudar a ordem.</p>
      <div class="gp-cols">${g.ordem.map((k, i) => { const c = gCol(g, k); if (!c) return ""; return `<div><label><input type="checkbox" data-k="${k}" ${g.ocultas.includes(k) ? "" : "checked"} ${c.fixo ? "disabled" : ""}> ${esc(c.t || c.k)}</label><span><button type="button" class="btn sm" data-up="${i}" ${i ? "" : "disabled"} aria-label="Subir">↑</button><button type="button" class="btn sm" data-dn="${i}" ${i < g.ordem.length - 1 ? "" : "disabled"} aria-label="Descer">↓</button></span></div>`; }).join("")}</div>
      <div class="gp-f">${pode.admin() ? `<button type="button" class="btn sm" data-todos title="Novos usuários (e quem clicar em Restaurar padrão) passam a ver as colunas nesta ordem">Salvar como padrão para todos</button>` : ""}<button type="button" class="btn sm" data-padrao>Restaurar padrão</button><button type="button" class="btn sm pri" data-fim>Fechar</button></div>`);
    $$("[data-k]", p).forEach(x => x.addEventListener("change", () => {
      g.ocultas = x.checked ? g.ocultas.filter(k => k !== x.dataset.k) : g.ocultas.concat(x.dataset.k);
      gradeSalvar(id); gRedesenhar(id);
    }));
    const mover = (i, d) => { const o = g.ordem; [o[i], o[i + d]] = [o[i + d], o[i]]; gradeSalvar(id); gRedesenhar(id); desenhar(); };
    $$("[data-up]", p).forEach(b => b.addEventListener("click", () => mover(+b.dataset.up, -1)));
    $$("[data-dn]", p).forEach(b => b.addEventListener("click", () => mover(+b.dataset.dn, 1)));
    $("[data-padrao]", p).addEventListener("click", () => {
      const pd = (S.gradePadrao || {})[id], todas = g.cols.map(c => c.k);
      if (pd && pd.ordem) { g.ordem = pd.ordem.filter(k => todas.includes(k)); todas.forEach((k, i) => { if (!g.ordem.includes(k)) g.ordem.splice(Math.min(i, g.ordem.length), 0, k); }); g.ocultas = (pd.ocultas || []).filter(k => todas.includes(k)); g.sort = pd.sort || g.opts.sort || null; }
      else { g.ordem = todas; g.ocultas = g.cols.filter(c => c.oculta).map(c => c.k); g.sort = g.opts.sort || null; }
      gradeSalvar(id); gRedesenhar(id); desenhar();
    });
    const tb = $("[data-todos]", p); if (tb) tb.addEventListener("click", async () => {
      try {
        const v = { ordem: g.ordem, ocultas: g.ocultas, sort: g.sort };
        await q(sb.from("config").upsert({ chave: "grade." + id, valor: JSON.stringify(v) }));
        (S.gradePadrao = S.gradePadrao || {})[id] = v; toast("Padrão de colunas salvo para todos os usuários.");
      } catch (e) { falha(e); }
    });
    $("[data-fim]", p).addEventListener("click", fecharPop);
  };
  desenhar();
};
let arrasto = null;
document.addEventListener("dragstart", ev => { const th = ev.target.closest && ev.target.closest("th[data-gk]"); if (!th) return; arrasto = { g: th.dataset.g, k: th.dataset.gk }; ev.dataTransfer.effectAllowed = "move"; try { ev.dataTransfer.setData("text/plain", th.dataset.gk); } catch (e) { /* ok */ } });
document.addEventListener("dragover", ev => { const th = ev.target.closest && ev.target.closest("th[data-gk]"); if (!th || !arrasto || th.dataset.g !== arrasto.g) return; ev.preventDefault(); $$("th.drop").forEach(x => x.classList.remove("drop")); th.classList.add("drop"); });
document.addEventListener("dragend", () => { arrasto = null; $$("th.drop").forEach(x => x.classList.remove("drop")); });
document.addEventListener("drop", ev => {
  const th = ev.target.closest && ev.target.closest("th[data-gk]"); if (!th || !arrasto || th.dataset.g !== arrasto.g) return;
  ev.preventDefault();
  const g = G[arrasto.g], o = g.ordem.filter(k => k !== arrasto.k);
  o.splice(o.indexOf(th.dataset.gk) + (g.ordem.indexOf(arrasto.k) < g.ordem.indexOf(th.dataset.gk) ? 1 : 0), 0, arrasto.k);
  g.ordem = o; gradeSalvar(arrasto.g); const id = arrasto.g; arrasto = null; gRedesenhar(id);
});
// caixa "selecionar todos" das grades com seleção
function ligarSelecao(pg) {
  $$("[data-sel-todos]", pg).forEach(t => t.addEventListener("change", () => $$("[data-sel]", pg).forEach(c => (c.checked = t.checked))));
}

/* =====================================================================
   SELETOR DE MÊS (calendário) e aviso de mês passado / futuro
   ===================================================================== */
ACT["mes-cal"] = el => {
  const dre = S.page === "dre";
  let ano = +S.mes.slice(0, 4);
  const atual = inicioMes(hoje());
  const desenhar = () => {
    const corpo = dre
      ? `<div class="cal-g anos">${Array.from({ length: 12 }, (_, i) => ano - 8 + i).map(a => `<button type="button" class="btn sm${a === +S.mes.slice(0, 4) ? " pri" : ""}${a === +atual.slice(0, 4) ? " hoje" : ""}" data-ano="${a}">${a}</button>`).join("")}</div>`
      : `<div class="cal-h"><button type="button" class="btn sm" data-ano-d="-1" aria-label="Ano anterior">‹</button><b>${ano}</b><button type="button" class="btn sm" data-ano-d="1" aria-label="Próximo ano">›</button></div>
         <div class="cal-g">${MES3.map((m, i) => { const c = ano + "-" + pad(i + 1) + "-01"; return `<button type="button" class="btn sm${c === S.mes ? " pri" : ""}${c === atual ? " hoje" : ""}${c < atual ? " pas" : c > atual ? " fut" : ""}" data-m="${c}">${m}</button>`; }).join("")}</div>`;
    const p = pop(el, `<div class="gp-h">${dre ? "Escolha o ano" : "Escolha o mês"}</div>${corpo}
      <div class="gp-f"><button type="button" class="btn sm" data-hoje>${dre ? "Ano atual" : "Mês atual"}</button></div>`, 280);
    $$("[data-ano-d]", p).forEach(b => b.addEventListener("click", () => { ano += +b.dataset.anoD; desenhar(); }));
    $$("[data-m]", p).forEach(b => b.addEventListener("click", () => { S.mes = b.dataset.m; ssSet("mes", S.mes); fecharPop(); ir(); }));
    $$("[data-ano]", p).forEach(b => b.addEventListener("click", () => { S.mes = b.dataset.ano + S.mes.slice(4); ssSet("mes", S.mes); fecharPop(); ir(); }));
    $("[data-hoje]", p).addEventListener("click", () => { S.mes = atual; ssSet("mes", S.mes); fecharPop(); ir(); });
  };
  desenhar();
};
ACT["mes-hoje"] = () => { S.mes = inicioMes(hoje()); ssSet("mes", S.mes); ir(); };
function tempoMes() {
  if (SEM_MES.includes(S.page)) return "";
  const atual = inicioMes(hoje());
  if (S.page === "dre") { const a = S.mes.slice(0, 4), b = atual.slice(0, 4); return a < b ? "passado" : a > b ? "futuro" : ""; }
  return S.mes < atual ? "passado" : S.mes > atual ? "futuro" : "";
}
function faixaTempo() {
  const t = tempoMes(), el = $("#faixa-tempo");
  document.body.dataset.tempo = t;
  el.hidden = !t;
  if (!t) { el.innerHTML = ""; return; }
  const nome = S.page === "dre" ? "ano " + S.mes.slice(0, 4) : mesTxt(S.mes);
  el.className = "faixa " + t;
  el.innerHTML = `<span>${t === "passado" ? "⏪ Período <b>PASSADO</b>" : "⏩ Período <b>FUTURO</b>"}</span><button class="btn sm" data-act="mes-hoje" title="${esc(nome)}">Voltar ${S.page === "dre" ? "ao ano atual" : "ao mês atual"}</button>`;
}

/* =====================================================================
   RESUMO DO MÊS (esperado × real) — usado no Mapa e em Indicadores
   ===================================================================== */
function resumoEsperado(linhas) {
  const r = { bruto: 0, adm: 0, proprio: 0, socio: 0, qtd: 0 };
  linhas.filter(i => i.status === "ALG").forEach(i => {
    const v = +i.valor || 0; r.qtd++; r.bruto += v;
    if (i.carteira === "proprio") r.proprio += v;
    else if (i.carteira === "socio") r.socio += v;
    else r.adm += v * (+i.taxa_adm || 0) / 100;
  });
  r.total = r.adm + r.proprio;
  return r;
}
function resumoReal(cobs) {
  const r = { bruto: 0, adm: 0, proprio: 0, socio: 0, qtd: 0, pagos: 0, tem: cobs.length > 0 };
  cobs.forEach(c => {
    r.qtd += +c.qtd; r.pagos += +c.pagos; r.bruto += +c.recebido;
    if (c.carteira === "proprio") r.proprio += +c.recebido;
    else if (c.carteira === "socio") r.socio += +c.recebido;
    else r.adm += +c.taxa;
  });
  r.total = r.adm + r.proprio;
  return r;
}
function cardsMes(esp, real, titulo) {
  const val = (t, v, cls) => `<span class="kt">${t}</span>${v == null ? `<i></i><b class="${cls}">—</b>` : `<i>R$</i><b class="${cls}">${n2(v)}</b>`}`;
  const linha = (k, l, sub, cls) => {
    const e = esp[k], rr = real.tem ? real[k] : null, def = rr == null ? null : r2(e - rr);
    return `<div class="kcard ${cls}"><div class="l">${esc(l)}</div>
      <div class="kg">${val("Esperado", e, "")}${val("Real", rr, "real")}${val("Defasagem", def, "defas")}</div>
      <div class="s">${rr == null ? "aluguéis do mês não gerados" : e ? Math.round(rr / e * 100) + "% do esperado" : ""}${sub ? " · " + esc(sub) : ""}</div></div>`;
  };
  return `<div class="kcards" aria-label="${esc(titulo || "Resumo do mês")}">
    ${linha("bruto", "Aluguel total da carteira (bruto)", esp.qtd + " alugados", "k-main")}
    ${linha("total", "Comissão total / líquido", "administração + próprios", "k-main")}
    ${linha("adm", "Comissão de administração", "", "k-sub")}
    ${linha("proprio", "Imóveis próprios (imobiliária)", "100% receita", "k-sub")}
    ${linha("socio", "Sócio Cilas (particular)", "não é receita", "k-sub")}
  </div>`;
}

/* =====================================================================
   PÁGINA: IMÓVEIS (mapa)
   ===================================================================== */
const CARTEIRAS = { administrado: "Administrado (de terceiros)", proprio: "Próprio da imobiliária", socio: "Particular do sócio" };
const CARTEIRA_CURTA = { administrado: "Terceiro", proprio: "Imob", socio: "Cilas" };
let IMV = { reajPor: {}, grupos: [], hist: null, cobs: [] };
S.liberado = {};
const reajTxt = i => (IMV.reajPor[i.id] || []).map(r => `${mesCurto(r.competencia)} → ${n2(r.valor_novo)}`).join(" · ");
function valorImvHTML(i) {
  if (i.valor == null || i.valor === "") return "";
  if (i.status === "ALG") return n2(i.valor);
  return `<span class="prev" title="Valor previsto (imóvel não está alugado)">${n2(i.valor)}</span>`;
}
const COLS_IMV = [
  { k: "status", t: "Situação", f: i => (STATUS_IMV[i.status] || [i.status])[0], html: i => `<span class="tag ${(STATUS_IMV[i.status] || ["", "idle"])[1]}">${(STATUS_IMV[i.status] || [i.status])[0]}</span>` },
  { k: "codigo_site", t: "Site", cls: "mono" },
  { k: "contrato_codigo", t: "Contrato", cls: "mono" },
  { k: "endereco", t: "Endereço", cls: "trunc" },
  { k: "tipo", t: "Tipo" },
  { k: "valor", t: "Aluguel", tipo: "num", html: valorImvHTML },
  { k: "locador", t: "Locador", cls: "trunc" },
  { k: "locatario", t: "Locatário", cls: "trunc" },
  { k: "data_entrada", t: "Entrada", tipo: "data" },
  { k: "dia_venc", t: "Dia", tipo: "num", int: true },
  { k: "reajuste", t: "Reajuste programado", v: i => (IMV.reajPor[i.id] || [{}])[0].competencia || null, f: reajTxt, html: i => reajTxt(i) ? `<span style="color:var(--warn)">${esc(reajTxt(i))}</span>` : "" },
  { k: "declarar_ir", t: "IR" },
  { k: "taxa_adm", t: "Taxa %", tipo: "num", oculta: true },
  { k: "carteira", t: "Carteira", f: i => CARTEIRA_CURTA[i.carteira] || "", dica: "Terceiro = administrado · Imob = próprio da imobiliária · Cilas = particular do sócio", oculta: true },
  { k: "grupo_locador", t: "Grupo do locador", f: i => i.grupo_locador || "(outros)", oculta: true },
  { k: "obs", t: "Observações", cls: "trunc", oculta: true }
];
PAGES.imoveis = async pg => {
  const mesAtual = inicioMes(hoje()), passado = S.mes < mesAtual;
  const [reaj, grupos, hist, cobs] = await Promise.all([
    q(sb.from("reajustes").select("imovel_id,competencia,valor_novo").is("aplicado_em", null).order("competencia")),
    q(sb.from("grupos_locador").select("*").order("ordem")),
    passado ? fetchAll("mapa_mensal", b => b.eq("competencia", S.mes).order("imovel_id")) : Promise.resolve(null),
    pode.editar() || S.papel === "leitura" ? rpc("resumo_cobrancas", { p_ini: S.mes, p_fim: S.mes }) : Promise.resolve([])
  ]);
  IMV.reajPor = {}; reaj.forEach(r => { (IMV.reajPor[r.imovel_id] = IMV.reajPor[r.imovel_id] || []).push(r); });
  IMV.grupos = grupos; IMV.cobs = cobs;
  IMV.hist = hist ? hist.map(h => Object.assign({}, S.imovelPor[h.imovel_id] || { endereco: "?" }, {
    status: h.status, valor: h.valor, locador: h.locador, locatario: h.locatario, taxa_adm: h.taxa_adm,
    carteira: h.carteira || (S.imovelPor[h.imovel_id] || {}).carteira || "administrado",
    data_entrada: null, contrato_codigo: "", dia_venc: null, _hist: true })).sort((a, b) => COLL.compare(a.endereco || "", b.endereco || "")) : null;
  setRd(pg, () => desenharImoveis());
  desenharImoveis(pg);
};
function desenharImoveis(pg) {
  pg = pg || $("#page");
  const mesAtual = inicioMes(hoje()), passado = S.mes < mesAtual, futuro = S.mes > mesAtual, lib = !!S.liberado[S.mes];
  const base = passado ? (IMV.hist || []) : S.imoveis;
  const f = S.f.imv || "todos", busca = S.f.imvBusca || "";
  const cont = { todos: base.length, ALG: 0, LVR: 0, OCP: 0, INTV: 0, reaj: 0 };
  base.forEach(i => { cont[i.status] = (cont[i.status] || 0) + 1; if (IMV.reajPor[i.id]) cont.reaj++; });
  let lista = base.filter(i => f === "todos" || (f === "reaj" ? !!IMV.reajPor[i.id] : i.status === f));
  if (f === "reaj" && S.f.imvAnt !== "reaj" && G.imoveis) G.imoveis.sort = { k: "reajuste", dir: "asc" }; // na ordem dos meses: nov, dez, jan…
  S.f.imvAnt = f;
  if (busca) { const b = norm(busca); lista = lista.filter(i => norm(i.endereco + " " + i.locador + " " + i.locatario + " " + i.codigo_site + " " + i.contrato_codigo).includes(b)); }
  const acaoLinha = i => {
    if (!pode.editar()) return `data-act="imv-ed" data-id="${i.id}"`;
    if (S.mes === mesAtual) return `data-act="imv-ed" data-id="${i.id}"`;
    if (!lib) return `data-act="imv-bloq"`;
    return passado ? `data-act="imv-hist-ed" data-id="${i.id}"` : `data-act="imv-ed" data-id="${i.id}"`;
  };
  const g = grade("imoveis", COLS_IMV, lista, {
    attr: i => acaoLinha(i) + ` style="cursor:pointer"`,
    rodape: fl => { const alg = fl.filter(i => i.status === "ALG"); return `${fl.length} imóveis · ${alg.length} alugados · aluguel ${brl(alg.reduce((a, i) => a + (+i.valor || 0), 0))}`; }
  });
  g.redesenhar = () => desenharImoveis();
  const chips = [["todos", "Todos", ""], ["ALG", "Alugados", "st-ALG"], ["LVR", "Livres", "st-LVR"], ["OCP", "Ocupados", "st-OCP"], ["INTV", "Inativos", "st-INTV"], ["reaj", "Reajuste programado", "st-REAJ"]];
  let aviso = "";
  if (passado && !(IMV.hist && IMV.hist.length)) aviso = `<div class="alert warn"><span>Não há mapa guardado de <b>${esc(mesTxt(S.mes))}</b>. A partir de agora o mapa de cada mês é guardado sozinho.</span></div>`;
  void futuro;
  const podeLib = pode.editar() && S.mes !== mesAtual && !(passado && !(IMV.hist && IMV.hist.length));
  pg.innerHTML = `<div class="grid">
    ${pode.editar() || S.papel === "leitura" ? cardsMes(resumoEsperado(base), resumoReal(IMV.cobs), "Resumo de " + mesTxt(S.mes)) : ""}
    ${aviso}
    <div class="filters">
      <div class="chips">${chips.map(([k, t, cls]) => `<button class="chip ${cls}${f === k ? " on" : ""}" data-act="chip" data-k="imv" data-v="${k}">${t}<span class="c">${cont[k] || 0}</span></button>`).join("")}</div>
      <input type="search" placeholder="Buscar endereço, locador, locatário…" value="${esc(busca)}" data-busca="imvBusca">
      <span class="spacer"></span>
      ${gradeBarra("imoveis")}
      ${podeLib ? (lib ? `<button class="btn" data-act="imv-trava" title="${passado ? "Alterações mudam só o histórico deste mês" : "Alterações valem para o cadastro atual"}">🔓 Edição liberada · bloquear</button>` : `<button class="btn" data-act="imv-libera">🔒 Liberar edição deste mês</button>`) : ""}
      ${pode.editar() && !passado ? `<button class="btn pri" data-act="imv-novo">+ Imóvel</button>` : ""}
      <button class="btn" data-act="xls-imv">Excel</button>
    </div>
    ${gradeHTML("imoveis")}
  </div>`;
  ligarBusca(pg);
}
ACT["imv-bloq"] = () => toast('Este mês não é o atual. Clique em "🔒 Liberar edição deste mês" para alterar.', true);
ACT["imv-libera"] = async () => {
  const passado = S.mes < inicioMes(hoje());
  if (!(await confirmar("Liberar edição", passado
    ? `Liberar alterações no mapa de <b>${esc(mesTxt(S.mes))}</b>?<br><br>As mudanças alteram apenas o <b>histórico desse mês</b> (como corrigir uma aba antiga do Excel). O cadastro atual dos imóveis não muda.`
    : `Liberar alterações estando em <b>${esc(mesTxt(S.mes))}</b> (mês futuro)?<br><br>As mudanças valem para o <b>cadastro atual</b> dos imóveis, a partir de agora.`, "Liberar"))) return;
  S.liberado[S.mes] = true; desenharImoveis();
};
ACT["imv-trava"] = () => { delete S.liberado[S.mes]; desenharImoveis(); };
ACT["imv-hist-ed"] = el => {
  const i = (IMV.hist || []).find(x => x.id === el.dataset.id); if (!i) return;
  modal({ titulo: "Histórico de " + mesTxt(S.mes), corpo: `<div class="box"><b>${esc(i.endereco)}</b><br>Alterando apenas o mapa guardado de ${esc(mesTxt(S.mes))}.</div>
      <div class="row"><label class="fl"><span>Situação</span><select name="status">${Object.entries(STATUS_IMV).map(([k, v]) => opt(k, v[0], i.status === k)).join("")}</select></label>
        <label class="fl"><span>Carteira</span><select name="carteira">${Object.entries(CARTEIRAS).map(([k, v]) => opt(k, v, i.carteira === k)).join("")}</select></label></div>
      <label class="fl"><span>Locador</span><input name="locador" value="${esc(i.locador || "")}"></label>
      <label class="fl"><span>Locatário</span><input name="locatario" value="${esc(i.locatario || "")}"></label>
      <div class="row"><label class="fl"><span>Aluguel</span><input name="valor" inputmode="decimal" value="${i.valor != null ? n2(i.valor) : ""}"></label>
        <label class="fl"><span>Taxa adm. %</span><input name="taxa" inputmode="decimal" value="${n2(i.taxa_adm)}"></label></div>`,
    salvar: async f => {
      const d = { status: f.status.value, carteira: f.carteira.value, locador: f.locador.value.trim(), locatario: f.locatario.value.trim(),
        valor: f.valor.value.trim() ? parseMoney(f.valor.value) : null, taxa_adm: parseMoney(f.taxa.value) };
      await q(sb.from("mapa_mensal").update(d).eq("competencia", S.mes).eq("imovel_id", i.id));
      toast("Histórico de " + mesTxt(S.mes) + " corrigido."); render();
    } });
};
function tiposImovel(atual) {
  const t = new Set(["Casa", "Apto", "Sala", "Salão", "Barracão", "C. Com.", "Terreno"]);
  S.imoveis.forEach(i => i.tipo && t.add(i.tipo)); if (atual) t.add(atual);
  return Array.from(t).sort((a, b) => COLL.compare(a, b));
}
function formImovel(i) {
  i = i || { status: "LVR", tipo: "Casa", taxa_adm: 10, carteira: "administrado" };
  const dis = pode.editar() ? "" : "disabled";
  const grupos = (IMV.grupos || []).map(g => g.nome);
  return `<div class="ficha-g">
      <label class="fl"><span>Situação</span><select name="status" ${dis}>${Object.entries(STATUS_IMV).map(([k, v]) => opt(k, v[0], i.status === k)).join("")}</select></label>
      <label class="fl"><span>Tipo</span><select name="tipo" ${dis}>${tiposImovel(i.tipo).map(t => opt(t, t, i.tipo === t)).join("")}</select></label>
      <label class="fl"><span>Código no site</span><input name="codigo_site" value="${esc(i.codigo_site || "")}" inputmode="numeric" ${dis}></label>
      <label class="fl"><span>Contrato</span><input name="contrato_codigo" value="${esc(i.contrato_codigo || "")}" placeholder="digite só os números: 26100" ${dis}></label>
      <label class="fl largo"><span>Endereço</span><input name="endereco" value="${esc(i.endereco || "")}" required ${dis}></label>
      <label class="fl"><span>Carteira</span><select name="carteira" ${dis}>${Object.entries(CARTEIRAS).map(([k, v]) => opt(k, v, (i.carteira || "administrado") === k)).join("")}</select></label>
      <label class="fl largo"><span>Locador (proprietário)</span><input name="locador" value="${esc(i.locador || "")}" list="dl-locadores" ${dis}></label>
      <label class="fl"><span>Grupo do locador</span><input name="grupo" list="dl-grupos" value="${esc(i.grupo_locador || "")}" placeholder="(outros locadores)" ${dis}
        title="Escolha um grupo da lista ou digite um nome novo. Vale para todos os imóveis deste locador."></label>
      <label class="fl largo"><span>Locatário (inquilino atual)</span><input name="locatario" value="${esc(i.locatario || "")}" ${dis}></label>
      <label class="fl"><span>${i.status === "ALG" ? "Aluguel" : "Aluguel previsto"}</span><input name="valor" inputmode="decimal" value="${i.valor != null ? n2(i.valor) : ""}" ${dis}></label>
      <label class="fl"><span>Taxa adm. %</span><input name="taxa_adm" inputmode="decimal" value="${n2(i.taxa_adm)}" ${dis}></label>
      <label class="fl"><span>Entrada do locatário</span><input type="date" name="data_entrada" value="${i.data_entrada || ""}" ${dis}></label>
      <label class="fl"><span>Dia venc.</span><input type="number" name="dia_venc" min="1" max="31" value="${i.dia_venc || ""}" ${dis} title="Preenchido sozinho com o dia da entrada (pode trocar)"></label>
      <label class="fl"><span>Declarar IR?</span><select name="declarar_ir" ${dis}>${opt("", "—", !i.declarar_ir)}${opt("Sim", "Sim", i.declarar_ir === "Sim")}${opt("Não", "Não", i.declarar_ir === "Não")}</select></label>
      <label class="fl largo2"><span>Observações</span><textarea name="obs" rows="2" ${dis}>${esc(i.obs || "")}</textarea></label>
    </div>
    <datalist id="dl-grupos">${grupos.map(g => `<option value="${esc(g)}">`).join("")}</datalist>
    <datalist id="dl-locadores">${Array.from(new Set(S.imoveis.map(x => x.locador).filter(Boolean))).sort((a, b) => COLL.compare(a, b)).map(l => `<option value="${esc(l)}">`).join("")}</datalist>
    <p class="hint">Carteira: <b>Administrado</b> = de terceiros (taxa normal) · <b>Próprio</b> = da imobiliária (100%) · <b>Particular do sócio</b> = 0%, dinheiro do sócio separado no caixa. O grupo vale para todos os imóveis do mesmo locador.</p>`;
}
function lerImovel(f) {
  const valor = f.valor.value.trim() ? parseMoney(f.valor.value) : null;
  const taxa = parseMoney(f.taxa_adm.value);
  if (taxa == null || taxa < 0 || taxa > 100) throw new Error("Taxa deve estar entre 0 e 100.");
  const d = { status: f.status.value, tipo: f.tipo.value || "Casa", codigo_site: f.codigo_site.value.trim(), endereco: f.endereco.value.trim(),
    carteira: f.carteira.value, locador: f.locador.value.trim(), locatario: f.locatario.value.trim(), valor, taxa_adm: taxa, dia_venc: +f.dia_venc.value || null,
    data_entrada: f.data_entrada.value || null, contrato_codigo: f.contrato_codigo.value.trim(), declarar_ir: f.declarar_ir.value, obs: f.obs.value.trim() };
  if (!d.endereco) throw new Error("Informe o endereço.");
  if (d.status === "ALG" && (!d.valor || !d.locatario)) throw new Error("Imóvel alugado precisa de locatário e valor.");
  if (d.contrato_codigo && !/^L\.\d{2}\.\d{3}$/.test(d.contrato_codigo)) throw new Error("Contrato no formato L.26.100 (digite só os números: 26100).");
  return d;
}
// grupo do locador escolhido no formulário (vale para todos os imóveis do mesmo locador)
async function salvarGrupo(f, antes) {
  const g = f.grupo.value.trim(), loc = f.locador.value.trim();
  if (g === (antes || "")) return;
  if (!loc) throw new Error("Informe o locador para escolher o grupo.");
  await rpc("definir_grupo_locador", { p_locador: loc, p_grupo: g });
}
function ligarCarteira(f) {
  f.carteira.addEventListener("change", () => { const t = { proprio: "100,00", socio: "0,00", administrado: "10,00" }[f.carteira.value]; if (t) f.taxa_adm.value = t; });
  mascaraContrato(f.contrato_codigo);
  // dia do vencimento = dia da entrada (salvo exceções: dá para trocar)
  let auto = f.data_entrada.value ? +f.data_entrada.value.slice(8, 10) : null;
  f.data_entrada.addEventListener("change", () => {
    if (!f.data_entrada.value) return;
    const dia = +f.data_entrada.value.slice(8, 10);
    if (!f.dia_venc.value || +f.dia_venc.value === auto) f.dia_venc.value = dia;
    auto = dia;
  });
  // grupo sugerido quando o locador já pertence a um grupo
  f.locador.addEventListener("change", () => { const g = (IMV.grupos || []).find(x => (x.locadores || []).includes(f.locador.value.trim())); if (g) f.grupo.value = g.nome; });
}
ACT["imv-novo"] = () => modal({ titulo: "Novo imóvel", xl: true, corpo: formImovel(), aoAbrir: f => ligarCarteira(f),
  salvar: async f => { await q(sb.from("imoveis").insert(lerImovel(f))); await salvarGrupo(f, ""); await recarregarImoveis(); toast("Imóvel cadastrado."); render(); } });
ACT["imv-ed"] = async el => {
  const i = S.imovelPor[el.dataset.id]; if (!i) return;
  const [reaj, hist, cobs] = await Promise.all([
    q(sb.from("reajustes").select("*").eq("imovel_id", i.id).order("competencia", { ascending: false })),
    q(sb.from("mapa_mensal").select("competencia,status,valor,locatario").eq("imovel_id", i.id).order("competencia", { ascending: false }).limit(14)),
    q(sb.from("cobrancas").select("competencia,vencimento,valor,acrescimos,descontos,valor_pago,data_pagamento,taxa_valor,repasse_data,locatario,devedor_id").eq("imovel_id", i.id).order("competencia", { ascending: false }).limit(12))
  ]);
  const saida = pode.editar() && i.status === "ALG" ? `<button type="button" class="btn left" data-saida>🚪 Registrar saída do locatário</button>` : "";
  const excluir = pode.admin() ? `<button type="button" class="btn danger left" data-del>Excluir</button>` : "";
  modal({
    titulo: i.endereco, xl: true, semOk: !pode.editar(), extra: saida + excluir,
    corpo: formImovel(i) + `
      <h3 style="margin-top:8px">Reajustes programados</h3>
      <div class="tw"><table><thead><tr><th>A partir de</th><th class="num">Novo valor</th><th>Situação</th><th></th></tr></thead><tbody>
        ${reaj.map(r => `<tr><td>${mesTxt(r.competencia)}</td><td class="num">${n2(r.valor_novo)}</td><td>${r.aplicado_em ? `<span class="tag ok">Aplicado</span>` : `<span class="tag warn">Pendente</span>`}</td><td class="acts">${pode.editar() && !r.aplicado_em ? `<button type="button" class="btn sm" data-reaj-del="${r.id}">Remover</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">Nenhum.</td></tr>`}
      </tbody></table></div>
      ${pode.editar() ? `<div class="row"><label class="fl"><span>Novo reajuste a partir de</span><input type="month" data-rj-mes value="${addMes(inicioMes(hoje()), 1).slice(0, 7)}"></label><label class="fl"><span>Novo valor</span><input data-rj-val inputmode="decimal"></label><label class="fl"><span>&nbsp;</span><button type="button" class="btn" data-reaj-add>Programar reajuste</button></label></div>` : ""}
      <h3 style="margin-top:8px">Últimos aluguéis</h3>
      <div class="tw"><table><thead><tr><th>Mês</th><th>Locatário</th><th class="num">Devido</th><th>Situação</th></tr></thead><tbody>
        ${cobs.map(c => `<tr><td>${mesCurto(c.competencia)}</td><td class="trunc">${esc(c.locatario)}</td><td class="num">${n2(devido(c))}</td><td>${tagCob(c)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">Nenhum.</td></tr>`}
      </tbody></table></div>
      <h3 style="margin-top:8px">Histórico do mapa</h3>
      <div class="tw"><table><thead><tr><th>Mês</th><th>Situação</th><th class="num">Valor</th><th>Locatário</th></tr></thead><tbody>
        ${hist.map(h => `<tr><td>${mesCurto(h.competencia)}</td><td><span class="tag ${(STATUS_IMV[h.status] || ["", "idle"])[1]}">${(STATUS_IMV[h.status] || [h.status])[0]}</span></td><td class="num">${h.valor != null ? n2(h.valor) : ""}</td><td class="trunc">${esc(h.locatario)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">Sem histórico.</td></tr>`}
      </tbody></table></div>`,
    salvar: async f => {
      const d = lerImovel(f);
      if (i.status === "ALG" && d.status !== "ALG") throw new Error('Para desocupar, use o botão "Registrar saída do locatário": assim ficam guardados a data de saída e se ele ficou devendo.');
      await q(sb.from("imoveis").update(d).eq("id", i.id)); await salvarGrupo(f, i.grupo_locador); await recarregarImoveis(); toast("Salvo."); render();
    },
    aoAbrir: (f, d) => {
      ligarCarteira(f);
      const sd = $("[data-saida]", d);
      if (sd) sd.addEventListener("click", () => { d.close(); setTimeout(() => abrirSaida(i), 0); });
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
function exportarGrade(id, nome, aba) {
  const g = G[id]; if (!g) return;
  const vis = g.ordem.filter(k => !g.ocultas.includes(k)).map(k => gCol(g, k)).filter(c => c && !c.nf);
  return baixarXLSX(nome, { [aba]: (g.filtradas || []).map(r => Object.fromEntries(vis.map(c => { const v = gVal(c, r); return [c.t, c.tipo === "num" ? (v == null || v === "" ? "" : +v) : gTxt(c, r)]; }))) });
}
ACT["xls-imv"] = () => exportarGrade("imoveis", `mapa-aluguel-${S.mes.slice(0, 7)}.xlsx`, "Mapa");

/* ---------- saída do locatário ---------- */
const ITENS_DIVIDA = ["Aluguel", "Água", "Energia", "Condomínio", "IPTU", "Pintura", "Reparos / danos", "Multa rescisória", "Limpeza", "Outros"];
function itensEditorHTML() {
  return `<datalist id="dl-itens">${ITENS_DIVIDA.map(t => `<option value="${t}">`).join("")}</datalist>
    <div class="itens" data-itens></div>
    <div class="chips rapidos"><span class="hint">Adicionar:</span>${ITENS_DIVIDA.map(t => `<button type="button" class="chip" data-item-rapido="${esc(t)}">+ ${esc(t)}</button>`).join("")}</div>`;
}
function ligarItens(d, itens, aoMudar) {
  const box = $("[data-itens]", d);
  const linha = it => {
    const div = document.createElement("div"); div.className = "item";
    div.innerHTML = `<input list="dl-itens" placeholder="Descrição (ex.: Pintura)" value="${esc(it.descricao || "")}" data-desc>
      <input inputmode="decimal" placeholder="Valor" value="${it.valor ? n2(it.valor) : ""}" data-val>
      <label class="chk est" title="Marque quando ainda não sabe o valor exato"><input type="checkbox" data-est ${it.estimado ? "checked" : ""}> estimado</label>
      <button type="button" class="btn sm" aria-label="Remover">✕</button>`;
    div.querySelector("button").addEventListener("click", () => { div.remove(); aoMudar && aoMudar(); });
    div.addEventListener("input", () => aoMudar && aoMudar());
    div.addEventListener("change", () => aoMudar && aoMudar());
    box.appendChild(div);
    return div;
  };
  (itens || []).forEach(linha);
  $$("[data-item-rapido]", d).forEach(b => b.addEventListener("click", () => { const div = linha({ descricao: b.dataset.itemRapido }); aoMudar && aoMudar(); div.querySelector("[data-val]").focus(); }));
  return () => $$(".item", box).map(x => ({ descricao: x.querySelector("[data-desc]").value.trim(), valor: parseMoney(x.querySelector("[data-val]").value), estimado: x.querySelector("[data-est]").checked }))
    .filter(x => x.descricao || x.valor).map(x => (x.estimado ? x : { descricao: x.descricao, valor: x.valor }));
}
function fmtTel(t) {
  const d = String(t || "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d[2]}.${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 9) return `${d[0]}.${d.slice(1, 5)}-${d.slice(5)}`;
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return d;
}
function mascaraTel(inp) {
  inp.addEventListener("input", () => {
    const d = inp.value.replace(/\D/g, "").slice(0, 11);
    let v = d;
    if (d.length > 2) v = `(${d.slice(0, 2)}) ` + (d.length === 11 ? `${d[2]}.${d.slice(3, 7)}-${d.slice(7)}` : d.length > 6 ? `${d.slice(2, 6)}-${d.slice(6)}` : d.slice(2));
    inp.value = v;
  });
}
const contatosTxt = cs => (cs || []).map(c => `${c.papel}: ${c.nome}${c.tel ? " · " + fmtTel(c.tel) : ""}${c.email ? " · " + c.email : ""}`).join("\n");
// termo aberto por cima de outro formulário: abre numa aba separada do diálogo atual
function abrirTermoJanela(tipo, codigo) {
  if (!(confirm("Abrir o termo? O formulário de saída será fechado (os dados digitados nele não são salvos)."))) return;
  $("#dlg").close(); setTimeout(() => abrirTermo(tipo, codigo), 0);
}
async function abrirSaida(i) {
  try {
    const [abs, ctt] = await Promise.all([
      q(sb.from("cobrancas").select("id,competencia,valor,acrescimos,descontos").eq("imovel_id", i.id).is("data_pagamento", null).is("devedor_id", null).order("competencia")),
      i.contrato_codigo ? q(sb.from("contratos").select("garantia,contatos").eq("codigo", i.contrato_codigo).maybeSingle()) : Promise.resolve(null)
    ]);
    let lerItens;
    const total = d => {
      const its = lerItens ? lerItens() : [];
      const cb = $$("[data-cob]:checked", d).map(x => abs.find(c => c.id === x.dataset.cob));
      const t = its.reduce((a, x) => a + (+x.valor || 0), 0) + cb.reduce((a, c) => a + devido(c), 0);
      $("[data-total]", d).textContent = brl(t) + (its.some(x => x.estimado) ? " (com valores estimados)" : "");
    };
    const contatos = (ctt && ctt.contatos) || [];
    modal({
      titulo: "Saída do locatário", largo: true, ok: "Registrar saída",
      corpo: `<div class="box"><b>${esc(i.endereco)}</b><br>Locatário: <b>${esc(i.locatario)}</b> · Locador: ${esc(i.locador)}<br>
          Contrato: ${esc(i.contrato_codigo || "—")} · Entrada: ${dt(i.data_entrada) || "—"} · Aluguel: ${brl(i.valor)}${ctt && ctt.garantia ? " · Garantia: " + esc(ctt.garantia) : ""}</div>
        <div class="row"><label class="fl"><span>Data de saída</span><input type="date" name="data" value="${hoje()}" required></label>
          <label class="fl"><span>O imóvel passa a ficar</span><select name="status">${opt("LVR", "Livre", true)}${opt("OCP", "Ocupado", false)}${opt("INTV", "Inativo", false)}</select></label></div>
        <div class="chips"><label class="chk"><input type="radio" name="deve" value="nao" checked> Saiu sem dever</label><label class="chk"><input type="radio" name="deve" value="sim"> Ficou devendo</label></div>
        <div data-divida hidden>
          <label class="fl"><span>Nome do devedor</span><input name="devedor" value="${esc(i.locatario)}"></label>
          ${abs.length ? `<h3 style="margin-top:10px">Aluguéis em aberto no sistema</h3><p class="hint">Marcados entram na dívida e saem da lista de inadimplência do mês.</p>
            ${abs.map(c => `<label class="chk"><input type="checkbox" data-cob="${c.id}" checked> Aluguel ${mesTxt(c.competencia)} — ${brl(devido(c))}</label>`).join("")}` : ""}
          <h3 style="margin-top:10px">Outros valores devidos</h3>
          <p class="hint">Não sabe o valor exato ainda? Coloque um valor aproximado e marque <b>estimado</b>: ele aparece como "a confirmar" na lista de devedores.</p>
          ${itensEditorHTML()}
          <div class="box" style="margin-top:8px">Total da dívida: <b data-total>R$ 0,00</b></div>
          ${contatos.length ? `<div class="box"><b>Contatos que irão para a lista de devedores</b> (do contrato):<br>${esc(contatosTxt(contatos)).replace(/\n/g, "<br>")}</div>` : `<p class="hint">Sem contatos no contrato: você pode incluir telefone e e-mail depois, na tela Devedores.</p>`}
          <label class="fl"><span>Observações (acordo, combinado…)</span><textarea name="obs"></textarea></label>
        </div>
        ${i.contrato_codigo ? `<div class="filters"><span class="hint">Termos deste contrato:</span><button type="button" class="btn sm" data-termo="entrega">🔑 Entrega de chaves</button><button type="button" class="btn sm" data-termo="caucao">💰 Devolução de caução</button></div>` : ""}
        <p class="hint">Ao registrar: o imóvel muda para a situação escolhida (o valor do aluguel fica como previsto), o contrato fica <b>Encerrado</b> — ou <b>Débito em aberto</b> se ficou devendo — e o devedor entra na lista de <b>Devedores</b> com os dados e contatos do contrato.</p>`,
      aoAbrir: (f, d) => {
        lerItens = ligarItens(d, [], () => total(d));
        $$("[data-termo]", d).forEach(b => b.addEventListener("click", () => abrirTermoJanela(b.dataset.termo, i.contrato_codigo)));
        $$("[name=deve]", d).forEach(r => r.addEventListener("change", () => { $("[data-divida]", d).hidden = f.deve.value !== "sim"; total(d); }));
        $$("[data-cob]", d).forEach(x => x.addEventListener("change", () => total(d)));
        total(d);
      },
      salvar: async f => {
        const deve = f.deve.value === "sim";
        let itens = [], cobsSel = [];
        if (deve) {
          const ruins = lerItens().filter(x => !x.descricao || !(x.valor > 0));
          if (ruins.length) throw new Error("Cada item precisa de descrição e valor (se não souber o exato, coloque um aproximado e marque 'estimado').");
          cobsSel = $$("[data-cob]:checked").map(x => x.dataset.cob);
          itens = abs.filter(c => cobsSel.includes(c.id)).map(c => ({ descricao: "Aluguel " + mesTxt(c.competencia), valor: devido(c) })).concat(lerItens());
          if (!itens.length) throw new Error('Informe o que ele ficou devendo, ou marque "Saiu sem dever".');
        }
        await rpc("registrar_saida", { p_imovel: i.id, p_data: f.data.value, p_devedor: deve ? f.devedor.value : null, p_itens: itens, p_obs: deve ? f.obs.value : "", p_cobrancas: cobsSel, p_status: f.status.value });
        await recarregarImoveis();
        toast(deve ? "Saída registrada e devedor incluído na lista." : "Saída registrada.");
        render();
      }
    });
  } catch (e) { falha(e); }
}

/* =====================================================================
   PÁGINA: DEVEDORES (ex-locatários)
   ===================================================================== */
const SIT_DEV = { "EM ABERTO": ["Em aberto", "bad", "Em aberto (ainda não combinou nada)"], "ACORDO": ["Acordo", "warn", "Acordo / parcelado"], "QUITADO": ["Quitado", "ok", "Quitado (pagou tudo)"], "PERDIDO": ["Saldo perdido", "idle", "Saldo perdido (desistido de cobrar)"] };
const addMesDia = (d, k) => { const a = new Date(+d.slice(0, 4), +d.slice(5, 7) - 1 + k, 1), ult = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate(); return iso(new Date(a.getFullYear(), a.getMonth(), Math.min(+d.slice(8, 10), ult))); };
// acompanhamento do acordo: parcelas pagas, atraso e próxima parcela
function acordoInfo(d) {
  const a = d.acordo;
  if (d.situacao !== "ACORDO" || !a || !(+a.parcelas > 0) || !(+a.valor_parcela > 0) || !a.primeiro_venc) return null;
  const n = +a.parcelas, vp = +a.valor_parcela, h = hoje();
  const datas = Array.from({ length: n }, (_, i) => addMesDia(a.primeiro_venc, i));
  const pago = (d.pagamentos || []).filter(p => !a.desde || p.data >= a.desde).reduce((s, p) => s + +p.valor, 0);
  const vencidas = datas.filter(x => x <= h).length, pagas = Math.min(n, Math.floor((pago + 0.01) / vp));
  const atraso = r2(Math.max(0, Math.min(vencidas * vp, n * vp) - pago));
  const prox = datas[pagas] || null;
  return { n, pagas, atraso, prox, txt: `${pagas}/${n} pagas · ${atraso > 0.009 ? "atrasado " + brl(atraso) : "em dia"}${prox ? " · próx. " + dt(prox) : ""}`, cls: atraso > 0.009 ? "bad" : "ok" };
}
let DEV = [];
const saldoDev = d => r2(+d.valor_total - +d.valor_pago);
const temEstimado = d => (d.itens || []).some(x => x.estimado);
const COLS_DEV = [
  { k: "devedor", t: "Devedor", cls: "trunc" },
  { k: "endereco", t: "Imóvel", cls: "trunc" },
  { k: "valor_total", t: "Dívida", tipo: "num", html: d => `${temEstimado(d) ? '<span class="tag warn est-tag" title="Há valores estimados (a confirmar)">≈</span> ' : ""}<b>${n2(d.valor_total)}</b>` },
  { k: "valor_pago", t: "Pago", tipo: "num", html: d => `<span class="pos">${n2(d.valor_pago)}</span>` },
  { k: "saldo", t: "Saldo", tipo: "num", v: saldoDev, html: d => `<b class="${saldoDev(d) > 0 && d.situacao !== "PERDIDO" ? "neg" : ""}">${n2(saldoDev(d))}</b>` },
  { k: "situacao", t: "Situação", f: d => (SIT_DEV[d.situacao] || [d.situacao])[0], html: d => `<span class="tag ${(SIT_DEV[d.situacao] || ["", "idle"])[1]}">${esc((SIT_DEV[d.situacao] || [d.situacao])[0])}</span>` },
  { k: "data_saida", t: "Saída", tipo: "data" },
  { k: "dias", t: "Dias", dica: "Dias desde a saída", tipo: "num", int: true, v: d => d.data_saida ? diasEntre(d.data_saida, hoje()) : null },
  { k: "acordo", t: "Acordo", v: d => { const a = acordoInfo(d); return a ? a.txt : ""; }, html: d => { const a = acordoInfo(d); return a ? `<span class="tag ${a.cls}">${esc(a.txt)}</span>` : ""; } },
  { k: "contrato_codigo", t: "Contrato", cls: "mono" },
  { k: "locador", t: "Locador", cls: "trunc" },
  { k: "data_entrada", t: "Entrada", tipo: "data" },
  { k: "confirmar", t: "A confirmar", f: d => temEstimado(d) ? "Sim" : "Não", oculta: true },
  { k: "itens", t: "Referente a", v: d => (d.itens || []).map(x => x.descricao + (x.estimado ? " (≈)" : "")).join(", "), cls: "trunc", oculta: true },
  { k: "contatos", t: "Contatos", v: d => (d.contatos || []).map(c => `${c.nome}${c.tel ? " " + fmtTel(c.tel) : ""}`).join(" · "), cls: "trunc", oculta: true },
  { k: "obs", t: "Observações", cls: "trunc", oculta: true }
];
PAGES.devedores = async pg => {
  DEV = await fetchAll("devedores", b => b.order("data_saida", { ascending: false }).order("id"));
  setRd(pg, () => desenharDevedores());
  desenharDevedores(pg);
};
function desenharDevedores(pg) {
  pg = pg || $("#page");
  const f = S.f.dev || "todos", busca = S.f.devBusca || "";
  const teste = { aberto: d => ["EM ABERTO", "ACORDO"].includes(d.situacao), "EM ABERTO": d => d.situacao === "EM ABERTO", ACORDO: d => d.situacao === "ACORDO", QUITADO: d => d.situacao === "QUITADO", PERDIDO: d => d.situacao === "PERDIDO", todos: () => true };
  let lista = DEV.filter(teste[f]);
  if (busca) { const b = norm(busca); lista = lista.filter(d => norm(d.devedor + " " + d.endereco + " " + d.locador + " " + d.contrato_codigo).includes(b)); }
  const abertos = DEV.filter(teste.aberto);
  const g = grade("devedores", COLS_DEV, lista, {
    attr: d => `data-act="dev-ed" data-id="${d.id}" style="cursor:pointer"`, sort: { k: "data_saida", dir: "desc" },
    rodape: fl => `${fl.length} devedores · dívida <b>${brl(fl.reduce((a, d) => a + +d.valor_total, 0))}</b> · pago <span class="pos">${brl(fl.reduce((a, d) => a + +d.valor_pago, 0))}</span> · saldo <b class="neg">${brl(fl.reduce((a, d) => a + saldoDev(d), 0))}</b>`
  });
  g.redesenhar = () => desenharDevedores();
  const chips = [["todos", "Todos", "", ""], ["EM ABERTO", "Em aberto", "st-INTV", "Ainda não pagou nem combinou nada"], ["ACORDO", "Acordos em andamento", "st-OCP", "Negociou e está pagando em parcelas"],
    ["PERDIDO", "Saldo perdido", "", "Vocês desistiram de cobrar: sai da cobrança, mas o histórico fica"], ["QUITADO", "Quitados", "st-LVR", "Pagou tudo (muda sozinho)"]];
  const acordos = DEV.filter(d => d.situacao === "ACORDO"), atrasados = acordos.filter(d => { const a = acordoInfo(d); return a && a.atraso > 0.009; });
  pg.innerHTML = `<div class="grid">
    <div class="kpis">${kpi("Saldo a receber", `<span class="neg">${brl(abertos.reduce((a, d) => a + saldoDev(d), 0))}</span>`, `${abertos.length} devedores em aberto ou em acordo`, true)}
      ${kpi("Acordos em andamento", String(acordos.length), atrasados.length ? `${atrasados.length} com parcela atrasada` : "todos em dia")}
      ${kpi("Já recebido", `<span class="pos">${brl(DEV.reduce((a, d) => a + +d.valor_pago, 0))}</span>`, "de todas as dívidas")}
      ${kpi("Com valor a confirmar", String(abertos.filter(temEstimado).length), "dívidas com valor estimado")}</div>
    <div class="filters">
      <div class="chips">${chips.map(([k, t, cls, dica]) => `<button class="chip ${cls}${f === k ? " on" : ""}" data-act="chip" data-k="dev" data-v="${k}"${dica ? ` title="${esc(dica)}"` : ""}>${t}<span class="c">${DEV.filter(teste[k]).length}</span></button>`).join("")}</div>
      <input type="search" placeholder="Buscar nome, imóvel, contrato…" value="${esc(busca)}" data-busca="devBusca">
      <span class="spacer"></span>${gradeBarra("devedores")}
      ${pode.editar() ? `<button class="btn pri" data-act="dev-novo">+ Devedor antigo</button>` : ""}<button class="btn" data-act="xls-dev">Excel</button>
    </div>
    ${gradeHTML("devedores")}
  </div>`;
  ligarBusca(pg);
}
function contatosEditorHTML() { return `<div class="contatos" data-contatos></div><button type="button" class="btn sm" data-ct-add>+ Contato</button>`; }
function ligarContatos(d, lista) {
  const box = $("[data-contatos]", d);
  const linha = c => {
    const div = document.createElement("div"); div.className = "contato";
    div.innerHTML = `<select data-p>${["Locatário", "Fiador", "Outro"].map(p => opt(p, p, (c.papel || "Locatário") === p)).join("")}</select>
      <input data-n placeholder="Nome" value="${esc(c.nome || "")}"><input data-t placeholder="(19) 9.0000-0000" value="${esc(fmtTel(c.tel))}" inputmode="tel"><input data-e placeholder="E-mail" value="${esc(c.email || "")}" inputmode="email">
      <button type="button" class="btn sm" aria-label="Remover">✕</button>`;
    div.querySelector("button").addEventListener("click", () => div.remove());
    mascaraTel(div.querySelector("[data-t]"));
    box.appendChild(div);
  };
  (lista || []).forEach(linha);
  $("[data-ct-add]", d).addEventListener("click", () => linha({}));
  return () => $$(".contato", box).map(x => ({ papel: x.querySelector("[data-p]").value, nome: x.querySelector("[data-n]").value.trim(), tel: x.querySelector("[data-t]").value.replace(/\D/g, ""), email: x.querySelector("[data-e]").value.trim() })).filter(c => c.nome || c.tel || c.email);
}
function formDevedor(d) {
  const novo = !d; d = d || { situacao: "EM ABERTO", itens: [] };
  return `${novo ? `<label class="fl"><span>Imóvel (do mapa, opcional)</span><input name="imovel" list="dl-imv" placeholder="Digite e escolha o endereço"></label>${imovelDatalist()}` : ""}
    <div class="row"><label class="fl"><span>Devedor</span><input name="devedor" value="${esc(d.devedor || "")}" required></label>
      <label class="fl"><span>Situação</span><select name="situacao">${Object.entries(SIT_DEV).map(([k, v]) => opt(k, v[2], d.situacao === k)).join("")}</select></label></div>
    <fieldset class="ficha-b" data-acordo ${d.situacao === "ACORDO" ? "" : "hidden"}><legend>Acordo de pagamento</legend><div class="ficha-g">
      <label class="fl"><span>Nº de parcelas</span><input type="number" name="ac_parcelas" min="1" max="120" value="${(d.acordo && d.acordo.parcelas) || ""}"></label>
      <label class="fl"><span>Valor da parcela</span><input name="ac_valor" inputmode="decimal" value="${d.acordo && d.acordo.valor_parcela ? n2(d.acordo.valor_parcela) : ""}"></label>
      <label class="fl"><span>1º vencimento</span><input type="date" name="ac_venc" value="${(d.acordo && d.acordo.primeiro_venc) || ""}"></label>
      <label class="fl"><span>Acordo feito em</span><input type="date" name="ac_desde" value="${(d.acordo && d.acordo.desde) || hoje()}"></label></div>
      <p class="hint">Os pagamentos registrados a partir da data do acordo contam como parcelas. A lista mostra quantas foram pagas, se há atraso e a próxima data.</p></fieldset>
    <div class="row"><label class="fl"><span>Endereço</span><input name="endereco" value="${esc(d.endereco || "")}"></label>
      <label class="fl"><span>Contrato</span><input name="contrato" value="${esc(d.contrato_codigo || "")}" placeholder="L.25.001"></label></div>
    <div class="row"><label class="fl"><span>Locador</span><input name="locador" value="${esc(d.locador || "")}"></label>
      <label class="fl"><span>Entrada</span><input type="date" name="entrada" value="${d.data_entrada || ""}"></label>
      <label class="fl"><span>Saída</span><input type="date" name="saida" value="${d.data_saida || ""}"></label></div>
    <h3 style="margin-top:6px">Referente a</h3>${itensEditorHTML()}
    <div class="box" style="margin-top:8px">Total da dívida: <b data-total>${brl(d.valor_total || 0)}</b></div>
    <h3 style="margin-top:6px">Contatos para cobrança</h3>${contatosEditorHTML()}
    <label class="fl"><span>Observações / histórico de cobrança</span><textarea name="obs">${esc(d.obs || "")}</textarea></label>`;
}
function lerDevedor(f, lerItens, lerContatos) {
  const itens = lerItens();
  if (itens.some(x => !x.descricao || !(x.valor > 0))) throw new Error("Cada item precisa de descrição e valor (se não souber o exato, coloque um aproximado e marque 'estimado').");
  if (!itens.length) throw new Error("Informe ao menos um item da dívida.");
  let acordo = null;
  if (f.situacao.value === "ACORDO") {
    acordo = { parcelas: +f.ac_parcelas.value || null, valor_parcela: parseMoney(f.ac_valor.value), primeiro_venc: f.ac_venc.value || null, desde: f.ac_desde.value || hoje() };
    if (!acordo.parcelas || !acordo.valor_parcela || !acordo.primeiro_venc) throw new Error("Acordo: informe o nº de parcelas, o valor da parcela e o 1º vencimento.");
  }
  return { devedor: f.devedor.value.trim(), endereco: f.endereco.value.trim(), contrato_codigo: f.contrato.value.trim(), contatos: lerContatos(),
    locador: f.locador.value.trim(), data_entrada: f.entrada.value || null, data_saida: f.saida.value || null, situacao: f.situacao.value, itens, obs: f.obs.value.trim(), acordo };
}
const somaItens = its => r2(its.reduce((a, x) => a + (+x.valor || 0), 0));
function ligarAcordo(f, d, saldo) {
  const box = $("[data-acordo]", d);
  f.situacao.addEventListener("change", () => { box.hidden = f.situacao.value !== "ACORDO"; });
  f.ac_parcelas.addEventListener("change", () => { const n = +f.ac_parcelas.value; if (n > 0 && !f.ac_valor.value) f.ac_valor.value = n2(r2(saldo() / n)); });
}
ACT["dev-novo"] = () => {
  let lerItens, lerContatos;
  modal({ titulo: "Cadastrar devedor antigo", largo: true, corpo: formDevedor(null),
    aoAbrir: (f, d) => {
      lerItens = ligarItens(d, [{}], () => ($("[data-total]", d).textContent = brl(somaItens(lerItens()))));
      lerContatos = ligarContatos(d, []); ligarAcordo(f, d, () => somaItens(lerItens()));
      f.imovel.addEventListener("change", () => { const im = imovelPorEndereco(f.imovel.value); if (im) { f.endereco.value = im.endereco; if (!f.locador.value) f.locador.value = im.locador; } });
    },
    salvar: async f => {
      const d = lerDevedor(f, lerItens, lerContatos); const im = f.imovel.value.trim() ? imovelPorEndereco(f.imovel.value) : null;
      d.imovel_id = im ? im.id : null;
      if (d.contrato_codigo && !d.contatos.length) { const c = await q(sb.from("contratos").select("contatos").eq("codigo", d.contrato_codigo).maybeSingle()); if (c) d.contatos = c.contatos || []; }
      await q(sb.from("devedores").insert(d)); toast("Devedor cadastrado."); render();
    } });
};
ACT["dev-ed"] = el => {
  const dv = DEV.find(x => x.id === el.dataset.id); if (!dv) return;
  let lerItens, lerContatos;
  const pags = dv.pagamentos || [];
  modal({ titulo: dv.devedor, largo: true, semOk: !pode.editar(),
    extra: (pode.editar() ? `<button type="button" class="btn pri left" data-pagar>+ Registrar pagamento</button>` : "") + (pode.admin() ? `<button type="button" class="btn danger left" data-del>Excluir</button>` : ""),
    corpo: `<div class="kpis">${kpi("Dívida", `<b>${brl(dv.valor_total)}</b>`)}${kpi("Pago", `<span class="pos">${brl(dv.valor_pago)}</span>`)}${kpi("Saldo", `<span class="${saldoDev(dv) > 0 ? "neg" : ""}">${brl(saldoDev(dv))}</span>`, "", true)}</div>
      <h3>Pagamentos recebidos</h3>
      <div class="tw"><table><thead><tr><th>Data</th><th class="num">Valor</th><th>Conta</th><th>Obs.</th><th></th></tr></thead><tbody>
        ${pags.map(p => `<tr><td>${dt(p.data)}</td><td class="num pos">${n2(p.valor)}</td><td>${esc(contaPor(p.conta_id).nome || "")}</td><td>${esc(p.obs || "")}</td><td class="acts">${pode.editar() ? `<button type="button" class="btn sm" data-cor="${esc(p.id)}">Corrigir</button> <button type="button" class="btn sm danger" data-est="${esc(p.id)}">Excluir</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">Nenhum pagamento.</td></tr>`}
      </tbody></table></div>
      <p class="hint">Corrigir ou excluir um pagamento ajusta também o lançamento no caixa.</p>
      ${formDevedor(dv)}`,
    aoAbrir: (f, d) => {
      lerItens = ligarItens(d, dv.itens || [], () => ($("[data-total]", d).textContent = brl(somaItens(lerItens()))));
      lerContatos = ligarContatos(d, dv.contatos || []); ligarAcordo(f, d, () => r2(somaItens(lerItens()) - +dv.valor_pago));
      if (!pode.editar()) $$("input,select,textarea,[data-item-rapido],[data-ct-add],.item button,.contato button", d).forEach(x => (x.disabled = true));
      const pg = $("[data-pagar]", d); if (pg) pg.addEventListener("click", () => { d.close(); setTimeout(() => pagarDevedor(dv), 0); });
      $$("[data-cor]", d).forEach(b => b.addEventListener("click", () => { d.close(); setTimeout(() => pagarDevedor(dv, pags.find(p => p.id === b.dataset.cor)), 0); }));
      $$("[data-est]", d).forEach(b => b.addEventListener("click", async () => { d.close(); const p = pags.find(x => x.id === b.dataset.est); if (!(await confirmar("Excluir pagamento", `Excluir o pagamento de <b>${brl(p.valor)}</b> de ${dt(p.data)}? O lançamento no caixa também será apagado.`, "Excluir"))) return; try { await rpc("estornar_pagamento_devedor", { p_id: dv.id, p_pagamento: b.dataset.est }); toast("Pagamento excluído."); render(); } catch (e) { falha(e); } }));
      const del = $("[data-del]", d); if (del) del.addEventListener("click", async () => { d.close(); if (!(await confirmar("Excluir devedor", `Excluir o registro de <b>${esc(dv.devedor)}</b>? Prefira marcar como Quitado ou Saldo perdido.${pags.length ? "<br><br>Os pagamentos já lançados no caixa continuam lá." : ""}`, "Excluir"))) return; try { await q(sb.from("devedores").delete().eq("id", dv.id)); toast("Excluído."); render(); } catch (e) { falha(e); } });
    },
    salvar: async f => {
      const d = lerDevedor(f, lerItens, lerContatos);
      const antes = somaItens(dv.itens || []), depois = somaItens(d.itens);
      const mudouItens = JSON.stringify((dv.itens || []).map(x => [x.descricao, +x.valor, !!x.estimado])) !== JSON.stringify(d.itens.map(x => [x.descricao, +x.valor, !!x.estimado]));
      if (depois < +dv.valor_pago - 0.004) throw new Error(`A dívida ficaria em ${brl(depois)}, menor que o já pago (${brl(dv.valor_pago)}). Corrija ou exclua um pagamento antes.`);
      if (mudouItens) {
        $("#dlg").close();
        if (!(await confirmar("Alterar a dívida", `Confirma a alteração dos valores devidos?<br><br>Antes: <b>${brl(antes)}</b><br>Depois: <b>${brl(depois)}</b>`, "Confirmar alteração"))) return false;
      }
      await q(sb.from("devedores").update(d).eq("id", dv.id)); toast("Salvo."); render();
    } });
};
function pagarDevedor(dv, pag) {
  const cats = S.categorias.filter(c => c.ativa && ["terceiros_entrada", "receita"].includes(c.grupo));
  const padrao = pag ? null : cats.find(c => /ex-locat/i.test(c.nome));
  let catAtual = padrao ? padrao.id : null;
  if (pag && pag.lancamento_id) catAtual = null; // carregado abaixo
  const corpo = `<div class="box">Saldo devedor: <b>${brl(saldoDev(dv) + (pag ? +pag.valor : 0))}</b>${pag ? " (já desconsiderando este pagamento)" : ""}</div>
      <div class="row"><label class="fl"><span>Data</span><input type="date" name="data" value="${pag ? pag.data : hoje()}" required></label>
        <label class="fl"><span>Valor</span><input name="valor" inputmode="decimal" value="${n2(pag ? pag.valor : saldoDev(dv))}" required></label></div>
      <label class="fl"><span>Entrou na conta</span><select name="conta">${contasOpts(pag ? pag.conta_id : null)}</select></label>
      <label class="fl"><span>Categoria</span><select name="cat">${["terceiros_entrada", "receita"].map(g => `<optgroup label="${esc(GRUPOS[g])}">${cats.filter(c => c.grupo === g).map(c => opt(c.id, c.nome, c.id === catAtual)).join("")}</optgroup>`).join("")}</select></label>
      <label class="fl"><span>Observação</span><input name="obs" value="${esc(pag ? pag.obs || "" : "")}" placeholder="ex.: parcela 1/3"></label>
      <p class="hint">Dívida de aluguel/encargos é do proprietário: use "Dívidas de ex-locatários (p/ proprietários)" e depois faça o repasse no caixa. Multa ou valor que fica com a imobiliária: use uma categoria de Receita.</p>`;
  modal({ titulo: (pag ? "Corrigir pagamento de " : "Pagamento de ") + dv.devedor, ok: pag ? "Salvar correção" : "Registrar", corpo,
    aoAbrir: async f => { if (pag && pag.lancamento_id) { try { const l = await q(sb.from("lancamentos").select("categoria_id").eq("id", pag.lancamento_id).maybeSingle()); if (l) f.cat.value = l.categoria_id; } catch (e) { /* ok */ } } },
    salvar: async f => {
      const v = parseMoney(f.valor.value); if (!v || v <= 0) throw new Error("Valor inválido.");
      if (pag) await rpc("corrigir_pagamento_devedor", { p_id: dv.id, p_pagamento: pag.id, p_data: f.data.value, p_valor: v, p_conta: f.conta.value, p_categoria: f.cat.value, p_obs: f.obs.value });
      else await rpc("registrar_pagamento_devedor", { p_id: dv.id, p_data: f.data.value, p_valor: v, p_conta: f.conta.value, p_categoria: f.cat.value, p_obs: f.obs.value });
      toast(pag ? "Pagamento corrigido." : "Pagamento registrado."); render();
    } });
}
ACT["xls-dev"] = () => exportarGrade("devedores", `devedores-${hoje()}.xlsx`, "Devedores");

/* =====================================================================
   PÁGINA: INDICADORES
   ===================================================================== */
function barrasH(itens, opts) {
  opts = opts || {};
  const max = Math.max(1e-9, ...itens.map(x => Math.abs(x.v)));
  return `<div class="hbars">${itens.map(x => `<div class="hb"><span class="hb-l" title="${esc(x.l)}">${esc(x.l)}</span><span class="hb-t"><i style="width:${Math.max(0.5, Math.abs(x.v) / max * 100)}%${x.cor ? ";background:" + x.cor : ""}"></i></span><span class="hb-v">${opts.fmt ? opts.fmt(x) : n2(x.v)}</span></div>`).join("")}</div>`;
}
const brlInt = v => "R$ " + Math.round(+v || 0).toLocaleString("pt-BR");
function eixoPasso(max) { const raw = max / 4 || 1, p = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 2.5, 5, 10].map(k => k * p).find(k => k >= raw); }
// barras verticais; série única com destaque (x.atual) ou duas séries (x.v2)
function barrasV(itens, opts) {
  const duas = itens.some(x => x.v2 != null);
  const W = 820, H = 250, L = opts.esq || 56, B = 28, T = 20, R = 8;
  const max = Math.max(1, ...itens.map(x => Math.max(x.v, x.v2 || 0)));
  const passo = eixoPasso(max), topo = Math.ceil(max / passo) * passo;
  const y = v => T + (1 - v / topo) * (H - T - B);
  const cw = (W - L - R) / Math.max(1, itens.length), bw = duas ? Math.min(22, (cw - 8) / 2) : Math.min(34, cw - 8);
  let g = "";
  for (let v = 0; v <= topo + 1e-6; v += passo) g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${opts.eixo ? opts.eixo(v) : v.toLocaleString("pt-BR")}</text>`;
  const barra = (x0, v, cls) => { const h = Math.max(0, y(0) - y(v)), r = Math.min(4, h, bw / 2); return h > 0.5 ? `<path class="${cls}" d="M${x0},${y(0)} V${y(v) + r} Q${x0},${y(v)} ${x0 + r},${y(v)} H${x0 + bw - r} Q${x0 + bw},${y(v)} ${x0 + bw},${y(v) + r} V${y(0)}Z"/>` : ""; };
  itens.forEach((x, i) => {
    const cx = L + i * cw;
    if (x.atual) g += `<rect class="band" x="${cx + 1}" y="${T - 14}" width="${cw - 2}" height="${H - T - B + 14}" rx="4"/>`;
    if (duas) { const x0 = cx + (cw - 2 * bw - 3) / 2; g += barra(x0, x.v, "b1") + barra(x0 + bw + 3, x.v2, "b2"); }
    else { const x0 = cx + (cw - bw) / 2; g += barra(x0, x.v, x.atual ? "b2" : "b1"); if (opts.rotulos) g += `<text class="ax${x.atual ? " fw" : ""}" x="${x0 + bw / 2}" y="${y(x.v) - 5}" text-anchor="middle">${opts.rotulos(x.v)}</text>`; }
    g += `<text class="ax${x.atual ? " fw" : ""}" x="${cx + cw / 2}" y="${H - 9}" text-anchor="middle">${esc(x.l)}</text>`;
    g += `<rect class="hit" x="${cx}" y="${T}" width="${cw}" height="${H - T - B}" data-tip="${esc(x.tip || x.l)}"/>`;
  });
  return `${opts.legenda ? `<div class="legend">${opts.legenda}</div>` : ""}<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.rotulo || "")}">${g}<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--muted)"/></svg><div class="tip" hidden></div></div>`;
}
// pizza (rosca)
function pizza(fatias, opts) {
  opts = opts || {};
  const tot = fatias.reduce((a, x) => a + x.v, 0);
  const R = 70, C = 2 * Math.PI * R, sw = 34;
  let off = 0, arcos = "";
  fatias.filter(x => x.v > 0).forEach(x => {
    const len = tot ? x.v / tot * C : 0, gap = fatias.filter(z => z.v > 0).length > 1 ? Math.min(2, len / 3) : 0;
    arcos += `<circle class="seg" r="${R}" cx="100" cy="100" fill="none" stroke="${x.cor}" stroke-width="${sw}" stroke-dasharray="${Math.max(0, len - gap)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 100 100)" data-tip="&lt;b&gt;${esc(esc(x.l))}&lt;/b&gt;&lt;br&gt;${esc(esc(opts.fmt ? opts.fmt(x.v) : String(x.v)))} · ${tot ? (x.v / tot * 100).toFixed(1).replace(".", ",") : 0}%"/>`;
    off += len;
  });
  if (opts.semLegenda) return `<div class="chart pz-so"><svg viewBox="0 0 200 200" role="img" aria-label="${esc(opts.rotulo || "")}">${arcos}
      <text x="100" y="96" text-anchor="middle" class="pz-t">${esc(opts.centro || "")}</text><text x="100" y="116" text-anchor="middle" class="pz-s">${esc(opts.centroSub || "")}</text></svg><div class="tip" hidden></div></div>`;
  return `<div class="pizza"><div class="chart"><svg viewBox="0 0 200 200" role="img" aria-label="${esc(opts.rotulo || "")}">${arcos}
      <text x="100" y="96" text-anchor="middle" class="pz-t">${esc(opts.centro || "")}</text><text x="100" y="116" text-anchor="middle" class="pz-s">${esc(opts.centroSub || "")}</text></svg><div class="tip" hidden></div></div>
    <div class="pz-leg">${fatias.map(x => `<div><i style="background:${x.cor}"></i><span>${esc(x.l)}</span><b>${esc(opts.fmt ? opts.fmt(x.v) : String(x.v))}</b><small>${tot ? (x.v / tot * 100).toFixed(1).replace(".", ",") : "0"}%</small></div>`).join("")}</div></div>`;
}
const pct = (a, b) => b ? (a / b * 100).toFixed(1).replace(".", ",") + "%" : "–";
PAGES.indicadores = async pg => {
  const atual = inicioMes(hoje()), passado = S.mes < atual;
  const [grupos, evol, cobsAll, hist, ctts] = await Promise.all([
    q(sb.from("grupos_locador").select("*").order("ordem")),
    rpc("resumo_mapa"),
    rpc("resumo_cobrancas", {}),
    passado ? fetchAll("mapa_mensal", b => b.eq("competencia", S.mes).order("imovel_id")) : Promise.resolve(null),
    sb.from("contratos").select("codigo", { count: "exact", head: true }).eq("situacao", "ATIVO")
  ]);
  const linhas = passado ? (hist || []).map(h => Object.assign({}, S.imovelPor[h.imovel_id] || {}, { status: h.status, valor: h.valor, locador: h.locador, taxa_adm: h.taxa_adm, carteira: h.carteira || (S.imovelPor[h.imovel_id] || {}).carteira || "administrado", data_entrada: (S.imovelPor[h.imovel_id] || {}).data_entrada }))
    : S.imoveis;
  if (passado && !linhas.length) { pg.innerHTML = `<div class="card empty">Não há mapa guardado de ${esc(mesTxt(S.mes))}.</div>`; return; }
  const alg = linhas.filter(i => i.status === "ALG");
  const membro = {}; grupos.forEach(g => (g.locadores || []).forEach(l => { if (!membro[l]) membro[l] = g; }));
  const grupoDe = i => membro[i.locador];
  const com = i => i.carteira === "proprio" ? (+i.valor || 0) : i.carteira === "socio" ? 0 : (+i.valor || 0) * (+i.taxa_adm || 0) / 100;
  const cat = i => i.carteira === "proprio" ? "Imóveis próprios (imobiliária)" : i.carteira === "socio" ? "Sócio Cilas (particular)" :
    grupoDe(i) && grupoDe(i).classe === "destaque" ? grupoDe(i).nome : grupoDe(i) ? "Principais locadores" : "Outros locadores";
  const agg = {};
  alg.forEach(i => { const k = cat(i); const a = agg[k] = agg[k] || { q: 0, bruto: 0, com: 0, donos: new Set() }; a.q++; a.bruto += +i.valor || 0; a.com += com(i); a.donos.add(i.locador); });
  const totCom = Object.values(agg).reduce((a, x) => a + x.com, 0), totBruto = alg.reduce((a, i) => a + (+i.valor || 0), 0);
  const CORES = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)"];
  const ordemFix = ["Imóveis próprios (imobiliária)"].concat(grupos.filter(g => g.classe === "destaque").map(g => g.nome), ["Principais locadores", "Outros locadores", "Sócio Cilas (particular)"]);
  const catsOrd = ordemFix.filter(k => agg[k]);
  const corCat = {}; catsOrd.forEach((k, i) => (corCat[k] = CORES[i % CORES.length]));
  const porGrupo = {};
  alg.filter(i => i.carteira === "administrado" && grupoDe(i) && grupoDe(i).classe === "grande").forEach(i => { const n = grupoDe(i).nome; const a = porGrupo[n] = porGrupo[n] || { q: 0, bruto: 0, com: 0 }; a.q++; a.bruto += +i.valor || 0; a.com += com(i); });
  const gruposOrd = Object.entries(porGrupo).sort((a, b) => b[1].com - a[1].com);
  // status geral
  const st = { ALG: 0, LVR: 0, OCP: 0, INTV: 0 }; linhas.forEach(i => st[i.status] = (st[i.status] || 0) + 1);
  // anos
  const anoSel = +S.mes.slice(0, 4), anos = {};
  alg.forEach(i => { const a = i.data_entrada ? +i.data_entrada.slice(0, 4) : null; const k = a == null ? "s/ data" : a <= 2015 ? "até 2015" : String(a); anos[k] = (anos[k] || 0) + 1; });
  const anosOrd = Object.keys(anos).sort((a, b) => (a === "s/ data") - (b === "s/ data") || (a === "até 2015" ? -1 : b === "até 2015" ? 1 : +a - +b));
  // tipos
  const tipos = {};
  linhas.forEach(i => { const t = tipos[i.tipo || "—"] = tipos[i.tipo || "—"] || { ALG: 0, LVR: 0, OCP: 0, INTV: 0, valor: 0 }; t[i.status]++; if (i.status === "ALG") t.valor += +i.valor || 0; });
  const tiposOrd = Object.entries(tipos).sort((a, b) => b[1].ALG - a[1].ALG);
  const maxAt = Math.max(1, ...tiposOrd.map(([, x]) => x.ALG + x.LVR));
  // faixas
  const faixas = [["até R$ 1.000", 0, 1000], ["R$ 1.000,01 – 1.500", 1000, 1500], ["R$ 1.500,01 – 2.000", 1500, 2000], ["R$ 2.000,01 – 3.500", 2000, 3500], ["R$ 3.500,01 – 5.000", 3500, 5000], ["R$ 5.000,01 – 10.000", 5000, 10000], ["mais de R$ 10.000", 10000, Infinity]]
    .map(([l, a, b]) => { const xs = alg.filter(i => (+i.valor > a || a === 0) && +i.valor <= b); return { l, q: xs.length, v: xs.reduce((s, i) => s + +i.valor, 0) }; });
  // evolução esperado × real
  const meses = Array.from(new Set(evol.map(e => e.competencia).concat(cobsAll.map(c => c.competencia)))).sort().filter(m => m <= addMes(atual, 0));
  const ev = meses.map(m => {
    const a = evol.find(e => e.competencia === m && e.status === "ALG") || { qtd: 0, valor: 0, comissao: 0 };
    const cs = cobsAll.filter(c => c.competencia === m);
    return { m, q: +a.qtd, esp: +a.valor, espCom: +a.comissao, real: cs.reduce((s, c) => s + +c.recebido, 0), realCom: cs.reduce((s, c) => s + +c.taxa, 0), tem: cs.length > 0 };
  });
  // cards do mês
  const esp = resumoEsperado(linhas), real = resumoReal(cobsAll.filter(c => c.competencia === S.mes));
  const noSite = linhas.filter(i => /^\d+$/.test(String(i.codigo_site || "").trim()) && +i.codigo_site > 0).length;
  const ativos = ctts.count || 0;
  const locUnicos = new Set(alg.map(i => i.locador)).size;
  // como no Excel: cada grupo conta como 1 locador
  const nPrincipais = new Set(alg.filter(i => cat(i) === "Principais locadores").map(i => grupoDe(i).nome)).size;
  const nOutros = new Set(alg.filter(i => cat(i) === "Outros locadores").map(i => i.locador)).size;
  const locContados = nPrincipais + nOutros + catsOrd.filter(k => k !== "Principais locadores" && k !== "Outros locadores").length;
  const rotCat = k => k === "Principais locadores" ? `Principais locadores (${nPrincipais})` : k === "Outros locadores" ? `Outros locadores (${nOutros})` : k;

  const evolHTML = `<div class="card"><div class="card-h"><h2>Evolução mês a mês — aluguel esperado × recebido</h2><span class="hint">destaque: ${esc(mesCurto(S.mes))}</span></div>
      ${ev.length ? barrasV(ev.map(e => ({ l: mesCurto(e.m), v: e.esp, v2: e.real, atual: e.m === S.mes, tip: `<b>${mesTxt(e.m)}</b><br>Esperado: ${brl(e.esp)}<br>Recebido: ${e.tem ? brl(e.real) : "—"}<br>${e.q} alugados` })), { esq: 96, eixo: brlInt, rotulo: "Esperado e recebido por mês", legenda: `<span><i style="background:var(--s1)"></i>Esperado (mapa)</span><span><i style="background:var(--s2)"></i>Recebido (aluguéis pagos)</span>` }) : `<p class="muted">Nenhum mapa guardado ainda.</p>`}
      ${ev.length ? `<div class="tw" style="margin-top:10px"><table class="evol"><thead><tr><th></th>${ev.map(e => `<th class="num${e.m === S.mes ? " cur" : ""}">${mesCurto(e.m)}</th>`).join("")}</tr></thead><tbody>
        <tr><td>Alugados</td>${ev.map(e => `<td class="num${e.m === S.mes ? " cur" : ""}">${e.q}</td>`).join("")}</tr>
        <tr><td>Aluguel esperado</td>${ev.map(e => `<td class="num${e.m === S.mes ? " cur" : ""}">${n2(e.esp)}</td>`).join("")}</tr>
        <tr><td>Aluguel recebido</td>${ev.map(e => `<td class="num${e.m === S.mes ? " cur" : ""}">${e.tem ? n2(e.real) : "—"}</td>`).join("")}</tr>
        <tr><td>Comissão esperada</td>${ev.map(e => `<td class="num${e.m === S.mes ? " cur" : ""}">${n2(e.espCom)}</td>`).join("")}</tr>
        <tr><td>Comissão real</td>${ev.map(e => `<td class="num${e.m === S.mes ? " cur" : ""}">${e.tem ? n2(e.realCom) : "—"}</td>`).join("")}</tr></tbody></table></div>` : ""}
      <p class="hint">"Recebido" só existe a partir do mês em que os aluguéis passaram a ser gerados e baixados no sistema.</p>
    </div>`;
  pg.innerHTML = `<div class="grid">
    ${cardsMes(esp, real, "Resumo de " + mesTxt(S.mes))}
    <div class="minis">
      <div><span>Imóveis cadastrados no site</span><b>${noSite}</b></div>
      <div title="Contratos ATIVOS na aba Contratos ÷ imóveis alugados"><span>Contratos rastreáveis</span><b>${pct(ativos, alg.length)}</b><small>${ativos} de ${alg.length}</small></div>
      <div><span>Ocupação (alugados ÷ ativos)</span><b>${pct(st.ALG, st.ALG + st.LVR)}</b></div>
      <div><span>Aluguel médio</span><b>${brl(alg.length ? totBruto / alg.length : 0)}</b></div>
      <div title="Cada grupo (FB, Imobiliária, Cilas e cada principal locador) conta como 1"><span>Locadores com imóvel alugado</span><b>${locContados}</b><small>grupos contam como 1 · ${locUnicos} nomes</small></div>
    </div>
    ${evolHTML}
    <div class="ind-pz">
      <div class="card"><div class="card-h"><h2>Situação geral dos imóveis</h2><span class="hint">${esc(mesTxt(S.mes))}</span></div>
        ${pizza([{ l: "Alugados", v: st.ALG, cor: "var(--info)" }, { l: "Livres", v: st.LVR, cor: "var(--ok)" }, { l: "Ocupados", v: st.OCP, cor: "var(--warn)" }, { l: "Inativos", v: st.INTV, cor: "var(--bad)" }], { centro: String(linhas.length), centroSub: "imóveis", rotulo: "Situação dos imóveis" })}
        <div class="ativos"><b>${st.ALG + st.LVR}</b> imóveis ativos <span class="muted">(alugados + livres)</span> · <b>${linhas.length}</b> no total</div></div>
      <div class="card"><div class="card-h"><h2>De onde vem a receita</h2><span class="hint">participação na comissão</span></div>
        <div class="receita">
          ${pizza(catsOrd.filter(k => !k.startsWith("Sócio")).map(k => ({ l: rotCat(k), v: r2(agg[k].com), cor: corCat[k] })), { fmt: brl, centro: brlInt(totCom), centroSub: "por mês", rotulo: "Receita por origem", semLegenda: true })}
          <div class="tw"><table class="compacta"><thead><tr><th>Origem</th><th class="num">Imóv.</th><th class="num">Aluguel bruto</th><th class="num">Comissão/mês</th><th class="num">%</th></tr></thead><tbody>
            ${catsOrd.map(k => `<tr><td><i class="dot" style="background:${corCat[k]}"></i>${esc(rotCat(k))}${k.startsWith("Sócio") ? ' <span class="tag idle">não é receita</span>' : ""}</td><td class="num">${agg[k].q}</td><td class="num">${n2(agg[k].bruto)}</td><td class="num">${n2(agg[k].com)}</td><td class="num">${k.startsWith("Sócio") ? "–" : pct(agg[k].com, totCom)}</td></tr>`).join("")}
          </tbody><tfoot><tr><td>Total</td><td class="num">${alg.length}</td><td class="num">${n2(totBruto)}</td><td class="num">${n2(totCom)}</td><td class="num">100%</td></tr></tfoot></table></div>
        </div>
      </div>
    </div>
    <div class="grid g2">
      <div class="card"><div class="card-h"><h2>Imóveis por tipo</h2></div>
        <div class="tw"><table><thead><tr><th>Tipo</th><th class="num">Alug.</th><th class="num">Livres</th><th class="num">Ocup.</th><th class="num">Inat.</th><th class="num">% locados</th></tr></thead><tbody>
        ${tiposOrd.map(([t, x]) => `<tr><td>${esc(t)}</td><td class="num">${x.ALG}</td><td class="num">${x.LVR}</td><td class="num">${x.OCP}</td><td class="num">${x.INTV}</td><td class="num">${pct(x.ALG, x.ALG + x.LVR)}</td></tr>`).join("")}</tbody></table></div>
        <p class="hint">% locados = alugados ÷ (alugados + livres).</p></div>
      <div class="card"><div class="card-h"><h2>Imóveis ativos por tipo e % locados</h2></div>
        <div class="legend"><span><i style="background:var(--info)"></i>Alugados</span><span><i style="background:var(--ok)"></i>Livres</span></div>
        <div class="hbars">${tiposOrd.filter(([, x]) => x.ALG + x.LVR).map(([t, x]) => `<div class="hb"><span class="hb-l">${esc(t)}</span><span class="hb-t sb"><i style="width:${x.ALG / maxAt * 100}%;background:var(--info)" title="${x.ALG} alugados"></i><i style="width:${x.LVR / maxAt * 100}%;background:var(--ok)" title="${x.LVR} livres"></i></span><span class="hb-v">${x.ALG + x.LVR} · ${pct(x.ALG, x.ALG + x.LVR)}</span></div>`).join("")}</div>
        <h3 style="margin:16px 0 8px">Entrada bruta (R$) por tipo de imóvel</h3>
        ${barrasH(tiposOrd.filter(([, x]) => x.valor > 0).sort((a, b) => b[1].valor - a[1].valor).map(([t, x]) => ({ l: t, v: x.valor })), { fmt: x => `${brl(x.v)} · ${pct(x.v, totBruto)}` })}</div>
    </div>
    <div class="grid g2">
      <div class="card"><div class="card-h"><h2>Locações ativas por ano de entrada</h2><span class="hint">destaque: ${anoSel}</span></div>
        ${barrasV(anosOrd.map(a => ({ l: a, v: anos[a], atual: a === String(anoSel), tip: `<b>${a}</b><br>${anos[a]} locações · ${pct(anos[a], alg.length)}` })), { rotulos: v => String(v), rotulo: "Locações por ano" })}</div>
      <div class="card"><div class="card-h"><h2>Faixas de valor de aluguel</h2></div>
        ${barrasH(faixas.map(x => ({ l: x.l, v: x.q, x })), { fmt: x => `${x.v} · ${pct(x.v, alg.length)}` })}
        <div class="tw" style="margin-top:12px"><table><thead><tr><th>Faixa</th><th class="num">Imóveis</th><th class="num">%</th><th class="num">R$</th><th class="num">% R$</th></tr></thead><tbody>
        ${faixas.map(x => `<tr><td>${x.l}</td><td class="num">${x.q}</td><td class="num">${pct(x.q, alg.length)}</td><td class="num">${n2(x.v)}</td><td class="num">${pct(x.v, totBruto)}</td></tr>`).join("")}</tbody></table></div></div>
    </div>
  </div>`;
  ligarGrafico(pg);
};

/* =====================================================================
   PÁGINA: CONTRATOS — ficha completa, igual à aba "Contratos Locação" do Excel
   ===================================================================== */
// ---- números por extenso (valor, prazo, dia) ----
const EXT_UN = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const EXT_DZ = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const EXT_CT = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
function ext999(n) {
  if (n === 100) return "cem";
  const c = Math.floor(n / 100), r = n % 100, p = [];
  if (c) p.push(EXT_CT[c]);
  if (r) p.push(r < 20 ? EXT_UN[r] : EXT_DZ[Math.floor(r / 10)] + (r % 10 ? " e " + EXT_UN[r % 10] : ""));
  return p.join(" e ");
}
function porExtenso(n) {
  n = Math.floor(Math.abs(n));
  if (!n) return "zero";
  const mi = Math.floor(n / 1e6), mil = Math.floor((n % 1e6) / 1000), r = n % 1000, p = [];
  if (mi) p.push(mi === 1 ? "um milhão" : ext999(mi) + " milhões");
  if (mil) p.push(mil === 1 ? "mil" : ext999(mil) + " mil");
  if (r) p.push(ext999(r));
  let s = p[0];
  for (let i = 1; i < p.length; i++) s += (i === p.length - 1 && r && (r < 100 || r % 100 === 0) ? " e " : " ") + p[i];
  return s;
}
const tituloExt = s => s.split(" ").map(w => ["e", "de", "da", "do"].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
function extensoReais(v) {
  v = r2(v); if (!v) return "";
  const int = Math.floor(v + 1e-9), cent = Math.round((v - int) * 100);
  let s = "";
  if (int) s = porExtenso(int) + (int === 1 ? " real" : int % 1e6 === 0 ? " de reais" : " reais");
  if (cent) s += (int ? " e " : "") + porExtenso(cent) + (cent === 1 ? " centavo" : " centavos");
  return tituloExt(s);
}
const dataExt = isoD => isoD ? `${+isoD.slice(8, 10) < 10 ? "0" : ""}${+isoD.slice(8, 10)} de ${MESES[+isoD.slice(5, 7) - 1]} de ${isoD.slice(0, 4)}` : "";
function dataDeTexto(t) {
  t = String(t || "").trim().toLowerCase();
  let m = t.match(/^(\d{1,2})\s*de\s*([a-zç]+)\s*de\s*(\d{4})/);
  if (m) { const k = MESES.indexOf(m[2] === "marco" ? "março" : m[2]); return k < 0 ? "" : `${m[3]}-${pad(k + 1)}-${pad(+m[1])}`; }
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
  return "";
}
const moedaTxt = v => v == null || v === "" ? "" : n2(v);
function mascaraDoc(inp) {
  inp.addEventListener("input", () => {
    const d = inp.value.replace(/\D/g, "").slice(0, 14);
    if (d.length <= 11) inp.value = d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    else inp.value = d.replace(/(\d{2})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1/$2").replace(/(\d{4})(\d{1,2})$/, "$1-$2");
  });
}
function mascaraContrato(inp) {
  inp.addEventListener("input", () => {
    const d = inp.value.replace(/\D/g, "").slice(0, 5);
    inp.value = d ? "L." + d.slice(0, 2) + (d.length > 2 ? "." + d.slice(2) : "") : "";
  });
}

// ---- os 140 campos, na ordem das colunas do Excel (A..EJ) ----
const OPC = {
  sexo: ["Masculino", "Feminino"], ec: ["solteiro", "solteira", "casado", "casada", "divorciado", "divorciada", "viúvo", "viúva", "separado judicialmente", "separada judicialmente", "união estável"],
  oe: ["SSP/SP", "SSP/MG", "SSP/PR", "SSP/BA", "SSP/RJ", "DETRAN/RJ", "RNM"], nac: ["brasileiro", "brasileira"],
  qtd: ["1", "2", "PJ"], simnao: ["Sim", "Não"], regime: ["comunhão parcial de bens", "comunhão universal de bens", "separação total de bens", "separação obrigatória de bens"],
  enc: ["Não se aplica", "Pagamento diretamente ao órgão competente ou boleto do condomínio", "Pagamento na ADMINISTRADORA juntamente com o aluguel"],
  fins: ["RESIDENCIAIS", "COMERCIAIS"], garantia: ["FIADOR", "CAUÇÃO", "SEGURO FIANÇA", "TÍTULO DE CAPITALIZAÇÃO", "SEM GARANTIA"],
  prazo: [12, 24, 30, 36, 48, 60].map(n => `${n} (${tituloExt(porExtenso(n))})`), dia: Array.from({ length: 31 }, (_, i) => `${pad(i + 1)} (${porExtenso(i + 1)})`),
  st: ["OK", "NÃO", "N/A", "???", "CANCELADO"], dc: ["Não", "Desconto", "Carência"], quem: ["LICO", "ELIANA", "ANDRÉ", "NIDA"]
};
const SIT_CTT = { "ATIVO": "ok", "EM ELABORAÇÃO": "info", "DÉBITO EM ABERTO": "bad", "ENCERRADO": "idle", "CANCELADO": "idle" };
const CP = []; // {col, k, t, sec, tipo, o}
(function montarCampos() {
  const L = (() => { const a = []; for (let i = 0; i < 140; i++) { let n = i, s = ""; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); a.push(s); } return a; })();
  const add = (k, t, sec, tipo, o) => CP.push({ col: L[CP.length], k, t, sec, tipo: tipo || "txt", o });
  add("codigo", "Código", "ctt", "codigo");
  add("end_rua", "Endereço (rua e nº)", "imv"); add("end_bairro", "Bairro", "imv"); add("end_cidade", "Município/UF", "imv"); add("end_cep", "CEP", "imv");
  add("matricula", "Matrícula", "imv"); add("insc_cad", "Inscrição cadastral", "imv"); add("uc", "UC (CPFL)", "imv"); add("rgi", "RGI (Sabesp)", "imv");
  add("fins", "Fins", "ctt", "lista", OPC.fins); add("data_contrato", "Data do contrato", "ctt", "dext"); add("prazo", "Prazo (meses)", "ctt", "lista", OPC.prazo);
  add("inicio", "Início", "ctt", "dext"); add("termino", "Término", "ctt", "dext"); add("valor", "Aluguel (R$)", "ctt", "moeda"); add("valor_ext", "Aluguel por extenso", "ctt", "ext");
  add("dia_venc", "Dia do pagamento", "ctt", "lista", OPC.dia);
  add("enc_agua_energia", "Água / energia", "enc", "lista", OPC.enc); add("enc_gas", "Gás", "enc", "lista", OPC.enc); add("enc_condominio", "Condomínio", "enc", "lista", OPC.enc); add("enc_iptu", "IPTU", "enc", "lista", OPC.enc);
  add("garantia", "Garantia", "gar", "lista", OPC.garantia); add("caucao_valor", "Caução (R$)", "gar", "moeda"); add("caucao_ext", "Caução por extenso", "gar", "ext"); add("caucao_conta", "Conta da caução", "gar");
  add("ig_descricao", "Imóvel em garantia · descrição", "gar"); add("ig_rua", "Imóvel em garantia · rua e nº", "gar"); add("ig_bairro_cidade", "Imóvel em garantia · bairro e município", "gar"); add("ig_matricula", "Imóvel em garantia · matrícula", "gar");
  const pessoa = (p, nome, sec) => {
    add(p + "_sexo", nome + " · sexo", sec, "lista", OPC.sexo); add(p + "_nome", nome + " · nome", sec); add(p + "_nac", nome + " · nacionalidade", sec, "lista", OPC.nac);
    add(p + "_est_civil", nome + " · estado civil", sec, "lista", OPC.ec); add(p + "_prof", nome + " · profissão", sec); add(p + "_rg", nome + " · RG", sec);
    add(p + "_oe", nome + " · órgão emissor/UF", sec, "lista", OPC.oe); add(p + "_cpf", nome + " · CPF/CNPJ", sec, "doc"); add(p + "_tel", nome + " · telefone", sec, "tel"); add(p + "_email", nome + " · e-mail", sec, "email");
  };
  const enderecos = (p, quem, sec) => {
    add(p + "_end1_rua", quem + " · endereço 1 (rua)", sec); add(p + "_end1_bairro", quem + " · endereço 1 (bairro)", sec); add(p + "_end1_cidade", quem + " · endereço 1 (município/UF)", sec);
    add(p + "_end2_rua", quem + " · endereço 2 (rua)", sec); add(p + "_end2_bairro", quem + " · endereço 2 (bairro)", sec); add(p + "_end2_cidade", quem + " · endereço 2 (município/UF)", sec);
    add(p + "_qtd", quem + " · quantidade", sec, "lista", OPC.qtd); add(p + "_casados", quem + " · casados entre si", sec, "lista", OPC.simnao);
    add(p + "_regime", quem + " · regime de bens", sec, "lista", OPC.regime); add(p + "_data_casamento", quem + " · data do casamento", sec);
  };
  pessoa("lcd1", "Locador 1", "lcd"); pessoa("lcd2", "Locador 2", "lcd"); enderecos("lcd", "Locadores", "lcd");
  pessoa("lct1", "Locatário 1", "lct"); pessoa("lct2", "Locatário 2", "lct"); enderecos("lct", "Locatários", "lct");
  pessoa("fdr1", "Fiador 1", "fdr"); pessoa("fdr2", "Fiador 2", "fdr"); enderecos("fdr", "Fiadores", "fdr");
  add("test1_nome", "Testemunha 1 · nome", "out"); add("test1_rg", "Testemunha 1 · RG", "out"); add("test1_cpf", "Testemunha 1 · CPF", "out", "doc");
  add("test2_nome", "Testemunha 2 · nome", "out"); add("test2_rg", "Testemunha 2 · RG", "out"); add("test2_cpf", "Testemunha 2 · CPF", "out", "doc");
  add("desc_carencia", "Desconto / carência?", "out", "lista", OPC.dc); add("desc_meses", "Desconto/carência · meses", "out"); add("desc_valor", "Desconto · valor (R$)", "out", "moeda");
  add("inundacao", "Área de inundação?", "out", "lista", OPC.simnao);
  add("obs", "Observações / alterações manuais", "st", "area"); add("redacao", "Redação", "st", "lista", OPC.quem); add("correcao", "Correção", "st", "lista", OPC.quem);
  add("st_ass_lcd", "Assinatura locador", "st", "st"); add("st_ass_lct", "Assinatura locatário/fiador", "st", "st"); add("st_scan", "Scan do contrato assinado", "st", "st");
  add("st_cpfl", "Transferência CPFL", "st", "st"); add("st_condominio", "Condomínio", "st", "st"); add("st_brimob", "Cadastro BRIMOB", "st", "st");
  add("situacao", "Situação do contrato", "st", "sit"); add("saldo_entrega", "Saldo devedor (na entrega)", "st");
})();
const CPK = Object.fromEntries(CP.map(c => [c.k, c]));
const SECS = [["imv", "Imóvel"], ["ctt", "Contrato"], ["gar", "Garantia"], ["lcd", "Locadores"], ["lct", "Locatários"], ["fdr", "Fiadores"], ["out", "Testemunhas e cláusulas"], ["st", "Status e observações"]];
const ST_K = ["st_ass_lcd", "st_ass_lct", "st_scan", "st_cpfl", "st_condominio", "st_brimob"];
// resumos (iguais aos botões de filtro de colunas do Excel)
const RESUMOS = {
  completa: ["Completa (todas as colunas)", null],
  r1: ["Resumo + fiadores + dados do contrato", "A B J O Q W Y Z AA AB AC AE AO BI BS CM CW DZ EA EB EC ED EE EF EG EH EI EJ"],
  r2: ["Resumo + fiadores", "A B AE AO BI BS CM CW DZ EA EB EC ED EE EF EG EH EI EJ"],
  r3: ["Resumo", "A B AE BI BS DZ EA EB EC ED EE EF EG EH EI EJ"],
  r4: ["CPFL", "A B E H AE BI BS EC ED EE EF EG"],
  r5: ["BRIMOB", "A B M N O AE AO BI BS DZ EH EI EJ"],
  r6: ["DIMOB", "A B E M O AE AK AO AU BI BO BS BY DZ EH EI EJ"]
};
const resumoKs = id => RESUMOS[id][1] ? RESUMOS[id][1].split(" ").map(l => CP.find(c => c.col === l).k) : CP.map(c => c.k);
const ehPend = v => { const s = String(v || "").trim().toUpperCase(); return !!s && s !== "---" && s !== "OK" && s !== "N/A"; };

// ficha "de exibição": a ficha gravada ou, se o contrato ainda não tem ficha, montada das colunas resumidas
function fichaDe(c) {
  const f = c.ficha && Object.keys(c.ficha).length ? Object.assign({}, c.ficha) : {};
  if (!Object.keys(f).length) {
    const nomes = s => String(s || "").split(" - ");
    const [l1, l2] = nomes(c.locador), [t1, t2] = nomes(c.locatario), [f1, f2] = nomes(c.fiador);
    Object.assign(f, { end_rua: c.endereco || "", fins: (c.finalidade || "").toUpperCase(), data_contrato: dataExt(c.data_contrato), inicio: dataExt(c.inicio), termino: dataExt(c.termino),
      prazo: c.prazo_meses ? `${c.prazo_meses} (${tituloExt(porExtenso(c.prazo_meses))})` : "", valor: moedaTxt(c.valor), valor_ext: c.valor ? extensoReais(c.valor) : "",
      dia_venc: c.dia_venc ? `${pad(c.dia_venc)} (${porExtenso(c.dia_venc)})` : "", garantia: (c.garantia || "").toUpperCase(),
      lcd1_nome: l1 || "", lcd2_nome: l2 || "", lct1_nome: t1 || "", lct2_nome: t2 || "", fdr1_nome: f1 || "", fdr2_nome: f2 || "", obs: c.obs || "",
      saldo_entrega: c.saldo_devedor != null ? moedaTxt(c.saldo_devedor) : "" });
    const cts = c.contatos || [], lt = cts.filter(x => x.papel === "Locatário"), fd = cts.filter(x => x.papel === "Fiador");
    [["lct1", lt[0]], ["lct2", lt[1]], ["fdr1", fd[0]], ["fdr2", fd[1]]].forEach(([p, x]) => { if (x) { f[p + "_tel"] = x.tel || ""; f[p + "_email"] = x.email || ""; } });
  }
  f.situacao = c.situacao;
  return f;
}
const fv = (c, k) => k === "codigo" ? c.codigo : (c._f || (c._f = fichaDe(c)))[k] || "";

function stPill(c, k) {
  const v = String(fv(c, k) || "").trim(), u = v.toUpperCase();
  const cls = !v || v === "---" ? "idle" : u === "OK" ? "ok" : u === "N/A" ? "idle" : u === "NÃO" || u === "NAO" || u === "CANCELADO" ? "bad" : "warn";
  const txt = !v || v === "---" ? "—" : v.length > 16 ? v.slice(0, 15) + "…" : v;
  const ed = pode.editar() ? ` data-act="ctt-st" data-id="${esc(c.codigo)}" data-k="${k}" role="button" tabindex="0"` : "";
  return `<span class="tag ${cls} st-ed"${ed} title="${esc(v || "vazio")}${pode.editar() ? " · clique para alterar" : ""}">${esc(txt)}</span>`;
}
function sitPill(c) {
  const ed = pode.editar() ? ` data-act="ctt-st" data-id="${esc(c.codigo)}" data-k="situacao" role="button" tabindex="0" title="Clique para alterar"` : "";
  return `<span class="tag ${SIT_CTT[c.situacao] || "idle"} st-ed"${ed}>${esc(c.situacao)}</span>`;
}
const COLS_CTT = CP.map(c => {
  const col = { k: c.k, t: c.t, v: r => fv(r, c.k), cls: /_nome$|^obs$|_rua$|^ig_|_ext$|^enc_/.test(c.k) ? "trunc" : "" };
  if (c.k === "codigo") Object.assign(col, { t: "Contrato", cls: "mono", fixo: true });
  if (c.k === "end_rua") col.t = "Imóvel";
  if (c.tipo === "st") Object.assign(col, { html: r => stPill(r, c.k) });
  if (c.k === "situacao") Object.assign(col, { t: "Situação", html: sitPill });
  if (c.tipo === "dext") Object.assign(col, { tipo: "data", v: r => dataDeTexto(fv(r, c.k)) || null, f: r => dt(dataDeTexto(fv(r, c.k))) || fv(r, c.k) });
  if (c.tipo === "moeda") Object.assign(col, { tipo: "num", v: r => parseMoney(fv(r, c.k)), f: r => { const n = parseMoney(fv(r, c.k)); return n == null ? fv(r, c.k) : n2(n); } });
  if (c.tipo === "tel") col.f = r => fmtTel(fv(r, c.k));
  return col;
});
// o resumo "Resumo" do Excel é o padrão
(() => { const vis = new Set(resumoKs("r3")); COLS_CTT.forEach(c => { if (!vis.has(c.k)) c.oculta = true; }); })();

PAGES.contratos = async pg => {
  CTT = await fetchAll("contratos", b => b.order("codigo", { ascending: false }));
  setRd(pg, () => desenharContratos());
  desenharContratos(pg);
};
let CTT = [];
function desenharContratos(pg) {
  pg = pg || $("#page");
  const f = S.f.ctt || "todos", busca = S.f.cttBusca || "";
  const lim60 = iso(new Date(Date.now() + 60 * 86400000));
  const testa = { todos: () => true, vencendo: c => c.situacao === "ATIVO" && c.termino && c.termino >= hoje() && c.termino <= lim60,
    pend: c => c.situacao !== "CANCELADO" && ST_K.some(k => ehPend(fv(c, k))) };
  const filtro = c => testa[f] ? testa[f](c) : c.situacao === f;
  const cont = k => CTT.filter(c => testa[k] ? testa[k](c) : c.situacao === k).length;
  let lista = CTT.filter(filtro);
  if (busca) { const b = norm(busca); lista = lista.filter(c => norm([c.codigo, c.endereco, c.locador, c.locatario, c.fiador, fv(c, "lct1_cpf"), fv(c, "lct2_cpf")].join(" ")).includes(b)); }
  const g = grade("contratos5", COLS_CTT, lista, { attr: c => `data-act="ctt-ed" data-id="${esc(c.codigo)}" style="cursor:pointer"`, sort: { k: "codigo", dir: "desc" }, rodape: fl => `${fl.length} contratos` });
  g.redesenhar = () => desenharContratos();
  const chips = [["todos", "Todos"], ["ATIVO", "Ativos"], ["vencendo", "Terminam em 60 dias"], ["pend", "Com pendências"], ["DÉBITO EM ABERTO", "Débito em aberto"], ["EM ELABORAÇÃO", "Em elaboração"], ["ENCERRADO", "Encerrados"], ["CANCELADO", "Cancelados"]];
  const semFicha = CTT.filter(c => !c.ficha || !Object.keys(c.ficha).length).length;
  pg.innerHTML = `<div class="grid">
    ${semFicha && pode.editar() ? `<div class="alert warn"><span><b>${semFicha}</b> contratos ainda sem a ficha completa (RG, CPF, UC, matrícula…). Use <b>Importar planilha</b> com o arquivo "Gerador de Contratos" para trazer todos os dados do Excel.</span></div>` : ""}
    <div class="filters">
      <div class="chips">${chips.map(([k, t]) => `<button class="chip${f === k ? " on" : ""}" data-act="chip" data-k="ctt" data-v="${esc(k)}">${t}<span class="c">${cont(k)}</span></button>`).join("")}</div>
      <input type="search" placeholder="Buscar código, endereço, nomes, CPF…" value="${esc(busca)}" data-busca="cttBusca">
      <span class="spacer"></span>
      <button class="btn" data-act="ctt-resumo" title="Conjuntos de colunas prontos, iguais aos do Excel">▦ Resumos</button>${gradeBarra("contratos5")}
      <button class="btn" data-act="ctt-termo">🔑 Termos</button>
      ${pode.editar() ? `<button class="btn" data-act="ctt-importar">Importar planilha</button><button class="btn pri" data-act="ctt-novo">+ Contrato</button>` : ""}<button class="btn" data-act="xls-ctt">Excel</button>
    </div>
    ${gradeHTML("contratos5")}</div>`;
  ligarBusca(pg);
}
ACT["ctt-resumo"] = el => {
  const g = G.contratos5, p = pop(el, `<div class="gp-h">Mostrar colunas como no Excel</div>
    <div class="gp-cols">${Object.entries(RESUMOS).map(([id, [t]]) => `<button type="button" class="btn sm" data-r="${id}" style="justify-content:flex-start">${esc(t)}</button>`).join("")}</div>
    <p class="hint">Depois você pode ajustar em ☰ Colunas.</p>`, 300);
  $$("[data-r]", p).forEach(b => b.addEventListener("click", () => {
    const vis = new Set(resumoKs(b.dataset.r));
    g.ordem = CP.map(c => c.k); g.ocultas = CP.map(c => c.k).filter(k => !vis.has(k) && !(gCol(g, k) || {}).fixo);
    gradeSalvar("contratos5"); fecharPop(); gRedesenhar("contratos5");
  }));
};
ACT["ctt-st"] = el => {
  const c = CTT.find(x => x.codigo === el.dataset.id), k = el.dataset.k, sit = k === "situacao";
  if (!c || !pode.editar()) return;
  const atual = String(fv(c, k) || "");
  const ops = sit ? Object.keys(SIT_CTT) : OPC.st;
  const p = pop(el, `<div class="gp-h">${esc(CPK[k].t)} · ${esc(c.codigo)}</div>
    <div class="st-ops">${ops.map(o => `<button type="button" class="btn sm${atual.toUpperCase() === o ? " pri" : ""}" data-o="${esc(o)}">${esc(o)}</button>`).join("")}</div>
    ${sit ? "" : `<label class="fl"><span>Outro / anotação</span><input data-livre value="${esc(ops.includes(atual.toUpperCase()) ? "" : atual)}" placeholder="ex.: falta reconhecer firma"></label>
    <div class="gp-f"><button type="button" class="btn sm" data-o="">Deixar vazio</button><button type="button" class="btn sm pri" data-ok>Salvar anotação</button></div>`}`, 320);
  const salvar = async v => {
    fecharPop();
    try {
      const ficha = Object.assign({}, fichaDe(c), { [k]: v });
      const r = await q(sb.from("contratos").update({ ficha }).eq("codigo", c.codigo).select().single());
      Object.assign(c, r); delete c._f; toast(`${CPK[k].t}: ${v || "vazio"}`); gRedesenhar("contratos5");
    } catch (e) { falha(e); }
  };
  $$("[data-o]", p).forEach(b => b.addEventListener("click", () => salvar(b.dataset.o)));
  const ok = $("[data-ok]", p); if (ok) ok.addEventListener("click", () => salvar($("[data-livre]", p).value.trim()));
  const lv = $("[data-livre]", p); if (lv) lv.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); salvar(lv.value.trim()); } });
};
function proximoCodigo() {
  const yy = hoje().slice(2, 4);
  const n = CTT.filter(c => c.codigo.startsWith("L." + yy + ".")).map(c => +c.codigo.slice(5)).filter(x => x < 900);
  return "L." + yy + "." + String((n.length ? Math.max(...n) : 0) + 1).padStart(3, "0");
}
function campoHTML(cp, v, dis) {
  const nm = `data-f="${cp.k}" ${dis}`;
  const lbl = cp.t.replace(/^(Locador|Locatário|Fiador)(es|s)? ?\d? · /, "").replace(/^(Locadores|Locatários|Fiadores) · /, "").replace(/^Imóvel em garantia · /, "").replace(/^Testemunha \d · /, "");
  let inp;
  if (cp.tipo === "dext") { const d = dataDeTexto(v); inp = d || !v ? `<input type="date" ${nm} value="${d}">` : `<input ${nm} value="${esc(v)}" title="Data em texto livre">`; }
  else if (cp.tipo === "sit") inp = `<select ${nm}>${Object.keys(SIT_CTT).map(k => opt(k, k, v === k)).join("")}</select>`;
  else if (cp.tipo === "area") inp = `<textarea ${nm} rows="3">${esc(v)}</textarea>`;
  else if (cp.tipo === "lista" || cp.tipo === "st") inp = `<input ${nm} list="dl-${cp.k}" value="${esc(v)}" autocomplete="off"><datalist id="dl-${cp.k}">${(cp.o || OPC.st).map(o => `<option value="${esc(o)}">`).join("")}</datalist>`;
  else if (cp.tipo === "tel") inp = `<input ${nm} value="${esc(fmtTel(v))}" inputmode="tel" placeholder="(19) 9.0000-0000">`;
  else if (cp.tipo === "moeda") inp = `<input ${nm} value="${esc(v)}" inputmode="decimal" placeholder="0,00">`;
  else inp = `<input ${nm} value="${esc(v)}"${cp.tipo === "email" ? ' inputmode="email"' : ""}${cp.tipo === "doc" ? ' inputmode="numeric" placeholder="000.000.000-00"' : ""}>`;
  return `<label class="fl${cp.tipo === "area" || cp.k.endsWith("_rua") || cp.k === "ig_descricao" ? " largo" : ""}"><span>${esc(lbl)}</span>${inp}</label>`;
}
function formContrato(c) {
  const novo = !c;
  const f = c ? fichaDe(c) : { situacao: "EM ELABORAÇÃO", fins: "RESIDENCIAIS", garantia: "FIADOR", prazo: OPC.prazo[2], end_cidade: "Monte Mor/SP", lcd_qtd: "1", lct_qtd: "1",
    test1_nome: "Linyston Luiz Cavallaro", test1_rg: "35.116.648-8", test1_cpf: "406.955.348-74", test2_nome: "André Cesar Filietaz", test2_rg: "29.257.256-X", test2_cpf: "380.827.298-80",
    desc_carencia: "Não", inundacao: "Não", redacao: "LICO" };
  const dis = pode.editar() ? "" : "disabled";
  const im = c && c.imovel_id ? S.imovelPor[c.imovel_id] : null;
  const bloco = (titulo, ks) => `<fieldset class="ficha-b"><legend>${esc(titulo)}</legend><div class="ficha-g">${ks.map(k => campoHTML(CPK[k], f[k] || "", dis)).join("")}</div></fieldset>`;
  const pessoaKs = p => ["nome", "sexo", "nac", "est_civil", "prof", "rg", "oe", "cpf", "tel", "email"].map(x => p + "_" + x);
  const endKs = p => ["end1_rua", "end1_bairro", "end1_cidade", "end2_rua", "end2_bairro", "end2_cidade", "qtd", "casados", "regime", "data_casamento"].map(x => p + "_" + x);
  const sec = {
    imv: `<div class="ficha-g">
        <label class="fl largo"><span>Imóvel no mapa (liga o contrato ao imóvel)</span><input name="imovel" list="dl-imv" value="${esc(im ? im.endereco : "")}" placeholder="Digite e escolha o endereço" ${dis}></label>
        ${["end_rua", "end_bairro", "end_cidade", "end_cep", "matricula", "insc_cad", "uc", "rgi"].map(k => campoHTML(CPK[k], f[k] || "", dis)).join("")}</div>${imovelDatalist()}`,
    ctt: `<div class="ficha-g">
        <label class="fl"><span>Código</span><input name="codigo" value="${esc(c ? c.codigo : proximoCodigo())}" placeholder="L.26.001" ${novo ? "" : "disabled"}></label>
        ${["situacao", "fins", "data_contrato", "inicio", "termino", "prazo", "dia_venc", "valor", "valor_ext"].map(k => campoHTML(CPK[k], f[k] || "", dis)).join("")}</div>
        ${bloco("Encargos", ["enc_agua_energia", "enc_gas", "enc_condominio", "enc_iptu"])}`,
    gar: `<div class="ficha-g">${["garantia", "caucao_valor", "caucao_ext", "caucao_conta"].map(k => campoHTML(CPK[k], f[k] || "", dis)).join("")}</div>
        ${bloco("Imóvel em garantia", ["ig_descricao", "ig_rua", "ig_bairro_cidade", "ig_matricula"])}`,
    lcd: bloco("Locador 1", pessoaKs("lcd1")) + bloco("Locador 2", pessoaKs("lcd2")) + bloco("Endereço e casamento dos locadores", endKs("lcd")),
    lct: bloco("Locatário 1 (ou empresa, quando PJ)", pessoaKs("lct1")) + bloco("Locatário 2 (ou representante, quando PJ)", pessoaKs("lct2")) + bloco("Endereço e casamento dos locatários", endKs("lct")),
    fdr: bloco("Fiador 1", pessoaKs("fdr1")) + bloco("Fiador 2", pessoaKs("fdr2")) + bloco("Endereço e casamento dos fiadores", endKs("fdr")),
    out: bloco("Testemunhas", ["test1_nome", "test1_rg", "test1_cpf", "test2_nome", "test2_rg", "test2_cpf"]) + bloco("Cláusulas especiais", ["desc_carencia", "desc_meses", "desc_valor", "inundacao"]),
    st: `<div class="ficha-g">${["st_ass_lcd", "st_ass_lct", "st_scan", "st_cpfl", "st_condominio", "st_brimob", "redacao", "correcao", "saldo_entrega", "obs"].map(k => campoHTML(CPK[k], f[k] || "", dis)).join("")}</div>`
  };
  const atual = im ? `hoje: <b>${esc((STATUS_IMV[im.status] || [im.status])[0])}</b>${im.locatario ? " · " + esc(im.locatario) : ""}` : "";
  return `<div class="abas ficha-abas">${SECS.map(([k, t], i) => `<button type="button" class="aba${i ? "" : " on"}" data-aba="${k}">${t}</button>`).join("")}</div>
    ${SECS.map(([k], i) => `<div class="ficha-sec" data-sec="${k}"${i ? " hidden" : ""}>${sec[k]}</div>`).join("")}
    ${pode.editar() ? `<div class="box mapa-opc"><div class="mapa-h"><b>Mapa do aluguel</b>
        <div class="seg"><button type="button" data-mapa="nao" class="${novo && !(im && im.status === "ALG") ? "" : "on"}">Não mexer no mapa</button><button type="button" data-mapa="sim" class="${novo && !(im && im.status === "ALG") ? "on" : ""}">Atualizar o imóvel no mapa</button></div></div>
        <div data-mapa-prev class="hint">${atual}</div></div>` : ""}`;
}
// lê o formulário e devolve a ficha (texto, como no Excel)
function lerFicha(d, base) {
  const f = Object.assign({}, base || {});
  $$("[data-f]", d).forEach(x => {
    const cp = CPK[x.dataset.f]; let v = x.value.trim();
    if (cp.tipo === "dext" && x.type === "date") v = dataExt(v);
    if (cp.tipo === "moeda") { const n = parseMoney(v); v = n == null ? v : n2(n); }
    if (cp.tipo === "tel") v = v.replace(/\D/g, "");
    f[cp.k] = v;
  });
  return f;
}
function ligarFicha(form, d, c) {
  $$(".ficha-abas .aba", d).forEach(b => b.addEventListener("click", () => {
    $$(".ficha-abas .aba", d).forEach(x => x.classList.toggle("on", x === b));
    $$(".ficha-sec", d).forEach(s => (s.hidden = s.dataset.sec !== b.dataset.aba));
  }));
  $$("[data-f]", d).forEach(x => { const t = CPK[x.dataset.f].tipo; if (t === "tel") mascaraTel(x); if (t === "doc") mascaraDoc(x); });
  if (form.codigo && !form.codigo.disabled) mascaraContrato(form.codigo);
  const ext = (a, b) => { const va = $(`[data-f=${a}]`, d), vb = $(`[data-f=${b}]`, d); if (!va || !vb) return;
    va.addEventListener("change", () => { const n = parseMoney(va.value); if (n != null) { va.value = n2(n); vb.value = extensoReais(n); } }); };
  ext("valor", "valor_ext"); ext("caucao_valor", "caucao_ext");
  // dia do pagamento = dia do início (pode trocar)
  const ini = $("[data-f=inicio]", d), dia = $("[data-f=dia_venc]", d);
  if (ini && dia && ini.type === "date") ini.addEventListener("change", () => { if (ini.value) { const n = +ini.value.slice(8, 10); dia.value = `${pad(n)} (${porExtenso(n)})`; } });
  // mapa: prévia do que muda
  const prev = $("[data-mapa-prev]", d);
  const desenharPrev = () => {
    if (!prev) return;
    const sim = $("[data-mapa=sim]", d).classList.contains("on");
    const im = imovelPorEndereco(form.imovel.value);
    if (!sim) { prev.innerHTML = im ? `O imóvel continua como está (hoje: <b>${esc((STATUS_IMV[im.status] || [im.status])[0])}</b>${im.locatario ? " · " + esc(im.locatario) : ""}).` : "O mapa não é alterado."; prev.className = "hint"; return; }
    const fx = lerFicha(d, {}), val = parseMoney(fx.valor), loc = [fx.lct1_nome, fx.lct2_nome].filter(x => x && x !== "---").join(" - ");
    const diaN = parseInt(fx.dia_venc, 10), entrada = dataDeTexto(fx.inicio);
    if (!im) { prev.innerHTML = "Escolha na aba <b>Imóvel</b> o imóvel do mapa que será atualizado."; prev.className = "hint neg"; return; }
    const aviso = im.status === "ALG" && im.locatario && norm(im.locatario) !== norm(loc) ? `<br><b class="neg">Atenção:</b> hoje ele está alugado para <b>${esc(im.locatario)}</b>. Se este é um novo locatário, registre antes a saída do anterior (tela Imóveis).` : "";
    prev.innerHTML = `Ao salvar, <b>${esc(im.endereco)}</b> (hoje: ${esc((STATUS_IMV[im.status] || [im.status])[0])}) passa para <b>Alugado</b> · locatário <b>${esc(loc || "?")}</b> · aluguel <b>${val ? brl(val) : "?"}</b> · dia <b>${diaN || "?"}</b> · entrada <b>${entrada ? dt(entrada) : "?"}</b> · contrato <b>${esc(form.codigo.value)}</b>.${aviso}`;
    prev.className = "hint";
  };
  $$("[data-mapa]", d).forEach(b => b.addEventListener("click", () => { $$("[data-mapa]", d).forEach(x => x.classList.toggle("on", x === b)); desenharPrev(); }));
  form.addEventListener("input", () => { if ($("[data-mapa=sim]", d) && $("[data-mapa=sim]", d).classList.contains("on")) desenharPrev(); });
  desenharPrev();
  if (!pode.editar()) $$("input,select,textarea", d).forEach(x => (x.disabled = true));
  void c;
}
async function salvarContrato(form, d, c) {
  const novo = !c;
  let imovel_id = null;
  if (form.imovel.value.trim()) { const im = imovelPorEndereco(form.imovel.value); if (!im) throw new Error("Imóvel não encontrado no mapa: escolha da lista (aba Imóvel) ou cadastre o imóvel antes."); imovel_id = im.id; }
  const codigo = novo ? form.codigo.value.trim() : c.codigo;
  if (!/^L\.\d{2}\.\d{3}$/.test(codigo)) throw new Error("Código no formato L.26.001 (digite só os números: 26001).");
  const ficha = lerFicha(d, c ? fichaDe(c) : {});
  if (!ficha.end_rua && imovel_id) ficha.end_rua = S.imovelPor[imovel_id].endereco;
  const atualizarMapa = $("[data-mapa=sim]", d) && $("[data-mapa=sim]", d).classList.contains("on");
  let salvo;
  if (novo) salvo = await q(sb.from("contratos").insert({ codigo, imovel_id, ficha }).select().single());
  else salvo = await q(sb.from("contratos").update({ imovel_id, ficha }).eq("codigo", codigo).select().single());
  if (atualizarMapa) {
    if (!imovel_id) throw new Error("Contrato salvo. Para atualizar o mapa, escolha o imóvel na aba Imóvel.");
    if (!salvo.valor || !salvo.locatario) throw new Error("Contrato salvo. Para atualizar o mapa, informe o locatário e o valor do aluguel.");
    await q(sb.from("imoveis").update({ status: "ALG", locatario: salvo.locatario, locador: salvo.locador || S.imovelPor[imovel_id].locador, valor: salvo.valor, dia_venc: salvo.dia_venc,
      data_entrada: salvo.inicio, contrato_codigo: codigo }).eq("id", imovel_id));
    await recarregarImoveis();
  }
}
ACT["ctt-novo"] = () => modal({ titulo: "Novo contrato", xl: true, corpo: formContrato(null), aoAbrir: (f, d) => ligarFicha(f, d, null),
  salvar: async f => { await salvarContrato(f, $("#dlg"), null); toast("Contrato salvo."); render(); } });
ACT["ctt-ed"] = el => {
  const c = CTT.find(x => x.codigo === el.dataset.id); if (!c) return;
  const termos = c.situacao !== "CANCELADO" ? `<button type="button" class="btn left" data-termo="entrega">🔑 Termo de entrega de chaves</button><button type="button" class="btn left" data-termo="caucao">💰 Devolução de caução</button>` : "";
  modal({ titulo: "Contrato " + c.codigo + (c.locatario ? " · " + c.locatario : ""), xl: true, corpo: formContrato(c), semOk: !pode.editar(),
    extra: termos + (pode.admin() ? `<button type="button" class="btn danger left" data-del>Excluir</button>` : ""),
    salvar: async f => { await salvarContrato(f, $("#dlg"), c); toast("Salvo."); render(); },
    aoAbrir: (f, d) => {
      ligarFicha(f, d, c);
      $$("[data-termo]", d).forEach(b => b.addEventListener("click", () => { d.close(); abrirTermo(b.dataset.termo, c.codigo); }));
      const b = $("[data-del]", d); if (b) b.addEventListener("click", async () => { d.close(); if (!(await confirmar("Excluir contrato", `Excluir o contrato ${esc(c.codigo)}? Prefira mudar a situação para Cancelado.`, "Excluir"))) return; try { await q(sb.from("contratos").delete().eq("codigo", c.codigo)); toast("Excluído."); render(); } catch (e) { falha(e); } });
    }
  });
};
// ---- termos (seus apps de entrega de chaves e devolução de caução) ----
const TERMOS = { entrega: ["Declaração de entrega de chaves", "termos/entrega-chaves.html"], caucao: ["Declaração de devolução de caução", "termos/devolucao-caucao.html"] };
async function abrirTermo(tipo, codigo) {
  try {
    const [titulo, arq] = TERMOS[tipo];
    if (!CTT.length) CTT = await fetchAll("contratos", b => b.order("codigo", { ascending: false }));
    const resp = await fetch(arq, { cache: "no-cache" });
    if (!resp.ok) throw new Error("Arquivo do termo não encontrado: " + arq);
    const html = await resp.text();
    // mesmo formato da aba "Contratos Locação" (3 linhas de cabeçalho + uma linha por contrato, colunas A..EJ)
    const linhas = [[], [], []].concat(CTT.filter(c => c.situacao !== "CANCELADO").map(c => CP.map(cp => fv(c, cp.k))));
    const d = $("#dlg");
    modal({ titulo, semOk: true, corpo: `<iframe title="${esc(titulo)}" sandbox="allow-scripts allow-downloads allow-modals allow-popups" referrerpolicy="no-referrer"></iframe>` });
    d.classList.add("termo-dlg");
    d.addEventListener("close", () => d.classList.remove("termo-dlg"), { once: true });
    const fr = $("iframe", d);
    const ouvir = ev => {
      if (ev.source !== fr.contentWindow || !ev.data || ev.data.tipo !== "termo-pronto") return;
      window.removeEventListener("message", ouvir);
      fr.contentWindow.postMessage({ tipo: "termo", html, linhas, codigo: codigo || "" }, "*");
    };
    window.addEventListener("message", ouvir);
    fr.src = "termos/abrir.html";
  } catch (e) { falha(e); }
}
ACT["ctt-termo"] = el => {
  const p = pop(el, `<div class="gp-h">Gerar termo</div><div class="gp-cols">${Object.entries(TERMOS).map(([k, [t]]) => `<button type="button" class="btn sm" data-t="${k}" style="justify-content:flex-start">${esc(t)}</button>`).join("")}</div><p class="hint">Dentro do termo, busque pelo endereço ou nome. Para já abrir preenchido, use os botões dentro do contrato.</p>`, 300);
  $$("[data-t]", p).forEach(b => b.addEventListener("click", () => { fecharPop(); abrirTermo(b.dataset.t, ""); }));
};
ACT["xls-ctt"] = () => exportarGrade("contratos5", `contratos-${hoje()}.xlsx`, "Contratos");

// ---- importação da aba "Contratos Locação" do Gerador de Contratos (.xlsm) ----
function linhaParaFicha(row) {
  const f = {};
  CP.forEach((cp, i) => {
    if (!i) return;
    let v = row[i];
    if (v instanceof Date) v = `${pad(v.getDate())}/${pad(v.getMonth() + 1)}/${v.getFullYear()}`;
    else if (typeof v === "number") v = cp.tipo === "moeda" ? n2(v) : (Number.isInteger(v) ? String(v) : String(v).replace(".", ","));
    v = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
    if (v === "---" || v === "None") v = "";
    f[cp.k] = v;
  });
  return f;
}
ACT["ctt-importar"] = () => {
  let lidos = null;
  modal({ titulo: "Importar planilha de contratos", largo: true, ok: "Importar",
    corpo: `<p>Escolha o arquivo <b>_Gerador de Contratos - OFICIAL LICO.xlsm</b>. O sistema lê a aba <b>Contratos Locação</b> aqui mesmo no seu navegador e grava a ficha completa de cada contrato (endereço, matrícula, UC, RGI, locadores, locatários, fiadores com RG/CPF, testemunhas, status…).</p>
      <input type="file" data-arq accept=".xlsm,.xlsx">
      <div data-res class="box" hidden></div>
      <label class="chk"><input type="checkbox" name="substituir"> Substituir também as fichas que já foram preenchidas ou alteradas no sistema</label>
      <p class="hint">Contratos novos são criados. A <b>situação</b> e as <b>observações</b> dos contratos que já existem no sistema são mantidas (o sistema passa a ser o lugar oficial delas).</p>`,
    aoAbrir: (f, d) => {
      $("[data-arq]", d).addEventListener("change", async e => {
        const arq = e.target.files[0], res = $("[data-res]", d); if (!arq) return;
        res.hidden = false; res.textContent = "Lendo a planilha…";
        try {
          await carregarXLSX();
          const wb = XLSX.read(await arq.arrayBuffer(), { type: "array", cellDates: true, sheets: ["Contratos Locação"] });
          const ws = wb.Sheets["Contratos Locação"]; if (!ws) throw new Error('A aba "Contratos Locação" não foi encontrada neste arquivo.');
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
          const porCod = new Map();
          rows.slice(5).forEach(r => {
            const cod = String(r[0] || "").trim(); if (!/^L\.\d{2}\.\d{3}$/.test(cod)) return;
            const f = linhaParaFicha(r);
            if (!f.fins && !f.lct1_nome && !f.lcd1_nome) return;
            porCod.set(cod, f);
          });
          const ex = new Map(CTT.map(c => [c.codigo, c]));
          const novos = [], vazios = [], cheios = [];
          porCod.forEach((f, cod) => { const c = ex.get(cod); if (!c) novos.push(cod); else if (!c.ficha || !Object.keys(c.ficha).length) vazios.push(cod); else cheios.push(cod); });
          lidos = { porCod, novos, vazios, cheios };
          res.innerHTML = `<b>${porCod.size}</b> contratos na planilha · <b>${novos.length}</b> novos · <b>${vazios.length}</b> já existem sem ficha (serão completados) · <b>${cheios.length}</b> já têm ficha no sistema${cheios.length ? " (só são substituídos se marcar a opção abaixo)" : ""}.`;
        } catch (err) { lidos = null; res.textContent = "Não foi possível ler: " + erroMsg(err); }
      });
    },
    salvar: async f => {
      if (!lidos) throw new Error("Escolha o arquivo da planilha.");
      const cods = lidos.novos.concat(lidos.vazios, f.substituir.checked ? lidos.cheios : []);
      const ex = new Map(CTT.map(c => [c.codigo, c]));
      const imvPorCtt = new Map(S.imoveis.filter(i => i.contrato_codigo).map(i => [i.contrato_codigo, i.id]));
      const btn = f.querySelector("button[type=submit]");
      let n = 0;
      for (const cod of cods) {
        const ficha = Object.assign({}, lidos.porCod.get(cod)), c = ex.get(cod);
        if (c) { ficha.situacao = c.situacao; ficha.obs = c.obs || ficha.obs; await q(sb.from("contratos").update({ ficha }).eq("codigo", cod)); }
        else await q(sb.from("contratos").insert({ codigo: cod, imovel_id: imvPorCtt.get(cod) || null, ficha }));
        if (++n % 20 === 0) btn.textContent = `Importando ${n} de ${cods.length}…`;
      }
      toast(`${n} contratos importados.`); render();
    } });
};

/* =====================================================================
   PÁGINA: CONFIGURAÇÕES (admin)
   ===================================================================== */
const COLS_CONTAS = [
  { k: "ordem_ac", t: "Ordem", nf: true, fixo: true, html: c => `<span class="acts"><button class="btn sm" data-act="conta-mover" data-id="${c.id}" data-d="-1" aria-label="Subir">↑</button><button class="btn sm" data-act="conta-mover" data-id="${c.id}" data-d="1" aria-label="Descer">↓</button></span>` },
  { k: "nome", t: "Conta" },
  { k: "tipo", t: "Tipo", f: c => ({ caixa: "Caixa", banco: "Banco", outro: "Outro" }[c.tipo] || c.tipo) },
  { k: "saldo_inicial", t: "Saldo inicial", tipo: "num" },
  { k: "data_saldo", t: "Em", tipo: "data" },
  { k: "ativa", t: "Situação", f: c => c.ativa ? "Ativa" : "Inativa", html: c => c.ativa ? `<span class="tag ok">Ativa</span>` : `<span class="tag bad">Inativa</span>` }
];
const COLS_CATS = [
  { k: "nome", t: "Categoria" },
  { k: "grupo", t: "Grupo", f: c => GRUPOS[c.grupo] || c.grupo },
  { k: "ativa", t: "Situação", f: c => c.ativa ? "Ativa" : "Inativa", html: c => c.ativa ? `<span class="tag ok">Ativa</span>` : `<span class="tag bad">Inativa</span>` }
];
const COLS_GRUPOS = [
  { k: "ordem_ac", t: "Ordem", nf: true, fixo: true, html: g => `<span class="acts"><button class="btn sm" data-act="grupo-mover" data-id="${esc(g.nome)}" data-d="-1" aria-label="Subir">↑</button><button class="btn sm" data-act="grupo-mover" data-id="${esc(g.nome)}" data-d="1" aria-label="Descer">↓</button></span>` },
  { k: "nome", t: "Grupo" },
  { k: "classe", t: "Classe", f: g => g.classe === "destaque" ? "Destaque" : "Principal locador" },
  { k: "locadores", t: "Locadores do grupo", v: g => (g.locadores || []).join(" · "), cls: "trunc" },
  { k: "imoveis", t: "Imóveis", tipo: "num", int: true, v: g => S.imoveis.filter(i => i.grupo_locador === g.nome).length },
  { k: "alugados", t: "Alugados", tipo: "num", int: true, v: g => S.imoveis.filter(i => i.grupo_locador === g.nome && i.status === "ALG").length }
];
const COLS_MEMBROS = [
  { k: "nome", t: "Nome" }, { k: "email", t: "E-mail" }, { k: "papel", t: "Papel", f: m => PAPEIS[m.papel] || m.papel },
  { k: "ativo", t: "Acesso", f: m => m.ativo ? "Ativo" : "Inativo", html: m => m.ativo ? `<span class="tag ok">Ativo</span>` : `<span class="tag idle">Inativo</span>` },
  { k: "exige_mfa", t: "Código (2FA)", f: m => m.exige_mfa ? "Exigido" : "Não exigido" }
];
const COLS_AUD = [
  { k: "em", t: "Quando", v: a => a.em, f: a => new Date(a.em).toLocaleString("pt-BR") }, { k: "email", t: "Quem", f: a => a.email || "sistema" },
  { k: "tabela", t: "Tabela" }, { k: "operacao", t: "Operação" }, { k: "registro", t: "Registro", cls: "mono trunc" }
];
PAGES.config = async pg => {
  if (!pode.admin()) { pg.innerHTML = `<div class="card empty">Somente o administrador.</div>`; return; }
  const aba = S.f.cfg || "contas";
  if (aba === "grupos") S.gruposCfg = await q(sb.from("grupos_locador").select("*").order("ordem").order("nome"));
  if (aba === "usuarios") S.membros = await q(sb.from("membros").select("*").order("criado_em"));
  if (aba === "auditoria") S.audit = await q(sb.from("auditoria").select("*").order("em", { ascending: false }).limit(500));
  if (aba === "fechamento") S.cfgBloq = await q(sb.from("config").select("*").eq("chave", "bloqueado_ate").maybeSingle());
  setRd(pg, () => desenharConfig());
  desenharConfig(pg);
};
function desenharConfig(pg) {
  pg = pg || $("#page");
  const aba = S.f.cfg || "contas";
  const abas = [["contas", "Contas"], ["categorias", "Plano de contas"], ["grupos", "Grupos de locadores"], ["usuarios", "Usuários"], ["fechamento", "Fechamento"], ["auditoria", "Auditoria"]];
  let html = "";
  const ativasInativas = (id, cols, lista, act, tituloInat, dica) => {
    const at = lista.filter(x => x.ativa), inat = lista.filter(x => !x.ativa);
    const g1 = grade(id, cols, at, { attr: x => `data-act="${act}" data-id="${x.id}" style="cursor:pointer"` }); g1.redesenhar = () => desenharConfig();
    let h = gradeHTML(id);
    if (inat.length) { const g2 = grade(id + "-inat", cols, inat, { attr: x => `data-act="${act}" data-id="${x.id}" style="cursor:pointer"`, cls: () => "inativa" }); g2.redesenhar = () => desenharConfig();
      h += `<h3 style="margin-top:8px;color:var(--bad)">${esc(tituloInat)} (${inat.length})</h3><p class="hint">${esc(dica)}. Clique para reativar ou excluir.</p><div class="inativas">${gradeHTML(id + "-inat")}</div>`; }
    return h;
  };
  if (aba === "contas") {
    html = `<div class="filters"><span class="hint">Onde o dinheiro fica. O saldo inicial é o saldo real da conta na data informada (pegue no extrato). Use ↑ ↓ para mudar a ordem em que as contas aparecem no painel e nos formulários.</span><span class="spacer"></span>${gradeBarra("contas")}<button class="btn pri" data-act="conta-ed">+ Conta</button></div>
      ${ativasInativas("contas", COLS_CONTAS, S.contas, "conta-ed", "Contas inativas", "não aparecem no painel nem nos formulários; o histórico continua guardado")}`;
  } else if (aba === "categorias") {
    html = `<div class="filters"><span class="hint">O grupo decide onde a categoria aparece na DRE.</span><span class="spacer"></span>${gradeBarra("categorias")}<button class="btn pri" data-act="cat-ed">+ Categoria</button></div>
      ${ativasInativas("categorias", COLS_CATS, S.categorias, "cat-ed", "Categorias inativas", "não aparecem nos formulários; lançamentos antigos continuam na DRE")}`;
  } else if (aba === "grupos") {
    const g = grade("grupos", COLS_GRUPOS, S.gruposCfg || [], { attr: x => `data-act="grupo-ed" data-id="${esc(x.nome)}" style="cursor:pointer"` }); g.redesenhar = () => desenharConfig();
    html = `<div class="filters"><span class="hint">Como no Excel: cada grupo junta os <b>nomes de locadores</b> da mesma família ou empresa. O imóvel entra no grupo pelo nome do locador, sozinho. "Destaque" aparece separado nos gráficos (ex.: FB); "Principal locador" entra em "Principais locadores". Imóveis da imobiliária (IMOB) e do sócio (CF) são definidos pela <b>carteira</b> do imóvel.</span><span class="spacer"></span>${gradeBarra("grupos")}<button class="btn pri" data-act="grupo-ed">+ Grupo</button></div>${gradeHTML("grupos")}`;
  } else if (aba === "usuarios") {
    const g = grade("membros", COLS_MEMBROS, S.membros || [], { attr: m => `data-act="membro-ed" data-id="${m.id}" style="cursor:pointer"` }); g.redesenhar = () => desenharConfig();
    html = `<div class="box">Para criar um usuário: no Supabase, <b>Authentication › Users › Add user</b> (e-mail + senha). Ele aparece aqui <b>inativo</b>; ative e escolha o papel. O cadastro público deve ficar <b>desligado</b>.</div>${gradeHTML("membros")}`;
  } else if (aba === "fechamento") {
    const b = S.cfgBloq && S.cfgBloq.valor;
    html = `<div class="card"><h2>Fechamento de mês</h2><p>Depois de conferir o caixa com o extrato, feche o mês: ninguém mais consegue criar, alterar ou apagar lançamentos com data até o fim desse mês (nem estornos).</p>
      <p>Situação atual: ${b ? `<b>fechado até ${dt(b)}</b>` : "<b>nenhum mês fechado</b>"}</p>
      <div class="filters"><button class="btn pri" data-act="fechar-ate" data-v="${fimMes(addMes(inicioMes(hoje()), -1))}">Fechar até ${esc(mesTxt(addMes(inicioMes(hoje()), -1)))}</button>
      ${b ? `<button class="btn danger" data-act="fechar-ate" data-v="">Reabrir tudo</button>` : ""}</div></div>`;
  } else if (aba === "auditoria") {
    const g = grade("auditoria", COLS_AUD, (S.audit || []).map((a, k) => Object.assign({ _k: k }, a)), { attr: a => `data-act="audit-ver" data-k="${a._k}" style="cursor:pointer"`, sort: { k: "em", dir: "desc" } }); g.redesenhar = () => desenharConfig();
    html = `<div class="filters"><span class="hint">Últimas 500 alterações. Ninguém consegue apagar este registro.</span><span class="spacer"></span>${gradeBarra("auditoria")}</div>${gradeHTML("auditoria")}`;
  }
  pg.innerHTML = `<div class="grid"><div class="chips">${abas.map(([k, t]) => `<button class="chip${aba === k ? " on" : ""}" data-act="cfg-aba" data-v="${k}">${t}</button>`).join("")}</div>${html}</div>`;
}
ACT["cfg-aba"] = el => { S.f.cfg = el.dataset.v; render(); };
function tabelaAtivasInativas() { return ""; } // (substituída pelas grades)
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
ACT["conta-mover"] = async el => {
  const lista = S.contas.slice(), i = lista.findIndex(c => c.id === el.dataset.id), j = i + +el.dataset.d;
  if (i < 0 || j < 0 || j >= lista.length) return;
  [lista[i], lista[j]] = [lista[j], lista[i]];
  for (let k = 0; k < lista.length; k++) if (lista[k].ordem !== k + 1) await q(sb.from("contas").update({ ordem: k + 1 }).eq("id", lista[k].id));
  await recarregarContas(); desenharConfig();
};
ACT["conta-ed"] = el => {
  const c = S.contas.find(x => x.id === el.dataset.id) || { tipo: "banco", saldo_inicial: 0, data_saldo: hoje().slice(0, 4) + "-01-01", ativa: true, ordem: S.contas.length + 1 };
  modal({ titulo: c.id ? "Conta" : "Nova conta", corpo: `
    <label class="fl"><span>Nome</span><input name="nome" value="${esc(c.nome || "")}" required></label>
    <label class="fl"><span>Tipo</span><select name="tipo">${opt("caixa", "Caixa (dinheiro)", c.tipo === "caixa")}${opt("banco", "Banco", c.tipo === "banco")}${opt("outro", "Outro", c.tipo === "outro")}</select></label>
    <div class="row"><label class="fl"><span>Saldo inicial</span><input name="saldo" inputmode="decimal" value="${n2(c.saldo_inicial)}"></label>
    <label class="fl"><span>Na data</span><input type="date" name="data" value="${c.data_saldo}" required></label></div>
    <label class="chk"><input type="checkbox" name="ativa" ${c.ativa ? "checked" : ""}> Ativa</label>
    <p class="hint">Lançamentos antes da data do saldo inicial não entram no saldo da conta. Uma conta já usada não pode ser excluída: desmarque "Ativa" para escondê-la.</p>`,
    extra: c.id ? `<button type="button" class="btn danger left" data-del>Excluir</button>` : "",
    aoAbrir: (f, d) => { const b = $("[data-del]", d); if (b) b.addEventListener("click", () => { d.close(); excluirCadastro("contas", c.id, c.nome, recarregarContas); }); },
    salvar: async f => {
      const d = { nome: f.nome.value.trim(), tipo: f.tipo.value, saldo_inicial: parseMoney(f.saldo.value) || 0, data_saldo: f.data.value, ativa: f.ativa.checked };
      if (c.id) await q(sb.from("contas").update(d).eq("id", c.id)); else await q(sb.from("contas").insert(Object.assign({ ordem: S.contas.length + 1 }, d)));
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
ACT["grupo-mover"] = async el => {
  const lista = (S.gruposCfg || []).slice(), i = lista.findIndex(g => g.nome === el.dataset.id), j = i + +el.dataset.d;
  if (i < 0 || j < 0 || j >= lista.length) return;
  [lista[i], lista[j]] = [lista[j], lista[i]];
  for (let k = 0; k < lista.length; k++) if (lista[k].ordem !== k + 1) await q(sb.from("grupos_locador").update({ ordem: k + 1 }).eq("nome", lista[k].nome));
  render();
};
ACT["grupo-ed"] = el => {
  const g = (S.gruposCfg || []).find(x => x.nome === el.dataset.id) || { classe: "grande", locadores: [] };
  const usados = new Set(); (S.gruposCfg || []).forEach(x => { if (x.nome !== g.nome) (x.locadores || []).forEach(l => usados.add(l)); });
  const todos = Array.from(new Set(S.imoveis.map(i => i.locador).filter(Boolean).concat(g.locadores || []))).sort((a, b) => a.localeCompare(b, "pt-BR"));
  modal({ titulo: g.nome ? "Grupo de locadores" : "Novo grupo", largo: true, corpo: `
    <div class="row"><label class="fl"><span>Nome do grupo</span><input name="nome" value="${esc(g.nome || "")}" required ${g.nome ? "disabled" : ""}></label>
    <label class="fl"><span>Classe</span><select name="classe">${opt("grande", "Principal locador", g.classe === "grande")}${opt("destaque", "Destaque (aparece sozinho)", g.classe === "destaque")}</select></label></div>
    <h3>Locadores deste grupo</h3><p class="hint">Marque os nomes (como estão no cadastro dos imóveis). Nomes já usados em outro grupo aparecem desabilitados.</p>
    <input type="search" placeholder="Pesquisar nome…" data-gbusca style="width:100%;border:1px solid var(--line);border-radius:6px;padding:7px 10px">
    <div class="gp-lista grupo-lista">${todos.map(l => `<label data-txt="${esc(norm(l))}"><input type="checkbox" value="${esc(l)}" ${(g.locadores || []).includes(l) ? "checked" : ""} ${usados.has(l) ? "disabled" : ""}> <span>${esc(l)}</span><small>${S.imoveis.filter(i => i.locador === l).length}</small></label>`).join("")}</div>`,
    extra: g.nome ? `<button type="button" class="btn danger left" data-del>Excluir grupo</button>` : "",
    aoAbrir: (f, d) => {
      $("[data-gbusca]", d).addEventListener("input", e => { const t = norm(e.target.value); $$(".grupo-lista label", d).forEach(l => (l.hidden = !!t && !l.dataset.txt.includes(t))); });
      const b = $("[data-del]", d); if (b) b.addEventListener("click", async () => { d.close(); if (!(await confirmar("Excluir grupo", `Excluir o grupo <b>${esc(g.nome)}</b>? Os imóveis voltam para "outros locadores".`, "Excluir"))) return; try { await q(sb.from("grupos_locador").delete().eq("nome", g.nome)); await recarregarImoveis(); toast("Excluído."); render(); } catch (e) { falha(e); } });
    },
    salvar: async f => {
      const locs = $$(".grupo-lista input:checked", $("#dlg")).map(x => x.value);
      const d = { classe: f.classe.value, locadores: locs };
      if (g.nome) await q(sb.from("grupos_locador").update(d).eq("nome", g.nome));
      else { if (!f.nome.value.trim()) throw new Error("Informe o nome do grupo."); await q(sb.from("grupos_locador").insert(Object.assign({ nome: f.nome.value.trim(), ordem: (S.gruposCfg || []).length + 1 }, d))); }
      await recarregarImoveis(); toast("Salvo."); render();
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
const TABELAS_BKP = ["config", "contas", "categorias", "grupos_locador", "imoveis", "contratos", "reajustes", "devedores", "cobrancas", "lancamentos", "mapa_mensal"];
const ORDEM_PK = { config: "chave", contratos: "codigo", mapa_mensal: "competencia", grupos_locador: "nome" };
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
