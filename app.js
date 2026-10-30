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
// Permissões: o papel define o que o banco permite com dinheiro; as abas (ver / alterar) vêm de
// Configurações › Usuários. As regras valem também no banco (RLS), não só na tela.
const ABAS = [
  ["Financeiro", [["caixa", "Caixa e lançamentos"], ["alugueis", "Pgto locatário (aluguéis)"], ["depositos", "Pgto locador (depósitos)"], ["atrasados", "Cobrança · inadimplência"], ["devedores", "Cobrança · devedores (ex-locatários)"], ["recibos", "Recibos (locatário e locador)"], ["notas", "Notas fiscais"]]],
  ["Cadastros", [["locadores", "Locadores"], ["imoveis", "Imóveis"], ["contratos", "Contratos"], ["caucao", "Contas caução"], ["fornecedores", "Prestadores e lojas"]]],
  ["Vendas", [["vendas", "Vendas"]]],
  ["Gestão", [["tarefas", "Tarefas"], ["painel", "Dashboard · Painel"], ["indicadores", "Dashboard · Indicadores"], ["dre", "Dashboard · Resultado (DRE)"]]],
  ["Sistema", [["backup", "Backup e dados"], ["config", "Configurações"], ["tutoriais", "Tutoriais"]]]];
const FLAGS = [["saldo_acumulado", "Ver o saldo acumulado das contas"]];
const PERM_PADRAO = {
  admin: { painel: "editar", indicadores: "editar", dre: "editar", alugueis: "editar", atrasados: "editar", devedores: "editar", caixa: "editar", depositos: "editar", imoveis: "editar", contratos: "editar", caucao: "editar", vendas: "editar", tarefas: "editar", locadores: "editar", fornecedores: "editar", recibos: "ver", tutoriais: "ver", backup: "editar", config: "editar", saldo_acumulado: true , notas: "editar" },
  financeiro: { painel: "ver", indicadores: "ver", dre: "ver", alugueis: "editar", atrasados: "editar", devedores: "editar", caixa: "editar", depositos: "editar", imoveis: "editar", contratos: "editar", caucao: "editar", vendas: "editar", tarefas: "editar", locadores: "editar", fornecedores: "editar", recibos: "ver", tutoriais: "ver", backup: "ver", saldo_acumulado: true , notas: "editar" },
  recepcao: { alugueis: "editar", atrasados: "ver", caixa: "editar", depositos: "editar", imoveis: "ver", tarefas: "editar", fornecedores: "ver", recibos: "ver", tutoriais: "ver", locadores: "ver" },
  leitura: { painel: "ver", indicadores: "ver", dre: "ver", alugueis: "ver", atrasados: "ver", devedores: "ver", caixa: "ver", depositos: "ver", imoveis: "ver", contratos: "ver", caucao: "ver", vendas: "ver", tarefas: "ver", locadores: "ver", fornecedores: "ver", recibos: "ver", tutoriais: "ver", saldo_acumulado: true , notas: "ver" },
  backup: {}
};
const pode = {
  ver: a => S.papel === "admin" || ["ver", "editar"].includes((S.perm || {})[a]),
  ed: a => S.papel === "admin" || (S.perm || {})[a] === "editar",
  flag: f => S.papel === "admin" || !!(S.perm || {})[f],
  editar: () => ["admin", "financeiro"].includes(S.papel) && pode.ed(S.page),
  receber: () => ["admin", "financeiro", "recepcao"].includes(S.papel) && pode.ed(S.page),
  admin: () => S.papel === "admin",
  lancar: () => ["admin", "financeiro", "recepcao"].includes(S.papel) && pode.ed(S.page)
};
const PAPEIS = { admin: "Administrador", financeiro: "Financeiro", recepcao: "Recepção", leitura: "Somente leitura", backup: "Backup automático" };
const GRUPOS = {
  receita: "Receita", imposto: "Imposto", custo: "Custo", despesa: "Despesa", retirada: "Retirada dos sócios",
  terceiros_entrada: "Proprietários (entrada)", terceiros_saida: "Proprietários (saída)", transferencia: "Transferência"
};
// link do imóvel no site: CFG.SITE_IMOVEL_URL com {codigo} (padrão: busca no Google dentro do site)
const urlSite = cod => (CFG.SITE_IMOVEL_URL || "https://www.google.com/search?q=site%3Aimobiliariabandeirantes.com.br+%22{codigo}%22").replace("{codigo}", encodeURIComponent(String(cod).trim()));
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
  await recarregarLocadores();
  try { S.perm = await rpc("minhas_permissoes"); } catch (e) { S.perm = PERM_PADRAO[S.papel] || {}; }
  S.gradePadrao = {}; padroes.forEach(r => { try { S.gradePadrao[r.chave.slice(6)] = JSON.parse(r.valor); } catch (e) { /* ignora */ } });
  sb.rpc("garantir_mapa_mes").then(() => {}, () => {}); // foto automática do mapa do mês
}
const soMinhasContas = l => S.papel === "recepcao" ? l.filter(s => s.tipo === "caixa") : l;
const COLL = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
function setImoveis(list) { list.sort((a, b) => COLL.compare(a.endereco, b.endereco)); S.imoveis = list; S.imovelPor = {}; list.forEach(i => (S.imovelPor[i.id] = i)); }
async function recarregarLocadores() { S.locadores = await q(sb.from("locadores").select("*").order("nome")).catch(() => []); S.fornecedores = await q(sb.from("fornecedores").select("*").order("nome")).catch(() => []); }
const locadorExiste = n => (S.locadores || []).some(l => l.nome === n);
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
  if (S.user && Date.now() - ultimoUso > (CFG.MINUTOS_INATIVIDADE || 240) * 60000) { protecao(false); sair("Sessão encerrada por inatividade."); return; }
  // proteção de tela: depois de alguns minutos parado, esconde as informações (volta sem senha)
  const pm = CFG.PROTECAO_MINUTOS == null ? 5 : +CFG.PROTECAO_MINUTOS;
  if (S.user && pm > 0 && !$("#v-app").hidden && Date.now() - ultimoUso > pm * 60000) protecao(true);
}, 15000);
let PROT = null;
// proteção de tela: tela escura com a marca; volta com clique ou tecla (sem senha)
function protecao(liga) {
  if (!liga) { if (PROT) { clearInterval(PROT.rel); PROT.el.remove(); PROT = null; document.body.classList.remove("protegido"); } return; }
  if (PROT) return;
  const el = document.createElement("div"); el.className = "auth login protecao"; el.setAttribute("role", "button"); el.setAttribute("aria-label", "Clique ou aperte uma tecla para voltar ao sistema");
  el.innerHTML = `<svg class="login-wm" aria-hidden="true"><use href="#logo-casa"/></svg>
    <div class="marca prot-marca"><svg class="marca-logo" aria-hidden="true"><use href="#logo-casa"/></svg><span class="marca-sep"></span>
      <div class="marca-txt"><small>IMOBILIÁRIA</small><b>BANDEIRANTES</b><span>FICA ADMINISTRAÇÃO DE IMÓVEIS</span></div></div>
    <div class="prot-centro"><h1 class="prot-pulsa">FICA Imob<em>One</em></h1><p>Sistema de Gestão Imobiliária</p><span>Imóveis • Locações • Financeiro • Indicadores</span><div class="prot-hora" data-rel></div></div>
    <div class="prot-user">${esc((S.membro && (S.membro.nome || S.membro.email)) || "")}</div>
    <p class="prot-dica">Clique ou aperte uma tecla para voltar</p>`;
  document.body.appendChild(el); document.body.classList.add("protegido");
  const rel = el.querySelector("[data-rel]");
  const hora = () => { const d = new Date(); rel.textContent = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) + " · " + d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }); };
  hora();
  const ini = Date.now();
  const sai = ev => {
    if (Date.now() - ini < 600) return;
    ev.preventDefault(); ev.stopPropagation();
    ["keydown", "mousedown", "touchstart"].forEach(t => document.removeEventListener(t, sai, true));
    ultimoUso = Date.now(); protecao(false);
  };
  ["keydown", "mousedown", "touchstart"].forEach(t => document.addEventListener(t, sai, true));
  PROT = { el, rel: setInterval(hora, 20000) };
}

/* ---------------- tela de login: tema, ver senha, tempo da sessão ---------------- */
(function () {
  const m = CFG.MINUTOS_INATIVIDADE || 240, txt = m % 60 === 0 ? `${m / 60} hora${m === 60 ? "" : "s"}` : `${m} minutos`;
  const l = document.getElementById("login-lock"); if (l) l.textContent = `Conexão criptografada. Depois da senha, será pedido o código de 6 dígitos do seu aplicativo autenticador. A sessão se encerra ao fechar a aba ou após ${txt} parado.`;
  const t = document.getElementById("login-tema"); if (t) t.addEventListener("click", () => ACT.tema());
  const o = document.getElementById("ver-senha"); if (o) o.addEventListener("click", () => { const i = document.querySelector("#f-login [name=senha]"); i.type = i.type === "password" ? "text" : "password"; });
})();
/* ---------------- tema ---------------- */
function aplicarTema() { const t = lsGet("tema", ""); if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
aplicarTema();

/* ---------------- app / rotas ---------------- */
const PAGES = {};
const DASH = [["painel", "Painel"], ["indicadores", "Indicadores"], ["dre", "Resultado (DRE)"]];
const PERM_DE = p => ({ recibos_lct: "recibos", recibos_lcd: "recibos" })[p] || p;
const TITULOS = { notas: "Notas fiscais", recibos_lct: "Recibos de locatários", recibos_lcd: "Recibos de locadores", locadores: "Locadores", fornecedores: "Prestadores e lojas", tutoriais: "Tutoriais", painel: "Dashboard", alugueis: "Pagamento de locatários (aluguéis do mês)", atrasados: "Cobrança", caixa: "Caixa e lançamentos", tarefas: "Tarefas", vendas: "Vendas",
  dre: "Dashboard", depositos: "Pagamento de locadores", indicadores: "Indicadores", devedores: "Cobrança", imoveis: "Imóveis", contratos: "Contratos", caucao: "Contas caução", backup: "Backup e dados", config: "Configurações" };
const SEM_MES = ["locadores", "fornecedores", "tutoriais", "contratos", "backup", "config", "devedores", "tarefas", "vendas", "caucao"];

function montarApp() {
  $("#brand-name").textContent = CFG.NOME_EMPRESA || "Imobiliária Bandeirantes";
  document.title = "FICA ImobOne";
  $("#me-nome").textContent = S.membro.nome || S.membro.email;
  $("#me-papel").textContent = PAPEIS[S.papel] || S.papel;
  $$("#nav a").forEach(a => { a.hidden = a.dataset.p === "painel" ? !DASH.some(([k]) => pode.ver(k)) : !pode.ver(PERM_DE(a.dataset.p)); });
  $$("#nav .nav-h").forEach(h => { let n = h.nextElementSibling, vis = false; while (n && !n.classList.contains("nav-h")) { if (!n.hidden) vis = true; n = n.nextElementSibling; } h.hidden = !vis; });
  mostrar("app");
  ir();
  // reajustes que chegaram no mês: pede confirmação uma vez por sessão
  if (pode.ed("imoveis") && ssGet("reajVisto", "") !== inicioMes(hoje())) {
    ssSet("reajVisto", inicioMes(hoje()));
    q(sb.from("reajustes").select("id").is("aplicado_em", null).lte("competencia", inicioMes(hoje())))
      .then(l => { if (l.length) setTimeout(() => confirmarReajustes(), 600); }, () => {});
  }
}
function ir() {
  const primeira = ($$("#nav a").find(x => !x.hidden) || { dataset: { p: "painel" } }).dataset.p;
  let p = (location.hash || "#" + primeira).slice(1).split("?")[0];
  if (!PAGES[p]) p = primeira;
  const a = $(`#nav a[data-p="${p}"]`);
  if (a && a.hidden) p = primeira;
  // Dashboard: Painel, Indicadores e DRE na mesma entrada do menu (abas no alto)
  const dash = DASH.some(([k]) => k === p);
  if (dash && !pode.ver(p)) { const ok = DASH.find(([k]) => pode.ver(k)); p = ok ? ok[0] : primeira; }
  S.page = p; S.redesenhar = null; fecharPop(); document.body.classList.remove("com-conta");
  $$("#nav a").forEach(x => x.classList.toggle("on", x.dataset.p === p || (p === "devedores" && x.dataset.p === "atrasados") || (DASH.some(([k]) => k === p) && x.dataset.p === "painel")));
  $("#subabas").innerHTML = DASH.some(([k]) => k === p) ? `<div class="seg cobr-abas dash-abas">${DASH.filter(([k]) => pode.ver(k)).map(([k, t]) => `<a href="#${k}" class="${k === p ? "on" : ""}">${t}</a>`).join("")}</div>` : "";
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
// números no menu lateral (⇄ troca: alugados ⇄ livres, a receber ⇄ recebidos…)
let CONT_T = null;
function atualizarContadores() { clearTimeout(CONT_T); CONT_T = setTimeout(contarMenu, 400); }
// o que cada número do menu pode mostrar (o usuário escolhe a exibição A e a B; ⇄ troca entre elas)
const NAV_MET = {
  alugueis: { aperm: "alugueis", rot: "Pgto locatário", ops: { areceber: "a receber no mês", recebidos: "recebidos no mês", atrasados: "atrasados no mês", nada: "(nada)" } },
  depositos: { aperm: "depositos", rot: "Pgto locador", ops: { afazer: "repasses a fazer", feitos: "repasses feitos no mês", nada: "(nada)" } },
  atrasados: { aperm: "atrasados", rot: "Cobrança", ops: { atraso: "aluguéis em atraso", devedores: "devedores (ex-locatários)", nada: "(nada)" } },
  locadores: { aperm: "locadores", rot: "Locadores", ops: { total: "locadores cadastrados", nada: "(nada)" } },
  imoveis: { aperm: "imoveis", rot: "Imóveis", ops: { ALG: "alugados", LVR: "livres", OCP: "ocupados", INTV: "inativos", nada: "(nada)" } },
  contratos: { aperm: "contratos", rot: "Contratos", ops: { ativos: "ativos", semimovel: "sem imóvel ligado", elab: "em elaboração", nada: "(nada)" } },
  caucao: { aperm: "caucao", rot: "Contas caução", ops: { ocup: "ocupadas", livres: "livres", nada: "(nada)" } },
  tarefas: { aperm: "tarefas", rot: "Tarefas", ops: { hoje: "minhas para hoje", atrasadas: "atrasadas", nada: "(nada)" } },
  caixa: { aperm: "caixa", rot: "Caixa", ops: { prevpagar: "previstos a pagar no mês", lancmes: "lançamentos no mês", nada: "(nada)" } },
  recibos_lct: { aperm: "recibos", rot: "Recibos locatário", ops: { mes: "recibos no mês", nada: "(nada)" } },
  recibos_lcd: { aperm: "recibos", rot: "Recibos locador", ops: { mes: "recibos no mês", nada: "(nada)" } },
  notas: { aperm: "notas", rot: "Notas fiscais", ops: { mesir: "aluguéis com IR no mês", emitidas: "notas registradas no mês", nada: "(nada)" } },
  fornecedores: { aperm: "fornecedores", rot: "Prestadores e lojas", ops: { total: "cadastrados", nada: "(nada)" } },
  vendas: { aperm: "vendas", rot: "Vendas", ops: { ano: "vendas no ano", total: "vendas (todas)", areceber: "com comissão a receber", nada: "(nada)" } },
  tutoriais: { aperm: "tutoriais", rot: "Tutoriais", ops: { total: "tutoriais", nada: "(nada)" } }
};
const NAV_PADRAO = { A: { alugueis: "areceber", depositos: "afazer", atrasados: "atraso", locadores: "nada", imoveis: "ALG", contratos: "ativos", caucao: "ocup", tarefas: "hoje", caixa: "nada", recibos_lct: "nada", recibos_lcd: "nada", notas: "mesir", fornecedores: "nada", vendas: "ano", tutoriais: "nada" },
  B: { alugueis: "recebidos", depositos: "feitos", atrasados: "devedores", locadores: "total", imoveis: "LVR", contratos: "semimovel", caucao: "livres", tarefas: "atrasadas", caixa: "prevpagar", recibos_lct: "mes", recibos_lcd: "mes", notas: "emitidas", fornecedores: "total", vendas: "areceber", tutoriais: "nada" } };
// cada usuário tem a sua escolha (guardada neste computador)
const navChave = k => k + "." + ((S.user && S.user.id) || "");
const navCfg = () => { try { const c = JSON.parse(lsGet(navChave("navCfg"), "") || lsGet("navCfg", "") || "null"); return c && c.A && c.B ? { A: Object.assign({}, NAV_PADRAO.A, c.A), B: Object.assign({}, NAV_PADRAO.B, c.B) } : NAV_PADRAO; } catch (e) { return NAV_PADRAO; } };
async function contarMenu() {
  if (!S.membro) return;
  const modo = lsGet(navChave("navInv"), "") === "1" ? "B" : "A", cfg = navCfg()[modo];
  const put = (k, n, titulo, alerta) => { const el = $(`.nav-c[data-c="${k}"]`); if (!el) return; el.textContent = n == null ? "" : String(n); el.title = titulo || ""; el.classList.toggle("b", !!alerta && n > 0); };
  const conta = async b => { try { const r = await b; return r.error ? null : r.count; } catch (e) { return null; } };
  const head = t => sb.from(t).select("*", { count: "exact", head: true });
  const cob = () => head("cobrancas").eq("competencia", S.mes);
  const Q = {
    alugueis: { areceber: () => conta(cob().is("data_pagamento", null).is("devedor_id", null)), recebidos: () => conta(cob().not("data_pagamento", "is", null)), atrasados: () => conta(cob().is("data_pagamento", null).is("devedor_id", null).lt("vencimento", hoje())) },
    depositos: { afazer: () => conta(cob().not("data_pagamento", "is", null).is("repasse_data", null)), feitos: () => conta(cob().not("repasse_data", "is", null)) },
    atrasados: { atraso: () => conta(head("cobrancas").is("data_pagamento", null).is("devedor_id", null).lt("vencimento", hoje())), devedores: () => pode.ver("devedores") ? conta(head("devedores").in("situacao", ["EM ABERTO", "ACORDO"])) : null },
    locadores: { total: () => conta(head("locadores").eq("ativo", true)) },
    imoveis: { ALG: () => S.imoveis.filter(i => i.status === "ALG").length, LVR: () => S.imoveis.filter(i => i.status === "LVR").length, OCP: () => S.imoveis.filter(i => i.status === "OCP").length, INTV: () => S.imoveis.filter(i => i.status === "INTV").length },
    contratos: { ativos: () => conta(head("contratos").eq("situacao", "ATIVO")), semimovel: () => conta(head("contratos").in("situacao", ["ATIVO", "EM ELABORAÇÃO"]).is("imovel_id", null)), elab: () => conta(head("contratos").eq("situacao", "EM ELABORAÇÃO")) },
    caucao: { ocup: () => conta(head("cauc_mov").is("data_saida", null).eq("somada", false)),
      livres: async () => { const [t, bl, oc] = await Promise.all([conta(head("cauc_contas")), conta(head("cauc_contas").eq("bloqueada", true)), conta(head("cauc_mov").is("data_saida", null).eq("somada", false))]); return t == null ? null : Math.max(0, t - bl - oc); } },
    tarefas: { hoje: () => q(sb.from("tarefas").select("*").eq("ativa", true)).then(ls => ls.filter(t => tarefaPendente(t) && (!t.responsavel || t.responsavel === S.user.id)).length).catch(() => null),
      atrasadas: () => q(sb.from("tarefas").select("*").eq("ativa", true)).then(ls => ls.filter(t => { const d = dataTarefa(t); return d && d < hoje() && !tarefaFeita(t); }).length).catch(() => null) },
    caixa: { prevpagar: () => conta(head("lancamentos").eq("competencia", S.mes).eq("pago", false).eq("tipo", "saida")), lancmes: () => conta(head("lancamentos").eq("competencia", S.mes)) },
    recibos_lct: { mes: () => conta(cob().not("recibo_locatario", "is", null)) },
    recibos_lcd: { mes: () => conta(cob().not("recibo_locador", "is", null)) },
    notas: { mesir: () => S.imoveis.filter(i => i.declarar_ir === "Sim" && i.status === "ALG").length, emitidas: () => conta(head("notas_fiscais").eq("competencia", S.mes).neq("numero", "")) },
    fornecedores: { total: () => conta(head("fornecedores").eq("ativo", true)) },
    vendas: { ano: () => conta(head("vendas").gte("data", S.mes.slice(0, 4) + "-01-01").lte("data", S.mes.slice(0, 4) + "-12-31")), total: () => conta(head("vendas")),
      areceber: async () => { try { const [vs, its] = await Promise.all([q(sb.from("vendas").select("id,comissao,lancamento_id")), q(sb.from("venda_itens").select("venda_id,tipo,valor,pago_em").eq("tipo", "comissao"))]);
        return vs.filter(v => { const pg = its.filter(i => i.venda_id === v.id && i.pago_em).reduce((a, i) => a + +i.valor, 0); return +v.comissao > 0 && !v.lancamento_id && pg < +v.comissao - 0.005; }).length; } catch (e) { return null; } } },
    tutoriais: { total: () => conta(head("tutoriais")).then(n => n == null ? null : n + TUTORIAIS.length) }
  };
  const ALERTA = { afazer: 1, atraso: 1, devedores: 1, semimovel: 1, hoje: 1, atrasados: 1, prevpagar: 1 };
  await Promise.all(Object.entries(NAV_MET).map(async ([k, m]) => {
    const op = cfg[k];
    if (!pode.ver(m.aperm) || !op || op === "nada" || !Q[k][op]) return put(k, null);
    put(k, await Q[k][op](), m.ops[op], ALERTA[op]);
  }));
}
async function render() {
  const tok = ++S.rtok, real = $("#page"), tmp = document.createElement("div");
  tmp.dataset.tok = String(tok);
  real.classList.add("loading");
  try {
    await PAGES[S.page](tmp);
    if (tok !== S.rtok) return;
    real.replaceChildren(...tmp.childNodes);
    requestAnimationFrame(ajustarAlturas);
    atualizarContadores();
  } catch (e) {
    if (tok !== S.rtok) return;
    falha(e); real.innerHTML = `<div class="card empty">Não foi possível carregar: ${esc(erroMsg(e))}</div>`;
  } finally { if (tok === S.rtok) real.classList.remove("loading"); }
}
window.addEventListener("hashchange", () => { if (S.user && S.membro) ir(); });

/* ---------------- ações (cliques) ---------------- */
const ACT = {};
ACT["nav-inv"] = () => { lsSet(navChave("navInv"), lsGet(navChave("navInv"), "") === "1" ? "" : "1"); contarMenu(); };
ACT["nav-cfg"] = () => {
  const c = navCfg();
  modal({ titulo: "Números do menu", largo: true, ok: "Salvar",
    corpo: `<p class="hint">Escolha o que cada número mostra nas exibições A e B. O botão ⇄ troca entre elas (agora: <b>${lsGet(navChave("navInv"), "") === "1" ? "B" : "A"}</b>). A escolha vale só para você.</p>
      <div class="tw"><table class="compacta"><thead><tr><th>Menu</th><th>Exibição A</th><th>Exibição B</th></tr></thead><tbody>
      ${Object.entries(NAV_MET).filter(([, m]) => pode.ver(m.aperm)).map(([k, m]) => `<tr><td>${esc(m.rot)}</td>${["A", "B"].map(x => `<td><select data-nm="${x}:${k}">${Object.entries(m.ops).map(([o, t]) => opt(o, t, c[x][k] === o)).join("")}</select></td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <button type="button" class="btn sm" data-np>Voltar ao padrão</button>`,
    aoAbrir: (f, d) => $("[data-np]", d).addEventListener("click", () => { lsSet(navChave("navCfg"), ""); lsSet("navCfg", ""); d.close(); contarMenu(); }),
    salvar: async () => {
      const n = { A: {}, B: {} }; $$("[data-nm]", $("#dlg")).forEach(x => { const [m, k] = x.dataset.nm.split(":"); n[m][k] = x.value; });
      lsSet(navChave("navCfg"), JSON.stringify(n)); contarMenu(); toast("Salvo para você, neste computador.");
    } });
};
document.addEventListener("click", ev => {
  if (ev.target.closest("a[data-pasta],[data-csel],[data-sel],[data-sel-todos],[data-tok]")) return; // link da pasta e caixa de seleção dentro de linhas clicáveis
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
function tabelaPermissoes(perm, editavel) {
  const nv = v => v === "editar" ? `<span class="tag ok">Ver e alterar</span>` : v === "ver" ? `<span class="tag info">Só ver</span>` : `<span class="tag idle">Sem acesso</span>`;
  return `<div class="perm">${ABAS.map(([sec, abas]) => `<div class="perm-s"><h3>${esc(sec)}</h3>${abas.map(([k, t]) => `<div class="perm-l"><span>${esc(t)}</span>${editavel
    ? `<select data-perm="${k}">${opt("", "Sem acesso", !perm[k])}${opt("ver", "Só ver", perm[k] === "ver")}${opt("editar", "Ver e alterar", perm[k] === "editar")}</select>` : nv(perm[k])}</div>`).join("")}</div>`).join("")}
    <div class="perm-s"><h3>Valores restritos</h3>${FLAGS.map(([k, t]) => `<div class="perm-l"><span>${esc(t)}</span>${editavel ? `<input type="checkbox" data-flag="${k}" ${perm[k] ? "checked" : ""}>` : (perm[k] ? `<span class="tag ok">Sim</span>` : `<span class="tag idle">Não</span>`)}</div>`).join("")}</div></div>`;
}
ACT.opcoes = () => {
  const perm = S.papel === "admin" ? PERM_PADRAO.admin : (S.perm || {});
  modal({ titulo: "Opções · " + (S.membro.nome || S.membro.email), largo: true, semOk: true,
    extra: `<button type="button" class="btn left" data-o="senha">Trocar senha</button><button type="button" class="btn left" data-o="tema">Tema claro / escuro</button><button type="button" class="btn danger left" data-o="sair">Sair</button>`,
    corpo: `<div class="box">${esc(S.membro.email)} · papel: <b>${esc(PAPEIS[S.papel] || S.papel)}</b></div><h3>O que você pode ver e alterar</h3>${tabelaPermissoes(perm, false)}
      <p class="hint">Quem define as permissões é o administrador, em Configurações › Usuários.</p>`,
    aoAbrir: (f, d) => $$("[data-o]", d).forEach(b => b.addEventListener("click", () => { const o = b.dataset.o; d.close(); setTimeout(() => (o === "tema" ? ACT.tema() : o === "sair" ? sair() : ACT.senha()), 0); })) });
};
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
function modal({ titulo, corpo, ok = "Salvar", salvar, extra = "", largo = false, xl = false, semOk = false, aoAbrir, aoFechar }) {
  const d = $("#dlg"), tok = d._mtok = (d._mtok || 0) + 1;
  if (aoFechar) d.addEventListener("close", function fx() { if (d.open || d._mtok !== tok) { if (d._mtok !== tok) d.removeEventListener("close", fx); return; } d.removeEventListener("close", fx); aoFechar(); }); // ignora o "close" atrasado da janela anterior
  d.style.width = xl ? "min(1180px, calc(100vw - 32px))" : largo ? "min(900px, calc(100vw - 32px))" : "";
  d.classList.toggle("xl", !!xl);
  d.innerHTML = `<form novalidate>
    <div class="dlg-h"><h2>${esc(titulo)}</h2><button type="button" class="x" data-x aria-label="Fechar">×</button></div>
    <div class="dlg-b">${corpo}<p class="err" data-err></p></div>
    <div class="dlg-f"><div class="dlg-ex">${extra}</div><button type="button" class="btn" data-x>${semOk ? "Fechar" : "Cancelar"}</button>${semOk ? "" : `<button type="submit" class="btn pri">${esc(ok)}</button>`}</div>
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
// pede uma última confirmação dentro do próprio formulário (não perde o que foi digitado)
function pedeConfirmacao(f, html, ok) {
  if (f.dataset.conf === "1") return true;
  f.dataset.conf = "1";
  let box = f.querySelector("[data-confbox]");
  if (!box) { box = document.createElement("div"); box.className = "box warn confbox"; box.dataset.confbox = ""; f.querySelector(".dlg-b").appendChild(box); }
  box.innerHTML = html; box.scrollIntoView({ block: "nearest" });
  const b = f.querySelector("button[type=submit]"); b.dataset.txt = b.dataset.txt || b.textContent; b.textContent = ok;
  f.addEventListener("input", () => { f.dataset.conf = ""; box.remove(); b.textContent = b.dataset.txt; }, { once: true });
  return false;
}
// valor em reais enquanto digita: 15000 -> R$ 150,00
const moedaFmt = v => v == null || v === "" ? "" : "R$ " + n2(v);
function mascaraMoeda(inp) {
  if (inp.value && !/^R\$/.test(inp.value)) { const n = parseMoney(inp.value); inp.value = n == null ? "" : moedaFmt(n); }
  inp.addEventListener("input", () => { const d = inp.value.replace(/\D/g, "").replace(/^0+/, ""); inp.value = d ? moedaFmt(+d / 100) : ""; });
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
// v9: acréscimos e descontos detalhados. "de": quem fica com o acréscimo / quem dá o desconto
//   acréscimo: imob (multa, juros: receita da imobiliária) · prop (vai para o proprietário) · repassar (IPTU, condomínio: a imobiliária paga o boleto)
//   desconto:  prop (sai do valor do proprietário) · imob (a imobiliária cobre)
const AJ_DE = { acr: { imob: "fica com a imobiliária", prop: "vai para o proprietário", repassar: "pago pela imobiliária (IPTU, condomínio…)" }, desc: { prop: "por conta do proprietário", imob: "por conta da imobiliária" } };
const AJ_SUG = { acr: [["Multa", "imob"], ["Juros", "imob"], ["IPTU", "repassar"], ["Condomínio", "repassar"], ["Água", "repassar"], ["Energia", "repassar"], ["Maj. tributária", "prop"], ["Diferença de aluguel", "prop"], ["Aluguel proporcional", "prop"], ["Taxa de contrato", "imob"], ["Outros", "prop"]],
  desc: [["Desconto combinado", "prop"], ["Desconto de pontualidade", "prop"], ["Desconto por reparo do locatário", "prop"], ["Aluguel proporcional", "prop"], ["Abono de multa", "imob"], ["Abono de juros", "imob"], ["Outros", "prop"]] };
const ajRot = x => (x.desc || "") + (x.obs ? " (" + x.obs + ")" : "");
function ajustesDe(c) {
  const a = Array.isArray(c.ajustes) ? c.ajustes : [];
  if (a.length) return a;
  const l = []; // registros antigos: só os totais
  if (+c.acrescimos) l.push({ tipo: "acr", desc: "Acréscimos", valor: +c.acrescimos, de: "prop" });
  if (+c.descontos) l.push({ tipo: "desc", desc: "Descontos", valor: +c.descontos, de: "prop" });
  return l;
}
let DESP = {}; // despesas do proprietário lançadas no caixa (descontam do repasse): imovel_id -> [lançamentos] do mês
async function carregarDesp(comp) {
  const ls = await q(sb.from("lancamentos").select("id,imovel_id,valor,descricao,data,competencia,natureza,fornecedor_id").eq("desconta_repasse", true).eq("competencia", comp)).catch(() => []);
  DESP = {}; ls.forEach(l => (DESP[l.imovel_id] = DESP[l.imovel_id] || []).push(l));
}
// quanto é do proprietário neste aluguel (com taxa, acréscimos/descontos e despesas dele)
function calcCob(c) {
  const aj = ajustesDe(c), soma = (t, de) => r2(aj.filter(x => x.tipo === t && (x.de || "prop") === de).reduce((a, x) => a + (+x.valor || 0), 0));
  const r = { acrProp: soma("acr", "prop"), acrImob: soma("acr", "imob"), acrRep: soma("acr", "repassar"), descProp: soma("desc", "prop"), descImob: soma("desc", "imob") };
  r.recebido = !!c.data_pagamento;
  r.taxa = c.taxa_valor != null ? +c.taxa_valor : r2((+c.valor - r.descProp) * +c.taxa_adm_pct / 100);
  r.desp = (DESP[c.imovel_id] || []).filter(l => l.competencia === c.competencia);
  r.despTot = r2(r.desp.reduce((a, l) => a + +l.valor, 0));
  r.bruto = r.recebido ? r2(+c.valor_pago - r.acrImob - r.acrRep + r.descImob) : r2(+c.valor + r.acrProp - r.descProp);
  r.prop = r2(Math.max(0, r.bruto - r.taxa - r.despTot));
  return r;
}
function stCob(c) {
  if (c.devedor_id && !c.data_pagamento) return "devedor";
  if (c.data_pagamento) {
    if (+c.valor_pago < devido(c) - 0.005) return "parcial";
    if (precisaRepasse(c)) return "pago";
    return "quitado";
  }
  if (c.repasse_data) return "adiantado";
  return c.vencimento < hoje() ? "atrasado" : "aberto";
}
function precisaRepasse(c) { return c.data_pagamento && !c.repasse_data && calcCob(c).prop > 0; }
const podeRepassar = c => !c.repasse_data && !c.devedor_id;
const ST_COB = { aberto: ["A vencer", "idle"], atrasado: ["Atrasado", "bad"], parcial: ["Pago parcial", "warn"], pago: ["A repassar", "info"], quitado: ["Concluído", "ok"], devedor: ["Em devedores", "idle"], adiantado: ["Repassado sem receber", "warn"] };
function tagCob(c) { const s = stCob(c); const [t, k] = ST_COB[s]; return `<span class="tag ${k}${t.length > 14 ? " duas" : ""}">${t}</span>`; }

/* =====================================================================
   PÁGINA: PAINEL
   ===================================================================== */
function evolucaoHTML(evol, cobsAll) {
  const atual = inicioMes(hoje());
  const meses = Array.from(new Set(evol.map(e => e.competencia).concat(cobsAll.map(c => c.competencia)))).sort().filter(m => m <= atual);
  const ev = meses.map(m => {
    const a = evol.find(e => e.competencia === m && e.status === "ALG") || { qtd: 0, valor: 0, comissao: 0 };
    const cs = cobsAll.filter(c => c.competencia === m);
    return { m, q: +a.qtd, esp: +a.valor, espCom: +a.comissao, real: cs.reduce((s, c) => s + +c.recebido, 0), realCom: cs.reduce((s, c) => s + +c.taxa, 0), tem: cs.length > 0 };
  });
  return `<div class="card"><div class="card-h"><h2>Evolução mês a mês — aluguel esperado × recebido</h2><span class="hint">destaque: ${esc(mesCurto(S.mes))}</span></div>
      ${ev.length ? barrasV(ev.map(e => ({ l: mesCurto(e.m), v: e.esp, v2: e.real, atual: e.m === S.mes, tip: `<b>${mesTxt(e.m)}</b><br>Esperado: ${brl(e.esp)}<br>Recebido: ${e.tem ? brl(e.real) : "—"}<br>${e.q} alugados` })), { esq: 96, eixo: brlInt, rotulo: "Esperado e recebido por mês", legenda: `<span><i style="background:var(--s1)"></i>Esperado (mapa)</span><span><i style="background:var(--s2)"></i>Recebido (aluguéis pagos)</span>` }) : `<p class="muted">Nenhum mapa guardado ainda.</p>`}
      ${ev.length ? `<div class="tw" style="margin-top:10px"><table class="evol"><thead><tr><th></th>${ev.map(e => `<th class="num${e.m === S.mes ? " cur" : ""}">${mesCurto(e.m)}</th>`).join("")}</tr></thead><tbody>
        <tr><td>Alugados</td>${ev.map(e => `<td class="num${e.m === S.mes ? " cur" : ""}">${e.q}</td>`).join("")}</tr>
        <tr><td>Aluguel esperado</td>${ev.map(e => `<td class="num${e.m === S.mes ? " cur" : ""}">${n2(e.esp)}</td>`).join("")}</tr>
        <tr><td>Aluguel recebido</td>${ev.map(e => `<td class="num${e.m === S.mes ? " cur" : ""}">${e.tem ? n2(e.real) : "—"}</td>`).join("")}</tr>
        <tr><td>Comissão esperada</td>${ev.map(e => `<td class="num${e.m === S.mes ? " cur" : ""}">${n2(e.espCom)}</td>`).join("")}</tr>
        <tr><td>Comissão real</td>${ev.map(e => `<td class="num${e.m === S.mes ? " cur" : ""}">${e.tem ? n2(e.realCom) : "—"}</td>`).join("")}</tr></tbody></table></div>` : ""}
      <p class="hint">"Recebido" só existe a partir do mês em que os aluguéis passaram a ser gerados e baixados no sistema.</p>
    </div>`;
}
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
  tarefas.push(pode.ver("devedores") ? q(sb.from("devedores").select("valor_total,valor_pago").in("situacao", ["EM ABERTO", "ACORDO"])) : Promise.resolve([]));
  tarefas.push(rpc("resumo_mapa"), rpc("resumo_cobrancas", {}));
  tarefas.push(pode.ver("contratos") || pode.ver("imoveis") ? termosPendentes() : Promise.resolve([]));
  tarefas.push(pode.ver("caucao") ? q(sb.from("cauc_mov").select("id,contrato_codigo").is("data_saida", null)).catch(() => []) : Promise.resolve([]));
  const [res, cobMes, atras, saldosTodos, reaj, cfg, vencendo, devs, evol, cobsAll, termosPend, caucVig] = await Promise.all(tarefas);
  const caucBaixa = caucVig.length ? (await q(sb.from("contratos").select("codigo").in("codigo", caucVig.map(m => m.contrato_codigo).filter(Boolean)).neq("situacao", "ATIVO").neq("situacao", "EM ELABORAÇÃO")).catch(() => [])).length : 0;
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
  if (reaj.length) alertas.push(["warn", `${reaj.length} reajuste(s) programado(s) até ${mesTxt(S.mes)} aguardando confirmação.`, "#imoveis?reaj", "Confirmar"]);
  if (atras.length) alertas.push(["bad", `${atras.length} aluguel(éis) em atraso (${atrasImv} imóveis) somando ${brl(atrasV)}.`, "#atrasados", "Ver lista"]);
  if (repPend.length) alertas.push(["", `${repPend.length} repasse(s) a proprietários pendente(s) neste mês: ${brl(repPendV)}.`, "#alugueis", "Ver"]);
  if (devs.length) alertas.push(["", `${devs.length} ex-locatário(s) devedor(es) com saldo de ${brl(devs.reduce((a, d) => a + +d.valor_total - +d.valor_pago, 0))}.`, "#devedores", "Ver devedores"]);
  if (vencendo.length) alertas.push(["", `${vencendo.length} contrato(s) terminam nos próximos 60 dias.`, "#contratos", "Ver"]);

  const fin = S.papel !== "recepcao";
  pg.innerHTML = `
  <div class="grid">
    ${termosPendentesHTML(termosPend)}
    ${caucBaixa ? `<div class="alert warn"><span><b>${caucBaixa}</b> conta(s) caução aguardando baixa (locatário já saiu): devolução e termo de devolução obrigatórios.</span><a class="btn sm" href="#caucao">Abrir Contas caução</a></div>` : ""}
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
          <div><span title="Aluguéis deste mês ainda não pagos, vencidos ou não">Falta receber neste mês (${nAberto})</span><b class="num">${brl(Math.max(prev - receb, 0))}</b></div>
          <div><span>Repasses pendentes (${repPend.length})</span><b class="num">${brl(repPendV)}</b></div>
          <div><span title="Só aluguéis com vencimento já passado (de qualquer mês), sem contar os que foram para Devedores">Em atraso (já vencidos)</span><b class="num neg">${brl(atrasV)}</b></div>
        </div>
        ${prev ? `<div class="bar" style="margin-top:10px" title="Recebido ${Math.round(receb / prev * 100)}%"><i style="width:${Math.min(receb / prev * 100, 100)}%;background:var(--ok)"></i></div><p class="hint" style="margin-top:4px">${Math.round(receb / prev * 100)}% recebido</p>` : ""}
      </div>
      <div class="card"><div class="card-h"><h2>Saldos</h2><a class="btn sm" href="#caixa">Caixa</a></div>
        <div class="lst">
          ${saldos.map(s => `<div><span>${esc(s.nome)}</span><b class="num ${+s.saldo < 0 ? "neg" : ""}">${s.saldo == null ? "—" : brl(s.saldo)}</b></div>`).join("") || `<div class="muted">Nenhuma conta cadastrada.</div>`}
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
    ${evolucaoHTML(evol, cobsAll)}
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
const ajTxt = c => ajustesDe(c).map(x => (x.tipo === "acr" ? "+ " : "− ") + ajRot(x) + " " + n2(x.valor)).join(" · ");
const COLS_COB = [
  { k: "sel", t: "Seleção", nf: true, fixo: true, th: `<input type="checkbox" data-sel-todos aria-label="Selecionar todos">`, html: c => `<input type="checkbox" data-sel="${c.id}" aria-label="Selecionar">` },
  { k: "vencimento", t: "Venc.", tipo: "data", html: c => `${dt(c.vencimento)}${stCob(c) === "atrasado" ? ` <span class="sub neg">${diasEntre(c.vencimento, hoje())} dias</span>` : ""}` },
  { k: "imovel", t: "Imóvel", v: c => (S.imovelPor[c.imovel_id] || {}).endereco || "?", cls: "trunc" },
  { k: "locatario", t: "Inquilino", cls: "trunc" },
  { k: "locador", t: "Proprietário", cls: "trunc" },
  { k: "devido", t: "Valor", tipo: "num", v: devido, dica: "Valor a receber do locatário. * = tem acréscimo ou desconto (veja a coluna Acrésc./desc.)",
    html: c => ajustesDe(c).length ? `<b title="${esc(ajTxt(c))}">*${n2(devido(c))}</b>` : n2(devido(c)) },
  { k: "taxa", t: "T. Adm.", tipo: "num", v: c => c.taxa_valor, html: c => c.taxa_valor != null ? n2(c.taxa_valor) : `<span class="muted">${n2(+c.taxa_adm_pct)}%</span>` },
  { k: "valor_pago", t: "Recebido", tipo: "num", v: c => c.valor_pago, html: c => c.data_pagamento ? `${n2(c.valor_pago)}<span class="sub" title="${esc(contaPor(c.conta_pgto_id).nome || "")}">${dt(c.data_pagamento)}</span>`
      : !c.devedor_id && pode.receber() ? `<button class="btn sm pri" data-act="receber" data-id="${c.id}">Receber</button>` : "" },
  { k: "data_pagamento", t: "Data receb.", tipo: "data", oculta: true },
  { k: "conta", t: "Conta receb.", v: c => contaPor(c.conta_pgto_id).nome || "", oculta: true },
  { k: "repasse_valor", t: "Repasse", tipo: "num", v: c => c.repasse_valor, html: c => c.repasse_data ? `${n2(c.repasse_valor)}<span class="sub">${dt(c.repasse_data)}</span>`
      : podeRepassar(c) && pode.editar() ? `<button class="btn sm pri" data-act="repassar" data-id="${c.id}" title="${c.data_pagamento ? "" : "Repassar sem o locatário ter pago (a imobiliária adianta) · "}valor do proprietário: ${n2(calcCob(c).prop)}">Repassar</button>` : "" },
  { k: "repasse_data", t: "Data repasse", tipo: "data", oculta: true },
  { k: "situacao", t: "Situação", f: c => ST_COB[stCob(c)][0], html: tagCob },
  { k: "carteira", t: "Carteira", f: c => CARTEIRAS[(S.imovelPor[c.imovel_id] || {}).carteira] || "", oculta: true },
  { k: "ajustes", t: "Acrésc./desc.", v: ajTxt, cls: "trunc", tip: true },
  { k: "obs", t: "Observações", cls: "trunc", oculta: true }
];
let COB_REAJ = [];
PAGES.alugueis = async pg => {
  [COB] = await Promise.all([fetchAll("cobrancas", b => b.eq("competencia", S.mes).order("vencimento").order("id")), carregarDesp(S.mes)]);
  COB_REAJ = pode.editar() ? await q(sb.from("reajustes").select("id").is("aplicado_em", null).lte("competencia", S.mes)) : [];
  setRd(pg, () => desenharAlugueis());
  desenharAlugueis(pg);
};
function desenharAlugueis(pg) {
  pg = pg || $("#page");
  const f = S.f.cob || "todos", busca = S.f.cobBusca || "";
  const conta = { todos: COB.length, aberto: 0, atrasado: 0, pago: 0, quitado: 0, parcial: 0, devedor: 0, adiantado: 0, ajustes: 0 };
  COB.forEach(c => { conta[stCob(c)]++; if (ajustesDe(c).length) conta.ajustes++; });
  let lista = COB.filter(c => f === "todos" || stCob(c) === f || (f === "aberto" && stCob(c) === "atrasado") || (f === "ajustes" && ajustesDe(c).length));
  if (busca) { const b = norm(busca); lista = lista.filter(c => norm((S.imovelPor[c.imovel_id] || {}).endereco + " " + c.locatario + " " + c.locador).includes(b)); }
  const g = grade("alugueis", COLS_COB, lista, {
    sort: { k: "vencimento", dir: "asc" }, divisor: "vencimento", attr: c => `data-act="cob-det" data-id="${c.id}" style="cursor:pointer"`,
    rodape: fl => `${fl.length} aluguéis · valor ${brl(fl.reduce((a, c) => a + devido(c), 0))} · recebido ${brl(fl.reduce((a, c) => a + (+c.valor_pago || 0), 0))} · taxa ${brl(fl.reduce((a, c) => a + (+c.taxa_valor || 0), 0))} · repassado ${brl(fl.reduce((a, c) => a + (+c.repasse_valor || 0), 0))}`
  });
  g.redesenhar = () => desenharAlugueis();
  const chips = [["todos", "Todos", ""], ["aberto", "Em aberto", "st-INTV"], ["atrasado", "Atrasados", "st-INTV"], ["parcial", "Parcial", "st-INTV"], ["pago", "Repasse pendente", "st-ALG"], ["adiantado", "Repassados sem receber", "st-OCP"], ["quitado", "Concluídos", "st-LVR"], ["ajustes", "Com acrésc./desc.", ""]];
  pg.innerHTML = `<div class="grid">
    ${!COB.length ? `<div class="card empty"><p>Os aluguéis de <b>${esc(mesTxt(S.mes))}</b> ainda não foram gerados.</p>
      ${pode.editar() ? `<p class="hint">O sistema cria uma cobrança para cada imóvel <b>alugado</b> no mapa, com o valor e o dia de vencimento cadastrados${COB_REAJ.length ? `, depois de aplicar <b>${COB_REAJ.length} reajuste(s) programado(s)</b>` : ""}.</p><button class="btn pri" data-act="gerar-cob">Gerar aluguéis de ${esc(mesTxt(S.mes))}</button>
      <p class="hint" style="margin-top:12px">Começando no meio do mês? Gere, filtre <b>Em aberto</b>, marque os que já foram pagos e use <b>Receber selecionados</b> para dar baixa de uma vez.</p>` : `<p class="hint">Peça ao financeiro para gerar.</p>`}</div>` : `
    <div class="filters">
      <div class="chips">${chips.map(([k, t, cls]) => `<button class="chip ${cls}${f === k ? " on" : ""}" data-act="chip" data-k="cob" data-v="${k}">${t}<span class="c">${k === "aberto" ? conta.aberto + conta.atrasado : conta[k]}</span></button>`).join("")}</div>
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
  const pend = await q(sb.from("reajustes").select("id").is("aplicado_em", null).lte("competencia", S.mes));
  if (pend.length) { toast(`Antes de gerar, confirme os ${pend.length} reajuste(s) deste mês.`, true); return confirmarReajustes(S.mes); }
  const n = await rpc("gerar_cobrancas", { p_comp: S.mes });
  await recarregarImoveis();
  toast(`${n} aluguel(éis) gerado(s).`);
  render();
};
// Reajustes do mês: confirmados um por um (fica registrado quem aceitou, em Auditoria)
async function confirmarReajustes(ate) {
  if (!pode.ed("imoveis")) return;
  const lista = await q(sb.from("reajustes").select("*").is("aplicado_em", null).lte("competencia", ate || inicioMes(hoje())).order("competencia"));
  let i = 0, feitos = 0;
  const proximo = () => {
    if (i >= lista.length) { if (feitos) { recarregarImoveis().then(() => render()); } return; }
    const r = lista[i], im = S.imovelPor[r.imovel_id] || {};
    let adiar = false;
    modal({ titulo: `Reajuste ${i + 1} de ${lista.length}`, ok: "Aplicar reajuste",
      extra: `<button type="button" class="btn danger" data-cancelar>Desistir deste reajuste</button><button type="button" class="btn" data-depois>Deixar para depois</button>`,
      corpo: `<div class="box"><b>${esc(im.endereco || "?")}</b><br>Locatário: ${esc(im.locatario || "—")} · Locador: ${esc(im.locador || "—")}${im.contrato_codigo ? " · Contrato " + esc(im.contrato_codigo) : ""}</div>
        <div class="row"><label class="fl"><span>A partir de</span><input value="${esc(mesTxt(r.competencia))}" disabled></label>
          <label class="fl"><span>Aluguel atual</span><input value="${esc(moedaFmt(im.valor))}" disabled></label>
          <label class="fl"><span>Novo aluguel</span><input name="valor" inputmode="numeric" value="${esc(moedaFmt(r.valor_novo))}"></label></div>
        ${r.obs ? `<p class="hint">${esc(r.obs)}</p>` : ""}
        <p class="hint">Ao aplicar, o aluguel do imóvel muda e os aluguéis ainda não pagos a partir de ${esc(mesTxt(r.competencia))} também.</p>`,
      aoAbrir: (f, d) => {
        mascaraMoeda(f.valor);
        $("[data-depois]", d).addEventListener("click", () => { adiar = true; d.close(); });
        $("[data-cancelar]", d).addEventListener("click", async () => { try { await q(sb.from("reajustes").delete().eq("id", r.id)); toast("Reajuste cancelado."); feitos++; adiar = true; d.close(); } catch (e) { falha(e); } });
        d.addEventListener("close", () => { if (adiar || d.dataset.ok) { i++; setTimeout(proximo, 0); } }, { once: true });
      },
      salvar: async f => {
        const v = parseMoney(f.valor.value); if (!v || v <= 0) throw new Error("Informe o novo valor.");
        await rpc("aplicar_reajuste", { p_id: r.id, p_valor: v }); feitos++; $("#dlg").dataset.ok = "1"; toast("Reajuste aplicado.");
      } });
    delete $("#dlg").dataset.ok;
  };
  if (!lista.length) return toast("Nenhum reajuste aguardando confirmação.");
  proximo();
}
ACT["reaj-conf"] = () => confirmarReajustes();
// editor de acréscimos / descontos (cada item com descrição e de quem é)
function ajustesHTML(c, ed) {
  const lin = (x, i) => `<div class="aj-l" data-aj="${i}">
    <select data-k="tipo" ${ed ? "" : "disabled"}>${opt("acr", "+ Acréscimo", x.tipo === "acr")}${opt("desc", "− Desconto", x.tipo === "desc")}</select>
    <select data-k="desc" ${ed ? "" : "disabled"}><option value="">— escolha o item —</option>${AJ_SUG[x.tipo].map(([t]) => opt(t, t, x.desc === t)).join("")}${x.desc && !AJ_SUG[x.tipo].some(([t]) => t === x.desc) ? opt(x.desc, x.desc, true) : ""}</select>
    <input data-k="obs" value="${esc(x.obs || "")}" placeholder="Observações (ex.: ref. set/26, boleto nº…)" ${ed ? "" : "disabled"}>
    <input data-k="valor" inputmode="numeric" value="${x.valor != null && x.valor !== "" ? moedaFmt(x.valor) : ""}" placeholder="R$ 0,00" ${ed ? "" : "disabled"}>
    <select data-k="de" ${ed ? "" : "disabled"}>${Object.entries(AJ_DE[x.tipo]).map(([k, t]) => opt(k, t, (x.de || (x.tipo === "acr" ? "imob" : "prop")) === k)).join("")}</select>
    ${ed ? `<button type="button" class="btn sm ghost" data-aj-del title="Remover">✕</button>` : ""}</div>`;
  const ls = ajustesDe(c);
  return `<div class="aj" data-ajustes><div class="aj-h"><b>Acréscimos e descontos</b>${ed ? `<button type="button" class="btn sm" data-aj-add="acr">+ Acréscimo</button><button type="button" class="btn sm" data-aj-add="desc">− Desconto</button>` : ""}</div>
    <div data-aj-ls>${ls.map(lin).join("") || `<p class="hint" data-aj-vazio>Nenhum.</p>`}</div>
    <p class="hint">Multa e juros normalmente ficam com a imobiliária; IPTU e condomínio a imobiliária recebe e paga o boleto. Desconto "por conta do proprietário" sai do repasse dele.</p></div>`;
}
function ligarAjustes(d, aoMudar, base) {
  const box = $("[data-ajustes]", d); if (!box) return () => [];
  const ls = $("[data-aj-ls]", box);
  const ler = () => $$("[data-aj]", ls).map(l => { const x = { tipo: $("[data-k=tipo]", l).value, desc: $("[data-k=desc]", l).value.trim(), valor: parseMoney($("[data-k=valor]", l).value) || 0, de: $("[data-k=de]", l).value }, o = $("[data-k=obs]", l).value.trim(); if (o) x.obs = o; return x; }).filter(x => x.desc || x.valor);
  const ligar = l => {
    const tipo = $("[data-k=tipo]", l), desc = $("[data-k=desc]", l), de = $("[data-k=de]", l);
    tipo.addEventListener("change", () => { de.innerHTML = Object.entries(AJ_DE[tipo.value]).map(([k, t]) => opt(k, t, false)).join(""); desc.innerHTML = `<option value="">— escolha o item —</option>` + AJ_SUG[tipo.value].map(([t]) => opt(t, t, false)).join(""); aoMudar && aoMudar(); });
    const val = $("[data-k=valor]", l); mascaraMoeda(val);
    const obs = $("[data-k=obs]", l);
    desc.addEventListener("change", () => {
      if (desc.value === "Outros" && !obs.value) obs.focus();
      const sg = AJ_SUG[tipo.value].find(([t]) => norm(t) === norm(desc.value)); if (sg) de.value = sg[1];
      // multa: 10% do aluguel, automático (dá para mudar)
      if (tipo.value === "acr" && /^multa/i.test(desc.value.trim()) && !parseMoney(val.value) && base) val.value = moedaFmt(r2(base * 0.1));
      aoMudar && aoMudar();
    });
    $$("input,select", l).forEach(x => x.addEventListener("input", () => aoMudar && aoMudar()));
    const del = $("[data-aj-del]", l); if (del) del.addEventListener("click", () => { l.remove(); aoMudar && aoMudar(); });
  };
  $$("[data-aj]", ls).forEach(ligar);
  $$("[data-aj-add]", box).forEach(b => b.addEventListener("click", () => {
    const v = $("[data-aj-vazio]", ls); if (v) v.remove();
    const t = document.createElement("div"); t.innerHTML = ajustesHTML({ ajustes: [{ tipo: b.dataset.ajAdd, desc: "", valor: "" }] }, true);
    const l = $("[data-aj]", t); l.dataset.aj = Date.now(); ls.appendChild(l); ligar(l); $("[data-k=desc]", l).focus();
  }));
  return ler;
}
const totaisAjustes = aj => ({ acrescimos: r2(aj.filter(x => x.tipo === "acr").reduce((a, x) => a + x.valor, 0)), descontos: r2(aj.filter(x => x.tipo === "desc").reduce((a, x) => a + x.valor, 0)) });
async function salvarAjustes(c, aj) {
  const t = totaisAjustes(aj);
  await q(sb.from("cobrancas").update(Object.assign({ ajustes: aj }, t)).eq("id", c.id));
  Object.assign(c, { ajustes: aj }, t);
}
ACT.receber = el => {
  const c = COB.find(x => x.id === el.dataset.id); const im = S.imovelPor[c.imovel_id] || {};
  const soCaixa = S.papel === "recepcao";
  let lerAj = () => ajustesDe(c);
  const atualiza = d => {
    const aj = lerAj(), t = totaisAjustes(aj), dev = r2(+c.valor + t.acrescimos - t.descontos);
    const descProp = aj.filter(x => x.tipo === "desc" && x.de === "prop").reduce((a, x) => a + x.valor, 0);
    $("[data-devido]", d).textContent = brl(dev);
    const f = $("form", d); if (!f.valor.dataset.mexeu) f.valor.value = moedaFmt(dev);
    if (f.taxa && !f.taxa.dataset.mexeu) f.taxa.value = moedaFmt(r2((+c.valor - descProp) * +c.taxa_adm_pct / 100));
    const v2 = parseMoney(f.valor2.value) || 0, tot = parseMoney(f.valor.value) || 0;
    $("[data-div-txt]", d).textContent = v2 ? `${contaPor(f.conta.value).nome || "1ª conta"}: ${brl(r2(tot - v2))} · ${contaPor(f.conta2.value).nome || "2ª conta"}: ${brl(v2)}` : "";
  };
  modal({
    titulo: "Registrar recebimento", xl: true,
    corpo: `<div class="info-cob"><div><small>Imóvel</small><b>${esc(im.endereco)}</b></div><div><small>Locatário</small><b>${esc(c.locatario)}</b></div><div><small>Vencimento</small><b>${dt(c.vencimento)}</b></div><div><small>Aluguel</small><b>${brl(c.valor)}</b></div><div class="destaque"><small>Total devido</small><b data-devido>${brl(devido(c))}</b></div></div>
      ${c.repasse_data ? `<div class="box warn">Já repassado ao proprietário em ${dt(c.repasse_data)} (sem ter recebido).</div>` : ""}
      ${ajustesHTML(c, pode.editar())}
      <div class="row">
        <label class="fl"><span>Data do recebimento</span><input type="date" name="data" value="${hoje()}" required></label>
        <label class="fl"><span>Valor recebido (total)</span><input name="valor" inputmode="numeric" value="${moedaFmt(devido(c))}" required></label>
        <label class="fl"><span>Entrou na conta</span><select name="conta" required>${contasOpts(null, soCaixa)}</select></label>
        ${soCaixa ? "" : `<label class="fl"><span>T. Adm.</span><input name="taxa" inputmode="numeric" value=""></label>`}
      </div>
      <label class="chk"><input type="checkbox" name="dividir"> Pago em duas formas (ex.: parte em PIX, parte em dinheiro)</label>
      <div class="row" data-div hidden><label class="fl"><span>Parte que entrou em outra conta</span><input name="valor2" inputmode="numeric" placeholder="R$ 0,00"></label>
        <label class="fl"><span>Outra conta</span><select name="conta2">${contasOpts(null, soCaixa)}</select></label><span class="hint" data-div-txt style="align-self:end"></span></div>
      <p class="hint">A T. Adm. (${n2(+c.taxa_adm_pct)}%) vira receita da imobiliária; multa/juros "da imobiliária" também. O restante fica como dinheiro do proprietário, a repassar.</p>`,
    ok: "Registrar",
    aoAbrir: (f, d) => {
      lerAj = ligarAjustes(d, () => atualiza(d), +c.valor);
      [f.valor, f.taxa, f.valor2].filter(Boolean).forEach(x => mascaraMoeda(x));
      f.valor.addEventListener("input", () => { f.valor.dataset.mexeu = 1; atualiza(d); }); if (f.taxa) f.taxa.addEventListener("input", () => (f.taxa.dataset.mexeu = 1));
      f.dividir.addEventListener("change", () => { $("[data-div]", d).hidden = !f.dividir.checked; if (!f.dividir.checked) f.valor2.value = ""; atualiza(d); });
      [f.valor2, f.conta, f.conta2].forEach(x => x.addEventListener("input", () => atualiza(d)));
      atualiza(d);
    },
    salvar: async f => {
      const v = parseMoney(f.valor.value); if (!v || v <= 0) throw new Error("Valor inválido.");
      const aj = lerAj(); if (aj.some(x => !x.desc || !(x.valor > 0))) throw new Error("Cada acréscimo/desconto precisa do item e do valor."); if (aj.some(x => x.desc === "Outros" && !x.obs)) throw new Error('Item "Outros": descreva nas observações.');
      if (pode.editar() && JSON.stringify(aj) !== JSON.stringify(ajustesDe(c))) await salvarAjustes(c, aj);
      const args = { p_id: c.id, p_data: f.data.value, p_valor: v, p_conta: f.conta.value };
      if (f.dividir.checked) { const v2 = parseMoney(f.valor2.value) || 0; if (!(v2 > 0) || v2 >= v) throw new Error("A parte da outra conta precisa ser maior que zero e menor que o total."); if (f.conta2.value === f.conta.value) throw new Error("Escolha uma conta diferente para a segunda parte."); Object.assign(args, { p_conta2: f.conta2.value, p_valor2: v2 }); }
      if (f.taxa) { const t = parseMoney(f.taxa.value); if (t == null || t < 0 || t > v) throw new Error("T. Adm. inválida."); args.p_taxa = t; }
      await rpc("registrar_pagamento", args);
      toast("Recebimento registrado."); render();
    }
  });
};
// forma de pagamento ao proprietário
const FORMAS = { pix: "PIX", ted: "Transferência (TED)", deposito: "Depósito bancário", dinheiro: "Dinheiro (na imobiliária)", boleto: "Boleto", cheque: "Cheque" };
const favDoLocador = loc => (DEP.favs || []).find(f => f.ativo && (f.locadores || []).includes(loc));
function repasseResumoHTML(c, k) {
  const lin = (t, v, cls) => `<tr${cls ? ` class="${cls}"` : ""}><td>${t}</td><td class="num">${v}</td></tr>`;
  return `<table class="compacta rep-res"><tbody>
    ${lin(k.recebido ? `Recebido em ${dt(c.data_pagamento)}` : "Aluguel (ainda não recebido)", n2(k.recebido ? c.valor_pago : c.valor))}
    ${!k.recebido && k.acrProp ? lin("+ acréscimos do proprietário", n2(k.acrProp)) : ""}${!k.recebido && k.descProp ? lin("− descontos do proprietário", n2(k.descProp)) : ""}
    ${k.recebido && (k.acrImob || k.acrRep) ? lin("− multa/juros e IPTU/condomínio (não são do proprietário)", n2(k.acrImob + k.acrRep)) : ""}${k.recebido && k.descImob ? lin("+ desconto coberto pela imobiliária", n2(k.descImob)) : ""}
    ${lin(`− T. Adm. ${c.taxa_valor == null ? `(${n2(+c.taxa_adm_pct)}%)` : ""}`, n2(k.taxa))}
    ${k.desp.map(l => lin("− " + esc(l.descricao || "despesa do proprietário") + ` <small class="muted">${dt(l.data)}</small>`, n2(l.valor))).join("")}
    ${lin("<b>= Valor do proprietário</b>", `<b>${n2(k.prop)}</b>`, "tot")}</tbody></table>`;
}
// despesas do proprietário (reparo, troca de porta…) pagas pela imobiliária: viram saída no Caixa e saem do repasse
const catDespProp = () => (S.categorias.find(c => c.grupo === "terceiros_saida" && /despesas do propriet/i.test(c.nome)) || S.categorias.find(c => c.grupo === "terceiros_saida" && /IPTU|condom/i.test(c.nome)) || {}).id;
function despPropHTML(c) {
  const k = calcCob(c);
  return `<div class="aj" data-desp-box><div class="aj-h"><b>Despesas do proprietário</b> <span class="hint">(pagas pela imobiliária e descontadas do repasse — ex.: troca de porta)</span>${pode.editar() ? `<button type="button" class="btn sm" data-desp-add>+ Despesa</button>` : ""}</div>
    <div data-desp-ls>${k.desp.map(l => `<div class="desp-l"><span>${esc(l.descricao || "despesa")}</span><span class="muted">${dt(l.data)}</span><b>${n2(l.valor)}</b>${pode.editar() ? `<button type="button" class="btn sm ghost" data-desp-del="${l.id}" title="Excluir do caixa">✕</button>` : ""}</div>`).join("") || `<p class="hint">Nenhuma.</p>`}</div>
    <div class="desp-novo2" data-desp-novo hidden>
      <label class="fl"><span>Natureza</span><select data-dk="nat">${opt("servico", "Serviço (mão de obra)", true)}${opt("material", "Material (compra em loja)", false)}</select></label>
      <label class="fl"><span data-dk-fl>Prestador</span><select data-dk="forn"></select></label>
      <label class="fl"><span>Valor</span><input data-dk="valor" inputmode="numeric" placeholder="R$ 0,00"></label>
      <label class="fl"><span>Pago pela conta</span><select data-dk="conta">${contasOpts(c.conta_pgto_id)}</select></label>
      <label class="fl desp-obs"><span>Observações (o que foi feito / comprado)</span><input data-dk="desc" placeholder="ex.: troca da porta da cozinha"></label>
      <label class="chk" style="margin:0;align-self:end"><input type="checkbox" data-dk="pago" checked> já paga</label><button type="button" class="btn sm pri" data-desp-ok style="align-self:end">Lançar</button></div>
    <p class="hint">Vai para o Caixa como saída (dinheiro do proprietário), com este imóvel, e aparece no relatório do proprietário.</p></div>`;
}
function ligarDespProp(d, c, aoMudar) {
  const box = $("[data-desp-box]", d); if (!box) return;
  const novo = $("[data-desp-novo]", box);
  const nat = $("[data-dk=nat]", novo), forn = $("[data-dk=forn]", novo);
  const encherForn = () => { const t = nat.value === "material" ? "loja" : "prestador"; $("[data-dk-fl]", novo).textContent = t === "loja" ? "Loja" : "Prestador";
    forn.innerHTML = `<option value="">— escolha —</option>` + (S.fornecedores || []).filter(x => x.ativo && x.tipo === t).map(x => opt(x.id, x.nome + (x.especialidade ? " · " + x.especialidade : ""), false)).join("") + `<option value="+">+ cadastrar novo…</option>`; };
  nat.addEventListener("change", encherForn); encherForn();
  forn.addEventListener("change", async () => {
    if (forn.value !== "+") return;
    const nome = (prompt(`Nome do ${nat.value === "material" ? "loja" : "prestador"} (cadastro completo em Cadastros › Prestadores e lojas):`) || "").trim();
    if (!nome) { forn.value = ""; return; }
    try { const r = await q(sb.from("fornecedores").insert({ nome, tipo: nat.value === "material" ? "loja" : "prestador" }).select().single()); await recarregarLocadores(); encherForn(); forn.value = r.id; } catch (e) { falha(e); forn.value = ""; }
  });
  const bAdd = $("[data-desp-add]", box); if (bAdd) bAdd.addEventListener("click", () => { novo.hidden = false; forn.focus(); });
  mascaraMoeda($("[data-dk=valor]", novo));
  const recarregar = async () => { await carregarDesp(c.competencia); box.outerHTML = despPropHTML(c); ligarDespProp(d, c, aoMudar); aoMudar && aoMudar(); };
  const ok = $("[data-desp-ok]", box); if (ok) ok.addEventListener("click", async () => {
    try {
      const obs = $("[data-dk=desc]", novo).value.trim(), v = parseMoney($("[data-dk=valor]", novo).value), fid = forn.value && forn.value !== "+" ? forn.value : null;
      if (!fid) throw new Error(`Escolha o ${nat.value === "material" ? "loja" : "prestador"} (ou cadastre um novo).`);
      if (!obs) throw new Error("Descreva nas observações o que foi feito ou comprado.");
      if (!(v > 0)) throw new Error("Informe o valor.");
      const fn = ((S.fornecedores || []).find(x => x.id === fid) || {}).nome || "", desc = `${nat.value === "material" ? "Material" : "Serviço"}: ${obs} — ${fn}`;
      const cat = catDespProp(); if (!cat) throw new Error('Crie a categoria "Despesas do proprietário" (Proprietários – saída) no plano de contas.');
      await q(sb.from("lancamentos").insert({ data: hoje(), competencia: c.competencia, tipo: "saida", categoria_id: cat, conta_id: $("[data-dk=conta]", novo).value, valor: v,
        descricao: desc, imovel_id: c.imovel_id, desconta_repasse: true, pago: $("[data-dk=pago]", novo).checked, natureza: nat.value, fornecedor_id: fid }));
      toast("Despesa lançada no Caixa e descontada do repasse."); await recarregar();
    } catch (e) { falha(e); }
  });
  $$("[data-desp-del]", box).forEach(b => b.addEventListener("click", async () => {
    if (!confirm("Excluir esta despesa do Caixa?")) return;
    try { await q(sb.from("lancamentos").delete().eq("id", b.dataset.despDel)); await recarregar(); } catch (e) { falha(e); }
  }));
}
ACT.repassar = async el => {
  const c = COB.find(x => x.id === el.dataset.id); const im = S.imovelPor[c.imovel_id] || {};
  if (!DEP.favs || !DEP.favs.length) DEP.favs = await q(sb.from("depositos_fav").select("*")).catch(() => []);
  const fav = favDoLocador(c.locador), ed = pode.editar() && !c.data_pagamento;
  let lerAj = () => ajustesDe(c);
  const atualiza = d => {
    const f = $("form", d), aj = lerAj(), tmp = Object.assign({}, c, { ajustes: aj }, totaisAjustes(aj)), k = calcCob(tmp);
    $("[data-res]", d).innerHTML = repasseResumoHTML(tmp, k);
    if (!f.valor.dataset.mexeu) f.valor.value = moedaFmt(k.prop);
  };
  modal({
    titulo: "Registrar repasse ao proprietário", xl: true,
    corpo: `<div class="info-cob"><div><small>Locador</small><b>${esc(c.locador)}</b></div><div><small>Imóvel</small><b>${esc(im.endereco)}</b></div><div><small>Locatário</small><b>${esc(c.locatario)}</b></div>
        <div class="${c.data_pagamento ? "destaque ok" : "destaque warn"}"><small>Recebido do locatário</small><b>${c.data_pagamento ? brl(c.valor_pago) + " em " + dt(c.data_pagamento) : "ainda não"}</b></div>
        ${fav ? `<div><small>Depósito para</small><b>${esc(fav.nome)}</b><span>${esc(FORMAS[fav.forma] || "")} ${esc(fav.conta_bancaria || "")}</span></div>` : ""}</div>
      ${!c.data_pagamento ? `<div class="box warn">⚠️ <b>Repasse sem recebimento:</b> o locatário ainda não pagou. A imobiliária adianta o valor ao proprietário (aviso só interno; não aparece no relatório do cliente).</div>` : ""}
      ${ajustesHTML(c, ed)}${c.data_pagamento ? `<p class="hint" style="margin-top:-4px">Acréscimos/descontos do locatário não mudam depois do recebimento. Para descontar algo do proprietário, use "Despesas do proprietário".</p>` : ""}
      ${despPropHTML(c)}
      <div data-res></div>
      <div class="row">
        <label class="fl"><span>Data do repasse</span><input type="date" name="data" value="${hoje()}" required></label>
        <label class="fl"><span>Valor repassado</span><input name="valor" inputmode="numeric" required></label>
        <label class="fl"><span>Forma</span><select name="forma">${Object.entries(FORMAS).map(([kk, t]) => opt(kk, t, kk === ((fav && fav.forma) || "pix"))).join("")}</select></label>
        <label class="fl"><span>Saiu da conta</span><select name="conta" required>${contasOpts(c.conta_pgto_id)}</select></label>
      </div>`,
    ok: "Registrar repasse",
    aoAbrir: (f, d) => { lerAj = ligarAjustes(d, () => atualiza(d), +c.valor); ligarDespProp(d, c, () => atualiza(d)); mascaraMoeda(f.valor); f.valor.addEventListener("input", () => (f.valor.dataset.mexeu = 1)); atualiza(d); },
    salvar: async f => {
      const v = parseMoney(f.valor.value); if (!v || v <= 0) throw new Error("Valor inválido.");
      const aj = lerAj(); if (aj.some(x => !x.desc || !(x.valor > 0))) throw new Error("Cada acréscimo/desconto precisa do item e do valor."); if (aj.some(x => x.desc === "Outros" && !x.obs)) throw new Error('Item "Outros": descreva nas observações.');
      if (!c.data_pagamento && !pedeConfirmacao(f, `Confirma o repasse de <b>${brl(v)}</b> <b>sem</b> o locatário ter pago?`, "Sim, repassar mesmo assim")) return false;
      if (ed && JSON.stringify(aj) !== JSON.stringify(ajustesDe(c))) await salvarAjustes(c, aj);
      await rpc("registrar_repasse", { p_id: c.id, p_data: f.data.value, p_valor: v, p_conta: f.conta.value, p_forma: f.forma.value });
      toast("Repasse registrado (também aparece em Pagamento de locadores)."); render();
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
  const sel = selecionados().filter(podeRepassar);
  if (!sel.length) return toast("Marque na lista os aluguéis com repasse pendente.", true);
  const semRec = sel.filter(c => !c.data_pagamento).length;
  modal({
    titulo: `Repassar ${sel.length} aluguel(éis)`,
    corpo: `<div class="box">Total a repassar: <b>${brl(sel.reduce((a, c) => a + calcCob(c).prop, 0))}</b> (valor do proprietário de cada um: aluguel − T. Adm. − descontos e despesas dele).</div>
      ${semRec ? `<div class="box warn">⚠️ ${semRec} deles ainda <b>não foram recebidos</b>: o repasse será adiantado pela imobiliária.</div>` : ""}
      <div class="row"><label class="fl"><span>Data</span><input type="date" name="data" value="${hoje()}" required></label>
      <label class="fl"><span>Conta</span><select name="conta">${contasOpts()}</select></label></div>`,
    ok: "Registrar repasses",
    salvar: async f => {
      let ok = 0, err = 0;
      for (const c of sel) {
        try { const v = calcCob(c).prop; if (v > 0) { await rpc("registrar_repasse", { p_id: c.id, p_data: f.data.value, p_valor: v, p_conta: f.conta.value }); ok++; } }
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
  if (c.recibo_locatario) extra += `<button type="button" class="btn" data-act="rec-ver" data-tipo="locatario" data-id="${c.id}">🧾 Recibo locatário nº ${c.recibo_locatario}</button>`;
  if (c.recibo_locador) extra += `<button type="button" class="btn" data-act="rec-ver" data-tipo="locador" data-id="${c.id}">🧾 Recibo locador nº ${c.recibo_locador}</button>`;
  modal({
    titulo: "Aluguel " + mesTxt(c.competencia), xl: true,
    corpo: `<div class="info-cob"><div><small>Imóvel</small><b>${esc(im.endereco)}</b></div><div><small>Locatário</small><b>${esc(c.locatario)}</b></div><div><small>Locador</small><b>${esc(c.locador)}</b></div>
        <div class="destaque ${c.data_pagamento ? "ok" : ""}"><small>Recebido</small><b>${c.data_pagamento ? brl(c.valor_pago) + " em " + dt(c.data_pagamento) : "não"}</b></div><div class="destaque ${c.repasse_data ? "ok" : ""}"><small>Repassado</small><b>${c.repasse_data ? brl(c.repasse_valor) + " em " + dt(c.repasse_data) : "não"}</b></div></div>
      <div class="row">
        <label class="fl"><span>Vencimento</span><input type="date" name="vencimento" value="${c.vencimento}" ${ed ? "" : "disabled"}></label>
        <label class="fl"><span>Aluguel</span><input name="valor" inputmode="decimal" value="${n2(c.valor)}" ${ed ? "" : "disabled"}></label>
        <label class="fl"><span>Taxa adm. %</span><input name="taxa" inputmode="decimal" value="${n2(c.taxa_adm_pct)}" ${ed ? "" : "disabled"}></label>
      </div>
      ${ajustesHTML(c, ed)}
      <label class="fl"><span>Observações</span><textarea name="obs" rows="4" ${pode.editar() ? "" : "disabled"}>${esc(c.obs)}</textarea></label>
      ${c.data_pagamento || c.repasse_data ? `<div class="box">${c.data_pagamento ? `Recebido ${brl(c.valor_pago)} em ${dt(c.data_pagamento)} (${esc(contaPor(c.conta_pgto_id).nome || "")}) · T. Adm. ${brl(c.taxa_valor)}` : "Ainda não recebido."}${c.repasse_data ? `<br>Repassado ${brl(c.repasse_valor)} em ${dt(c.repasse_data)}${c.data_pagamento ? "" : " <b class=\"neg\">(sem receber)</b>"}` : ""}</div>` : ""}
      ${despPropHTML(c)}<h3 style="margin-top:10px">Valor do proprietário</h3><div data-res-det>${repasseResumoHTML(c, calcCob(c))}</div>`,
    extra, ok: "Salvar", semOk: !pode.editar(),
    salvar: async f => {
      const upd = { obs: f.obs.value };
      if (ed) { const aj = lerAjDet(); if (aj.some(x => !x.desc || !(x.valor > 0))) throw new Error("Cada acréscimo/desconto precisa do item e do valor."); if (aj.some(x => x.desc === "Outros" && !x.obs)) throw new Error('Item "Outros": descreva nas observações.'); Object.assign(upd, { vencimento: f.vencimento.value, valor: parseMoney(f.valor.value), taxa_adm_pct: parseMoney(f.taxa.value), ajustes: aj }, totaisAjustes(aj)); }
      if (ed && (upd.valor == null || upd.valor < 0)) throw new Error("Valor inválido.");
      await q(sb.from("cobrancas").update(upd).eq("id", c.id));
      toast("Salvo."); render();
    },
    aoAbrir: (f, d) => { lerAjDet = ligarAjustes(d, null, +c.valor); ligarDespProp(d, c, () => { const r = $("[data-res-det]", d); if (r) r.innerHTML = repasseResumoHTML(c, calcCob(c)); }); $$("[data-x2]", d).forEach(b => b.addEventListener("click", async () => {
      const a = b.dataset.x2;
      d.close();
      const txt = { estornar_pagamento: "Desfazer o recebimento? Os lançamentos no caixa serão apagados.", estornar_repasse: "Desfazer o repasse? O lançamento de saída será apagado.", excluir: "Excluir esta cobrança do mês?" }[a];
      if (!(await confirmar("Confirmar", esc(txt)))) return;
      try {
        if (a === "excluir") await q(sb.from("cobrancas").delete().eq("id", c.id));
        else await rpc(a, { p_id: c.id });
        // depois de desfazer, mostra o aluguel (mesmo que o filtro fosse "Concluídos") para repassar de novo
        if (a !== "excluir") { S.f.cob = "todos"; S.f.cobBusca = im.endereco || ""; }
        toast(a === "estornar_repasse" ? "Repasse desfeito: o aluguel voltou para “Repasse pendente”. Clique em Repassar para refazer." : "Feito."); render();
      } catch (e) { falha(e); }
    })); }
  });
};
let lerAjDet = () => [];
ACT["xls-cob"] = () => exportarGrade("alugueis", `alugueis-${S.mes.slice(0, 7)}.xlsx`, mesCurto(S.mes).replace("/", "-"));


/* =====================================================================
   PÁGINA: INADIMPLÊNCIA
   ===================================================================== */
let INAD = [];
const COLS_INAD = [
  { k: "imovel", t: "Imóvel", cls: "trunc" },
  { k: "locatario", t: "Locatário", cls: "trunc" },
  { k: "locador", t: "Locador", cls: "trunc" },
  { k: "meses", t: "Meses em aberto", v: x => x.meses.join(", "), html: x => x.meses.map(m => `<span class="tag bad">${m}</span>`).join(" ") },
  { k: "desde", t: "Desde", tipo: "data" },
  { k: "dias", t: "Dias", tipo: "num", int: true },
  { k: "total", t: "Total", tipo: "num", html: x => `<b class="neg">${n2(x.total)}</b>` },
  { k: "acoes", t: "Ações", nf: true, fixo: true, html: x => `<span class="acts"><button class="btn sm" data-act="ir-mes" data-m="${x.cobs[0].competencia}" data-imv="${x.id}">Abrir mês</button><button class="btn sm" data-act="cob-termo" data-src="inad" data-id="${x.id}">📄 Termos</button></span>` }
];
PAGES.atrasados = async pg => {
  const cobs = await fetchAll("cobrancas", b => b.is("data_pagamento", null).is("devedor_id", null).lt("vencimento", hoje()).order("vencimento").order("id"));
  const grupos = {};
  cobs.forEach(c => { (grupos[c.imovel_id] = grupos[c.imovel_id] || []).push(c); });
  INAD = Object.entries(grupos).map(([id, cs]) => ({
    id, imovel: (S.imovelPor[id] || {}).endereco || "?", locatario: cs[cs.length - 1].locatario, locador: cs[0].locador,
    meses: cs.map(c => mesCurto(c.competencia)), total: cs.reduce((a, c) => a + devido(c), 0), desde: cs[0].vencimento, dias: diasEntre(cs[0].vencimento, hoje()), cobs: cs
  }));
  setRd(pg, () => desenharAtrasados());
  desenharAtrasados(pg);
};
// Cobrança: inadimplência dos locatários ativos e devedores (ex-locatários) na mesma aba
const cobrancaAbas = atual => `<div class="seg cobr-abas"><a href="#atrasados" class="${atual === "atrasados" ? "on" : ""}">Inadimplência (locatários ativos)</a>${pode.ver("devedores") ? `<a href="#devedores" class="${atual === "devedores" ? "on" : ""}">Devedores (ex-locatários)</a>` : ""}</div>`;


/* =====================================================================
   PÁGINA: CAIXA E LANÇAMENTOS
   ===================================================================== */
let LANC = [];
const ORIGENS = { manual: "Manual", pagamento: "Recebimento de aluguel", taxa: "Taxa de administração", repasse: "Repasse", transferencia: "Transferência", devedor: "Pagamento de devedor" };
// "Aluguel 10/2026 - FULANO" -> referente a "Aluguel 10/2026", quem "FULANO"
function partesDesc(l) {
  const d = String(l.descricao || "").trim(), i = d.indexOf(" - ");
  if (i > 0) return [d.slice(0, i), d.slice(i + 3)];
  return [d || catPor(l.categoria_id).nome || "", ""];
}
const COLS_LANC = [
  { k: "data", t: "Data", tipo: "data", dica: "Linhas amarelas: previstas. Laranja: previstas com a data já passada." },
  { k: "ref", t: "Referente a", v: l => partesDesc(l)[0], cls: "trunc", html: l => l.afeta_caixa === false ? `<span title="Lançamento interno: não mexe no saldo. A taxa sai da parte do proprietário e vira receita da imobiliária (para a DRE).">↳ ${esc(partesDesc(l)[0])} <small>(interno)</small></span>` : esc(partesDesc(l)[0]) },
  { k: "quem", t: "De quem", v: l => partesDesc(l)[1], cls: "trunc" },
  { k: "descricao", t: "Descrição completa", cls: "trunc", oculta: true },
  { k: "categoria", t: "Categoria", v: l => catPor(l.categoria_id).nome, cls: "trunc" },
  { k: "grupo", t: "Grupo", f: l => GRUPOS[catPor(l.categoria_id).grupo] || "", oculta: true },
  { k: "conta", t: "Conta", v: l => contaPor(l.conta_id).nome || "" },
  { k: "entrada", t: "Entrada", tipo: "num", v: l => l.tipo === "entrada" ? +l.valor : null, html: l => l.tipo === "entrada" ? (l.afeta_caixa === false ? `<span class="muted" title="Lançamento interno: não mexe no saldo">(${n2(l.valor)})</span>` : `<span class="pos">${n2(l.valor)}</span>`) : "" },
  { k: "saida", t: "Saída", tipo: "num", v: l => l.tipo === "saida" ? +l.valor : null, html: l => l.tipo === "saida" ? (l.afeta_caixa === false ? `<span class="muted" title="Lançamento interno: não mexe no saldo">(${n2(l.valor)})</span>` : `<span class="neg">${n2(l.valor)}</span>`) : "" },
  { k: "situacao", t: "Situação", f: l => l.pago ? "Realizado" : "Previsto", oculta: true },
  { k: "documento", t: "Documento", oculta: true },
  { k: "imovel", t: "Imóvel", v: l => l.imovel_id ? (S.imovelPor[l.imovel_id] || {}).endereco : "", cls: "trunc", oculta: true },
  { k: "origem", t: "Origem", f: l => ORIGENS[l.origem] || l.origem, oculta: true },
  { k: "competencia", t: "Competência", f: l => mesCurto(l.competencia), v: l => l.competencia, oculta: true }
];
let CAIXA_SALDOS = { fim: [] }, CAIXA_PREV = 0;
const COR_CONTA = ["var(--c3)", "var(--c2)", "var(--c6)", "var(--c5)", "var(--c4)", "var(--c1)"];
PAGES.caixa = async pg => {
  const fim = fimMes(S.mes);
  const [lanc, saldosFimT] = await Promise.all([
    fetchAll("lancamentos", b => b.gte("data", S.mes).lte("data", fim).order("data").order("criado_em").order("id")),
    rpc("saldos_contas", { p_ate: fim })
  ]);
  // mesma data: o aluguel e seus lançamentos internos (taxa) ficam juntos, nessa ordem
  const ORD = { pagamento: 1, taxa: 2, devedor: 3, repasse: 4, manual: 5, transferencia: 6 };
  LANC = lanc.slice().sort((a, b) => a.data.localeCompare(b.data) || String(a.cobranca_id || a.id).localeCompare(String(b.cobranca_id || b.id))
    || (ORD[a.origem] || 9) - (ORD[b.origem] || 9) || (a.tipo === b.tipo ? 0 : a.tipo === "entrada" ? -1 : 1));
  CAIXA_SALDOS = { fim: soMinhasContas(saldosFimT) };
  // despesas/receitas fixas do plano de contas que ainda não viraram previsão neste mês
  const ja = new Set(lanc.filter(l => l.previsao_de).map(l => l.previsao_de));
  CAIXA_PREV = S.categorias.filter(c => c.ativa && c.recorrente && +c.valor_previsto > 0 && !ja.has(c.id) && (c.periodicidade !== "anual" || c.mes_previsto === +S.mes.slice(5, 7))).length;
  setRd(pg, () => desenharCaixa());
  desenharCaixa(pg);
};
function desenharCaixa(pg) {
  pg = pg || $("#page");
  const busca = S.f.lcBusca || "", tipo = S.f.lcTipo || "todos", sit = S.f.lcSit || "todos", internos = S.f.lcInt === "1";
  const contas = CAIXA_SALDOS.fim, conta = contas.some(c => c.conta_id === S.f.lcConta) ? S.f.lcConta : "";
  const corDe = id => COR_CONTA[Math.max(0, contas.findIndex(c => c.conta_id === id)) % COR_CONTA.length];
  let lista = LANC.filter(l => (internos || l.afeta_caixa !== false) && (tipo === "todos" || l.tipo === tipo) && (!conta || l.conta_id === conta)
    && (sit === "todos" || (sit === "prev" ? !l.pago : l.pago)));
  if (busca) { const b = norm(busca); lista = lista.filter(l => norm(l.descricao + " " + l.documento + " " + catPor(l.categoria_id).nome).includes(b)); }
  const nInt = LANC.filter(l => l.afeta_caixa === false).length;
  // cards: entradas, saídas e saldo do mês (realizados) + saldo acumulado
  const mov = id => { const ls = LANC.filter(l => l.pago && l.afeta_caixa !== false && (!id || l.conta_id === id)); const e = ls.filter(l => l.tipo === "entrada").reduce((a, l) => a + +l.valor, 0), s = ls.filter(l => l.tipo === "saida").reduce((a, l) => a + +l.valor, 0); return { e, s }; };
  const verAcum = pode.flag("saldo_acumulado") && contas.some(c => c.saldo != null);
  const card = (id, nome, acum, cor, main) => { const m = mov(id);
    return `<button type="button" class="ccard${main ? " main" : ""}${conta === id ? " on" : ""}" data-act="lc-conta" data-v="${id}" style="--cc:${cor}">
      <span class="l">${esc(nome)}</span>
      <span class="kg"><span class="kt">Entradas no mês</span><i>R$</i><b class="pos">${n2(m.e)}</b>
      <span class="kt">Saídas no mês</span><i>R$</i><b class="neg">${n2(m.s)}</b>
      <span class="kt">Saldo do mês</span><i>R$</i><b>${n2(m.e - m.s)}</b>
      ${verAcum ? `<span class="kt">Saldo acumulado</span><i>R$</i><b class="acum">${n2(acum)}</b>` : ""}</span></button>`; };
  const tot = contas.reduce((a, c) => a + (+c.saldo || 0), 0);
  document.body.style.setProperty("--conta-cor", conta ? corDe(conta) : "transparent");
  document.body.classList.toggle("com-conta", !!conta);
  const g = grade("caixa6", COLS_LANC, lista, {
    sort: { k: "data", dir: "asc" }, divisor: "data", cls: l => l.afeta_caixa === false ? "interno" : !l.pago ? (l.data < hoje() ? "prev-atras" : "previsto") : "", attr: l => `data-act="lanc-ed" data-id="${l.id}" style="cursor:pointer"`,
    rodape: fl => { const pg2 = fl.filter(l => l.pago), e = pg2.filter(l => l.tipo === "entrada").reduce((a, l) => a + +l.valor, 0), s = pg2.filter(l => l.tipo === "saida").reduce((a, l) => a + +l.valor, 0), pv = fl.filter(l => !l.pago);
      return `${fl.length} lançamentos · realizados: entradas <span class="pos">${brl(e)}</span> · saídas <span class="neg">${brl(s)}</span> · resultado <b>${brl(e - s)}</b>${pv.length ? ` · previstos: ${pv.length} (${brl(pv.reduce((a, l) => a + (l.tipo === "entrada" ? +l.valor : -l.valor), 0))})` : ""}`; }
  });
  g.redesenhar = () => desenharCaixa();
  const chip = (k, v, t, cls, atual) => `<button class="chip ${cls}${atual === v ? " on" : ""}" data-act="chip" data-k="${k}" data-v="${v}">${t}</button>`;
  pg.innerHTML = `<div class="grid">
    <div class="ccards">${contas.length > 1 ? card("", "Todas as contas", tot, "var(--idle)", true) : ""}${contas.map(c => card(c.conta_id, c.nome, c.saldo, corDe(c.conta_id), contas.length === 1)).join("")}</div>
    ${CAIXA_PREV && pode.editar() ? `<div class="alert warn"><span>${CAIXA_PREV} despesa(s)/receita(s) fixa(s) do plano de contas ainda não foram lançadas como previstas em ${esc(mesTxt(S.mes))}.</span><button class="btn sm" data-act="gerar-prev">Lançar previstos</button></div>` : ""}
    <div class="filters">
      <div class="fgrupo"><span>Tipo</span>${chip("lcTipo", "todos", "Todos", "", tipo)}${chip("lcTipo", "entrada", "Só entradas", "st-LVR", tipo)}${chip("lcTipo", "saida", "Só saídas", "st-INTV", tipo)}</div>
      <div class="fgrupo"><span>Situação</span>${chip("lcSit", "todos", "Previstos e realizados", "", sit)}${chip("lcSit", "prev", "Só previstos", "st-OCP", sit)}${chip("lcSit", "real", "Só realizados", "", sit)}</div>
      <input type="search" placeholder="Buscar descrição, documento, categoria…" value="${esc(busca)}" data-busca="lcBusca">
      ${nInt ? `<label class="chk" title="Taxas de administração retidas dos aluguéis: viram receita sem mexer no saldo das contas"><input type="checkbox" data-int ${internos ? "checked" : ""}> lançamentos internos (${nInt})</label>` : ""}
      <span class="spacer"></span>${gradeBarra("caixa6")}
      ${pode.lancar() ? `<button class="btn pri" data-act="lanc-novo" data-tipo="entrada">+ Entrada</button><button class="btn pri" data-act="lanc-novo" data-tipo="saida">+ Saída</button>` : ""}
      ${pode.editar() ? `<button class="btn" data-act="transf">⇄ Transferência</button>` : ""}
      <button class="btn" data-act="xls-lanc">Excel</button>
    </div>
    ${gradeHTML("caixa6")}
  </div>`;
  ligarBusca(pg);
  const ci = $("[data-int]", pg); if (ci) ci.addEventListener("change", () => { S.f.lcInt = ci.checked ? "1" : ""; desenharCaixa(); requestAnimationFrame(ajustarAlturas); });
}
ACT["lc-conta"] = el => { S.f.lcConta = S.f.lcConta === el.dataset.v ? "" : el.dataset.v; desenharCaixa(); requestAnimationFrame(ajustarAlturas); };
ACT["gerar-prev"] = async () => {
  const n = await rpc("gerar_previstos", { p_comp: S.mes });
  toast(n ? `${n} lançamento(s) previsto(s) criado(s). Confirme cada um quando pagar.` : "Nada novo para lançar."); render();
};
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
    ${tipo === "saida" ? `<label class="chk" data-desc-rep ${im ? "" : "hidden"}><input type="checkbox" name="descrep" ${l && l.desconta_repasse ? "checked" : ""} ${dis}> <span><b>Descontar do repasse do proprietário</b> deste imóvel (despesa dele paga pela imobiliária: reparo, material, conta…). Aparece no repasse, em Depósitos e no relatório do proprietário, no mês da competência.</span></label>` : ""}
    ${soCaixa ? "" : `<label class="chk"><input type="checkbox" name="pago" ${!l || l.pago ? "checked" : ""} ${dis}> Já foi ${tipo === "entrada" ? "recebido" : "pago"} (desmarque para deixar como previsto / conta a pagar)</label>`}
    ${!l && !soCaixa ? `<label class="fl"><span>Repetir nos meses seguintes (como previsto)</span><input type="number" name="repetir" min="0" max="36" value="0"></label>` : ""}`;
}
// "Descontar do repasse" só aparece com imóvel; vem marcado para categorias de dinheiro do proprietário
function ligarLanc(f, d) {
  const box = $("[data-desc-rep]", d); if (!box || !f.imovel) return;
  const upd = () => {
    const tem = !!imovelPorEndereco(f.imovel.value); box.hidden = !tem;
    const cat = S.categorias.find(c => c.id === f.categoria.value);
    if (tem && cat && cat.grupo === "terceiros_saida" && !f.descrep.dataset.mexeu && !/repasse|caução|caucao/i.test(cat.nome)) f.descrep.checked = true;
  };
  f.descrep.addEventListener("change", () => (f.descrep.dataset.mexeu = 1));
  f.imovel.addEventListener("input", upd); f.categoria.addEventListener("change", upd); upd();
}
function lerLanc(f, tipo) {
  const v = parseMoney(f.valor.value); if (!v || v <= 0) throw new Error("Valor inválido.");
  if (!f.categoria.value) throw new Error("Escolha a categoria.");
  let imovel_id = null;
  if (f.imovel.value.trim()) { const im = imovelPorEndereco(f.imovel.value); if (!im) throw new Error("Imóvel não encontrado: escolha um endereço da lista."); imovel_id = im.id; }
  return { data: f.data.value, valor: v, tipo, categoria_id: f.categoria.value, conta_id: f.conta.value, competencia: (f.comp.value || f.data.value.slice(0, 7)) + "-01",
    descricao: f.descricao.value.trim(), documento: f.documento.value.trim(), imovel_id, pago: f.pago ? f.pago.checked : true, desconta_repasse: !!(imovel_id && f.descrep && f.descrep.checked) };
}
ACT["lanc-novo"] = el => {
  const tipo = el.dataset.tipo;
  modal({
    titulo: tipo === "entrada" ? "Nova entrada" : "Nova saída", corpo: formLanc(null, tipo), ok: "Lançar", aoAbrir: (f, d) => ligarLanc(f, d),
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
      ligarLanc(f, d);
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
ACT["xls-lanc"] = () => exportarGrade("caixa6", `caixa-${S.mes.slice(0, 7)}.xlsx`, "Lancamentos");

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
    return `<tr class="${cls || ""}${/tot/.test(cls || "") && t < 0 ? " neg" : ""}"><td>${esc(rotulo)}</td>${vals.map(v => cel(v, suf)).join("")}${cel(t, suf).replace(/>([^<]*)<\/td>$/, "><b>$1</b></td>")}</tr>`;
  };
  const cats = g => Object.entries(val[g] || {}).sort((a, b) => a[0].localeCompare(b[0])).map(([n, m]) => L(n, meses.map(x => m[x] || 0), "sub")).join("");
  const pct = (a, b) => a.map((v, i) => b[i] ? v / b[i] * 100 : 0);
  pg.innerHTML = `<div class="grid">
    <div class="filters"><label class="chk"><input type="checkbox" data-prev ${prev ? "checked" : ""}> Incluir lançamentos previstos (ainda não pagos)</label>
      <span class="spacer"></span><button class="btn" data-act="xls-dre">Excel</button><button class="btn" data-act="imprimir">Imprimir</button></div>
    <div class="tw"><table class="dre"><thead><tr><th>${ano}</th>${meses.map(m => `<th class="num">${MES3[+m.slice(5, 7) - 1]}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>
      ${L("Receita bruta", rec, "grp")}${cats("receita")}
      ${L("(−) Impostos sobre a receita", imp, "grp")}${cats("imposto")}
      ${L("= Receita líquida", liq, "tot t1")}
      ${L("(−) Custos (comissões etc.)", cus, "grp")}${cats("custo")}
      ${L("= Lucro bruto", bruto, "tot t2")}
      ${L("(−) Despesas operacionais", des, "grp")}${cats("despesa")}
      ${L("= Resultado operacional", oper, "tot t3")}
      ${L("Margem (% da receita bruta)", pct(oper, rec), "memo", (() => { const r = rec.reduce((a, b) => a + b, 0); return r ? oper.reduce((a, b) => a + b, 0) / r * 100 : 0; })(), "%")}
      ${L("(−) Retiradas dos sócios", ret, "grp")}${cats("retirada")}
      ${L("= Resultado após retiradas", fin, "tot t4")}
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
  const ini = new Set(vis.filter((c, i) => i > 0 && c.grp && c.grp !== vis[i - 1].grp).map(c => c.k));
  const wst = c => c.w ? ` style="width:${c.w}px;max-width:${c.w}px;min-width:${c.w}px"` : "";
  const th = c => {
    const gi = ini.has(c.k) ? " g-ini" : "";
    if (c.nf) return `<th draggable="true" data-gk="${c.k}" data-g="${id}" class="${c.tipo === "num" ? "num" : ""} ${c.thcls || ""}${gi}"${wst(c)}>${c.th || esc(c.t)}</th>`;
    const s = g.sort && g.sort.k === c.k ? (g.sort.dir === "asc" ? " ▲" : " ▼") : "";
    return `<th draggable="true" data-gk="${c.k}" data-g="${id}" class="${c.tipo === "num" ? "num" : ""} ${c.thcls || ""}${gi}"${wst(c)} title="${esc(c.dica || "Clique para ordenar · arraste para mudar a ordem")}">
      <span class="gh" data-act="g-sort" data-g="${id}" data-k="${c.k}">${esc(c.t)}${s}</span><button type="button" class="gf${g.filtros[c.k] ? " on" : ""}" data-act="g-filtro" data-g="${id}" data-k="${c.k}" aria-label="Filtrar ${esc(c.t)}">▾</button></th>`;
  };
  const td = (c, r) => `<td class="${c.tipo === "num" ? "num " : ""}${c.cls || ""}${ini.has(c.k) ? " g-ini" : ""}"${wst(c)}${c.tip ? ` title="${esc(gTxt(c, r))}"` : ""}>${c.html ? c.html(r) : esc(gTxt(c, r))}</td>`;
  // divisória discreta quando a lista está ordenada pela coluna de data indicada (ex.: um dia para o outro)
  // divisor: nome da coluna, ou {k, g: linha => grupo} (ex.: contratos separados por ano)
  const dv = typeof g.opts.divisor === "string" ? { k: g.opts.divisor } : g.opts.divisor;
  const div = dv && g.sort && g.sort.k === dv.k ? gCol(g, dv.k) : null;
  let ant = null;
  const linhaHTML = r => {
    const cls = [];
    if (div) { const v = dv.g ? dv.g(r) : gVal(div, r); if (ant !== null && v !== ant) cls.push("novo-dia"); ant = v; }
    if (g.opts.cls) { const c = g.opts.cls(r); if (c) cls.push(c); }
    return `<tr${cls.length ? ` class="${cls.join(" ")}"` : ""} ${g.opts.attr ? g.opts.attr(r) : ""}>${vis.map(c => td(c, r)).join("")}</tr>`;
  };
  return `<div class="tw fixa"><table class="grade ${g.opts.tcls || ""}"><thead><tr>${vis.map(th).join("")}</tr></thead><tbody>
    ${filtradas.map(linhaHTML).join("") || `<tr><td colspan="${vis.length}" class="empty">${esc(g.opts.vazio || "Nada encontrado.")}</td></tr>`}
    </tbody>${g.opts.rodape ? `<tfoot><tr><td colspan="${vis.length}">${g.opts.rodape(filtradas)}</td></tr></tfoot>` : ""}</table></div>`;
}
function ajustarAlturas() {
  $$(".tw.fixa").forEach(el => {
    const outras = $$(".tw.fixa").length > 1 || el.closest("dialog");
    if (outras) { el.style.maxHeight = ""; return; }
    const r = el.getBoundingClientRect(), topo = r.top + window.scrollY;
    // o que vem abaixo da tabela dentro da página (+ margem de baixo), sem contar espaço vazio da janela
    const pgEl = $("#page"), main = $("#main");
    const resto = Math.max(0, pgEl.getBoundingClientRect().bottom - r.bottom) + (main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0);
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
  if (!p) { p = document.createElement("div"); p.id = "gpop"; p.className = "gpop"; }
  // dentro de uma janela (dialog) o menu precisa ficar na mesma camada dela
  const cont = ancora.closest("dialog") || document.body, fixo = cont !== document.body;
  if (p.parentElement !== cont) cont.appendChild(p);
  p.innerHTML = html; p.hidden = false; p.style.position = fixo ? "fixed" : "absolute";
  const r = ancora.getBoundingClientRect(), sx = fixo ? 0 : window.scrollX, sy = fixo ? 0 : window.scrollY;
  const w = Math.min(largura || 300, window.innerWidth - 16);
  p.style.width = w + "px";
  p.style.left = Math.max(8, Math.min(r.left + sx, sx + window.innerWidth - w - 8)) + "px";
  p.style.top = (r.bottom + sy + 4) + "px";
  const h = p.offsetHeight; if (r.bottom + 4 + h > window.innerHeight - 8 && r.top - h - 4 > 8) p.style.top = (r.top + sy - h - 4) + "px";
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
  // a barra é redesenhada a cada mudança: a janelinha se ancora sempre no botão atual
  const anc = () => document.querySelector(`[data-act="g-cols"][data-g="${id}"]`) || el;
  const desenhar = () => {
    const p = pop(anc(), `<div class="gp-h">Colunas exibidas</div><p class="hint" style="margin:0 0 6px">Marque as que quer ver. Use as setas, ou arraste o título da coluna na tabela, para mudar a ordem.</p>
      <div class="gp-cols">${g.ordem.map((k, i) => { const c = gCol(g, k); if (!c) return ""; return `<div><label><input type="checkbox" data-k="${k}" ${g.ocultas.includes(k) ? "" : "checked"} ${c.fixo ? "disabled" : ""}> ${esc(c.t || c.k)}</label><span><button type="button" class="btn sm" data-up="${i}" ${i ? "" : "disabled"} aria-label="Subir">↑</button><button type="button" class="btn sm" data-dn="${i}" ${i < g.ordem.length - 1 ? "" : "disabled"} aria-label="Descer">↓</button></span></div>`; }).join("")}</div>
      <div class="gp-f gp-wrap">${pode.admin() ? `<button type="button" class="btn sm" data-todos title="Novos usuários (e quem clicar em Restaurar padrão) passam a ver as colunas nesta ordem">Salvar padrão</button>` : ""}<button type="button" class="btn sm" data-padrao>Restaurar padrão</button><button type="button" class="btn sm" data-todas>Mostrar todas</button><button type="button" class="btn sm pri" data-fim>Fechar</button></div>`, 400);
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
    $("[data-todas]", p).addEventListener("click", () => { g.ocultas = []; gradeSalvar(id); gRedesenhar(id); desenhar(); });
    const tb = $("[data-todos]", p); if (tb) tb.addEventListener("click", async () => {
      if (!tb.dataset.conf) { tb.dataset.conf = "1"; tb.textContent = "Confirmar: vale para todos"; tb.classList.add("danger"); return; }
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
  { k: "codigo_site", t: "Site", cls: "mono", html: i => /^\d+$/.test(String(i.codigo_site || "").trim()) ? `<a href="${esc(urlSite(i.codigo_site))}" target="_blank" rel="noopener" data-pasta title="Abrir no site da imobiliária">${esc(i.codigo_site)} ↗</a>` : esc(i.codigo_site || "") },
  { k: "contrato_codigo", t: "Contrato", cls: "mono" },
  { k: "endereco", t: "Endereço", cls: "trunc" },
  { k: "tipo", t: "Tipo" },
  { k: "valor", t: "Aluguel", tipo: "num", html: valorImvHTML },
  { k: "locador", t: "Locador", cls: "trunc" },
  { k: "locatario", t: "Locatário", cls: "trunc" },
  { k: "fiador", t: "Fiador", cls: "trunc", oculta: true },
  { k: "data_entrada", t: "Entrada", tipo: "data" },
  { k: "dia_venc", t: "Dia", tipo: "num", int: true },
  { k: "reajuste", t: "Reajuste programado", v: i => (IMV.reajPor[i.id] || [{}])[0].competencia || null, f: reajTxt, html: i => reajTxt(i) ? `<span style="color:var(--warn)">${esc(reajTxt(i))}</span>` : "" },
  { k: "declarar_ir", t: "IR" },
  { k: "ir_para", t: "IR declarado por", oculta: true },
  { k: "taxa_adm", t: "Taxa %", tipo: "num", oculta: true },
  { k: "carteira", t: "Carteira", f: i => CARTEIRA_CURTA[i.carteira] || "", dica: "Terceiro = administrado · Imob = próprio da imobiliária · Cilas = particular do sócio", oculta: true },
  { k: "grupo_locador", t: "Grupo do locador", f: i => i.grupo_locador || "(outros)", oculta: true },
  { k: "obs", t: "Observações", cls: "trunc", oculta: true }
];
PAGES.imoveis = async pg => {
  const mesAtual = inicioMes(hoje()), passado = S.mes < mesAtual;
  const [reaj, grupos, hist, cobs, tpend] = await Promise.all([
    q(sb.from("reajustes").select("imovel_id,competencia,valor_novo").is("aplicado_em", null).order("competencia")),
    q(sb.from("grupos_locador").select("*").order("ordem")),
    passado ? fetchAll("mapa_mensal", b => b.eq("competencia", S.mes).order("imovel_id")) : Promise.resolve(null),
    pode.editar() || S.papel === "leitura" ? rpc("resumo_cobrancas", { p_ini: S.mes, p_fim: S.mes }) : Promise.resolve([]),
    termosPendentes()
  ]);
  IMV.termos = tpend;
  IMV.reajPor = {}; reaj.forEach(r => { (IMV.reajPor[r.imovel_id] = IMV.reajPor[r.imovel_id] || []).push(r); });
  IMV.grupos = grupos; IMV.cobs = cobs;
  IMV.hist = hist ? hist.map(h => Object.assign({}, S.imovelPor[h.imovel_id] || { endereco: "?" }, {
    status: h.status, valor: h.valor, locador: h.locador, locatario: h.locatario, taxa_adm: h.taxa_adm,
    carteira: h.carteira || (S.imovelPor[h.imovel_id] || {}).carteira || "administrado",
    data_entrada: null, contrato_codigo: "", dia_venc: null, _hist: true })).sort((a, b) => COLL.compare(a.endereco || "", b.endereco || "")) : null;
  setRd(pg, () => desenharImoveis());
  desenharImoveis(pg);
  if (/\?reaj/.test(location.hash)) { history.replaceState(null, "", "#imoveis"); setTimeout(() => confirmarReajustes(), 50); }
};
function desenharImoveis(pg) {
  pg = pg || $("#page");
  const mesAtual = inicioMes(hoje()), passado = S.mes < mesAtual, futuro = S.mes > mesAtual, lib = !!S.liberado[S.mes];
  const base = passado ? (IMV.hist || []) : S.imoveis;
  const f = S.f.imv || "todos", busca = S.f.imvBusca || "";
  const cont = { todos: base.length, ALG: 0, LVR: 0, OCP: 0, INTV: 0, reaj: 0, ativos: 0 };
  base.forEach(i => { cont[i.status] = (cont[i.status] || 0) + 1; if (IMV.reajPor[i.id]) cont.reaj++; if (i.status === "ALG" || i.status === "LVR") cont.ativos++; });
  let lista = base.filter(i => f === "todos" || (f === "reaj" ? !!IMV.reajPor[i.id] : f === "ativos" ? (i.status === "ALG" || i.status === "LVR") : i.status === f));
  if (G.imoveis && f === "reaj" && S.f.imvAnt !== "reaj") { G.imoveis.sortAntes = G.imoveis.sort; G.imoveis.sort = { k: "reajuste", dir: "asc" }; } // na ordem dos meses: nov, dez, jan…
  if (G.imoveis && f !== "reaj" && S.f.imvAnt === "reaj") { G.imoveis.sort = G.imoveis.sortAntes || null; delete G.imoveis.sortAntes; }
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
  const chips = [["todos", "Todos", ""], ["ativos", "Ativos (alugados + livres)", ""], ["ALG", "Alugados", "st-ALG"], ["LVR", "Livres", "st-LVR"], ["OCP", "Ocupados", "st-OCP"], ["INTV", "Inativos", "st-INTV"], ["reaj", "Reajuste programado", "st-REAJ"]];
  let aviso = "";
  const nReajPend = Object.values(IMV.reajPor).flat().filter(r => r.competencia <= mesAtual).length;
  if (nReajPend && pode.ed("imoveis")) aviso += `<div class="alert warn"><span>${nReajPend} reajuste(s) chegaram no mês e aguardam confirmação.</span><button class="btn sm" data-act="reaj-conf">Confirmar reajustes</button></div>`;
  if (passado && !(IMV.hist && IMV.hist.length)) aviso += `<div class="alert warn"><span>Não há mapa guardado de <b>${esc(mesTxt(S.mes))}</b>. A partir de agora o mapa de cada mês é guardado sozinho.</span></div>`;
  void futuro;
  const podeLib = pode.editar() && S.mes !== mesAtual && !(passado && !(IMV.hist && IMV.hist.length));
  pg.innerHTML = `<div class="grid">
    ${pode.editar() || S.papel === "leitura" ? cardsMes(resumoEsperado(base), resumoReal(IMV.cobs), "Resumo de " + mesTxt(S.mes)) : ""}
    ${aviso}
    <div class="filters">
      <div class="chips">${chips.map(([k, t, cls]) => `<button class="chip ${cls}${f === k ? " on" : ""}" data-act="chip" data-k="imv" data-v="${k}">${t}<span class="c">${cont[k] || 0}</span></button>`).join("")}</div>
      <input type="search" placeholder="Buscar endereço, locador, locatário…" value="${esc(busca)}" data-busca="imvBusca">
      <span class="spacer"></span>
      ${(IMV.termos || []).length ? `<button class="btn danger" data-act="termos-imv" title="Imóveis com termo obrigatório pendente">⚠ ${IMV.termos.length} termo(s) pendente(s)</button>` : ""}${gradeBarra("imoveis")}
      ${podeLib ? (lib ? `<button class="btn" data-act="imv-trava" title="${passado ? "Alterações mudam só o histórico deste mês" : "Alterações valem para o cadastro atual"}">🔓 Edição liberada · bloquear</button>` : `<button class="btn" data-act="imv-libera">🔒 Liberar edição deste mês</button>`) : ""}
<button class="btn" data-act="imv-livres" title="Lista de imóveis livres para deixar na recepção (por tipo)">📄 Lista de livres</button>
      ${pode.editar() && !passado ? `<button class="btn pri" data-act="imv-novo">+ Imóvel</button>` : ""}
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
  const novo = !i;
  i = i || { status: "LVR", tipo: "Casa", taxa_adm: 10, carteira: "administrado" };
  const dis = pode.editar() ? "" : "disabled";
  const grupos = (IMV.grupos || []).map(g => g.nome);
  // só vira ALUGADO por um contrato; ao cadastrar: Livre (padrão), Ocupado ou Inativo
  const sts = Object.entries(STATUS_IMV).filter(([k]) => k !== "ALG" || i.status === "ALG");
  return `<div class="imv-g">
      <label class="fl"><span>Situação</span><select name="status" ${dis}>${sts.map(([k, v]) => opt(k, v[0], i.status === k)).join("")}</select></label>
      <label class="fl"><span>Tipo</span><select name="tipo" ${dis}>${tiposImovel(i.tipo).map(t => opt(t, t, i.tipo === t)).join("")}</select></label>
      <label class="fl"><span>Código no site ${/^\d+$/.test(String(i.codigo_site || "").trim()) ? `<a href="${esc(urlSite(i.codigo_site))}" target="_blank" rel="noopener">ver no site ↗</a>` : ""}</span><input name="codigo_site" value="${esc(i.codigo_site || "")}" inputmode="numeric" ${dis}></label>
      <label class="fl"><span>Contrato</span><input name="contrato_codigo" value="${esc(i.contrato_codigo || "")}" placeholder="só números: 26100" ${novo ? "disabled title=\"O imóvel recebe o contrato pela tela Contratos\"" : dis}></label>
      <label class="fl"><span>Declarar IR?</span><select name="declarar_ir" ${dis}>${opt("", "—", !i.declarar_ir)}${opt("Sim", "Sim", i.declarar_ir === "Sim")}${opt("Não", "Não", i.declarar_ir === "Não")}</select></label>
      <label class="fl"><span>IR declarado por</span><select name="ir_para" ${dis}>${opt("", "—", !i.ir_para)}${["Locador", "Locatário", "Locador e locatário"].map(x => opt(x, x, i.ir_para === x)).join("")}</select></label>
      <label class="fl s3"><span>Endereço</span><input name="endereco" value="${esc(i.endereco || "")}" required ${dis}></label>
      <label class="fl s2"><span>Carteira</span><select name="carteira" ${dis}>${Object.entries(CARTEIRAS).map(([k, v]) => opt(k, v, (i.carteira || "administrado") === k)).join("")}</select></label>
      <label class="fl s2"><span>Locador (proprietário) — do cadastro de locadores ${dis ? "" : `<button type="button" class="btn sm" data-novo-loc style="padding:0 6px;margin-left:6px">+ novo</button>`}</span><input name="locador" value="${esc(i.locador || "")}" list="dl-locadores" placeholder="escolha da lista" ${dis}></label>
      <label class="fl"><span>Grupo do locador</span><input name="grupo" list="dl-grupos" value="${esc(i.grupo_locador || "")}" placeholder="(outros locadores)" ${dis}
        title="Escolha um grupo da lista ou digite um nome novo. Vale para todos os imóveis deste locador."></label>
      <label class="fl"><span>${i.status === "ALG" ? "Aluguel" : "Aluguel previsto"}</span><input name="valor" inputmode="decimal" value="${i.valor != null ? n2(i.valor) : ""}" ${dis}></label>
      <label class="fl"><span>Taxa adm. %</span><input name="taxa_adm" inputmode="decimal" value="${n2(i.taxa_adm)}" ${dis}></label>
      ${novo ? "" : `<label class="fl s2"><span>Locatário (inquilino atual)</span><input name="locatario" value="${esc(i.locatario || "")}" ${dis}></label>
      <label class="fl"><span>Entrada do locatário</span><input type="date" name="data_entrada" value="${i.data_entrada || ""}" ${dis}></label>
      <label class="fl"><span>Dia venc.</span><input type="number" name="dia_venc" min="1" max="31" value="${i.dia_venc || ""}" ${dis}></label>
      <span></span>
      <label class="fl s2"><span>Fiador(es)</span><input name="fiador" value="${esc(i.fiador || "")}" ${dis}></label>`}
      <label class="fl s5"><span>Observações</span><textarea name="obs" rows="2" ${dis}>${esc(i.obs || "")}</textarea></label>
    </div>
    <datalist id="dl-grupos">${grupos.map(g => `<option value="${esc(g)}">`).join("")}</datalist>
    <datalist id="dl-locadores">${(S.locadores || []).filter(l => l.ativo).map(l => `<option value="${esc(l.nome)}">`).join("")}</datalist>
    <p class="hint">${novo ? "O imóvel passa a <b>Alugado</b> só quando um contrato é ligado a ele (tela Contratos). " : ""}Carteira: <b>Administrado</b> = de terceiros · <b>Próprio</b> = da imobiliária (100%) · <b>Particular do sócio</b> = 0%. O grupo vale para todos os imóveis do mesmo locador.</p>`;
}
function lerImovel(f) {
  const valor = f.valor.value.trim() ? parseMoney(f.valor.value) : null;
  const taxa = parseMoney(f.taxa_adm.value);
  if (taxa == null || taxa < 0 || taxa > 100) throw new Error("Taxa deve estar entre 0 e 100.");
  const d = { status: f.status.value, tipo: f.tipo.value || "Casa", codigo_site: f.codigo_site.value.trim(), endereco: f.endereco.value.trim(),
    carteira: f.carteira.value, locador: f.locador.value.trim(), valor, taxa_adm: taxa, contrato_codigo: f.contrato_codigo.value.trim(), declarar_ir: f.declarar_ir.value, ir_para: f.ir_para.value, obs: f.obs.value.trim() };
  if (f.locatario) Object.assign(d, { locatario: f.locatario.value.trim(), fiador: f.fiador.value.trim(), dia_venc: +f.dia_venc.value || null, data_entrada: f.data_entrada.value || null });
  if (!d.endereco) throw new Error("Informe o endereço.");
  if (!d.locador) throw new Error("Escolha o locador (Cadastros › Locadores). Se for novo, clique em “+ novo”.");
  if (!locadorExiste(d.locador)) throw new Error(`O locador “${d.locador}” não está no cadastro de locadores. Escolha da lista ou cadastre com “+ novo”.`);
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
  if (f.data_entrada) { let auto = f.data_entrada.value ? +f.data_entrada.value.slice(8, 10) : null;
  f.data_entrada.addEventListener("change", () => {
    if (!f.data_entrada.value) return;
    const dia = +f.data_entrada.value.slice(8, 10);
    if (!f.dia_venc.value || +f.dia_venc.value === auto) f.dia_venc.value = dia;
    auto = dia;
  }); }
  // grupo sugerido quando o locador já pertence a um grupo
  f.locador.addEventListener("change", () => { const g = (IMV.grupos || []).find(x => (x.locadores || []).includes(f.locador.value.trim())); if (g) f.grupo.value = g.nome; });
}
// lista de imóveis livres (para imprimir e deixar na recepção): residenciais e comerciais, cada uma enchendo a folha A4 com linhas em branco
const LV_LINHAS = 35, LV_LINHAS2 = 40; // linhas na 1ª folha A4 e nas seguintes (cabeçalhos de tipo contam como linha)
const ehResid = t => /casa|apto|apart|kit|sobrado|edicula|edícula/i.test(t || "");
function listaLivresHTML(titulo, grupos, minBranco, extraPref) {
  // grupos: [[tipo, imoveis]] · cada tipo: 1 linha de título + imóveis + linhas em branco
  // minBranco: número ou lista (um por tipo) · extraPref: tipos (índices) que recebem as linhas que sobram
  const mins = grupos.map((g, i) => Array.isArray(minBranco) ? minBranco[i] : minBranco);
  const usados = grupos.reduce((a, [, ls], i) => a + 1 + ls.length + mins[i], 0);
  const total = usados <= LV_LINHAS ? LV_LINHAS : LV_LINHAS + Math.ceil((usados - LV_LINHAS) / LV_LINHAS2) * LV_LINHAS2;
  const brancos = mins.slice(); let sobra = total - usados;
  const pref = extraPref == null ? grupos.map((g, i) => i) : [].concat(extraPref).filter(i => grupos[i]);
  for (let i = 0; sobra > 0 && pref.length; i = (i + 1) % pref.length, sobra--) brancos[pref[i]]++;
  const linhas = grupos.map(([t, ls], gi) => `<tr class="lv-tipo${gi ? " lv-div" : ""}"><td colspan="3">${esc(t.toUpperCase())} <small>(${ls.length} disponíve${ls.length === 1 ? "l" : "is"})</small></td></tr>`
    + ls.map(i => `<tr><td>${esc(i.endereco)}${i.bairro ? ` <small>– ${esc(i.bairro)}</small>` : ""}</td><td>${esc(i.tipo || "")}</td><td class="num">${+i.valor > 0 ? n2(i.valor) : ""}</td></tr>`).join("")
    + Array.from({ length: brancos[gi] }, () => `<tr class="lv-br"><td></td><td></td><td></td></tr>`).join("")).join("");
  return `<div class="rel-tit"><b>Imóveis disponíveis para locação · ${esc(titulo)}</b><span>Atualizado em ${new Date().toLocaleDateString("pt-BR")}</span></div>
    <table class="rel-t lv-t"><colgroup><col><col style="width:22%"><col style="width:16%"></colgroup><thead><tr><th>Endereço</th><th>Tipo</th><th class="num">Valor (R$)</th></tr></thead><tbody>${linhas}</tbody></table>
    <p class="rel-rod">Valores sujeitos a alteração. Consulte condições e garantias na imobiliária.</p>`;
}
ACT["imv-livres"] = () => {
  const livres = S.imoveis.filter(i => i.status === "LVR");
  const res = livres.filter(i => ehResid(i.tipo)), com = livres.filter(i => !ehResid(i.tipo));
  modal({ titulo: "Lista de imóveis livres", ok: "Gerar",
    corpo: `<p>${livres.length} imóveis livres: <b>${res.length}</b> residenciais (casas e apartamentos) e <b>${com.length}</b> comerciais. Cada lista sai numa folha A4 inteira, com linhas em branco para completar à mão.</p>
      <label class="chk"><input type="checkbox" name="r" checked> Residenciais: casas numa folha e apartamentos em outra</label><label class="chk"><input type="checkbox" name="c" checked> Comerciais (salões, salas, barracões, terrenos…)</label>
      <label class="chk"><input type="checkbox" name="semvalor" checked> Incluir imóveis sem valor de aluguel definido (o valor fica em branco para preencher à mão)</label>`,
    salvar: async f => {
      if (!f.r.checked && !f.c.checked) throw new Error("Escolha pelo menos uma lista.");
      const ok = i => f.semvalor.checked || +i.valor > 0, ord = (a, b) => (+a.valor || 0) - (+b.valor || 0) || COLL.compare(a.endereco, b.endereco);
      const blocos = [];
      if (f.r.checked) {
        const casas = res.filter(i => !/apto|apart|kit/i.test(i.tipo)).filter(ok).sort(ord), aptos = res.filter(i => /apto|apart|kit/i.test(i.tipo)).filter(ok).sort(ord);
        blocos.push(listaLivresHTML("Casas", [["Casas", casas]], 5, 0));
        blocos.push(listaLivresHTML("Apartamentos", [["Apartamentos", aptos]], 5, 0));
      }
      if (f.c.checked) {
        // sala e salão ficam com as linhas que sobram; os outros tipos (barracão, terreno, casa comercial…) com 1 linha em branco
        const tipos = Array.from(new Set(com.map(i => i.tipo || "Outros"))).sort((a, b) => COLL.compare(a, b)), salas = t => /^sal/i.test(norm(t));
        const gs = tipos.map(t => [t, com.filter(i => (i.tipo || "Outros") === t).filter(ok).sort(ord)]);
        const pref = gs.map((g, i) => salas(g[0]) ? i : -1).filter(i => i >= 0);
        blocos.push(listaLivresHTML("Comerciais", gs, gs.map(g => salas(g[0]) ? 3 : 1), pref.length ? pref : null));
      }
      setTimeout(() => abrirRelatorio("Imóveis livres", blocos), 0);
    } });
};
// + novo locador direto do cadastro do imóvel
function ligarNovoLocador(f, d) {
  const b = $("[data-novo-loc]", d); if (!b) return;
  b.addEventListener("click", async () => {
    const nome = (prompt("Nome do novo locador (como deve aparecer no sistema):", f.locador.value.trim()) || "").trim().toUpperCase();
    if (!nome) return;
    try {
      if (!locadorExiste(nome)) await q(sb.from("locadores").insert({ nome }));
      await recarregarLocadores(); f.locador.value = nome;
      $("#dl-locadores", d).innerHTML = S.locadores.map(l => `<option value="${esc(l.nome)}">`).join("");
      toast(`Locador ${nome} cadastrado. Complete os dados em Cadastros › Locadores.`);
    } catch (e) { falha(e); }
  });
}
ACT["imv-novoctt"] = el => { const im = S.imovelPor[el.dataset.id]; $("#dlg").close(); novoContratoPreenchido(im.locador, im); };
ACT["imv-novo"] = () => modal({ titulo: "Novo imóvel", xl: true, corpo: formImovel(), aoAbrir: (f, d) => { ligarCarteira(f); ligarNovoLocador(f, d); },
  salvar: async f => {
    const d = lerImovel(f);
    if (d.status !== "LVR" && !pedeConfirmacao(f, `Cadastrar este imóvel como <b>${esc(STATUS_IMV[d.status][0])}</b>? O normal é cadastrar como <b>Livre</b>.`, "Sim, cadastrar assim")) return false;
    await q(sb.from("imoveis").insert(d)); await salvarGrupo(f, ""); await recarregarImoveis(); toast("Imóvel cadastrado."); render(); } });
let cttsImv = [];
// v13: ficha completa do imóvel — os dados vêm do contrato (atual ou o último) e ficam travados aqui
const IMV_FICHA_KS = ["end_rua", "end_bairro", "end_cidade", "end_cep", "matricula", "insc_cad", "uc", "rgi"];
function abasImovelHTML(i, ctts) {
  const c = ctts.find(x => x.codigo === i.contrato_codigo) || ctts.find(x => (x.ficha || {}).end_rua) || ctts[0];
  const f = c ? fichaDe(c) : {}, fi = i.ficha || {};
  const ro = (ks) => `<div class="ficha-g">${ks.map(k => campoHTML(CPK[k], f[k] || "", "disabled")).join("")}</div>`;
  const pessoaKs = p => ["nome", "sexo", "nac", "est_civil", "prof", "rg", "oe", "cpf", "tel", "email"].map(x => p + "_" + x);
  const endKs = p => ["qtd", "casados", "regime", "data_casamento", "end1_rua", "end1_bairro", "end1_cidade", "end2_rua", "end2_bairro", "end2_cidade"].map(x => p + "_" + x);
  const blocoP = (g, rot) => !c ? `<p class="hint">Sem contrato ligado a este imóvel.</p>` : !f[g + "1_nome"] ? `<p class="hint">O contrato ${esc(c.codigo)} não tem ${rot.toLowerCase()}.</p>` :
    `<fieldset class="ficha-b"><legend>${rot} 1</legend>${ro(pessoaKs(g + "1"))}</fieldset>${f[g + "2_nome"] ? `<fieldset class="ficha-b"><legend>${rot} 2</legend>${ro(pessoaKs(g + "2"))}</fieldset>` : ""}<fieldset class="ficha-b"><legend>Casamento e endereços</legend>${ro(endKs(g))}</fieldset>`;
  const topo = c ? `<div class="box trava">🔒 Dados do contrato <b>${esc(c.codigo)}</b> (${esc(c.situacao)})${c.codigo !== i.contrato_codigo ? " · último contrato deste imóvel" : ""}. Para alterar, abra o contrato. <button type="button" class="btn sm" data-abrir-ctt="${esc(c.codigo)}">Abrir o contrato ${esc(c.codigo)}</button></div>` : "";
  const difs = c ? IMV_FICHA_KS.filter(k => fi[k] && f[k] && norm(fi[k]) !== norm(f[k])) : [];
  const imvSec = c ? ro(IMV_FICHA_KS) + (difs.length ? `<div class="box warn">Dados diferentes guardados no imóvel (lista antiga): ${difs.map(k => `${esc(CPK[k].t.split(" (")[0])}: <b>${esc(fi[k])}</b>`).join(" · ")}. Vale o contrato.</div>` : "")
    : `<p class="hint">Sem contrato: os dados ficam guardados no próprio imóvel.</p><div class="ficha-g">${IMV_FICHA_KS.map(k => `<label class="fl${k === "end_rua" ? " largo" : ""}"><span>${esc(CPK[k].t)}</span><input data-if="${k}" value="${esc(fi[k] || "")}" ${pode.editar() ? "" : "disabled"}></label>`).join("")}</div>`;
  return { abas: `<div class="abas ficha-abas imv-abas"><button type="button" class="aba on" data-aba="res">Resumo</button><button type="button" class="aba" data-aba="imv">Imóvel</button><button type="button" class="aba" data-aba="lcd">Locadores</button><button type="button" class="aba" data-aba="lct">Locatários</button><button type="button" class="aba" data-aba="fdr">Fiadores</button></div>`,
    secs: `<div class="ficha-sec" data-sec="imv" hidden>${topo}${imvSec}</div><div class="ficha-sec" data-sec="lcd" hidden>${topo}${blocoP("lcd", "Locador")}</div><div class="ficha-sec" data-sec="lct" hidden>${topo}${blocoP("lct", "Locatário")}</div><div class="ficha-sec" data-sec="fdr" hidden>${topo}${blocoP("fdr", "Fiador")}</div>` };
}
ACT["imv-ed"] = async el => {
  const i = S.imovelPor[el.dataset.id]; if (!i) return;
  const [reaj, hist, cobs, ultAlg] = await Promise.all([
    q(sb.from("reajustes").select("*").eq("imovel_id", i.id).order("competencia", { ascending: false })),
    q(sb.from("mapa_mensal").select("competencia,status,valor,locatario").eq("imovel_id", i.id).order("competencia", { ascending: false }).limit(14)),
    q(sb.from("cobrancas").select("competencia,vencimento,valor,acrescimos,descontos,valor_pago,data_pagamento,taxa_valor,repasse_data,locatario,devedor_id").eq("imovel_id", i.id).order("competencia", { ascending: false }).limit(12)),
    q(sb.from("mapa_mensal").select("competencia,valor,locatario").eq("imovel_id", i.id).eq("status", "ALG").order("competencia", { ascending: false }).limit(1)),
    q(sb.from("contratos").select("*").or(`imovel_id.eq.${i.id}${i.contrato_codigo ? `,codigo.eq.${i.contrato_codigo}` : ""}`).order("codigo", { ascending: false })).catch(() => [])
  ]).then(r => { cttsImv = r[4]; return r; });
  const saida = pode.editar() && i.status === "ALG" ? `<button type="button" class="btn" data-saida>🚪 Registrar saída do locatário</button>` : pode.editar() && i.status === "LVR" ? `<button type="button" class="btn" data-act="imv-novoctt" data-id="${i.id}" title="Abre o gerador com os dados do locador e do imóvel">📄 Novo contrato para este imóvel</button>` : "";
  const excluir = pode.admin() ? `<span class="spacer"></span><button type="button" class="btn danger" data-del>Excluir</button>` : "";
  modal({
    titulo: i.endereco, xl: true, semOk: !pode.editar(), extra: saida + excluir,
    corpo: abasImovelHTML(i, cttsImv).abas + `<div class="ficha-sec" data-sec="res">` + formImovel(i) + `
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
        ${ultAlg.length && !hist.some(h => h.status === "ALG") ? `<tr class="ult-alg"><td>${mesCurto(ultAlg[0].competencia)}</td><td colspan="3">Último mês alugado registrado: <b>${brl(ultAlg[0].valor)}</b>${ultAlg[0].locatario ? " · " + esc(ultAlg[0].locatario) : ""}</td></tr>` : ""}
        ${!ultAlg.length && hist.length ? `<tr class="ult-alg"><td colspan="4">Nenhum mês alugado registrado no histórico.</td></tr>` : ""}
      </tbody></table></div></div>` + abasImovelHTML(i, cttsImv).secs,
    salvar: async f => {
      const d = lerImovel(f);
      if (i.status === "ALG" && d.status !== "ALG") throw new Error('Para desocupar, use o botão "Registrar saída do locatário": assim ficam guardados a data de saída e se ele ficou devendo.');
      const fi = Object.assign({}, i.ficha || {}); $$("[data-if]", $("#dlg")).forEach(x => (fi[x.dataset.if] = x.value.trim())); d.ficha = fi;
      await q(sb.from("imoveis").update(d).eq("id", i.id)); await salvarGrupo(f, i.grupo_locador); await recarregarImoveis(); toast("Salvo."); render();
    },
    aoAbrir: (f, d) => { ligarNovoLocador(f, d);
      ligarCarteira(f);
      $$(".imv-abas .aba", d).forEach(b => b.addEventListener("click", () => { $$(".imv-abas .aba", d).forEach(x => x.classList.toggle("on", x === b)); $$(".ficha-sec", d).forEach(s => (s.hidden = s.dataset.sec !== b.dataset.aba)); }));
      $$("[data-abrir-ctt]", d).forEach(b => b.addEventListener("click", async () => { d.close(); if (!CTT.length) CTT = await fetchAll("contratos", x => x.order("codigo", { ascending: false })); ACT["ctt-ed"]({ dataset: { id: b.dataset.abrirCtt } }); }));
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
      <input inputmode="numeric" placeholder="R$ 0,00" value="${it.valor ? moedaFmt(it.valor) : ""}" data-val>
      <label class="chk est" title="Marque quando ainda não sabe o valor exato"><input type="checkbox" data-est ${it.estimado ? "checked" : ""}> estimado</label>
      <button type="button" class="btn sm" aria-label="Remover">✕</button>`;
    mascaraMoeda(div.querySelector("[data-val]"));
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
// termos obrigatórios pendentes (entrega de chaves depois da saída)
const termoEst = (c, t) => ((c.termos || {})[t] || {}).estado || "";
// contratos com termo obrigatório pendente (entrega de chaves e devolução de caução)
async function termosPendentes() {
  const [e, c] = await Promise.all([
    q(sb.from("contratos").select("codigo,locatario,endereco,termos").eq("termos->entrega->>estado", "pendente")).catch(() => []),
    q(sb.from("contratos").select("codigo,locatario,endereco,termos").eq("termos->caucao->>estado", "pendente")).catch(() => [])
  ]);
  return e.map(x => Object.assign({ tipo: "entrega" }, x)).concat(c.map(x => Object.assign({ tipo: "caucao" }, x)));
}
const termoBtn = t => `<button class="btn sm" data-act="termo-pend" data-id="${esc(t.codigo)}" data-t="${t.tipo}">${t.tipo === "entrega" ? "🔑" : "💰"} ${esc(t.codigo)} · ${esc(curtoTxt(t.locatario, 34))}</button>`;
function termosPendentesHTML(lista) {
  const ls = lista || CTT.filter(c => termoEst(c, "entrega") === "pendente").map(c => Object.assign({ tipo: "entrega" }, c))
    .concat(CTT.filter(c => termoEst(c, "caucao") === "pendente").map(c => Object.assign({ tipo: "caucao" }, c)));
  if (!ls.length) return "";
  const en = ls.filter(t => t.tipo === "entrega"), ca = ls.filter(t => t.tipo === "caucao");
  return `<div class="alert bad"><span>${en.length ? `<b>Termo de entrega de chaves pendente</b> (obrigatório depois da saída): ${en.map(termoBtn).join(" ")}` : ""}${en.length && ca.length ? "<br>" : ""}${ca.length ? `<b>Termo de devolução de caução pendente</b>: ${ca.map(termoBtn).join(" ")}` : ""}</span></div>`;
}
// avisos compactos: um botão pequeno que abre a lista completa
const AVISOS = {};
function avisoBtn(id, rotulo, cls, titulo, html) { AVISOS[id] = { titulo, html }; return `<button class="btn sm aviso ${cls || ""}" data-act="aviso" data-id="${id}">${rotulo}</button>`; }
ACT.aviso = el => { const a = AVISOS[el.dataset.id]; if (a) modal({ titulo: a.titulo, corpo: a.html, semOk: true, largo: true }); };
const listaBtns = arr => `<div class="aviso-lista">${arr.join("")}</div>`;
ACT["termos-imv"] = el => {
  const ls = IMV.termos || [];
  const p = pop(el, `<div class="gp-h">Termos obrigatórios pendentes</div><div class="gp-cols">${ls.map(t => termoBtn(t)).join("")}</div><p class="hint">🔑 entrega de chaves · 💰 devolução de caução. O termo fica feito quando o PDF é baixado.</p>`, 360);
  void p;
};
ACT["termo-pend"] = async el => {
  fecharPop();
  if (el.dataset.t !== "caucao") return abrirTermoObrig(el.dataset.id);
  // caução: se ainda tem conta caução vigente, a baixa (com o termo) é feita em Contas caução
  await carregarCauc();
  const m = CAUC.vigPorCtt[el.dataset.id];
  if (m) return darBaixaCauc(m);
  const mv = CAUC.movs.find(x => x.contrato_codigo === el.dataset.id && x.termo === "pendente");
  if (mv) return abrirTermoCauc(mv.id, el.dataset.id);
  abrirTermo("caucao", el.dataset.id, "", { aoBaixar: async () => { try { await rpc("marcar_termo", { p_codigo: el.dataset.id, p_tipo: "caucao", p_estado: "feito", p_motivo: "" }); toast("Termo de devolução registrado como feito."); $("#dlg").dataset.mudou = "1"; } catch (e) { falha(e); } } });
};
// abre o termo de entrega; ao baixar o PDF ele fica "feito"
function abrirTermoObrig(codigo) {
  abrirTermo("entrega", codigo, "", { aoBaixar: () => marcarEntregaFeita(codigo) });
}
async function marcarEntregaFeita(codigo) {
    try { await rpc("marcar_termo", { p_codigo: codigo, p_tipo: "entrega", p_estado: "feito", p_motivo: "" });
      const c = CTT.find(x => x.codigo === codigo); if (c) c.termos = Object.assign({}, c.termos, { entrega: { estado: "feito" } });
      toast(`Termo de entrega do contrato ${codigo} registrado como feito.`); $("#dlg").dataset.mudou = "1";
    } catch (e) { falha(e); }
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
        ${i.contrato_codigo ? `<div class="obrig" data-obrig><b>🔑 Termo de entrega de chaves: OBRIGATÓRIO.</b> Ao registrar a saída, o termo abre já preenchido; ele só conta como feito quando o PDF for gerado/baixado. Enquanto isso, o contrato fica com aviso de <b>termo pendente</b>.
          <label class="chk" style="margin-top:6px"><input type="checkbox" name="semtermo"> Neste caso específico o termo <b>não é necessário</b></label>
          <label class="fl" data-motivo hidden><span>Motivo (fica registrado na auditoria)</span><input name="motivo" placeholder="Ex.: chaves devolvidas em cartório, termo feito em papel…"></label>
          </div>
          ${/CAU/i.test(norm((ctt && ctt.garantia) || "")) ? `<div class="obrig" data-obrig-c style="margin-top:8px"><b>💰 Termo de devolução de caução: OBRIGATÓRIO.</b> Contrato com caução: depois da saída, faça a baixa da caução (valor devolvido) em <b>Contas caução</b>; o termo de devolução abre junto. Até lá fica o aviso de <b>termo pendente</b>.
            <label class="chk" style="margin-top:6px"><input type="checkbox" name="semcauc"> Neste caso o termo de devolução de caução <b>não é necessário</b></label>
            <label class="fl" data-motivo-c hidden><span>Motivo (fica registrado)</span><input name="motivoc" placeholder="Ex.: caução usada para quitar débitos, paga direto ao proprietário…"></label></div>` : ""}`
          : `<p class="hint">Imóvel sem contrato ligado: não há termo de entrega para gerar pelo sistema.</p>`}
        <p class="hint">Ao registrar: o imóvel muda para a situação escolhida (o valor do aluguel fica como previsto), o contrato fica <b>Encerrado</b> — ou <b>Débito em aberto</b> se ficou devendo — e o devedor entra na lista de <b>Devedores</b> com os dados e contatos do contrato.</p>`,
      aoAbrir: (f, d) => {
        lerItens = ligarItens(d, [], () => total(d));
        if (f.semtermo) f.semtermo.addEventListener("change", () => { $("[data-motivo]", d).hidden = !f.semtermo.checked; $("[data-obrig]", d).classList.toggle("ok", f.semtermo.checked); });
        if (f.semcauc) f.semcauc.addEventListener("change", () => { $("[data-motivo-c]", d).hidden = !f.semcauc.checked; $("[data-obrig-c]", d).classList.toggle("ok", f.semcauc.checked); });
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
        const semTermo = !!(f.semtermo && f.semtermo.checked), motivo = f.motivo ? f.motivo.value.trim() : "";
        if (semTermo && motivo.length < 5) throw new Error("Explique por que o termo de entrega não é necessário neste caso.");
        const temCauc = !!f.semcauc, semCauc = temCauc && f.semcauc.checked, motivoC = f.motivoc ? f.motivoc.value.trim() : "";
        if (semCauc && motivoC.length < 5) throw new Error("Explique por que o termo de devolução de caução não é necessário.");
        const totalTxt = deve ? brl(itens.reduce((a, x) => a + (+x.valor || 0), 0)) : "";
        if (!pedeConfirmacao(f, `<b>Confirma a saída de ${esc(i.locatario || "?")}</b> de ${esc(i.endereco)} em <b>${dt(f.data.value)}</b>?<br>
          O imóvel passa a ficar <b>${esc((STATUS_IMV[f.status.value] || [f.status.value])[0])}</b>${deve ? ` e o devedor entra na lista com <b>${totalTxt}</b>` : " (saiu sem dever)"}.
          ${i.contrato_codigo ? (semTermo ? `<br>⚠️ Termo de entrega <b>DISPENSADO</b>: “${esc(motivo)}”.` : "<br>Em seguida abre o <b>termo de entrega de chaves</b> (obrigatório).") : ""}
          ${f.semcauc ? (f.semcauc.checked ? `<br>⚠️ Termo de devolução de caução <b>DISPENSADO</b>.` : "<br>Fica pendente a <b>baixa da caução</b> com o termo de devolução.") : ""}`, "Sim, registrar a saída")) return false;
        await rpc("registrar_saida", { p_imovel: i.id, p_data: f.data.value, p_devedor: deve ? f.devedor.value : null, p_itens: itens, p_obs: deve ? f.obs.value : "", p_cobrancas: cobsSel, p_status: f.status.value });
        if (i.contrato_codigo) {
          try { await rpc("marcar_termo", { p_codigo: i.contrato_codigo, p_tipo: "entrega", p_estado: semTermo ? "dispensado" : "pendente", p_motivo: motivo });
            if (temCauc) await rpc("marcar_termo", { p_codigo: i.contrato_codigo, p_tipo: "caucao", p_estado: semCauc ? "dispensado" : "pendente", p_motivo: motivoC }); } catch (e) { falha(e); }
        }
        await recarregarImoveis();
        CTT = await fetchAll("contratos", b => b.order("codigo", { ascending: false }));
        toast(deve ? "Saída registrada e devedor incluído na lista." : "Saída registrada.");
        render();
        if (i.contrato_codigo && !semTermo) setTimeout(() => abrirTermoObrig(i.contrato_codigo), 300);
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
  pg.innerHTML = `<div class="grid">${cobrancaAbas("devedores")}
    <div class="kpis">${kpi("Saldo a receber", `<span class="neg">${brl(abertos.reduce((a, d) => a + saldoDev(d), 0))}</span>`, `${abertos.length} devedores em aberto ou em acordo`, true)}
      ${kpi("Acordos em andamento", String(acordos.length), atrasados.length ? `${atrasados.length} com parcela atrasada` : "todos em dia")}
      ${kpi("Já recebido", `<span class="pos">${brl(DEV.reduce((a, d) => a + +d.valor_pago, 0))}</span>`, "de todas as dívidas")}
      ${kpi("Com valor a confirmar", String(abertos.filter(temEstimado).length), "dívidas com valor estimado")}</div>
    <div class="filters">
      <div class="chips">${chips.map(([k, t, cls, dica]) => `<button class="chip ${cls}${f === k ? " on" : ""}" data-act="chip" data-k="dev" data-v="${k}"${dica ? ` title="${esc(dica)}"` : ""}>${t}<span class="c">${DEV.filter(teste[k]).length}</span></button>`).join("")}</div>
      <input type="search" placeholder="Buscar nome, imóvel, contrato…" value="${esc(busca)}" data-busca="devBusca">
      <span class="spacer"></span>${gradeBarra("devedores")}
      <button class="btn" data-act="cob-termos-menu">📄 Termos ▾</button>${pode.editar() ? `<button class="btn pri" data-act="dev-novo">+ Devedor antigo</button>` : ""}
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
    extra: (pode.editar() ? `<button type="button" class="btn pri left" data-pagar>+ Registrar pagamento</button>` : "") + (pode.admin() ? `<button type="button" class="btn danger left" data-del>Excluir</button>` : "") + `<button type="button" class="btn" data-act="cob-termo" data-src="dev" data-id="${dv.id}">📄 Termos (notificação, acordo, despejo)</button>`,
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
   PÁGINA: DEPÓSITOS AOS PROPRIETÁRIOS (lista de depósitos + demonstrativo)
   ===================================================================== */
const SIT_DEP = { depositado: ["Depositado", "ok"], imob: ["Pago na imobiliária", "info"], sem_valor: ["Sem valor (descontado)", "idle"], nao_houve: ["Não houve", "idle"], carencia: ["Carência", "warn"] };
let DEP = { favs: [], mes: [], cobs: [] };
// aluguéis do mês que entram no depósito deste favorecido (pelos nomes de locadores ligados a ele)
const cobsDoFav = f => DEP.cobs.filter(c => (f.locadores || []).includes(c.locador));
const liquidoCob = c => calcCob(c).prop;
function infoDep(f) {
  const m = DEP.mes.find(x => x.favorecido_id === f.id);
  const cs = cobsDoFav(f), pend = cs.filter(precisaRepasse), naoPagos = cs.filter(c => !c.data_pagamento && !c.devedor_id);
  const prevista = f.dia ? S.mes.slice(0, 8) + pad(Math.min(f.dia, +fimMes(S.mes).slice(8))) : null;
  const atrasado = !m && prevista && prevista < hoje() && pend.length > 0;
  return { m, cs, pend, naoPagos, prevista, atrasado, aRepassar: pend.reduce((a, c) => a + liquidoCob(c), 0) };
}
const COLS_DEP = [
  { k: "dia", t: "Dia", tipo: "num", int: true, dica: "Dia previsto do depósito" },
  { k: "nome", t: "Favorecido", cls: "trunc" },
  { k: "locadores", t: "Locadores (mapa)", v: f => (f.locadores || []).join(" · "), cls: "trunc", html: f => f.locadores && f.locadores.length ? esc(f.locadores.join(" · ")) : `<span class="tag warn">sem locador ligado</span>` },
  { k: "imoveis", t: "Aluguéis", tipo: "num", int: true, v: f => cobsDoFav(f).length, dica: "Aluguéis do mês ligados a este depósito" },
  { k: "receber", t: "Falta receber", tipo: "num", int: true, v: f => infoDep(f).naoPagos.length, html: f => { const n = infoDep(f).naoPagos.length; return n ? `<span class="neg">${n}</span>` : ""; } },
  { k: "arepassar", t: "A repassar", tipo: "num", v: f => infoDep(f).aRepassar || null },
  { k: "situacao", t: "Situação", v: f => { const i = infoDep(f); return i.m ? SIT_DEP[i.m.situacao][0] : i.atrasado ? "Atrasado" : "Pendente"; },
    html: f => { const i = infoDep(f); if (i.m) return `<span class="tag ${SIT_DEP[i.m.situacao][1]}">${esc(SIT_DEP[i.m.situacao][0])}${i.m.data ? " " + dt(i.m.data).slice(0, 5) : ""}</span>`;
      return i.atrasado ? `<span class="tag bad">Atrasado</span>` : `<span class="tag idle">Pendente</span>`; } },
  { k: "valor", t: "Depositado", tipo: "num", v: f => { const i = infoDep(f); return i.m && i.m.valor != null ? +i.m.valor : null; } },
  { k: "forma", t: "Forma", v: f => FORMAS[f.forma] || "", dica: "Forma de pagamento padrão" },
  { k: "conta_bancaria", t: "Conta / PIX", cls: "trunc" },
  { k: "obs", t: "Observações", cls: "trunc", oculta: true }
];
PAGES.depositos = async pg => {
  const [favs, mes, cobs] = await Promise.all([
    q(sb.from("depositos_fav").select("*").order("dia").order("nome")),
    q(sb.from("depositos_mes").select("*").eq("competencia", S.mes)),
    fetchAll("cobrancas", b => b.eq("competencia", S.mes).order("id"), "id,imovel_id,competencia,vencimento,locador,locatario,valor,acrescimos,descontos,ajustes,valor_pago,data_pagamento,taxa_valor,taxa_adm_pct,repasse_data,repasse_valor,devedor_id"),
    carregarDesp(S.mes)
  ]);
  DEP = { favs, mes, cobs };
  setRd(pg, () => desenharDepositos());
  desenharDepositos(pg);
};
function desenharDepositos(pg) {
  pg = pg || $("#page");
  const f = S.f.dep || "todos", busca = S.f.depBusca || "", inativos = S.f.depInat === "1", forma = S.f.depForma || "";
  const ehDinheiro = x => x.forma === "dinheiro";
  const base = DEP.favs.filter(x => (inativos || x.ativo) && (!forma || (forma === "dinheiro" ? ehDinheiro(x) : !ehDinheiro(x))));
  const teste = { todos: () => true, pend: x => !infoDep(x).m, atras: x => infoDep(x).atrasado, feitos: x => !!infoDep(x).m, semloc: x => !(x.locadores || []).length,
    desc: x => infoDep(x).cs.some(c => { const k = calcCob(c); return k.descProp > 0 || k.despTot > 0; }), forados: x => (x.locadores || []).some(l => !locadorExiste(l)) };
  let lista = base.filter(teste[f] || teste.todos);
  if (busca) { const b = norm(busca); lista = lista.filter(x => norm(x.nome + " " + (x.locadores || []).join(" ") + " " + x.conta_bancaria).includes(b)); }
  const tot = base.reduce((a, x) => { const i = infoDep(x); a.rep += i.aRepassar; if (i.m && i.m.valor) a.dep += +i.m.valor; if (i.atrasado) a.atr++; return a; }, { rep: 0, dep: 0, atr: 0 });
  const g = grade("depositos", COLS_DEP, lista, { attr: x => `data-act="dep-ed" data-id="${x.id}" style="cursor:pointer"`, sort: { k: "dia", dir: "asc" }, divisor: "dia",
    cls: x => { if (!x.ativo) return "inativa"; const i = infoDep(x); return i.m ? "ct-ativo" : i.atrasado ? "ct-deb" : "ct-pend"; },
    rodape: fl => `${fl.length} depósitos · a repassar <b>${brl(fl.reduce((a, x) => a + infoDep(x).aRepassar, 0))}</b> · depositado <span class="pos">${brl(fl.reduce((a, x) => { const m = infoDep(x).m; return a + (m && m.valor ? +m.valor : 0); }, 0))}</span>` });
  g.redesenhar = () => desenharDepositos();
  const chips = [["todos", "Todos", ""], ["pend", "Pendentes", "st-OCP"], ["atras", "Atrasados", "st-INTV"], ["feitos", "Feitos", "st-LVR"], ["desc", "Com descontos", ""], ["semloc", "Sem locador ligado", ""]].concat(base.some(teste.forados) ? [["forados", "⚠ Locador fora do cadastro", "st-INTV"]] : []);
  // locadores com aluguel no mês que não estão em nenhum favorecido
  const ligados = new Set(DEP.favs.flatMap(x => x.locadores || []));
  DEP.semCad = Array.from(new Set(DEP.cobs.filter(c => c.locador && !ligados.has(c.locador) && (S.imovelPor[c.imovel_id] || {}).carteira !== "proprio").map(c => c.locador))).sort((a, b) => COLL.compare(a, b));
  pg.innerHTML = `<div class="grid">
    <div class="kpis">${kpi("A repassar no mês", brl(tot.rep), "aluguéis já recebidos e ainda não repassados", true)}${kpi("Já depositado", `<span class="pos">${brl(tot.dep)}</span>`, mesTxt(S.mes))}${kpi("Atrasados", `<span class="${tot.atr ? "neg" : ""}">${tot.atr}</span>`, "dia previsto já passou")}</div>
    <div class="filters">
      <div class="fgrupo"><span>Situação</span>${chips.map(([k, t, cls]) => `<button class="chip ${cls}${f === k ? " on" : ""}" data-act="chip" data-k="dep" data-v="${k}">${t}<span class="c">${base.filter(teste[k]).length}</span></button>`).join("")}</div>
      <div class="fgrupo"><span>Forma</span>${[["", "Todas"], ["deposito", "Depósito / PIX"], ["dinheiro", "Dinheiro"]].map(([k, t]) => `<button class="chip${forma === k ? " on" : ""}" data-act="chip" data-k="depForma" data-v="${k}">${t}</button>`).join("")}</div>
      ${DEP.semCad.length ? `<button class="btn sm danger" data-act="dep-semcad" title="Locadores com aluguel no mês que não estão em nenhum cadastro de pagamento">⚠ ${DEP.semCad.length} locador(es) sem cadastro</button>` : ""}
      <input type="search" placeholder="Buscar favorecido, locador, conta…" value="${esc(busca)}" data-busca="depBusca">
      <label class="chk"><input type="checkbox" data-inat ${inativos ? "checked" : ""}> mostrar inativos</label>
      <span class="spacer"></span>${gradeBarra("depositos")}
      ${pode.ed("depositos") ? `<button class="btn" data-act="dep-fav">+ Favorecido</button>` : ""}
      <button class="btn" data-act="dep-rel-mes">Relatório do mês</button><button class="btn" data-act="dep-rel-todos" title="Relatório de cada proprietário (para imprimir ou salvar em PDF)">📄 Relatórios dos proprietários</button>
    </div>
    ${gradeHTML("depositos")}
  </div>`;
  ligarBusca(pg);
  const ci = $("[data-inat]", pg); if (ci) ci.addEventListener("change", () => { S.f.depInat = ci.checked ? "1" : ""; desenharDepositos(); requestAnimationFrame(ajustarAlturas); });
}
ACT["dep-semcad"] = () => modal({ titulo: "Locadores sem cadastro de pagamento", semOk: true, largo: true,
  corpo: `<p class="hint">Têm aluguel em ${esc(mesTxt(S.mes))}, mas não estão ligados a nenhum favorecido. Cadastre para aparecerem no pagamento de locadores.</p>
    <div class="tw"><table class="compacta"><tbody>${DEP.semCad.map(l => `<tr><td>${esc(l)}</td><td class="num">${DEP.cobs.filter(c => c.locador === l).length} aluguel(éis)</td><td>${pode.ed("depositos") ? `<button type="button" class="btn sm" data-novo-fav="${esc(l)}">Cadastrar</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`,
  aoAbrir: (f, d) => $$("[data-novo-fav]", d).forEach(b => b.addEventListener("click", () => { d.close(); setTimeout(() => ACT["dep-fav"]({ dataset: {}, novoLocador: b.dataset.novoFav }), 0); })) });
ACT["xls-dep"] = () => exportarGrade("depositos", `depositos-${S.mes.slice(0, 7)}.xlsx`, "Depositos");

// ---- cadastro do favorecido ----
function locadoresDoMapa() { return Array.from(new Set((S.locadores || []).filter(l => l.ativo).map(l => l.nome))).sort((a, b) => COLL.compare(a, b)); }
ACT["dep-fav"] = el => {
  const fav = DEP.favs.find(x => x.id === (el && el.dataset.id)) || { ativo: true, locadores: el && el.novoLocador ? [el.novoLocador] : [], nome: el && el.novoLocador ? el.novoLocador : "" };
  const usados = new Map(); DEP.favs.forEach(x => { if (x.id !== fav.id) (x.locadores || []).forEach(l => usados.set(l, x.nome)); });
  const todos = Array.from(new Set(locadoresDoMapa().concat(fav.locadores || [])));
  modal({ titulo: fav.id ? "Favorecido do depósito" : "Novo favorecido", largo: true,
    extra: fav.id && pode.admin() ? `<button type="button" class="btn danger" data-del>Excluir</button>` : "",
    corpo: `<div class="row"><label class="fl" style="grid-column:span 2"><span>Nome (como na lista de depósitos)</span><input name="nome" value="${esc(fav.nome || "")}" required></label>
        <label class="fl"><span>Dia previsto</span><input type="number" name="dia" min="1" max="31" value="${fav.dia || ""}"></label></div>
      <div class="row"><label class="fl"><span>Forma de pagamento padrão</span><select name="forma">${opt("", "—", !fav.forma)}${Object.entries(FORMAS).map(([k, t]) => opt(k, t, fav.forma === k)).join("")}</select></label>
        <label class="fl" style="grid-column:span 2"><span data-lconta>${fav.forma === "pix" ? "Chave PIX" : "Conta bancária"} (vazio se for em dinheiro)</span><input name="conta" value="${esc(fav.conta_bancaria || "")}"></label></div>
      <p><button type="button" class="btn sm" data-copiar-banco>⇣ Copiar do cadastro do locador</button> <span class="hint">usa os dados bancários do 1º locador marcado abaixo</span></p>
      <h3>Locadores que entram neste depósito</h3>
      <p class="hint">Marque um ou mais nomes de Cadastros › Locadores. Os aluguéis desses locadores aparecem no depósito. Nomes já ligados a outro depósito mostram ao lado de qual.</p>
      <input type="search" placeholder="Pesquisar nome…" data-lbusca style="width:100%;border:1px solid var(--line);border-radius:6px;padding:7px 10px">
      <div class="gp-lista grupo-lista">${todos.map(l => `<label data-txt="${esc(norm(l))}"><input type="checkbox" value="${esc(l)}" ${(fav.locadores || []).includes(l) ? "checked" : ""}> <span>${esc(l)}${locadorExiste(l) ? "" : ` <b class="neg" title="Este nome não está em Cadastros › Locadores. Desmarque e marque o nome certo do cadastro.">⚠ fora do cadastro</b>`}</span><small>${usados.has(l) ? "em: " + esc(usados.get(l)) : S.imoveis.filter(i => i.locador === l && i.status === "ALG").length + " alug."}</small></label>`).join("")}</div>
      <label class="chk"><input type="checkbox" name="ativo" ${fav.ativo ? "checked" : ""}> Ativo</label>
      <label class="fl"><span>Observações</span><textarea name="obs" rows="2">${esc(fav.obs || "")}</textarea></label>`,
    aoAbrir: (f, d) => {
      f.forma.addEventListener("change", () => { $("[data-lconta]", d).textContent = (f.forma.value === "pix" ? "Chave PIX" : "Conta bancária") + " (vazio se for em dinheiro)"; f.conta.disabled = f.forma.value === "dinheiro"; });
      $("[data-copiar-banco]", d).addEventListener("click", () => {
        const n = ($$(".grupo-lista input:checked", d)[0] || {}).value, lf = ((locPor(n) || {}).ficha) || {};
        if (!n) return toast("Marque o locador na lista.", true);
        if (!lf.pg_pix && !lf.pg_conta) return toast(`O cadastro de ${n} não tem dados bancários (Cadastros › Locadores › Dados bancários).`, true);
        if (lf.pg_pix) { f.forma.value = "pix"; f.conta.value = lf.pg_pix; } else { f.forma.value = "ted"; f.conta.value = `${lf.pg_banco || ""} ag. ${lf.pg_agencia || ""} c/c ${lf.pg_conta || ""}${lf.pg_titular ? " – " + lf.pg_titular : ""}${lf.pg_doc ? " – " + lf.pg_doc : ""}`.trim(); }
        f.forma.dispatchEvent(new Event("change")); if (!f.nome.value.trim()) f.nome.value = n;
      });
      $("[data-lbusca]", d).addEventListener("input", e => { const t = norm(e.target.value); $$(".grupo-lista label", d).forEach(l => (l.hidden = !!t && !l.dataset.txt.includes(t))); });
      const del = $("[data-del]", d); if (del) del.addEventListener("click", async () => { d.close(); if (!(await confirmar("Excluir favorecido", `Excluir <b>${esc(fav.nome)}</b> e o histórico de depósitos dele? Prefira desmarcar "Ativo".`, "Excluir"))) return; try { await q(sb.from("depositos_fav").delete().eq("id", fav.id)); toast("Excluído."); render(); } catch (e) { falha(e); } });
    },
    salvar: async f => {
      const dd = { nome: f.nome.value.trim(), dia: +f.dia.value || null, conta_bancaria: f.forma.value === "dinheiro" ? "" : f.conta.value.trim(), forma: f.forma.value, ativo: f.ativo.checked, obs: f.obs.value.trim(),
        locadores: $$(".grupo-lista input:checked", $("#dlg")).map(x => x.value) };
      if (!dd.nome) throw new Error("Informe o nome.");
      const fora = dd.locadores.filter(l => !locadorExiste(l)); if (fora.length) throw new Error("Fora do cadastro de locadores: " + fora.join(", ") + ". Desmarque e escolha o nome do cadastro (ou cadastre em Cadastros › Locadores).");
      if (fav.id) await q(sb.from("depositos_fav").update(dd).eq("id", fav.id)); else await q(sb.from("depositos_fav").insert(dd));
      toast("Salvo."); render();
    } });
};

// ---- depósito do mês ----
ACT["dep-ed"] = el => {
  const fav = DEP.favs.find(x => x.id === el.dataset.id); if (!fav) return;
  const i = infoDep(fav), ed = pode.ed("depositos"), soCaixa = S.papel === "recepcao";
  const abertos = i.cs.filter(c => podeRepassar(c));
  const podeReg = ed && (!i.m || abertos.length > 0); // complemento: aluguel pago depois do depósito do mês
  const linhaCob = c => { const im = S.imovelPor[c.imovel_id] || {}, k = calcCob(c), aberto = podeRepassar(c);
    const descs = [].concat(ajustesDe(c).filter(x => x.tipo === "desc" && x.de === "prop").map(x => ajRot(x) + " " + n2(x.valor)), k.desp.map(l => (l.descricao || "despesa") + " " + n2(l.valor)));
    return `<tr class="${c.repasse_data ? "ct-ativo" : !c.data_pagamento ? "ct-pend" : ""}"><td>${aberto && podeReg ? `<input type="checkbox" data-cob="${c.id}" checked title="Desmarque se não for repassar este aluguel agora">` : ""}</td><td class="trunc">${esc(im.endereco || "")}</td><td class="trunc">${esc(c.locatario)}</td>
      <td class="num">${n2(c.valor)}</td>
      <td class="num">${c.data_pagamento ? `${n2(c.valor_pago)} <small class="muted">${dt(c.data_pagamento).slice(0, 5)}</small>` : `<span class="tag warn" title="Aviso interno: não sai no relatório do proprietário">não recebido</span>`}</td>
      <td class="num">${n2(k.taxa)}</td><td class="num" title="${esc(descs.join("\n"))}">${k.descProp + k.despTot ? n2(k.descProp + k.despTot) : ""}</td>
      <td class="num">${aberto ? `<input data-val="${c.id}" inputmode="decimal" value="${n2(k.prop)}" ${podeReg ? "" : "disabled"}>${!c.data_pagamento ? `<div class="sub neg">repasse sem receber</div>` : ""}` : c.repasse_data ? n2(c.repasse_valor) + ` <small class="muted">${dt(c.repasse_data).slice(0, 5)}</small>${!c.data_pagamento ? ` <small class="neg">sem receber</small>` : ""}` : ""}</td>
      <td>${ed ? `<button type="button" class="btn sm" data-ajc="${c.id}" title="Acréscimos, descontos e despesas do proprietário deste aluguel">±</button>` : ""}</td></tr>`; };
  modal({ titulo: `Depósito · ${fav.nome}`, xl: true, semOk: !podeReg, ok: i.m ? "Registrar complemento" : "Registrar",
    extra: `<button type="button" class="btn" data-rel>📄 Relatório do proprietário</button>${ed ? `<button type="button" class="btn" data-fav>Cadastro do favorecido</button>` : ""}${i.m && ed ? `<span class="spacer"></span><button type="button" class="btn danger" data-est>Desfazer este registro</button>` : ""}`,
    corpo: `<div class="box"><b>${esc(fav.nome)}</b> · dia previsto <b>${fav.dia || "—"}</b> · ${esc(FORMAS[fav.forma] || "forma não definida")}${fav.conta_bancaria ? " · " + esc(fav.conta_bancaria) : ""}<br>
        <span class="hint">Locadores: ${esc((fav.locadores || []).join(" · ") || "nenhum ligado — abra o cadastro do favorecido")}</span></div>
      ${i.m ? `<div class="box ${SIT_DEP[i.m.situacao][1] === "ok" ? "" : "warn"}">${esc(mesTxt(S.mes))}: <b>${esc(SIT_DEP[i.m.situacao][0])}</b>${i.m.forma ? " · " + esc(FORMAS[i.m.forma] || i.m.forma) : ""}${i.m.data ? " em " + dt(i.m.data) : ""}${i.m.valor != null ? " · " + brl(i.m.valor) : ""}${i.m.conta_id ? " · saiu de " + esc(contaPor(i.m.conta_id).nome || "") : ""}${i.m.obs ? "<br>" + esc(i.m.obs) : ""}</div>` : ""}
      <h3>Aluguéis de ${esc(mesTxt(S.mes))}</h3>
      <div class="tw"><table class="compacta dep-t"><thead><tr><th></th><th>Imóvel</th><th>Locatário</th><th class="num">Aluguel</th><th class="num">Recebido</th><th class="num">T. Adm.</th><th class="num">Descontos</th><th class="num">Repasse</th><th></th></tr></thead><tbody>
        ${i.cs.map(linhaCob).join("") || `<tr><td colspan="9" class="muted">Nenhum aluguel deste mês ligado a este depósito${(fav.locadores || []).length ? "" : " (ligue os locadores no cadastro do favorecido)"}.</td></tr>`}</tbody></table></div>
      <p class="hint">Descontos = descontos do aluguel por conta do proprietário + despesas dele lançadas no Caixa com "Descontar do repasse". Aluguel não recebido também pode ser repassado (marque a linha): o aviso "sem receber" é só interno.</p>
      ${podeReg ? `${i.m && i.pend.length ? `<div class="box warn">Há aluguéis ainda não repassados depois do registro deste mês. Registre o complemento: o valor soma ao que já foi depositado.</div>` : ""}<div class="row">
        <label class="fl"><span>Situação</span><select name="sit">${Object.entries(SIT_DEP).map(([k, v]) => opt(k, v[0], k === (abertos.length ? (fav.forma === "dinheiro" ? "imob" : "depositado") : "nao_houve"))).join("")}</select></label>
        <label class="fl"><span>Forma</span><select name="forma">${Object.entries(FORMAS).map(([k, t]) => opt(k, t, k === (fav.forma || "pix"))).join("")}</select></label>
        <label class="fl"><span>Data</span><input type="date" name="data" value="${hoje()}"></label>
        <label class="fl"><span>Saiu da conta</span><select name="conta">${contasOpts(null, soCaixa)}</select></label>
        <label class="fl"><span>Valor</span><input name="valor" inputmode="decimal" value=""></label></div>
        <label class="fl"><span>Observação</span><input name="obs" placeholder="ex.: descontado reparo de R$ 150"></label>` : ""}`,
    aoAbrir: (f, d) => {
      const soma = () => { if (!f.valor) return; const t = $$("[data-cob]:checked", d).reduce((a, x) => a + (parseMoney($(`[data-val="${x.dataset.cob}"]`, d).value) || 0), 0); f.valor.value = n2(t); };
      $$("[data-cob],[data-val]", d).forEach(x => x.addEventListener("input", soma)); soma();
      $$("[data-val]", d).forEach(x => mascaraMoeda(x));
      // ± : lançar acréscimo/desconto do aluguel ou despesa do proprietário por aqui (atualiza Caixa e Pgto locatário)
      $$("[data-ajc]", d).forEach(b => b.addEventListener("click", () => {
        const tr = b.closest("tr"), prox = tr.nextElementSibling;
        if (prox && prox.classList.contains("aj-row")) { prox.remove(); return; }
        const c = i.cs.find(x => x.id === b.dataset.ajc), edAj = !c.data_pagamento;
        const nr = document.createElement("tr"); nr.className = "aj-row";
        nr.innerHTML = `<td colspan="9">${ajustesHTML(c, edAj)}${despPropHTML(c)}${edAj ? `<button type="button" class="btn sm pri" data-ajc-ok>Salvar acréscimos/descontos</button>` : ""}</td>`;
        tr.after(nr);
        const ler = ligarAjustes(nr, null, +c.valor);
        ligarDespProp(nr, c, () => { setTimeout(() => { d.close(); ACT["dep-ed"]({ dataset: { id: fav.id } }); }, 0); });
        const ok = $("[data-ajc-ok]", nr); if (ok) ok.addEventListener("click", async () => {
          try { const aj = ler(); if (aj.some(x => !x.desc || !(x.valor > 0))) throw new Error("Cada acréscimo/desconto precisa do item e do valor."); if (aj.some(x => x.desc === "Outros" && !x.obs)) throw new Error('Item "Outros": descreva nas observações.');
            await salvarAjustes(c, aj); toast("Salvo (também em Pgto locatário)."); d.close(); setTimeout(() => ACT["dep-ed"]({ dataset: { id: fav.id } }), 0); } catch (e) { falha(e); }
        });
      }));
      if (f.forma) f.forma.addEventListener("change", () => { if (f.forma.value === "dinheiro") f.sit.value = "imob"; else if (f.sit.value === "imob") f.sit.value = "depositado"; });
      $("[data-rel]", d).addEventListener("click", () => { d.close(); setTimeout(() => abrirRelatorio("Relatório · " + fav.nome, relatorioProprietario(fav)), 0); });
      const bf = $("[data-fav]", d); if (bf) bf.addEventListener("click", () => { d.close(); setTimeout(() => ACT["dep-fav"]({ dataset: { id: fav.id } }), 0); });
      const be = $("[data-est]", d); if (be) be.addEventListener("click", async () => { d.close(); if (!(await confirmar("Desfazer depósito", `Desfazer o registro de ${esc(mesTxt(S.mes))} de <b>${esc(fav.nome)}</b>? Os repasses que ele registrou também saem do caixa.`, "Desfazer"))) return; try { await rpc("estornar_deposito", { p_id: i.m.id }); toast("Desfeito."); render(); } catch (e) { falha(e); } });
    },
    salvar: async f => {
      const marc = $$("[data-cob]:checked", $("#dlg")).map(x => x.dataset.cob);
      const vals = marc.map(id => parseMoney($(`[data-val="${id}"]`, $("#dlg")).value) || 0);
      const sit = f.sit.value, novoV = parseMoney(f.valor.value) || 0, valor = r2(novoV + (i.m && i.m.valor ? +i.m.valor : 0)) || null;
      const repassa = ["depositado", "imob"].includes(sit);
      if (repassa && !(novoV > 0)) throw new Error("Informe o valor.");
      const semRec = marc.filter(id => { const c = i.cs.find(x => x.id === id); return c && !c.data_pagamento; }).length;
      if (repassa && semRec && !pedeConfirmacao(f, `<b>${semRec}</b> aluguel(éis) marcado(s) ainda <b>não foram recebidos</b>: o repasse será adiantado pela imobiliária. Confirma?`, "Sim, registrar")) return false;
      await rpc("registrar_deposito", { p_fav: fav.id, p_comp: S.mes, p_situacao: sit, p_data: f.data.value || null, p_conta: f.conta.value || null,
        p_cobrancas: repassa ? marc : [], p_valores: repassa ? vals : [], p_valor: valor, p_obs: f.obs.value.trim(), p_forma: f.forma.value });
      toast("Registrado (repasses também em Aluguéis do mês e no Caixa)."); render();
    } });
};
ACT["dep-zerar"] = () => modal({ titulo: "Zerar a lista de favorecidos", ok: "Apagar tudo",
  corpo: `<div class="box bad">Apaga <b>todos os ${DEP.favs.length} favorecidos</b> e o registro mensal dos depósitos (situação e data de cada mês). Os repasses e lançamentos do Caixa <b>não</b> são apagados.</div>
    <p>Depois, use <b>Importar planilha</b> com a lista ajustada.</p><label class="fl"><span>Para confirmar, digite ZERAR</span><input name="conf" autocomplete="off"></label>`,
  salvar: async f => {
    if (f.conf.value.trim().toUpperCase() !== "ZERAR") throw new Error("Digite ZERAR para confirmar.");
    await q(sb.from("depositos_fav").delete().not("id", "is", null));
    toast("Lista de favorecidos apagada."); render();
  } });
const demonstrativo = fav => abrirRelatorio("Relatório · " + fav.nome, relatorioProprietario(fav));
ACT["dep-rel-mes"] = () => {
  const ls = DEP.favs.filter(f => f.ativo).sort((a, b) => (a.dia || 99) - (b.dia || 99) || COLL.compare(a.nome, b.nome));
  const html = `<div class="rel-tit"><b>Depósitos aos proprietários</b><span>${esc(mesTxt(S.mes))}</span></div>
    <p style="font-size:11px"><span style="background:#e3f2e4;padding:1px 6px">feito</span> <span style="background:#fff3cf;padding:1px 6px">pendente</span> <span style="background:#fde8ea;padding:1px 6px">atrasado (dia previsto já passou)</span></p>
    <table class="rel-t"><thead><tr><th>Dia</th><th>Favorecido</th><th>Forma</th><th>Conta / PIX</th><th class="num">A repassar</th><th>Situação</th><th class="num">Valor</th></tr></thead><tbody>
    ${ls.map(f => { const i = infoDep(f), cls = i.m ? "r-ok" : i.atrasado ? "r-bad" : "r-pend";
      return `<tr class="${cls}"><td>${f.dia || ""}</td><td>${esc(f.nome)}</td><td>${esc(FORMAS[(i.m && i.m.forma) || f.forma] || "")}</td><td>${esc(f.conta_bancaria)}</td><td class="num">${i.aRepassar ? n2(i.aRepassar) : ""}</td><td>${i.m ? esc(SIT_DEP[i.m.situacao][0]) + (i.m.data ? " " + dt(i.m.data) : "") : i.atrasado ? "ATRASADO" : "pendente"}</td><td class="num">${i.m && i.m.valor != null ? n2(i.m.valor) : ""}</td></tr>`; }).join("")}
    </tbody></table><p class="rel-rod">Emitido em ${new Date().toLocaleDateString("pt-BR")}</p>`;
  abrirRelatorio("Depósitos de " + mesTxt(S.mes), html, { paisagem: true });
};
// ---- papel timbrado (igual ao dos termos) e impressão em várias páginas ----
const TIMBRE = Object.assign({
  razao: "FICA ADMINISTRAÇÃO DE IMÓVEIS LTDA — CRECI 4419-J", nome: "IMOBILIÁRIA BANDEIRANTES", cidade: "Monte Mor", recebedor: "Fica Adm. de Imóveis Ltda", cnpj: "51.909.307/0001-40", banco: "Banco do Brasil, agência 2324-8, conta corrente nº 100130-2",
  rodape: ["Av. Jânio Quadros, 444 – Centro – Monte Mor/SP – CEP 13190-101", "Fone: (19) 3879-1945 / (19) 3879-2949 – WhatsApp (19) 9.8783-5485",
    "email: imob-bandeirantes@interall.com.br / contato@imobiliariabandeirantes.com.br"]
}, CFG.TIMBRE || {});
function timbrado(conteudo) {
  return `<div class="relatorio"><img class="tb-wm" src="img/logo.png" alt=""><table class="tb-pg">
    <thead><tr><td><div class="tb-h"><img src="img/logo.png" alt=""><div><small>${esc(TIMBRE.razao)}</small><b>${esc(TIMBRE.nome)}</b></div></div></td></tr></thead>
    <tbody><tr><td>${conteudo}</td></tr></tbody>
    <tfoot><tr><td><div class="tb-f">${TIMBRE.rodape.map(esc).join("<br>")}</div></td></tr></tfoot></table></div>`;
}
function imprimir(html, paisagem) {
  const area = $("#print-area"); area.innerHTML = html;
  let pg = $("#print-page"); if (!pg) { pg = document.createElement("style"); pg.id = "print-page"; document.head.appendChild(pg); }
  pg.textContent = `@media print{@page{size:A4 ${paisagem ? "landscape" : "portrait"};margin:9mm}}`;
  document.body.classList.add("imprimindo");
  const fim = () => { document.body.classList.remove("imprimindo"); area.innerHTML = ""; window.removeEventListener("afterprint", fim); };
  window.addEventListener("afterprint", fim);
  setTimeout(() => window.print(), 50);
}
// conteudo: um bloco, ou uma lista de blocos (cada um vira páginas próprias, com o timbre)
function abrirRelatorio(titulo, conteudo, opts) {
  opts = opts || {};
  const blocos = Array.isArray(conteudo) ? conteudo : [conteudo];
  const html = blocos.map((b, i) => `<div class="${i ? "rel-quebra" : ""}">${timbrado(b)}</div>`).join("");
  modal({ titulo, xl: !!opts.paisagem, largo: !opts.paisagem, semOk: true, extra: `<button type="button" class="btn pri" data-imp>🖨 Imprimir / salvar PDF</button>`, corpo: `<div class="rel-prev">${html}</div>`,
    aoAbrir: (f, d) => $("[data-imp]", d).addEventListener("click", () => imprimir(html, opts.paisagem)) });
}
// ---- relatório do proprietário (como o modelo do Excel: aluguéis, descontos e total a receber) ----
function relatorioProprietario(fav) {
  const i = infoDep(fav);
  const itens = i.cs.filter(c => c.data_pagamento || c.repasse_data).sort((a, b) => (a.data_pagamento || a.repasse_data || "").localeCompare(b.data_pagamento || b.repasse_data || ""));
  const end = c => (S.imovelPor[c.imovel_id] || {}).endereco || "";
  let sub = 0, tx = 0; const descs = [], pcts = new Set();
  const linhas = itens.map((c, n) => {
    const k = calcCob(c), aj = ajustesDe(c);
    sub += +c.valor + k.acrProp; tx += k.taxa; pcts.add(+c.taxa_adm_pct);
    aj.filter(x => x.tipo === "desc" && x.de === "prop").forEach(x => descs.push([`${ajRot(x)} — ${end(c)}`, x.valor]));
    k.desp.forEach(l => descs.push([`${l.descricao || "Despesa"} — ${end(c)}${l.data ? " (" + dt(l.data) + ")" : ""}`, +l.valor]));
    return `<tr class="lct"><td class="n">${pad(n + 1)}</td><td>${esc(c.locatario)}</td><td class="d"></td><td class="v"></td></tr>
      <tr class="imv"><td></td><td>${esc(end(c))}</td><td class="d">${dt(c.data_pagamento || c.repasse_data)}</td><td class="v">${n2(c.valor)}</td></tr>
      ${aj.filter(x => x.tipo === "acr" && x.de === "prop").map(x => `<tr class="imv"><td></td><td>+ ${esc(ajRot(x))}</td><td class="d"></td><td class="v">${n2(x.valor)}</td></tr>`).join("")}`;
  }).join("");
  const totDesc = r2(tx + descs.reduce((a, x) => a + x[1], 0)), total = r2(sub - totDesc);
  const m = i.m, dinheiro = (m && (m.forma === "dinheiro" || m.situacao === "imob")) || (!m && fav.forma === "dinheiro");
  const pctTxt = pcts.size === 1 ? ` ${n2([...pcts][0]).replace(",00", "")}%` : "";
  return `<div class="rel-tit"><b>Relatório dos aluguéis · ${esc(fav.nome)}</b><span>Aluguéis recebidos em ${esc(mesTxt(S.mes))}</span></div>
    <table class="rp"><tbody>
      ${linhas || `<tr><td colspan="4">Nenhum aluguel recebido neste mês.</td></tr>`}
      <tr class="rp-sub"><td></td><td>SUBTOTAL</td><td></td><td class="v">${n2(sub)}</td></tr>
      <tr class="rp-sec"><td></td><td colspan="3">DESCONTOS</td></tr>
      <tr><td></td><td>Comissão (taxa de administração)${pctTxt}</td><td></td><td class="v">-${n2(tx)}</td></tr>
      ${descs.map(([t, v]) => `<tr><td></td><td>${esc(t)}</td><td></td><td class="v">-${n2(v)}</td></tr>`).join("")}
      <tr class="rp-sub"><td></td><td>TOTAL DOS DESCONTOS</td><td></td><td class="v">-${n2(totDesc)}</td></tr>
      <tr class="rp-tot"><td></td><td>TOTAL A RECEBER</td><td></td><td class="v">${n2(total)}</td></tr>
    </tbody></table>
    ${dinheiro ? `<div class="rel-ass"><p>Recebi os valores acima mencionados:</p><p>${esc(TIMBRE.cidade)}, ______ de ____________________ de ${S.mes.slice(0, 4)}.</p><div class="linha">${esc(fav.nome)}</div></div>`
      : `<p style="margin-top:14px">${m && m.data && m.valor ? `Valor depositado em <b>${dt(m.data)}</b>${m.forma ? " via " + esc(FORMAS[m.forma] || m.forma) : ""}: <b>${brl(m.valor)}</b>` : "Depósito ainda não realizado"}${fav.conta_bancaria ? ` · ${fav.forma === "pix" ? "chave PIX" : "conta"}: ${esc(fav.conta_bancaria)}` : ""}.</p>`}
    <p class="rel-rod">Emitido em ${new Date().toLocaleDateString("pt-BR")}</p>`;
}
ACT["dep-rel-todos"] = () => {
  const ativos = DEP.favs.filter(f => f.ativo && infoDep(f).cs.some(c => c.data_pagamento || c.repasse_data));
  modal({ titulo: "Relatórios dos proprietários", ok: "Gerar",
    corpo: `<p>Gera o relatório de cada proprietário de <b>${esc(mesTxt(S.mes))}</b> (com aluguel recebido ou repassado), um por página, com o papel timbrado.</p>
      <label class="fl"><span>Quais</span><select name="q">${opt("todos", `Todos com movimento (${ativos.length})`, true)}${opt("feitos", "Só os já depositados/pagos", false)}${opt("dinheiro", "Só os pagos em dinheiro (com assinatura)", false)}${opt("deposito", "Só os por depósito/PIX", false)}</select></label>`,
    salvar: async f => {
      const qv = f.q.value;
      const ls = ativos.filter(x => { const i = infoDep(x), din = (i.m && (i.m.forma === "dinheiro" || i.m.situacao === "imob")) || (!i.m && x.forma === "dinheiro");
        return qv === "todos" || (qv === "feitos" && i.m) || (qv === "dinheiro" && din) || (qv === "deposito" && !din); }).sort((a, b) => (a.dia || 99) - (b.dia || 99) || COLL.compare(a.nome, b.nome));
      if (!ls.length) throw new Error("Nenhum proprietário nesse filtro.");
      setTimeout(() => abrirRelatorio(`Relatórios dos proprietários · ${mesTxt(S.mes)} (${ls.length})`, ls.map(relatorioProprietario)), 0);
    } });
};
// ---- importação da planilha de depósitos (aba do semestre, ex.: "Jul26") ----
const nzN = s => norm(s).toUpperCase();
const STOP_N = new Set(["DE", "DA", "DO", "DOS", "DAS", "E", "FB", "SQ", "PFC", "IMOB", "CF", "OUTROS"]);
const toksN = s => (nzN(s).match(/[A-Z]+\.?/g) || []).filter(t => !STOP_N.has(t.replace(".", "")));
function notaNome(dn, ln) {
  const a = toksN(dn), b = toksN(ln).map(t => t.replace(".", ""));
  if (!a.length || !b.length) return 0;
  let hit = 0;
  a.forEach(t => {
    if (t.endsWith(".") || t.length === 1) { if (b.some(x => x.startsWith(t.replace(".", "")))) hit += 0.5; }
    else if (b.includes(t)) hit += 1;
    else if (t.length >= 4 && b.some(x => x.length >= 4 && (x.startsWith(t) || t.startsWith(x)))) hit += 0.7;
  });
  return (hit + (a[0].replace(".", "") === b[0] ? 1 : 0)) / (a.length + 1);
}
const MES_ABA = { JAN: 1, JUL: 7 };
function lerAbaDepositos(ws, nomeAba) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
  const m = String(nomeAba).match(/^([A-Za-z]{3})(\d{2})$/), ini = m ? (MES_ABA[m[1].toUpperCase()] || 1) : 1, ano = m ? 2000 + +m[2] : +hoje().slice(0, 4);
  const cab = rows[0] || [], colsMes = [];
  for (let k = 2; k < 8; k++) { const t = String(cab[k] || "").trim().toUpperCase().slice(0, 3); const n = MES3.map(x => x.toUpperCase()).indexOf(t); if (n >= 0) colsMes.push([k, `${ano}-${pad(n + 1)}-01`]); }
  void ini;
  const out = [];
  rows.slice(1).forEach(r => {
    const nome = String(r[1] || "").trim(); if (!nome || /^LOCADOR$/i.test(nome)) return;
    const dia = parseInt(r[0], 10);
    const hist = colsMes.map(([k, comp]) => {
      const v = r[k]; if (v === "" || v == null) return null;
      if (v instanceof Date) return { comp, situacao: "depositado", data: iso(v) };
      const s = String(v).trim().toLowerCase();
      if (/^\d{1,2}$/.test(s)) { const ult = +fimMes(comp).slice(8); return { comp, situacao: "depositado", data: comp.slice(0, 8) + pad(Math.min(+s, ult)) }; }
      if (s.startsWith("imob")) return { comp, situacao: "imob" };
      if (s.startsWith("desc")) return { comp, situacao: "sem_valor" };
      if (s.startsWith("car")) return { comp, situacao: "carencia" };
      if (s === "x" || s === "-") return { comp, situacao: "nao_houve" };
      return null;
    }).filter(Boolean);
    out.push({ nome, dia: dia >= 1 && dia <= 31 ? dia : null, conta: String(r[8] || "").trim(), hist });
  });
  return out;
}
ACT["dep-importar"] = () => {
  let lidos = null;
  const locs = locadoresDoMapa();
  modal({ titulo: "Importar lista de depósitos", xl: true, ok: "Importar",
    corpo: `<p>Escolha a planilha de depósitos (ex.: <b>DEPOSITO - BKP LICO.xlsx</b>). O sistema lê a <b>última aba</b> (o semestre atual): dia previsto, nome, conta e o que já foi feito em cada mês, e tenta ligar cada nome a um <b>locador do mapa</b>.</p>
      <input type="file" data-arq accept=".xlsx,.xlsm"><div data-res></div><datalist id="dl-locs">${locs.map(l => `<option value="${esc(l)}">`).join("")}</datalist>`,
    aoAbrir: (f, d) => {
      $("[data-arq]", d).addEventListener("change", async e => {
        const arq = e.target.files[0], res = $("[data-res]", d); if (!arq) return;
        res.innerHTML = `<p class="hint">Lendo…</p>`;
        try {
          await carregarXLSX();
          const wb = XLSX.read(await arq.arrayBuffer(), { type: "array", cellDates: true });
          const aba = wb.SheetNames[wb.SheetNames.length - 1];
          lidos = lerAbaDepositos(wb.Sheets[aba], aba);
          lidos.forEach(x => {
            const cands = locs.map(l => [notaNome(x.nome, l), l]).sort((a, b) => b[0] - a[0]);
            x.nota = cands.length ? cands[0][0] : 0; x.sugestao = x.nota >= 0.35 ? cands[0][1] : "";
          });
          const ok = lidos.filter(x => x.nota >= 0.6).length, duv = lidos.filter(x => x.nota >= 0.35 && x.nota < 0.6).length;
          res.innerHTML = `<div class="box">Aba <b>${esc(aba)}</b>: ${lidos.length} depósitos · <span class="pos">${ok} ligados com segurança</span> · <span style="color:var(--warn)">${duv} para conferir</span> · <span class="neg">${lidos.length - ok - duv} sem par</span>. Confira a coluna "Locador do mapa" (pode digitar para trocar, ou deixar vazio).</div>
            <div class="tw" style="max-height:52vh"><table class="compacta"><thead><tr><th>Dia</th><th>Nome na planilha</th><th>Locador do mapa</th><th>Confiança</th><th>Meses</th></tr></thead><tbody>
            ${lidos.map((x, k) => `<tr><td>${x.dia || ""}</td><td>${esc(x.nome)}</td><td><input data-loc="${k}" list="dl-locs" value="${esc(x.sugestao)}" style="width:100%;min-width:260px;border:1px solid var(--line);border-radius:6px;padding:4px 6px"></td>
              <td><span class="tag ${x.nota >= 0.6 ? "ok" : x.nota >= 0.35 ? "warn" : "bad"}">${x.nota >= 0.6 ? "alta" : x.nota >= 0.35 ? "conferir" : "sem par"}</span></td><td>${x.hist.length}</td></tr>`).join("")}</tbody></table></div>`;
        } catch (err) { lidos = null; res.innerHTML = `<p class="neg">Não foi possível ler: ${esc(erroMsg(err))}</p>`; }
      });
    },
    salvar: async f => {
      if (!lidos) throw new Error("Escolha o arquivo.");
      const dlg = $("#dlg"); let n = 0;
      const exist = new Map(DEP.favs.map(x => [norm(x.nome) + "|" + (x.dia || ""), x]));
      for (let k = 0; k < lidos.length; k++) {
        const x = lidos[k], loc = ($(`[data-loc="${k}"]`, dlg).value || "").trim();
        const forma = /pix/i.test(x.conta) ? "pix" : /dinheiro|imob/i.test(x.conta) || !x.conta ? "dinheiro" : "deposito";
        const dd = { nome: x.nome, dia: x.dia, conta_bancaria: forma === "dinheiro" ? "" : x.conta, forma, locadores: loc ? [loc] : [], ativo: true };
        let fav = exist.get(norm(x.nome) + "|" + (x.dia || "")) || null;
        if (fav) { await q(sb.from("depositos_fav").update({ dia: dd.dia, conta_bancaria: dd.conta_bancaria, forma: fav.forma || dd.forma, locadores: Array.from(new Set((fav.locadores || []).concat(dd.locadores))) }).eq("id", fav.id)); }
        else { fav = await q(sb.from("depositos_fav").insert(dd).select().single()); exist.set(norm(x.nome) + "|" + (x.dia || ""), fav); }
        if (x.hist.length) await q(sb.from("depositos_mes").upsert(x.hist.map(h => ({ favorecido_id: fav.id, competencia: h.comp, situacao: h.situacao, data: h.data || null, obs: "importado da planilha" })), { onConflict: "favorecido_id,competencia", ignoreDuplicates: true }));
        n++;
      }
      toast(`${n} depósitos importados.`); render();
    } });
};

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

  pg.innerHTML = `<div class="grid">
    ${cardsMes(esp, real, "Resumo de " + mesTxt(S.mes))}
    <div class="minis">
      <div><span>Imóveis cadastrados no site</span><b>${noSite}</b></div>
      <div title="Contratos ATIVOS na aba Contratos ÷ imóveis alugados"><span>Contratos rastreáveis</span><b>${pct(ativos, alg.length)}</b><small>${ativos} de ${alg.length}</small></div>
      <div><span>Ocupação (alugados ÷ ativos)</span><b>${pct(st.ALG, st.ALG + st.LVR)}</b></div>
      <div><span>Aluguel médio</span><b>${brl(alg.length ? totBruto / alg.length : 0)}</b></div>
      <div title="Cada grupo (FB, Imobiliária, Cilas e cada principal locador) conta como 1"><span>Locadores com imóvel alugado</span><b>${locContados}</b><small>grupos contam como 1 · ${locUnicos} nomes</small></div>
    </div>
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
  st: ["OK", "NÃO", "N/A", "???", "CANCELADO"], dc: ["Não", "Desconto", "Carência"], quem: ["ANDRÉ", "ELIANA", "LINYSTON", "VANILDA"]
};
const SIT_CTT = { "ATIVO": "ok", "EM ELABORAÇÃO": "warn", "DÉBITO EM ABERTO": "bad", "ENCERRADO": "info", "CANCELADO": "idle" };
const SIT_CTT_CHIP = { "ATIVO": "st-LVR", "EM ELABORAÇÃO": "st-OCP", "DÉBITO EM ABERTO": "st-INTV", "ENCERRADO": "st-ALG", "CANCELADO": "st-CANC" };
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
  add("obs", "Observações / alterações manuais", "st", "area"); add("redacao", "Redação", "st", "quem"); add("correcao", "Correção", "st", "quem");
  add("st_ass_lcd", "Assinatura locador", "st", "st"); add("st_ass_lct", "Assinatura locatário/fiador", "st", "st"); add("st_scan", "Scan do contrato assinado", "st", "st");
  add("st_cpfl", "Transferência CPFL", "st", "st"); add("st_condominio", "Condomínio", "st", "st"); add("st_brimob", "Cadastro BRIMOB", "st", "st");
  add("situacao", "Situação do contrato", "st", "sit"); add("saldo_entrega", "Saldo devedor (na entrega)", "st");
})();
const CPK = Object.fromEntries(CP.map(c => [c.k, c]));
const SECS = [["imv", "Imóvel"], ["ctt", "Contrato"], ["gar", "Garantia"], ["lcd", "Locadores"], ["lct", "Locatários"], ["fdr", "Fiadores"], ["out", "Testemunhas e cláusulas"], ["st", "Status e observações"]];
const ST_K = ["st_ass_lcd", "st_ass_lct", "st_scan", "st_cpfl", "st_condominio", "st_brimob"];
// resumos (iguais aos botões de filtro de colunas do Excel)
// v13: nesta ordem; o "saldo devedor na entrega" (EJ) fica só como histórico da planilha, fora dos resumos
const RESUMOS = {
  r3: ["Resumo", "A B AE BI BS DZ EA EB EC ED EE EF EG EH EI"],
  r2: ["Resumo + FDR", "A B AE AO BI BS CM CW DZ EA EB EC ED EE EF EG EH EI"],
  r1: ["Resumo + FDR + dados do contrato", "A B J O Q W Y Z AA AB AC AE AO BI BS CM CW DZ EA EB EC ED EE EF EG EH EI"],
  r4: ["CPFL", "A B E H AE BI BS EC ED EE EF EG"],
  r5: ["BRIMOB", "A B M N O AE AO BI BS DZ EH EI"],
  r6: ["DIMOB", "A B E M O AE AK AO AU BI BO BS BY DZ EH EI"],
  completa: ["Completo", null]
};
const resumoKs = id => (RESUMOS[id] || RESUMOS.r3)[1] ? (RESUMOS[id] || RESUMOS.r3)[1].split(" ").map(l => CP.find(c => c.col === l).k).concat(["r1", "r2", "r3"].includes(id) ? ["data_encerramento"] : []) : CP.map(c => c.k).concat(["data_encerramento"]);
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
  let v = String(fv(c, k) || "").trim(); const u = v.toUpperCase();
  if (c.situacao === "CANCELADO" && u === "CANCELADO") v = ""; // nos cancelados, "CANCELADO" fica só na situação
  const cls = !v || v === "---" ? (pendAtiva(c, k) ? "warn" : "idle") : u === "OK" || u === "SIM" ? "ok" : u === "N/A" ? "idle" : u === "NÃO" || u === "NAO" ? "bad" : "warn";
  // na tabela: só SIM/OK, NÃO ou N/A; qualquer outro texto vira "…" (clique para ler)
  const txt = !v || v === "---" ? "—" : ["OK", "SIM", "NÃO", "NAO", "N/A"].includes(u) ? u : "…";
  const ed = pode.editar() ? ` data-act="ctt-st" data-id="${esc(c.codigo)}" data-k="${k}" role="button" tabindex="0"` : "";
  return `<span class="tag ${cls} st-ed"${ed} title="${esc(v || "vazio")}${pode.editar() ? " · clique para alterar" : ""}">${esc(txt)}</span>`;
}
// redação/correção: usuários (verde), LCT/PREF (azul), vazio ou outro valor (vermelho)
const QUEM_ESP = ["LCT", "PREF"], QUEM_ANT = { LICO: "LINYSTON", NIDA: "VANILDA" };
const quemOps = () => Array.from(new Set(OPC.quem.concat((S.quemUsu || []).map(n => norm(String(n).split(" ")[0]).toUpperCase()).filter(Boolean)))).sort();
const quemNorm = v => { const u = String(v || "").trim().toUpperCase(); return QUEM_ANT[u] || u; };
function quemPill(c, k) {
  const v = quemNorm(fv(c, k)), cls = !v ? "bad" : QUEM_ESP.includes(v) ? "info" : quemOps().includes(v) ? "ok" : "bad";
  const ed = pode.editar() ? ` data-act="ctt-quem" data-id="${esc(c.codigo)}" data-k="${k}" role="button" tabindex="0"` : "";
  return `<span class="tag ${cls} st-ed"${ed} title="${esc(v || "vazio")}${pode.editar() ? " · clique para escolher" : ""}">${esc(v || "—")}</span>`;
}
ACT["ctt-quem"] = el => {
  const c = CTT.find(x => x.codigo === el.dataset.id), k = el.dataset.k; if (!c || !pode.editar()) return;
  const atual = quemNorm(fv(c, k));
  const p = pop(el, `<div class="gp-h">${esc(CPK[k].t)} · ${esc(c.codigo)}</div><div class="st-ops">${quemOps().concat(QUEM_ESP).map(o => `<button type="button" class="btn sm${atual === o ? " pri" : ""}" data-o="${esc(o)}">${esc(o)}</button>`).join("")}</div>
    <div class="gp-f"><button type="button" class="btn sm" data-o="">Deixar vazio</button></div>`, 300);
  $$("[data-o]", p).forEach(b => b.addEventListener("click", async () => {
    fecharPop();
    try { const ficha = Object.assign({}, fichaDe(c), { [k]: b.dataset.o }); const r = await q(sb.from("contratos").update({ ficha }).eq("codigo", c.codigo).select().single()); Object.assign(c, r); delete c._f; toast(`${CPK[k].t}: ${b.dataset.o || "vazio"}`); gRedesenhar("contratos6"); } catch (e) { falha(e); }
  }));
};
function sitPill(c) {
  const ed = pode.editar() ? ` data-act="ctt-st" data-id="${esc(c.codigo)}" data-k="situacao" role="button" tabindex="0" title="Clique para alterar"` : "";
  return `<span class="tag ${SIT_CTT[c.situacao] || "idle"} st-ed"${ed}>${esc(c.situacao)}</span>`;
}
// títulos curtos nas colunas (o nome completo aparece ao passar o mouse)
const CURTO_CTT = { st_ass_lcd: "Ass. LCD", st_ass_lct: "Ass. LCT/FDR", st_scan: "Scan", st_cpfl: "CPFL", st_condominio: "Condom.", st_brimob: "BRIMOB",
  situacao: "Situação", saldo_entrega: "Saldo entrega", obs: "Obs.", data_contrato: "Data ctt", prazo: "Prazo", valor: "Aluguel", valor_ext: "Aluguel ext.",
  dia_venc: "Dia", enc_agua_energia: "Água/luz", enc_gas: "Gás", enc_condominio: "Condom.", enc_iptu: "IPTU", caucao_valor: "Caução", caucao_ext: "Caução ext.",
  caucao_conta: "Conta caução", insc_cad: "Insc. cad.", desc_carencia: "Desc./car.", desc_meses: "Meses", desc_valor: "Desconto", inundacao: "Inundação" };
function tituloCurto(c) {
  if (CURTO_CTT[c.k]) return CURTO_CTT[c.k];
  let t = c.t.replace(/^Locador(es)? ?/, "LCD").replace(/^Locatário(s)? ?/, "LCT").replace(/^Fiador(es)? ?/, "FDR").replace(/^Testemunha /, "Test.").replace(/^Imóvel em garantia/, "Imv gar.");
  t = t.replace(" · nome", "").replace(" · ", " ").replace("órgão emissor/UF", "OE").replace("estado civil", "est. civil").replace("nacionalidade", "nac.").replace("profissão", "prof.").replace("endereço ", "end.").replace("quantidade", "qtd").replace("casados entre si", "casados").replace("regime de bens", "regime").replace("data do casamento", "dt casam.").replace("município/UF", "munic.").replace("CPF/CNPJ", "CPF");
  if (/^(LCD|LCT|FDR)\d$/.test(t)) t = { LCD: "Locador ", LCT: "Locatário ", FDR: "Fiador " }[t.slice(0, 3)] + t.slice(3);
  return t;
}
const COLS_CTT = CP.map(c => {
  const col = { k: c.k, t: tituloCurto(c), dica: c.t + " · clique para ordenar, arraste para mover", v: r => fv(r, c.k), cls: "trunc", tip: true };
  col.grp = c.k === "obs" ? "obs" : c.k === "redacao" || c.k === "correcao" ? "red" : c.sec === "st" ? "st" : c.sec;
  if (c.tipo === "st") col.w = 66;
  if (c.k === "codigo") Object.assign(col, { t: "Contrato", cls: "mono", fixo: true, w: 112, tip: false, html: r => `${esc(r.codigo)}<a class="pasta" href="${esc(pastaUrl(r))}"${CFG.PASTA_LOCAL ? "" : ' target="_blank" rel="noopener"'} data-pasta title="${CFG.PASTA_LOCAL ? "Abrir a pasta do contrato no computador (G:)" : r.pasta_url ? "Abrir a pasta do contrato (Google Drive)" : "Procurar a pasta deste contrato no Google Drive"}">📁</a>` });
  if (c.k === "obs") Object.assign(col, { w: 150, cls: "trunc obs-col" });
  if (c.k === "redacao" || c.k === "correcao") Object.assign(col, { w: 92, tip: false, html: r => quemPill(r, c.k) });
  if (c.k === "situacao") col.w = 120;
  if (c.k === "end_rua") col.t = "Imóvel";
  if (c.tipo === "st") Object.assign(col, { html: r => stPill(r, c.k) });
  if (c.k === "situacao") Object.assign(col, { t: "Situação", html: sitPill, tip: false });
  if (c.tipo === "st") col.tip = false;
  if (c.tipo === "dext") Object.assign(col, { tipo: "data", v: r => dataDeTexto(fv(r, c.k)) || null, f: r => dt(dataDeTexto(fv(r, c.k))) || fv(r, c.k) });
  if (c.tipo === "moeda") Object.assign(col, { tipo: "num", v: r => parseMoney(fv(r, c.k)), f: r => { const n = parseMoney(fv(r, c.k)); return n == null ? fv(r, c.k) : n2(n); } });
  if (c.tipo === "tel") col.f = r => fmtTel(fv(r, c.k));
  if (c.k === "prazo" || c.k === "dia_venc") col.f = r => String(fv(r, c.k)).split(" (")[0];
  return col;
});
// o resumo "Resumo" do Excel é o padrão
(() => { const vis = new Set(resumoKs("r3")); COLS_CTT.forEach(c => { if (!vis.has(c.k)) c.oculta = true; }); })();
// data de encerramento (preenchida sozinha pela saída do locatário)
COLS_CTT.splice(Math.max(1, COLS_CTT.findIndex(c => c.k === "situacao") + 1), 0, { k: "data_encerramento", t: "Encerrado em", tipo: "data", w: 92, grp: "st", dica: "Data de encerramento — preenchida ao registrar a saída do locatário", v: r => r.data_encerramento || null, f: r => dt(r.data_encerramento) });

PAGES.contratos = async pg => {
  if (!S.f.cttResumo) S.f.cttResumo = "r3";
  let ms;
  [CTT, , ms] = await Promise.all([fetchAll("contratos", b => b.order("codigo", { ascending: false })), carregarCauc().catch(() => null), S.quemUsu ? null : rpc("lista_membros").catch(() => [])]);
  if (ms) S.quemUsu = ms.map(m => m.nome).filter(Boolean);
  setRd(pg, () => desenharContratos());
  desenharContratos(pg);
};
let CTT = [];
// pendências (pintam a linha só nos contratos ATIVOS)
const PEND_CTT = [["st_ass_lcd", "Falta ass. LCD"], ["st_ass_lct", "Falta ass. LCT/FDR"], ["st_scan", "Falta scan"], ["st_cpfl", "Falta CPFL"], ["st_condominio", "Falta condomínio"], ["st_brimob", "Falta BRIMOB"], ["redcor", "Falta redação/correção"]];
const vazioSt = v => { const t = String(v || "").trim(); return !t || /^-+$/.test(t); };
function pendAtiva(c, k) {
  if (k === "redcor") return vazioSt(fv(c, "redacao")) || vazioSt(fv(c, "correcao"));
  const v = fv(c, k);
  if (k === "st_brimob" && vazioSt(v)) return true; // BRIMOB em branco também conta como falta
  return ehPend(v);
}
const pendsDe = c => c.situacao === "ATIVO" ? PEND_CTT.filter(([k]) => k !== "redcor" && pendAtiva(c, k)) : [];
const curtoTxt = (t, n) => { t = String(t || ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
// pasta do contrato: link do Google Drive gravado no contrato, ou busca pelo número no Drive
const pastaUrl = c => CFG.PASTA_LOCAL ? "imobone:" + c.codigo : c.pasta_url || (CFG.DRIVE_BUSCA || "https://drive.google.com/drive/search?q=") + encodeURIComponent(c.codigo);
const garDe = c => { const g = norm(fv(c, "garantia") || c.garantia || "").toUpperCase(); return /FIAD/.test(g) ? "fiador" : /CAU/.test(g) ? "caucao" : /SEGURO/.test(g) ? "seguro" : /TITULO|CAPITALIZ/.test(g) ? "titulo" : "sem"; };
function corCtt(c) {
  return { "ATIVO": pendsDe(c).length ? "ct-pend" : "ct-ativo", "EM ELABORAÇÃO": "ct-elab", "ENCERRADO": "ct-enc", "DÉBITO EM ABERTO": "ct-deb", "CANCELADO": "ct-canc" }[c.situacao] || "";
}
const NAO_ATIVOS = ["ENCERRADO", "DÉBITO EM ABERTO", "CANCELADO"];
const CTT_SEL = new Set();
const COL_SEL_CTT = { k: "sel", t: "Seleção", nf: true, fixo: true, w: 30, th: `<input type="checkbox" data-csel="todos" aria-label="Selecionar todos">`, html: c => `<input type="checkbox" data-csel="${esc(c.codigo)}" ${CTT_SEL.has(c.codigo) ? "checked" : ""} aria-label="Selecionar">` };
function desenharContratos(pg) {
  pg = pg || $("#page");
  let f = S.f.ctt || "todos"; if (!["todos", "ATIVO", "EM ELABORAÇÃO", "naoativos"].includes(f)) f = S.f.ctt = "todos";
  const sub = S.f.cttSub || "", pend = S.f.cttPend || "", gar = S.f.cttGar || "", busca = S.f.cttBusca || "";
  const lim60 = iso(new Date(Date.now() + 60 * 86400000));
  const grupo = { todos: () => true, ATIVO: c => c.situacao === "ATIVO", "EM ELABORAÇÃO": c => c.situacao === "EM ELABORAÇÃO", naoativos: c => NAO_ATIVOS.includes(c.situacao) };
  const subT = { pend: c => pendsDe(c).length > 0, sempend: c => !pendsDe(c).length, vencendo: c => c.termino && c.termino >= hoje() && c.termino <= lim60, redcor: c => pendAtiva(c, "redcor"),
    ENCERRADO: c => c.situacao === "ENCERRADO", "DÉBITO EM ABERTO": c => c.situacao === "DÉBITO EM ABERTO", CANCELADO: c => c.situacao === "CANCELADO", rascunho: c => ehRascunho(c.codigo) };
  const base = CTT.filter(c => !gar || garDe(c) === gar);
  const nG = k => base.filter(grupo[k]).length;
  let lista = base.filter(grupo[f]);
  const subs = f === "ATIVO" ? [["", "Todos os ativos", ""], ["sempend", "Sem pendência", "st-LVR"], ["pend", "Com pendências", "st-OCP"], ["redcor", "Falta redação/correção", ""], ["vencendo", "Terminam em 60 dias", ""]]
    : f === "naoativos" ? [["", "Todos não ativos", ""], ["ENCERRADO", "Encerrados sem débitos", "st-ALG"], ["DÉBITO EM ABERTO", "Encerrados com débito", "st-INTV"], ["CANCELADO", "Cancelados", "st-CANC"]]
    : f === "EM ELABORAÇÃO" ? [["", "Todos em elaboração", ""], ["rascunho", "Rascunhos do gerador", ""]] : [];
  const subOk = subs.some(x => x[0] === sub) ? sub : "";
  const listaG = lista, nS = k => k ? listaG.filter(subT[k]).length : listaG.length;
  if (subOk) lista = lista.filter(subT[subOk]);
  // pendências por tipo: nos ativos (dentro de "Com pendências") e em elaboração
  const verPend = (f === "ATIVO" && subOk === "pend") || f === "EM ELABORAÇÃO";
  const listaP = lista, nP = k => listaP.filter(c => pendAtiva(c, k)).length;
  if (verPend && pend) lista = lista.filter(c => pendAtiva(c, pend));
  if (busca) { const b = norm(busca); lista = lista.filter(c => norm([c.codigo, c.endereco, c.locador, c.locatario, c.fiador, fv(c, "lct1_cpf"), fv(c, "lct2_cpf")].join(" ")).includes(b)); }
  const cols = pode.editar() ? [COL_SEL_CTT].concat(COLS_CTT) : COLS_CTT;
  const g = grade("contratos6", cols, lista, { attr: c => `data-act="ctt-ed" data-id="${esc(c.codigo)}" style="cursor:pointer"`, sort: { k: "codigo", dir: "desc" }, rodape: fl => `${fl.length} contratos`,
    divisor: { k: "codigo", g: c => c.codigo.slice(2, 4) }, cls: corCtt, tcls: "ctt" });
  if (pode.editar() && !g.ordem.includes("sel")) g.ordem.unshift("sel");
  g.redesenhar = () => desenharContratos();
  const chip = (k, t, cls, n, on, key) => `<button class="chip ${cls || ""}${on ? " on" : ""}" data-act="chip" data-k="${key}" data-v="${esc(k)}">${t}<span class="c">${n}</span></button>`;
  const semFicha = CTT.filter(c => !c.ficha || !Object.keys(c.ficha).length).length;
  const sabado = new Date().getDay() === 6, nPendAtivos = CTT.filter(c => pendsDe(c).length).length;
  const selN = [...CTT_SEL].filter(k => CTT.some(c => c.codigo === k)).length;
  pg.innerHTML = `<div class="grid">
    <div class="filters">
      <div class="fgrupo"><span>Situação</span>${chip("todos", "Todos", "", nG("todos"), f === "todos", "ctt")}${chip("ATIVO", "Ativos", "st-LVR", nG("ATIVO"), f === "ATIVO", "ctt")}${chip("EM ELABORAÇÃO", "Em elaboração", "st-OCP", nG("EM ELABORAÇÃO"), f === "EM ELABORAÇÃO", "ctt")}${chip("naoativos", "Não ativos", "st-ALG", nG("naoativos"), f === "naoativos", "ctt")}</div>
      <div class="fgrupo"><span>Garantia</span>${[["", "Todas"], ["fiador", "Fiador"], ["caucao", "Caução"], ["sem", "Sem garantia"]].map(([k, t]) => chip(k, t, "", (k ? CTT.filter(c => garDe(c) === k) : CTT).filter(grupo[f]).length, gar === k, "cttGar")).join("")}</div>
      <input type="search" placeholder="Buscar código, nomes, CPF…" value="${esc(busca)}" data-busca="cttBusca" style="width:180px">
      <span class="spacer"></span>${avisosContratos(semFicha, sabado, nPendAtivos)}${gradeBarra("contratos6")}
      <button class="btn" data-act="ctt-termo">🔑 Termos</button>
    </div>
    <div class="filters">
      ${subs.length ? `<div class="chips sub">${subs.map(([k, t, cls]) => chip(k, t, cls, nS(k), subOk === k, "cttSub")).join("")}</div>` : `<div class="leg-ct"><span><i style="background:var(--ok-soft)"></i>Ativo</span><span><i style="background:var(--warn-soft)"></i>Ativo com pendência</span><span><i style="background:color-mix(in srgb,var(--c2) 12%,var(--surface))"></i>Em elaboração</span><span><i style="background:var(--info-soft)"></i>Encerrado</span><span><i style="background:var(--bad-soft)"></i>Encerrado com débito</span><span><i style="background:var(--idle-soft)"></i>Cancelado</span></div>`}
      <span class="spacer"></span>
      <button class="btn" data-act="ctt-rel-pend" title="Relatório de pendências para imprimir ou salvar em PDF (sábados)">📋 Pendências</button>
      ${pode.editar() ? `<button class="btn" data-act="ctt-novo" title="Só a ficha, sem gerar o Word">+ Ficha</button><button class="btn pri" data-act="ctt-gerar">📄 Novo contrato</button>` : ""}
    </div>
    ${verPend ? `<div class="filters"><div class="chips sub">${chip("", "Todas as pendências", "", listaP.length, !pend, "cttPend")}${PEND_CTT.map(([k, t]) => chip(k, t, "", nP(k), pend === k, "cttPend")).join("")}</div></div>` : ""}
    ${selN ? `<div class="filters lote-bar"><b>${selN} selecionado(s)</b> · alterar <select data-lote-k>${opt("situacao", "Situação", true)}${PEND_CTT.filter(([k]) => k !== "redcor").map(([k]) => opt(k, CPK[k].t, false)).join("")}${opt("redacao", "Redação", false)}${opt("correcao", "Correção", false)}</select>
      para <input data-lote-v list="dl-lote" placeholder="valor (vazio = limpar)" style="width:200px"><datalist id="dl-lote">${Object.keys(SIT_CTT).concat(OPC.st, OPC.quem).map(o => `<option value="${esc(o)}">`).join("")}</datalist>
      <button class="btn pri" data-act="ctt-lote">Aplicar aos selecionados</button><button class="btn" data-act="ctt-lote-limpar">Limpar seleção</button></div>` : ""}
    ${CTT.some(c => c.situacao === "CANCELADO" && ST_K.some(k => String(fv(c, k)).trim().toUpperCase() === "CANCELADO")) && pode.editar() ? `<p class="hint">Há contratos cancelados com "CANCELADO" escrito nos status. <button class="btn sm" data-act="ctt-limpa-canc">Apagar esse texto dos status (fica só na Situação)</button></p>` : ""}
    <div class="resumos"><span class="hint">Colunas:</span>${Object.entries(RESUMOS).map(([id, [t]]) => `<button class="chip${S.f.cttResumo === id ? " on" : ""}" data-act="ctt-resumo" data-r="${id}">${esc(t)}</button>`).join("")}</div>
    ${gradeHTML("contratos6")}</div>`;
  ligarBusca(pg);
  $$("[data-csel]", pg).forEach(x => x.addEventListener("change", () => {
    if (x.dataset.csel === "todos") { g.filtradas.forEach(c => x.checked ? CTT_SEL.add(c.codigo) : CTT_SEL.delete(c.codigo)); }
    else if (x.checked) CTT_SEL.add(x.dataset.csel); else CTT_SEL.delete(x.dataset.csel);
    desenharContratos(); requestAnimationFrame(ajustarAlturas);
  }));
}
function avisosContratos(semFicha, sabado, nPend) {
  let h = "";
  const tp = CTT.filter(c => termoEst(c, "entrega") === "pendente").map(c => Object.assign({ tipo: "entrega" }, c)).concat(CTT.filter(c => termoEst(c, "caucao") === "pendente").map(c => Object.assign({ tipo: "caucao" }, c)));
  if (tp.length) h += avisoBtn("ctt-termos", `⚠ ${tp.length} termo(s)`, "danger", "Termos obrigatórios pendentes", `<p class="hint">🔑 entrega de chaves · 💰 devolução de caução. O termo fica feito quando o PDF é baixado.</p>${listaBtns(tp.map(termoBtn))}`);
  const sc = CAUC.contas.length ? caucSemConta() : [];
  if (sc.length) h += avisoBtn("ctt-cauc", `⚠ ${sc.length} caução sem conta`, "warn", "Contratos com caução sem conta caução vinculada", `<p class="hint">Obrigatório: escolha uma conta livre, somada a outra conta, ou "paga direto ao proprietário".</p>${listaBtns(sc.map(c => `<button class="btn sm" data-act="cauc-vinc-ctt" data-id="${esc(c.codigo)}">${esc(c.codigo)} · ${esc(curtoTxt(c.locatario, 40))}</button>`))}`);
  if (sabado && nPend) h += `<button class="btn sm aviso warn" data-act="ctt-rel-pend" title="Hoje é sábado: dia do relatório de pendências">📋 Sábado: pendências (${nPend})</button>`;
  if (semFicha && pode.editar()) h += avisoBtn("ctt-ficha", `${semFicha} sem ficha`, "", "Contratos sem a ficha completa", `<p>${semFicha} contratos ainda sem a ficha completa (RG, CPF, UC, matrícula…). Use <b>Importar planilha</b> com o arquivo "Gerador de Contratos" para trazer todos os dados do Excel.</p>`);
  return h;
}
// alterar vários contratos de uma vez
async function alterarFichas(cods, k, v) {
  let ok = 0;
  for (const cod of cods) {
    const c = CTT.find(x => x.codigo === cod); if (!c) continue;
    const ficha = Object.assign({}, fichaDe(c), { [k]: v });
    if (k === "situacao" && !v) continue;
    const r = await q(sb.from("contratos").update({ ficha }).eq("codigo", c.codigo).select().single());
    Object.assign(c, r); delete c._f; ok++;
  }
  return ok;
}
ACT["ctt-lote"] = async () => {
  const k = $("[data-lote-k]").value, v = $("[data-lote-v]").value.trim(), cods = [...CTT_SEL];
  if (k === "situacao" && !Object.keys(SIT_CTT).includes(v.toUpperCase())) return toast("Escolha uma situação válida (ATIVO, ENCERRADO…).", true);
  if (!(await confirmar("Alterar vários contratos", `Alterar <b>${esc(CPK[k].t)}</b> para <b>${esc(v || "(vazio)")}</b> em <b>${cods.length}</b> contrato(s)?`, "Alterar"))) return;
  const n = await alterarFichas(cods, k, k === "situacao" ? v.toUpperCase() : v);
  CTT_SEL.clear(); toast(`${n} contrato(s) alterado(s).`); desenharContratos(); requestAnimationFrame(ajustarAlturas);
};
ACT["ctt-lote-limpar"] = () => { CTT_SEL.clear(); desenharContratos(); requestAnimationFrame(ajustarAlturas); };
ACT["ctt-limpa-canc"] = async () => {
  const ls = CTT.filter(c => c.situacao === "CANCELADO" && ST_K.some(k => String(fv(c, k)).trim().toUpperCase() === "CANCELADO"));
  if (!(await confirmar("Limpar status dos cancelados", `Apagar o texto "CANCELADO" dos campos de status (assinaturas, scan, CPFL…) de <b>${ls.length}</b> contrato(s) cancelado(s)? A Situação continua CANCELADO.`, "Apagar"))) return;
  for (const c of ls) {
    const ficha = Object.assign({}, fichaDe(c)); ST_K.forEach(k => { if (String(ficha[k] || "").trim().toUpperCase() === "CANCELADO") ficha[k] = ""; });
    const r = await q(sb.from("contratos").update({ ficha }).eq("codigo", c.codigo).select().single()); Object.assign(c, r); delete c._f;
  }
  toast(`${ls.length} contrato(s) limpos.`); desenharContratos();
};
ACT["ctt-gar"] = () => {};
ACT["aud-limpar"] = () => { S.f.aud = { dia: "", user: "", sec: "" }; render(); };
ACT["ctt-rel-pend"] = () => {
  const ls = CTT.filter(c => pendsDe(c).length).sort((a, b) => COLL.compare(a.codigo, b.codigo));
  const PCOLS = PEND_CTT.filter(([k]) => k !== "redcor");
  const porTipo = PCOLS.map(([k, t]) => [t, ls.filter(c => pendAtiva(c, k)).length]).filter(x => x[1]);
  const html = `<div class="rel-tit"><b>Contratos ativos com pendências</b><span>${new Date().toLocaleDateString("pt-BR")} · ${ls.length} contratos</span></div>
    <p style="font-size:11px">${porTipo.map(([t, n]) => `${esc(t)}: <b>${n}</b>`).join(" · ")}</p>
    <table class="rel-t"><thead><tr><th>Contrato</th><th>Imóvel</th><th>Locatário</th><th>Início</th>${PCOLS.map(([, t]) => `<th>${esc(t.replace("Falta ", ""))}</th>`).join("")}</tr></thead><tbody>
    ${ls.map(c => `<tr><td>${esc(c.codigo)}</td><td>${esc(curtoTxt(c.endereco || fv(c, "end_rua"), 42))}</td><td>${esc(curtoTxt(c.locatario || fv(c, "lct1_nome"), 34))}</td><td>${dt(c.inicio)}</td>${PCOLS.map(([k]) => { const v = String(fv(c, k) || "").trim(); return `<td${pendAtiva(c, k) ? ' style="background:#fff3cf"' : ""}>${pendAtiva(c, k) ? "<b>" + esc(curtoTxt(v || "falta", 20)) + "</b>" : esc(curtoTxt(v === "---" ? "" : v, 20))}</td>`; }).join("")}</tr>`).join("")}
    </tbody></table><p class="rel-rod">Emitido em ${new Date().toLocaleString("pt-BR")} por ${esc(S.membro.nome || S.membro.email)}</p>`;
  abrirRelatorio("Relatório de pendências", html, { paisagem: true });
};
ACT["ctt-resumo"] = el => {
  const g = G.contratos6, vis = new Set(resumoKs(el.dataset.r));
  g.ordem = COLS_CTT.map(c => c.k); g.ocultas = g.ordem.filter(k => !vis.has(k) && !(gCol(g, k) || {}).fixo);
  S.f.cttResumo = el.dataset.r; gradeSalvar("contratos6"); desenharContratos(); requestAnimationFrame(ajustarAlturas);
};
ACT["ctt-st"] = el => {
  const c = CTT.find(x => x.codigo === el.dataset.id), k = el.dataset.k, sit = k === "situacao";
  if (!c || !pode.editar()) return;
  const atual = String(fv(c, k) || "");
  const ops = sit ? Object.keys(SIT_CTT) : OPC.st;
  const p = pop(el, `<div class="gp-h">${esc(CPK[k].t)} · ${esc(c.codigo)}</div>${atual && !sit ? `<p class="st-atual">${esc(atual)}</p>` : ""}
    <div class="st-ops">${ops.map(o => `<button type="button" class="btn sm${atual.toUpperCase() === o ? " pri" : ""}" data-o="${esc(o)}">${esc(o)}</button>`).join("")}</div>
    ${sit ? "" : `<label class="fl"><span>Outro / anotação</span><input data-livre value="${esc(ops.includes(atual.toUpperCase()) ? "" : atual)}" placeholder="ex.: falta reconhecer firma"></label>
    <div class="gp-f"><button type="button" class="btn sm" data-o="">Deixar vazio</button><button type="button" class="btn sm pri" data-ok>Salvar anotação</button></div>`}`, 320);
  const salvar = async v => {
    fecharPop();
    try {
      const ficha = Object.assign({}, fichaDe(c), { [k]: v });
      const r = await q(sb.from("contratos").update({ ficha }).eq("codigo", c.codigo).select().single());
      Object.assign(c, r); delete c._f; toast(`${CPK[k].t}: ${v || "vazio"}`); gRedesenhar("contratos6");
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
  else if (cp.tipo === "quem") { const q2 = quemNorm(v), ops = quemOps().concat(QUEM_ESP); inp = `<select ${nm}>${opt("", "—", !q2)}${ops.map(o => opt(o, o, q2 === o)).join("")}${q2 && !ops.includes(q2) ? opt(q2, q2 + " (inválido)", true) : ""}</select>`; }
  else if (cp.tipo === "area") inp = `<textarea ${nm} rows="3">${esc(v)}</textarea>`;
  else if (cp.tipo === "lista" || cp.tipo === "st") inp = `<input ${nm} list="dl-${cp.k}" value="${esc(v)}" autocomplete="off"><datalist id="dl-${cp.k}">${(cp.o || OPC.st).map(o => `<option value="${esc(o)}">`).join("")}</datalist>`;
  else if (cp.tipo === "tel") inp = `<input ${nm} value="${esc(fmtTel(v))}" inputmode="tel" placeholder="(19) 9.0000-0000">`;
  else if (cp.tipo === "moeda") inp = `<input ${nm} value="${esc(v)}" inputmode="decimal" placeholder="0,00">`;
  else inp = `<input ${nm} value="${esc(v)}"${cp.tipo === "email" ? ' inputmode="email"' : ""}${cp.tipo === "doc" ? ' inputmode="numeric" placeholder="000.000.000-00"' : ""}>`;
  if (cp.k === "obs") inp = inp.replace('rows="3"', 'rows="8"');
  return `<label class="fl${cp.k === "obs" ? " obs-ficha" : cp.tipo === "area" || cp.k.endsWith("_rua") || cp.k === "ig_descricao" ? " largo" : ""}"><span>${esc(lbl)}</span>${inp}</label>`;
}
function formContrato(c) {
  const novo = !c;
  const f = c ? fichaDe(c) : { situacao: "EM ELABORAÇÃO", fins: "RESIDENCIAIS", garantia: "FIADOR", prazo: OPC.prazo[2], end_cidade: "Monte Mor/SP", lcd_qtd: "1", lct_qtd: "1",
    test1_nome: "Linyston Luiz Cavallaro", test1_rg: "35.116.648-8", test1_cpf: "406.955.348-74", test2_nome: "André Cesar Filietaz", test2_rg: "29.257.256-X", test2_cpf: "380.827.298-80",
    desc_carencia: "Não", inundacao: "Não", redacao: "LINYSTON" };
  const dis = pode.editar() ? "" : "disabled";
  const im = c && c.imovel_id ? S.imovelPor[c.imovel_id] : null;
  const bloco = (titulo, ks) => `<fieldset class="ficha-b"><legend>${esc(titulo)}</legend><div class="ficha-g">${ks.map(k => campoHTML(CPK[k], f[k] || "", dis)).join("")}</div></fieldset>`;
  const pessoaKs = p => ["nome", "sexo", "nac", "est_civil", "prof", "rg", "oe", "cpf", "tel", "email"].map(x => p + "_" + x);
  const endKs = p => ["end1_rua", "end1_bairro", "end1_cidade", "end2_rua", "end2_bairro", "end2_cidade", "qtd", "casados", "regime", "data_casamento"].map(x => p + "_" + x);
  const sec = {
    imv: `<div class="ficha-g">
        <div class="fl largo"><span>Imóvel no mapa (etiqueta do imóvel na lista de Imóveis)</span>
          ${im ? `<div data-imv-tag><span class="imv-tag">🏠 ${esc(im.endereco)} <small>${esc((STATUS_IMV[im.status] || [im.status])[0])}${im.locador ? " · " + esc(im.locador) : ""}</small>${dis ? "" : `<button type="button" class="btn sm" data-trocar-imv>trocar</button>`}</span></div>` : ""}
          <input name="imovel" list="dl-imv" value="${esc(im ? im.endereco : "")}" placeholder="Digite e escolha o endereço" ${dis} ${im ? "hidden" : ""}></div>
        ${["end_rua", "end_bairro", "end_cidade", "end_cep", "matricula", "insc_cad", "uc", "rgi"].map(k => campoHTML(CPK[k], f[k] || "", dis)).join("")}</div>${imovelDatalist()}`,
    ctt: `<div class="ficha-g">
        <label class="fl"><span>Código</span><input name="codigo" value="${esc(c ? c.codigo : proximoCodigo())}" placeholder="L.26.001" ${novo ? "" : "disabled"}></label>
        ${["situacao", "fins", "data_contrato", "inicio", "termino", "prazo", "dia_venc", "valor", "valor_ext"].map(k => campoHTML(CPK[k], f[k] || "", dis)).join("")}
        <label class="fl largo"><span>Pasta do contrato no Google Drive (link)</span><input name="pasta" value="${esc(c ? c.pasta_url || "" : "")}" placeholder="https://drive.google.com/drive/folders/…  (copie o link da pasta no Drive)" ${dis}></label>
        <label class="fl"><span>Data de encerramento</span><input type="date" name="data_enc" value="${esc(c ? c.data_encerramento || "" : "")}" title="Preenchida sozinha ao registrar a saída do locatário" ${dis}></label></div>
        ${bloco("Encargos", ["enc_agua_energia", "enc_gas", "enc_condominio", "enc_iptu"])}`,
    gar: `<div class="ficha-g">${["garantia", "caucao_valor", "caucao_ext", "caucao_conta"].map(k => campoHTML(CPK[k], f[k] || "", dis)).join("")}</div>
        ${bloco("Imóvel em garantia", ["ig_descricao", "ig_rua", "ig_bairro_cidade", "ig_matricula"])}`,
    lcd: bloco("Locador 1", pessoaKs("lcd1")) + bloco("Locador 2", pessoaKs("lcd2")) + bloco("Endereço e casamento dos locadores", endKs("lcd")),
    lct: bloco("Locatário 1 (ou empresa, quando PJ)", pessoaKs("lct1")) + bloco("Locatário 2 (ou representante, quando PJ)", pessoaKs("lct2")) + bloco("Endereço e casamento dos locatários", endKs("lct")),
    fdr: bloco("Fiador 1", pessoaKs("fdr1")) + bloco("Fiador 2", pessoaKs("fdr2")) + bloco("Endereço e casamento dos fiadores", endKs("fdr")),
    out: bloco("Testemunhas", ["test1_nome", "test1_rg", "test1_cpf", "test2_nome", "test2_rg", "test2_cpf"]) + bloco("Cláusulas especiais", ["desc_carencia", "desc_meses", "desc_valor", "inundacao"]),
    st: `<div class="ficha-g">${["st_ass_lcd", "st_ass_lct", "st_scan", "st_cpfl", "st_condominio", "st_brimob", "redacao", "correcao", "obs"].map(k => campoHTML(CPK[k], f[k] || "", dis)).join("")}</div>
        ${f.saldo_entrega ? `<p class="hint">Saldo devedor na entrega (só histórico da planilha antiga): ${esc(f.saldo_entrega)}. Débitos novos vão pela saída do locatário, em Cobrança.</p>` : ""}`
  };
  const atual = im ? `hoje: <b>${esc((STATUS_IMV[im.status] || [im.status])[0])}</b>${im.locatario ? " · " + esc(im.locatario) : ""}` : "";
  return `<div class="abas ficha-abas">${SECS.map(([k, t], i) => `<button type="button" class="aba${i ? "" : " on"}" data-aba="${k}">${t}</button>`).join("")}</div>
    ${SECS.map(([k], i) => `<div class="ficha-sec" data-sec="${k}"${i ? " hidden" : ""}>${sec[k]}</div>`).join("")}
    ${pode.editar() ? `<div class="box mapa-opc"><div class="mapa-h"><b>Mapa do aluguel</b>
        <div class="seg"><button type="button" data-mapa="nao" class="on">Não mexer no mapa</button><button type="button" data-mapa="sim">Ligar a um imóvel LIVRE do mapa</button></div></div>
        <div data-mapa-prev class="hint">${atual}</div></div>` : ""}`;
}
// lê o formulário e devolve a ficha (texto, como no Excel)
function lerFicha(d, base) {
  const f = Object.assign({}, base || {});
  const g = norm(($("[data-f=garantia]", d) || {}).value || ""), cau = g.includes("cau"), fia = g.includes("fiador");
  $$("[data-f]", d).forEach(x => {
    const cp = CPK[x.dataset.f]; let v = x.value.trim();
    // garantia escolhida apaga os dados da outra (como no Excel: "---")
    if (cau && (cp.sec === "fdr" || cp.k.startsWith("ig_"))) v = "";
    if (fia && cp.k.startsWith("caucao_")) v = "";
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
  const ti = $("[data-trocar-imv]", d); if (ti) ti.addEventListener("click", () => { $("[data-imv-tag]", d).hidden = true; form.imovel.hidden = false; form.imovel.select(); });
  // v12: ao escolher o imóvel, completa os locadores com o cadastro de locadores (só os campos vazios)
  if (form.imovel && !form.imovel.disabled) form.imovel.addEventListener("change", () => {
    const im = imovelPorEndereco(form.imovel.value), l = im && locPor(im.locador), lf = (l && l.ficha) || {};
    if (!lf.lcd1_nome) return;
    let n = 0;
    LCD_KS().forEach(k => { const i = $(`[data-f="${k}"]`, d); if (!i || i.value.trim() || !lf[k]) return; const cp = CPK[k]; i.value = cp.tipo === "dext" && i.type === "date" ? dataDeTexto(lf[k]) : cp.tipo === "tel" ? fmtTel(lf[k]) : lf[k]; n++; });
    if (n) toast(`Dados do locador ${l.nome} copiados do cadastro (aba Locadores).`);
  });
  const ext = (a, b) => { const va = $(`[data-f=${a}]`, d), vb = $(`[data-f=${b}]`, d); if (!va || !vb) return;
    va.addEventListener("change", () => { const n = parseMoney(va.value); if (n != null) { va.value = n2(n); vb.value = extensoReais(n); } }); };
  ext("valor", "valor_ext"); ext("caucao_valor", "caucao_ext");
  // garantia: com caução não existe aba de fiadores; com fiador os campos de caução somem (viram "---")
  const gar = $("[data-f=garantia]", d);
  const aplicarGarantia = () => {
    const g = norm(gar.value), cau = g.includes("cau"), fia = g.includes("fiador");
    const abaF = $(".ficha-abas [data-aba=fdr]", d); if (abaF) abaF.hidden = cau;
    ["caucao_valor", "caucao_ext", "caucao_conta"].forEach(k => { const x = $(`[data-f=${k}]`, d); if (x && !x.closest("label").dataset.sempreOculto) x.closest("label").hidden = fia; });
    const cb = $("[data-cauc-box]", d); if (cb) cb.hidden = !cau;
    $$("[data-f^=ig_]", d).forEach(x => { const fs = x.closest("fieldset"); if (fs) fs.hidden = cau; });
  };
  // conta caução: escolher uma conta LIVRE da lista (obrigatório para contrato ativo com caução)
  const cc = $("[data-f=caucao_conta]", d);
  if (cc && CAUC.contas.length) {
    const vig = c && CAUC.vigPorCtt[c.codigo], conta = vig && CAUC.contas.find(x => x.id === vig.conta_id);
    cc.type = "hidden";
    const box = document.createElement("div");
    box.className = "fl largo";
    box.innerHTML = vig ? `<span>Conta da caução</span><div class="box">✔ Vinculada: <b>${esc(contaCaucTxt(conta))}</b> · ${brl(vig.valor_entrada)} desde ${dt(vig.data_entrada)}<br><span class="hint">Para devolver ou trocar, use Cadastro locação → Contas caução.</span></div>`
      : `<span>Conta da caução (escolha uma conta livre)</span><select data-cauc-sel ${pode.editar() ? "" : "disabled"}>${opt("", "— não vinculada —", !(c && caucDireto(c)))}
          <optgroup label="Conta caução livre">${CAUC.contas.filter(x => estadoCauc(x) === "livre").map(x => opt(x.id, contaCaucTxt(x), false)).join("")}</optgroup>
          <optgroup label="Somada a uma conta já ocupada (mesmo locatário)">${CAUC.contas.filter(x => ["ocup", "baixa"].includes(estadoCauc(x))).map(x => opt("s:" + x.id, contaCaucTxt(x) + " — hoje: " + ((CAUC.vig[x.id] || {}).locatario || ""), false)).join("")}</optgroup>
          <optgroup label="Sem conta">${opt("direto", "Paga direto ao proprietário", !!(c && caucDireto(c)))}</optgroup></select>`;
    cc.closest("label").after(box); cc.closest("label").hidden = true; cc.closest("label").dataset.sempreOculto = "1";
    const sel = $("[data-cauc-sel]", box); if (sel) sel.addEventListener("change", () => { const x = CAUC.contas.find(y => y.id === sel.value.replace(/^s:/, "")); cc.value = sel.value === "direto" ? "Paga diretamente ao proprietário" : x ? contaCaucTxt(x) : ""; });
    box.dataset.caucBox = "1";
  }
  if (gar) { gar.addEventListener("input", aplicarGarantia); aplicarGarantia(); }
  // dia do pagamento = dia do início (pode trocar)
  const ini = $("[data-f=inicio]", d), dia = $("[data-f=dia_venc]", d);
  if (ini && dia && ini.type === "date") ini.addEventListener("change", () => { if (ini.value) { const n = +ini.value.slice(8, 10); dia.value = `${pad(n)} (${porExtenso(n)})`; } });
  // mapa: prévia do que muda
  const prev = $("[data-mapa-prev]", d);
  const desenharPrev = () => {
    if (!prev) return;
    const sim = $("[data-mapa=sim]", d).classList.contains("on");
    const im = imovelPorEndereco(form.imovel.value);
    prev.className = "hint";
    if (!sim) { prev.innerHTML = im ? `O imóvel continua como está (hoje: <b>${esc((STATUS_IMV[im.status] || [im.status])[0])}</b>${im.locatario ? " · " + esc(im.locatario) : ""}).` : "O mapa não é alterado."; return; }
    if (!im) { prev.innerHTML = "Escolha na aba <b>Imóvel</b> o imóvel do mapa (campo \"Imóvel no mapa\")."; prev.className = "hint neg"; return; }
    const cod = form.codigo.value.trim() || (c && c.codigo);
    if (im.status !== "LVR" && im.contrato_codigo !== cod) {
      prev.innerHTML = `<b>Bloqueado:</b> <b>${esc(im.endereco)}</b> está <b>${esc((STATUS_IMV[im.status] || [im.status])[0])}</b>${im.locatario ? " (" + esc(im.locatario) + ")" : ""}. Só um imóvel <b>Livre</b> recebe um novo contrato: registre antes a saída do locatário atual em Imóveis.`;
      prev.className = "box bad"; return;
    }
    const fx = lerFicha(d, {}), nomes = (a, b, q) => [fx[a], q === "PJ" ? "" : fx[b]].filter(x => x && x !== "---").join(" - ");
    const novo = { locatario: nomes("lct1_nome", "lct2_nome", (fx.lct_qtd || "").toUpperCase()), fiador: nomes("fdr1_nome", "fdr2_nome", (fx.fdr_qtd || "").toUpperCase()),
      locador: nomes("lcd1_nome", "lcd2_nome", (fx.lcd_qtd || "").toUpperCase()), valor: parseMoney(fx.valor), dia: parseInt(fx.dia_venc, 10) || null, entrada: dataDeTexto(fx.inicio) };
    const ck0 = $("[data-copiar-locador]", d), era = !!(ck0 && ck0.checked);
    const lin = (t, a, b, chk) => `<tr><td>${t}</td><td>${esc(a || "—")}</td><td><b>${esc(b || "—")}</b></td><td>${chk || "✔"}</td></tr>`;
    prev.innerHTML = `Ao salvar, <b>${esc(im.endereco)}</b> passa para <b>Alugado</b> e o contrato <b>${esc(cod)}</b> passa para <b>Ativo</b>:
      <div class="tw" style="margin-top:6px"><table class="compacta"><thead><tr><th>Campo</th><th>No mapa hoje</th><th>Do contrato</th><th>Copiar</th></tr></thead><tbody>
      ${lin("Locatário", im.locatario, novo.locatario)}${lin("Fiador", im.fiador, novo.fiador)}${lin("Aluguel", im.valor != null ? n2(im.valor) : "", novo.valor ? n2(novo.valor) : "")}
      ${lin("Dia do vencimento", im.dia_venc, novo.dia)}${lin("Entrada", dt(im.data_entrada), dt(novo.entrada))}
      ${lin("Locador", im.locador, novo.locador, `<input type="checkbox" data-copiar-locador ${era ? "checked" : ""} title="O nome do locador no mapa define o grupo e a carteira (IMOB, CF…). Só marque se o do contrato for o correto.">`)}</tbody></table></div>
      <span class="hint">O locador do mapa só muda se você marcar: o nome dele define o grupo e a carteira.</span>`;
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
  if (!/^L\.\d{2}\.\d{3}$/.test(codigo) && !(c && ehRascunho(codigo))) throw new Error("Código no formato L.26.001 (digite só os números: 26001).");
  const ficha = lerFicha(d, c ? fichaDe(c) : {});
  if (!ficha.end_rua && imovel_id) ficha.end_rua = S.imovelPor[imovel_id].endereco;
  const atualizarMapa = $("[data-mapa=sim]", d) && $("[data-mapa=sim]", d).classList.contains("on");
  // caução: contrato ativo com caução precisa de conta caução vinculada
  const selC = $("[data-cauc-sel]", d), selV = selC ? selC.value : "", somada = selV.startsWith("s:");
  const contaSel = selV && selV !== "direto" ? CAUC.contas.find(x => x.id === selV.replace(/^s:/, "")) : null;
  const ehCau = /CAU/i.test(norm(ficha.garantia || "")), jaVinc = !novo && CAUC.vigPorCtt[codigo];
  if (selC) { if (selV === "direto") ficha.caucao_modo = "proprietario"; else if (ficha.caucao_modo === "proprietario") delete ficha.caucao_modo; }
  if (ehCau && CAUC.contas.length && !jaVinc) {
    if (!contaSel && selV !== "direto" && (ficha.situacao || "") === "ATIVO") throw new Error("Contrato ativo com caução: escolha uma conta caução livre, somada a outra conta, ou 'Paga direto ao proprietário' (aba Garantia).");
    if (contaSel && !(parseMoney(ficha.caucao_valor) > 0)) throw new Error("Informe o valor da caução (aba Garantia).");
  }
  let salvo;
  const pasta_url = form.pasta ? form.pasta.value.trim() : (c && c.pasta_url) || "";
  if (pasta_url && !/^https:\/\//.test(pasta_url)) throw new Error("O link da pasta precisa começar com https:// (copie o link da pasta no Google Drive).");
  const data_encerramento = form.data_enc ? form.data_enc.value || null : (c && c.data_encerramento) || null;
  if (novo) salvo = await q(sb.from("contratos").insert({ codigo, imovel_id, ficha, pasta_url, data_encerramento }).select().single());
  else salvo = await q(sb.from("contratos").update({ imovel_id, ficha, pasta_url, data_encerramento }).eq("codigo", codigo).select().single());
  if (ehCau && contaSel && !jaVinc) { await gravarVinculoCauc(contaSel, salvo, parseMoney(ficha.caucao_valor), dataDeTexto(ficha.inicio) || salvo.inicio || hoje(), somada); await carregarCauc(); }
  if (atualizarMapa) {
    if (!imovel_id) throw new Error("Contrato salvo. Para ligar ao mapa, escolha o imóvel na aba Imóvel.");
    const im = S.imovelPor[imovel_id];
    if (im.status !== "LVR" && im.contrato_codigo !== codigo) throw new Error(`Contrato salvo, mas o imóvel não foi alterado: ele está ${(STATUS_IMV[im.status] || [im.status])[0]}. Registre antes a saída do locatário atual.`);
    if (!salvo.valor || !salvo.locatario) throw new Error("Contrato salvo. Para ligar ao mapa, informe o locatário e o valor do aluguel.");
    const u = { status: "ALG", locatario: salvo.locatario, fiador: salvo.fiador || "", valor: salvo.valor, dia_venc: salvo.dia_venc, data_entrada: salvo.inicio, contrato_codigo: codigo };
    const cl = $("[data-copiar-locador]", d); if (cl && cl.checked && salvo.locador) u.locador = salvo.locador;
    await q(sb.from("imoveis").update(u).eq("id", imovel_id));
    // ligado a um imóvel livre: o contrato passa a ATIVO sozinho
    if (salvo.situacao !== "ATIVO") await q(sb.from("contratos").update({ ficha: Object.assign({}, salvo.ficha || ficha, { situacao: "ATIVO" }) }).eq("codigo", codigo));
    await recarregarImoveis();
  }
}
ACT["ctt-gerar"] = () => abrirTermo("gerador", "", proximoCodigo());
ACT["ctt-novo"] = async () => { try { if (pode.ver("caucao") || pode.ver("contratos")) await carregarCauc(); } catch (e) { console.warn(e); } abrirNovoCtt(); };
const abrirNovoCtt = () => modal({ titulo: "Novo contrato", xl: true, corpo: formContrato(null), aoAbrir: (f, d) => ligarFicha(f, d, null),
  salvar: async f => { await salvarContrato(f, $("#dlg"), null); toast("Contrato salvo."); render(); } });
ACT["ctt-ed"] = async el => {
  const c = CTT.find(x => x.codigo === el.dataset.id); if (!c) return;
  try { await carregarCauc(); } catch (e) { console.warn(e); }
  const termos = (pode.editar() ? `<button type="button" class="btn" data-termo="gerador" title="Abre o gerador com os dados deste contrato">📄 Gerar contrato (Word)</button>` : "") +
    (c.situacao !== "CANCELADO" ? `<button type="button" class="btn" data-termos-ctt>🔑 Termos ▾</button>` : "");
  modal({ titulo: "Contrato " + c.codigo + (c.locatario ? " · " + c.locatario : ""), xl: true, corpo: formContrato(c), semOk: !pode.editar(),
    extra: termos + (pode.admin() ? `<span class="spacer"></span><button type="button" class="btn danger" data-del>Excluir</button>` : ""),
    salvar: async f => { await salvarContrato(f, $("#dlg"), c); toast("Salvo."); render(); },
    aoAbrir: (f, d) => {
      ligarFicha(f, d, c);
      $$("[data-termo]", d).forEach(b => b.addEventListener("click", () => { d.close(); abrirTermo(b.dataset.termo, c.codigo); }));
      const tm = $("[data-termos-ctt]", d); if (tm) tm.addEventListener("click", () => menuTermos(tm, "Termos deste contrato", TERMOS_CTT.map(x => ({ ic: x.ic, t: x.t, d: x.d, fn: () => { d.close(); abrirTermo(x.k, c.codigo); } }))));
      const b = $("[data-del]", d); if (b) b.addEventListener("click", async () => { d.close(); if (!(await confirmar("Excluir contrato", `Excluir o contrato ${esc(c.codigo)}? Prefira mudar a situação para Cancelado.`, "Excluir"))) return; try { await q(sb.from("contratos").delete().eq("codigo", c.codigo)); toast("Excluído."); render(); } catch (e) { falha(e); } });
    }
  });
};
// ---- termos (seus apps de entrega de chaves e devolução de caução) ----
const TERMOS = { entrega: ["Declaração de entrega de chaves", "termos/entrega-chaves.html"], caucao: ["Declaração de devolução de caução", "termos/devolucao-caucao.html"],
  gerador: ["Gerador de contratos", "termos/gerador-contratos.html"] };
// planilha (em memória) no mesmo formato da aba "Contratos Locação", entregue aos apps no lugar da planilha externa
async function cadastroXLSX(extra) {
  await carregarXLSX();
  const cab = CP.map(c => c.t), linhas = [cab, cab, ["Nº Contrato"].concat(cab.slice(1))]
    .concat(CTT.filter(c => c.situacao !== "CANCELADO").concat(extra ? [extra] : []).map(c => CP.map(cp => String(fv(c, cp.k) || ""))));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), "Contratos Locação");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}
const ehRascunho = cod => /^L\.\d{2}\.R\d+$/.test(cod || "");
function proximoRascunho() {
  const yy = hoje().slice(2, 4);
  const n = CTT.filter(c => c.codigo.startsWith("L." + yy + ".R")).map(c => +c.codigo.slice(6)).filter(x => x > 0);
  return "L." + yy + ".R" + String((n.length ? Math.max(...n) : 0) + 1).padStart(2, "0");
}
async function abrirTermo(tipo, codigo, novoCodigo, opts) {
  opts = opts || {};
  if (["entrega", "caucao", "moradia", "quitacao"].includes(tipo)) return abrirTermoNativo(tipo, codigo, opts);
  if (!opts.aoBaixar && tipo === "entrega" && codigo && termoEst(CTT.find(c => c.codigo === codigo) || {}, "entrega") === "pendente") opts.aoBaixar = () => marcarEntregaFeita(codigo);
  try {
    const [titulo, arq] = TERMOS[tipo];
    if (!CTT.length) CTT = await fetchAll("contratos", b => b.order("codigo", { ascending: false }));
    const resp = await fetch(arq, { cache: "no-cache" });
    if (!resp.ok) throw new Error("Arquivo não encontrado no site: " + arq);
    const html = await resp.text(), xlsx = await cadastroXLSX(opts.prefill), arquivos = {};
    const ger = tipo === "gerador";
    let rascunho = "", form = null;
    if (ger) {
      const m = await fetch("termos/contrato_padrao.docx", { cache: "no-cache" }).catch(() => null);
      if (m && m.ok) arquivos["contrato_padrao.docx"] = await m.arrayBuffer();
      else toast('O modelo "contrato_padrao.docx" não está na pasta termos do site: o botão "Gerar Contrato (Word)" não vai funcionar até ele ser enviado.', true);
      const m2 = await fetch("termos/contrato_sem_garantia.docx", { cache: "no-cache" }).catch(() => null);
      if (m2 && m2.ok) arquivos["contrato_sem_garantia.docx"] = await m2.arrayBuffer();
      if (ehRascunho(codigo)) { rascunho = codigo; const c = CTT.find(x => x.codigo === codigo); form = c && c.ficha && c.ficha._form || null; novoCodigo = proximoCodigo(); }
    }
    const d = $("#dlg");
    modal({ titulo: ger && rascunho ? `Gerador de contratos · rascunho ${rascunho}` : titulo, semOk: true, corpo: `<iframe title="${esc(titulo)}" sandbox="allow-scripts allow-downloads allow-modals allow-popups" referrerpolicy="no-referrer"></iframe><div class="ger-sair" data-sair hidden></div>` });
    d.classList.add("termo-dlg"); if (ger) d.classList.add("ger");
    const fr = $("iframe", d);
    const st = { sujo: false, rascunho };
    if (ger) {
      const bar = document.createElement("div"); bar.className = "ger-bar";
      bar.innerHTML = `<span class="hint" data-gst></span><button type="button" class="btn sm" data-ga="rascunho-json" title="Baixa o rascunho no computador (.json)">⬇ Rascunho .json</button><button type="button" class="btn sm" data-ga="limpar">🗑 Limpar</button>
        <button type="button" class="btn sm" data-ga="rascunho-sistema" title="Guarda no sistema como Em elaboração, com número de rascunho (não usa número de contrato)">📝 Salvar rascunho</button>
        <button type="button" class="btn sm pri" data-ga="salvar" title="Contrato completo: grava no sistema com o número definitivo">💾 Salvar no sistema</button><button type="button" class="btn sm pri" data-ga="word">📄 Gerar contrato (Word)</button>`;
      $(".dlg-h", d).insertBefore(bar, $(".dlg-h .x", d));
      $$("[data-ga]", bar).forEach(b => b.addEventListener("click", () => fr.contentWindow.postMessage({ tipo: "acao", acao: b.dataset.ga }, "*")));
      // fechar com algo digitado: pergunta antes (X ou Esc)
      const perguntar = ev => {
        if (!st.sujo) return;
        ev.preventDefault(); ev.stopImmediatePropagation();
        const box = $("[data-sair]", d); box.hidden = false;
        box.innerHTML = `<div class="ger-sair-c"><h3>Fechar o gerador?</h3><p>Você começou a preencher este contrato. O que fazer com ele?</p>
          <button type="button" class="btn pri" data-s="sistema">📝 Salvar rascunho no sistema (Em elaboração)</button>
          <button type="button" class="btn" data-s="json">⬇ Baixar rascunho .json e fechar</button>
          <button type="button" class="btn danger" data-s="fechar">Fechar sem salvar</button>
          <button type="button" class="btn" data-s="voltar">Continuar editando</button></div>`;
        $$("[data-s]", box).forEach(b => b.addEventListener("click", () => {
          const o = b.dataset.s; box.hidden = true;
          if (o === "sistema") fr.contentWindow.postMessage({ tipo: "acao", acao: "rascunho-sistema", fechar: true }, "*");
          if (o === "json") { fr.contentWindow.postMessage({ tipo: "acao", acao: "rascunho-json" }, "*"); st.sujo = false; setTimeout(() => d.close(), 600); }
          if (o === "fechar") { st.sujo = false; d.close(); }
        }));
      };
      d.addEventListener("click", ev => { if (ev.target.closest("[data-x]")) perguntar(ev); }, true);
      d.addEventListener("cancel", perguntar);
      d.addEventListener("close", () => d.removeEventListener("cancel", perguntar), { once: true });
    }
    const ouvir = ev => {
      if (ev.source !== fr.contentWindow || !ev.data) return;
      const m = ev.data;
      if (m.tipo === "termo-pronto") fr.contentWindow.postMessage({ tipo: "termo", html, xlsx, arquivos, codigo: (opts.prefill ? opts.prefill.codigo : codigo) || "", novoCodigo: novoCodigo || "", form, rascunho: st.rascunho }, "*");
      if (m.tipo === "gerador-sujo") st.sujo = true;
      if (m.tipo === "gerador-status") { const g = $("[data-gst]", d); if (g) g.textContent = m.texto; }
      if (m.tipo === "gerador-salvar") salvarDoGerador(m.linha, fr, st.rascunho).then(ok => { if (ok) { st.sujo = false; st.rascunho = ""; } });
      if (m.tipo === "gerador-rascunho") salvarRascunhoGerador(m.linha, m.form, st, fr).then(ok => { if (ok && m.fechar) { st.sujo = false; d.close(); } });
      if (m.tipo === "termo-baixado" && opts.aoBaixar) opts.aoBaixar(m.arquivo);
    };
    window.addEventListener("message", ouvir);
    d.addEventListener("close", () => { d.classList.remove("termo-dlg", "ger"); window.removeEventListener("message", ouvir); if (d.dataset.mudou) { delete d.dataset.mudou; if (["contratos", "painel", "imoveis", "caucao"].includes(S.page)) render(); } }, { once: true });
    fr.src = "termos/abrir.html";
  } catch (e) { falha(e); }
}
const fichaDaLinha = linha => { const novos = {}; CP.forEach((cp, i) => { if (i && linha && i < linha.length) { const v = String(linha[i] == null ? "" : linha[i]).trim(); novos[cp.k] = v === "---" ? "" : v; } }); return novos; };
// "Salvar no sistema" do gerador: a linha que ia para o Excel vira a ficha do contrato
async function salvarDoGerador(linha, fr, rascunho) {
  const avisar = t => fr.contentWindow && fr.contentWindow.postMessage({ tipo: "aviso", texto: t }, "*");
  try {
    if (!pode.ed("contratos")) throw new Error("Sem permissão para alterar contratos.");
    const cod = String(linha[0] || "").trim();
    if (!/^L\.\d{2}\.\d{3}$/.test(cod)) throw new Error("Nº do contrato inválido (formato L.26.001). Para guardar sem número, use 'Salvar rascunho'.");
    const novos = fichaDaLinha(linha);
    const ex = (await q(sb.from("contratos").select("*").eq("codigo", cod).maybeSingle()));
    if (ex) {
      if (!confirm(`O contrato ${cod} já existe no sistema${ex.locatario ? " (" + ex.locatario + ")" : ""}. Atualizar a ficha com os dados do gerador?\n\nSituação, status (assinaturas, CPFL…) e saldo continuam como estão.`)) return false;
      const f = Object.assign(fichaDe(ex), novos, { situacao: ex.situacao }); delete f._form; delete f.rascunho;
      await q(sb.from("contratos").update({ ficha: f }).eq("codigo", cod));
    } else {
      const im = S.imoveis.find(i => norm(i.endereco).trim() === norm(novos.end_rua).trim());
      await q(sb.from("contratos").insert({ codigo: cod, imovel_id: im ? im.id : null, ficha: Object.assign(novos, { situacao: "EM ELABORAÇÃO" }) }));
    }
    // o rascunho vira o contrato definitivo: o número de rascunho some
    if (rascunho && rascunho !== cod) await q(sb.from("contratos").delete().eq("codigo", rascunho));
    CTT = await fetchAll("contratos", b => b.order("codigo", { ascending: false }));
    $("#dlg").dataset.mudou = "1";
    avisar(`✅ Contrato ${cod} salvo no sistema${ex ? " (ficha atualizada)" : " como Em elaboração"}${rascunho && rascunho !== cod ? ` (o rascunho ${rascunho} foi substituído)` : ""}.`);
    return true;
  } catch (e) { avisar("⚠️ Não foi salvo: " + erroMsg(e)); return false; }
}
// rascunho: guarda no sistema sem validar, com número próprio (L.26.R01), para não ocupar número de contrato
async function salvarRascunhoGerador(linha, form, st, fr) {
  const avisar = t => fr.contentWindow && fr.contentWindow.postMessage({ tipo: "aviso", texto: t }, "*");
  try {
    if (!pode.ed("contratos")) throw new Error("Sem permissão para alterar contratos.");
    const novos = fichaDaLinha(linha), codForm = String((linha && linha[0]) || "").trim();
    const real = !st.rascunho && /^L\.\d{2}\.\d{3}$/.test(codForm) && CTT.find(c => c.codigo === codForm);
    if (real) {
      if (!confirm(`Gravar as alterações na ficha do contrato ${codForm}${real.locatario ? " (" + real.locatario + ")" : ""}?`)) return false;
      const f = Object.assign(fichaDe(real), novos, { situacao: real.situacao }); delete f._form;
      await q(sb.from("contratos").update({ ficha: f }).eq("codigo", codForm));
      avisar(`✅ Ficha do contrato ${codForm} atualizada.`);
    } else {
      const cod = st.rascunho || proximoRascunho();
      const ficha = Object.assign(novos, { situacao: "EM ELABORAÇÃO", _form: form || {}, obs: novos.obs || "" });
      const im = novos.end_rua ? S.imoveis.find(i => norm(i.endereco).trim() === norm(novos.end_rua).trim()) : null;
      if (st.rascunho) await q(sb.from("contratos").update({ ficha, imovel_id: im ? im.id : null }).eq("codigo", cod));
      else await q(sb.from("contratos").insert({ codigo: cod, imovel_id: im ? im.id : null, ficha }));
      st.rascunho = cod;
      avisar(`📝 Rascunho salvo no sistema como ${cod} (Em elaboração). O número definitivo só é usado quando você clicar em "Salvar no sistema".`);
      toast(`Rascunho salvo como ${cod}.`);
    }
    CTT = await fetchAll("contratos", b => b.order("codigo", { ascending: false }));
    $("#dlg").dataset.mudou = "1"; st.sujo = false;
    return true;
  } catch (e) { avisar("⚠️ Não foi salvo: " + erroMsg(e)); falha(e); return false; }
}
ACT["xls-ctt"] = () => exportarGrade("contratos6", `contratos-${hoje()}.xlsx`, "Contratos");

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
  { k: "data_saldo", t: "Em", tipo: "data" }
];
const COLS_CATS = [
  { k: "nome", t: "Categoria" },
  { k: "grupo", t: "Grupo", f: c => GRUPOS[c.grupo] || c.grupo },
  { k: "recorrente", t: "Previsão", f: c => !c.recorrente ? "" : c.periodicidade === "anual" ? "anual" + (c.mes_previsto ? " (" + MES3[c.mes_previsto - 1] + ")" : "") : "todo mês",
    html: c => !c.recorrente ? "" : `<span class="tag ${c.periodicidade === "anual" ? "info" : "warn"}">${c.periodicidade === "anual" ? "anual" + (c.mes_previsto ? " · " + MES3[c.mes_previsto - 1] : " · falta o mês") : "todo mês"}</span>${!c.valor_previsto ? ' <span class="tag bad" title="Sem valor a previsão não é lançada">sem valor</span>' : ""}` },
  { k: "dia_previsto", t: "Dia", tipo: "num", int: true, v: c => c.recorrente ? c.dia_previsto : null },
  { k: "valor_previsto", t: "Valor previsto", tipo: "num", v: c => c.recorrente ? c.valor_previsto : null },
  { k: "conta_prevista", t: "Conta", v: c => c.recorrente ? contaPor(c.conta_prevista).nome || "" : "", oculta: true }
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
// Auditoria em linguagem do dia a dia
const SECAO_AUD = { imoveis: "Imóveis", cauc_contas: "Contas caução", cauc_mov: "Caução (entradas e baixas)", depositos_fav: "Depósitos (favorecidos)", depositos_mes: "Depósitos do mês", contratos: "Contratos", lancamentos: "Caixa", cobrancas: "Aluguéis do mês", devedores: "Devedores", reajustes: "Reajustes",
  mapa_mensal: "Histórico do mapa", contas: "Contas", categorias: "Plano de contas", grupos_locador: "Grupos de locadores", membros: "Usuários", config: "Configurações" };
const OPER_AUD = { INSERT: "Criou", UPDATE: "Alterou", DELETE: "Excluiu" };
const CAMPO_AUD = { valor: "valor", status: "situação", situacao: "situação", locatario: "locatário", locador: "locador", fiador: "fiador", data_pagamento: "data do pagamento",
  valor_pago: "valor pago", repasse_data: "data do repasse", pago: "pago", data: "data", descricao: "descrição", categoria_id: "categoria", conta_id: "conta", dia_venc: "dia venc.",
  data_entrada: "entrada", contrato_codigo: "contrato", endereco: "endereço", obs: "observações", taxa_adm: "taxa", carteira: "carteira", ativo: "acesso", papel: "papel",
  permissoes: "permissões", itens: "itens da dívida", pagamentos: "pagamentos", aplicado_em: "aplicado", valor_novo: "novo valor", nome: "nome", ativa: "ativa", tipo: "tipo" };
function regAud(a) {
  const r = a.depois || a.antes || {};
  switch (a.tabela) {
    case "contratos": return r.codigo + (r.locatario ? " · " + r.locatario : "");
    case "imoveis": return r.endereco || (S.imovelPor[a.registro] || {}).endereco || "";
    case "lancamentos": return (r.descricao || catPor(r.categoria_id).nome || "") + (r.valor != null ? " · " + brl(r.valor) : "");
    case "cobrancas": return ((S.imovelPor[r.imovel_id] || {}).endereco || "") + (r.competencia ? " · " + mesCurto(r.competencia) : "");
    case "devedores": return r.devedor || "";
    case "reajustes": return ((S.imovelPor[r.imovel_id] || {}).endereco || "") + (r.competencia ? " · a partir de " + mesCurto(r.competencia) : "");
    case "membros": return r.email || "";
    case "config": return r.chave || "";
    default: return r.nome || a.registro || "";
  }
}
const fmtAud = v => v == null || v === "" ? "vazio" : typeof v === "number" ? n2(v) : typeof v === "boolean" ? (v ? "sim" : "não") : typeof v === "object" ? "…" : /^\d{4}-\d{2}-\d{2}$/.test(v) ? dt(v) : String(v).length > 30 ? String(v).slice(0, 28) + "…" : String(v);
function resumoAud(a) {
  if (a.operacao === "INSERT") return "registro novo";
  if (a.operacao === "DELETE") return "registro apagado";
  const A = a.antes || {}, D = a.depois || {};
  if (a.tabela === "reajustes" && !A.aplicado_em && D.aplicado_em) return `reajuste aceito: ${brl(D.valor_novo)}`;
  const ign = ["atualizado_em", "atualizado_por", "criado_em", "contatos", "pendencias", "grupo_locador"];
  const mud = Object.keys(D).filter(k => !ign.includes(k) && JSON.stringify(A[k]) !== JSON.stringify(D[k]));
  if (mud.includes("ficha")) {
    const fa = A.ficha || {}, fd = D.ficha || {};
    const fk = Object.keys(fd).filter(k => JSON.stringify(fa[k]) !== JSON.stringify(fd[k]));
    const outros = mud.filter(k => k !== "ficha" && !["endereco", "finalidade", "data_contrato", "inicio", "termino", "prazo_meses", "valor", "dia_venc", "garantia", "locador", "locatario", "fiador", "obs", "situacao", "saldo_devedor"].includes(k));
    const p = fk.slice(0, 3).map(k => `${(CPK[k] || { t: k }).t}: ${fmtAud(fa[k])} → ${fmtAud(fd[k])}`);
    return (fk.some(k => fa[k] != null && fa[k] !== "") || fk.length < 6 ? p.join(" · ") + (fk.length > 3 ? ` (+${fk.length - 3})` : "") : `ficha preenchida (${fk.length} campos)`) + (outros.length ? " · " + outros.join(", ") : "");
  }
  return mud.slice(0, 3).map(k => `${CAMPO_AUD[k] || k}: ${fmtAud(A[k])} → ${fmtAud(D[k])}`).join(" · ") + (mud.length > 3 ? ` (+${mud.length - 3})` : "") || "sem mudança visível";
}
const nomeAud = a => { const m = (S.membros || []).find(x => x.id === a.usuario || x.email === a.email); return m ? (m.nome || m.email) : (a.email || "sistema"); };
const COLS_AUD = [
  { k: "em", t: "Quando", v: a => a.em, f: a => new Date(a.em).toLocaleString("pt-BR") },
  { k: "quem", t: "Quem", v: nomeAud },
  { k: "tabela", t: "Seção", f: a => SECAO_AUD[a.tabela] || a.tabela },
  { k: "operacao", t: "Ação", f: a => OPER_AUD[a.operacao] || a.operacao },
  { k: "registro", t: "O quê", v: regAud, cls: "trunc" },
  { k: "resumo", t: "Resumo da alteração", v: resumoAud, cls: "trunc" },
  { k: "id_tec", t: "Código técnico", v: a => a.registro, cls: "mono trunc", oculta: true }
];
PAGES.config = async pg => {
  if (!pode.admin()) { pg.innerHTML = `<div class="card empty">Somente o administrador.</div>`; return; }
  let aba = S.f.cfg || "usuarios"; if (aba === "contas") aba = "usuarios";
  if (aba === "grupos") S.gruposCfg = await q(sb.from("grupos_locador").select("*").order("ordem").order("nome"));
  if (aba === "usuarios") S.membros = await q(sb.from("membros").select("*").order("criado_em"));
  if (aba === "auditoria") {
    const fa = S.f.aud || (S.f.aud = { dia: "", user: "", sec: "" });
    let qa = sb.from("auditoria").select("*").order("em", { ascending: false }).limit(fa.dia || fa.user || fa.sec ? 2000 : 500);
    if (fa.dia) { const d0 = new Date(fa.dia + "T00:00:00"); qa = qa.gte("em", d0.toISOString()).lt("em", new Date(d0.getTime() + 86400000).toISOString()); }
    if (fa.user) qa = qa.eq("usuario", fa.user);
    if (fa.sec) qa = qa.eq("tabela", fa.sec);
    [S.audit, S.membros] = await Promise.all([q(qa), q(sb.from("membros").select("*").order("criado_em"))]);
  }
  if (aba === "fechamento") S.cfgBloq = await q(sb.from("config").select("*").eq("chave", "bloqueado_ate").maybeSingle());
  setRd(pg, () => desenharConfig());
  desenharConfig(pg);
};
function desenharConfig(pg) {
  pg = pg || $("#page");
  let aba = S.f.cfg || "usuarios"; if (aba === "contas") aba = "usuarios";
  const abas = [["usuarios", "Usuários e contas"], ["categorias", "Plano de contas"], ["fechamento", "Fechamento"], ["auditoria", "Auditoria"]];
  let html = "";
  // ativas à esquerda, inativas à direita (cada tabela já é a situação)
  const ladoALado = (id, cols, lista, act, titAt, titInat) => {
    const at = lista.filter(x => x.ativa), inat = lista.filter(x => !x.ativa);
    const g1 = grade(id, cols, at, { attr: x => `data-act="${act}" data-id="${x.id}" style="cursor:pointer"` }); g1.redesenhar = () => desenharConfig();
    const g2 = grade(id + "-inat", cols, inat, { attr: x => `data-act="${act}" data-id="${x.id}" style="cursor:pointer"`, cls: () => "inativa", vazio: "Nenhuma." }); g2.redesenhar = () => desenharConfig();
    return `<div class="dois"><div><h3>${esc(titAt)} (${at.length})</h3>${gradeHTML(id)}</div><div><h3 style="color:var(--bad)">${esc(titInat)} (${inat.length})</h3>${gradeHTML(id + "-inat")}</div></div>`;
  };
  const ativasInativas = (id, cols, lista, act, tituloInat, dica) => {
    const at = lista.filter(x => x.ativa), inat = lista.filter(x => !x.ativa);
    const g1 = grade(id, cols, at, { attr: x => `data-act="${act}" data-id="${x.id}" style="cursor:pointer"` }); g1.redesenhar = () => desenharConfig();
    let h = gradeHTML(id);
    if (inat.length) { const g2 = grade(id + "-inat", cols, inat, { attr: x => `data-act="${act}" data-id="${x.id}" style="cursor:pointer"`, cls: () => "inativa" }); g2.redesenhar = () => desenharConfig();
      h += `<h3 style="margin-top:8px;color:var(--bad)">${esc(tituloInat)} (${inat.length})</h3><p class="hint">${esc(dica)}. Clique para reativar ou excluir.</p><div class="inativas">${gradeHTML(id + "-inat")}</div>`; }
    return h;
  };
  if (aba === "categorias") {
    const ft = S.f.catTipo || "", ehEnt = c => GRUPOS_TIPO.entrada.includes(c.grupo);
    const recRank = c => !c.recorrente ? 2 : c.periodicidade === "anual" ? 0 : 1;
    const ordem = c => `${ehEnt(c) ? 0 : 1}${recRank(c)}${c.nome}`;
    const lista = S.categorias.filter(c => c.grupo !== "transferencia" && (!ft || (ft === "entrada" ? ehEnt(c) : !ehEnt(c))));
    const cols = [{ k: "ord", t: "Ordem", oculta: true, v: ordem }].concat(COLS_CATS);
    const grupoTit = c => `${ehEnt(c) ? "Entradas" : "Saídas"} · ${["anuais", "mensais", "sem recorrência"][recRank(c)]}`;
    const at = lista.filter(x => x.ativa), inat = lista.filter(x => !x.ativa);
    const g1 = grade("categorias2", cols, at, { attr: x => `data-act="cat-ed" data-id="${x.id}" style="cursor:pointer"`, sort: { k: "ord", dir: "asc" }, divisor: { k: "ord", g: grupoTit } }); g1.redesenhar = () => desenharConfig();
    const g2 = grade("categorias2-inat", cols, inat, { attr: x => `data-act="cat-ed" data-id="${x.id}" style="cursor:pointer"`, cls: () => "inativa", vazio: "Nenhuma." }); g2.redesenhar = () => desenharConfig();
    html = `<div class="filters"><div class="fgrupo"><span>Tipo</span>${[["", "Todas"], ["entrada", "Entradas"], ["saida", "Saídas"]].map(([k, t]) => `<button class="chip${ft === k ? " on" : ""}" data-act="chip" data-k="catTipo" data-v="${k}">${t}</button>`).join("")}</div>
      <span class="hint">Ordem: anuais, mensais e depois sem recorrência. "Previsão": o Caixa lança como previsto (sem valor, não lança).</span><span class="spacer"></span>${gradeBarra("categorias2")}<button class="btn pri" data-act="cat-ed">+ Categoria</button></div>
      ${gradeHTML("categorias2")}${inat.length ? `<h3 style="margin-top:10px;color:var(--bad)">Inativas (${inat.length})</h3><div class="inativas">${gradeHTML("categorias2-inat")}</div>` : ""}`;
  } else if (aba === "grupos") {
    const g = grade("grupos", COLS_GRUPOS, S.gruposCfg || [], { attr: x => `data-act="grupo-ed" data-id="${esc(x.nome)}" style="cursor:pointer"` }); g.redesenhar = () => desenharConfig();
    html = `<div class="filters"><span class="hint">Como no Excel: cada grupo junta os <b>nomes de locadores</b> da mesma família ou empresa. O imóvel entra no grupo pelo nome do locador, sozinho. "Destaque" aparece separado nos gráficos (ex.: FB); "Principal locador" entra em "Principais locadores". Imóveis da imobiliária (IMOB) e do sócio (CF) são definidos pela <b>carteira</b> do imóvel.</span><span class="spacer"></span>${gradeBarra("grupos")}<button class="btn pri" data-act="grupo-ed">+ Grupo</button></div>${gradeHTML("grupos")}`;
  } else if (aba === "usuarios") {
    const g = grade("membros", COLS_MEMBROS, S.membros || [], { attr: m => `data-act="membro-ed" data-id="${m.id}" style="cursor:pointer"` }); g.redesenhar = () => desenharConfig();
    html = `<h2 class="cfg-t">Usuários</h2><div class="box">Para criar um usuário: no Supabase, <b>Authentication › Users › Add user</b> (e-mail + senha). Ele aparece aqui <b>inativo</b>; ative e escolha o papel. O cadastro público deve ficar <b>desligado</b>.</div>${gradeHTML("membros")}
      <h2 class="cfg-t" style="margin-top:18px">Contas</h2>
      <div class="filters"><span class="hint">Onde o dinheiro fica. O saldo inicial é o saldo real da conta na data informada (pegue no extrato). Use ↑ ↓ para mudar a ordem em que as contas aparecem no painel e nos formulários.</span><span class="spacer"></span><button class="btn pri" data-act="conta-ed">+ Conta</button></div>
      ${ladoALado("contas", COLS_CONTAS, S.contas, "conta-ed", "Contas ativas", "Contas inativas")}`;
  } else if (aba === "fechamento") {
    const b = S.cfgBloq && S.cfgBloq.valor;
    html = `<div class="card"><h2>Fechamento de mês</h2><p>Depois de conferir o caixa com o extrato, feche o mês: ninguém mais consegue criar, alterar ou apagar lançamentos com data até o fim desse mês (nem estornos).</p>
      <p>Situação atual: ${b ? `<b>fechado até ${dt(b)}</b>` : "<b>nenhum mês fechado</b>"}</p>
      <div class="filters"><button class="btn pri" data-act="fechar-ate" data-v="${fimMes(addMes(inicioMes(hoje()), -1))}">Fechar até ${esc(mesTxt(addMes(inicioMes(hoje()), -1)))}</button>
      ${b ? `<button class="btn danger" data-act="fechar-ate" data-v="">Reabrir tudo</button>` : ""}</div></div>`;
  } else if (aba === "auditoria") {
    const g = grade("auditoria6", COLS_AUD, (S.audit || []).map((a, k) => Object.assign({ _k: k }, a)), { attr: a => `data-act="audit-ver" data-k="${a._k}" style="cursor:pointer"`, sort: { k: "em", dir: "desc" }, divisor: { k: "em", g: a => new Date(a.em).toLocaleDateString("pt-BR") } }); g.redesenhar = () => desenharConfig();
    const fa = S.f.aud || {};
    html = `<div class="aud-f"><label>Dia<input type="date" data-aud="dia" value="${esc(fa.dia || "")}"></label>
      <label>Usuário<select data-aud="user">${opt("", "Todos", !fa.user)}${(S.membros || []).map(m => opt(m.id, m.nome || m.email, fa.user === m.id)).join("")}</select></label>
      <label>Seção<select data-aud="sec">${opt("", "Todas", !fa.sec)}${Object.entries(SECAO_AUD).sort((a, b) => a[1].localeCompare(b[1])).map(([k, t]) => opt(k, t, fa.sec === k)).join("")}</select></label>
      ${fa.dia || fa.user || fa.sec ? `<button class="btn" data-act="aud-limpar">Limpar filtros</button>` : ""}
      <span class="hint">${fa.dia || fa.user || fa.sec ? `${(S.audit || []).length} alterações encontradas.` : "Últimas 500 alterações."} Ninguém consegue apagar este registro; guarda os últimos 12 meses.</span><span class="spacer"></span>${gradeBarra("auditoria6")}</div>${gradeHTML("auditoria6")}`;
  }
  pg.innerHTML = `<div class="grid"><div class="chips">${abas.map(([k, t]) => `<button class="chip${aba === k ? " on" : ""}" data-act="cfg-aba" data-v="${k}">${t}</button>`).join("")}</div>${html}</div>`;
  $$("[data-aud]", pg).forEach(el => el.addEventListener("change", () => { S.f.aud = Object.assign({}, S.f.aud, { [el.dataset.aud]: el.value }); render(); }));
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
    <fieldset class="ficha-b"><legend>Previsão no Caixa (despesa / receita que se repete)</legend>
      <label class="chk"><input type="checkbox" name="recorrente" ${c.recorrente ? "checked" : ""}> Se repete: lançar como <b>previsto</b> no caixa</label>
      <div class="row" style="margin-top:8px"><label class="fl"><span>Quando</span><select name="per">${opt("mensal", "Todo mês", c.periodicidade !== "anual")}${opt("anual", "Uma vez por ano", c.periodicidade === "anual")}</select></label>
        <label class="fl" data-mesp><span>Mês (se anual)</span><select name="mes">${opt("", "—", !c.mes_previsto)}${MES3.map((m, i) => opt(i + 1, m, c.mes_previsto === i + 1)).join("")}</select></label></div>
      <div class="row" style="margin-top:8px"><label class="fl"><span>Dia previsto</span><input type="number" name="dia" min="1" max="31" value="${c.dia_previsto || ""}"></label>
      <label class="fl"><span>Valor previsto (média)</span><input name="valor" inputmode="decimal" value="${c.valor_previsto ? n2(c.valor_previsto) : ""}"></label>
      <label class="fl"><span>Conta</span><select name="conta">${opt("", "(primeira conta)", !c.conta_prevista)}${contasOpts(c.conta_prevista)}</select></label></div>
      <p class="hint">Na virada do mês, o Caixa avisa e lança essas previsões com um clique. Depois é só confirmar o dia e o valor exato de cada uma.</p></fieldset>
    <p class="hint">Uma categoria já usada não pode ser excluída: desmarque "Ativa" para escondê-la.</p>`,
    extra: c.id ? `<button type="button" class="btn danger left" data-del>Excluir</button>` : "",
    aoAbrir: (f, d) => { const b = $("[data-del]", d); if (b) b.addEventListener("click", () => { d.close(); excluirCadastro("categorias", c.id, c.nome, recarregarCategorias); }); },
    salvar: async f => {
      const d = { nome: f.nome.value.trim(), grupo: f.grupo.value, ativa: f.ativa.checked, recorrente: f.recorrente.checked, periodicidade: f.per.value, mes_previsto: +f.mes.value || null,
        dia_previsto: +f.dia.value || null, valor_previsto: parseMoney(f.valor.value), conta_prevista: f.conta.value || null };
      if (d.recorrente && (!d.dia_previsto || !d.valor_previsto)) throw new Error("Para lançar a previsão, informe o dia e o valor previsto.");
      if (d.recorrente && d.periodicidade === "anual" && !d.mes_previsto) throw new Error("Previsão anual: escolha o mês.");
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
  const todos = Array.from(new Set((S.locadores || []).map(l => l.nome).concat(S.imoveis.map(i => i.locador).filter(Boolean), g.locadores || []))).sort((a, b) => a.localeCompare(b, "pt-BR"));
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
  const perm = m.permissoes || PERM_PADRAO[m.papel] || {};
  modal({ titulo: m.email, largo: true, corpo: `
    <div class="row"><label class="fl"><span>Nome</span><input name="nome" value="${esc(m.nome)}" required></label>
    <label class="fl"><span>Papel (modelo de permissões)</span><select name="papel" ${eu ? "disabled" : ""}>${Object.entries(PAPEIS).map(([k, v]) => opt(k, v, m.papel === k)).join("")}</select></label></div>
    <label class="chk"><input type="checkbox" name="ativo" ${m.ativo ? "checked" : ""} ${eu ? "disabled" : ""}> Acesso liberado</label>
    <label class="chk"><input type="checkbox" name="mfa" ${m.exige_mfa ? "checked" : ""} ${eu ? "disabled" : ""}> Exigir código do aplicativo autenticador (recomendado)</label>
    <h3>Permissões por aba ${m.permissoes ? '<span class="tag warn">personalizadas</span>' : '<span class="tag idle">padrão do papel</span>'}</h3>
    <div data-perms>${tabelaPermissoes(perm, !eu && m.papel !== "admin")}</div>
    ${!eu && m.papel !== "admin" ? `<button type="button" class="btn sm" data-padrao>Voltar ao padrão do papel</button>` : ""}
    <div class="box"><b>Papel</b> define o que a pessoa pode fazer com dinheiro: Administrador — tudo · Financeiro — aluguéis, caixa e cadastros · Recepção — recebimentos e lançamentos só no caixa da recepção · Somente leitura — consulta. As abas acima escolhem o que ela vê e o que pode alterar.</div>
    ${eu ? `<p class="hint">Você não pode mudar o próprio papel, acesso ou permissões.</p>` : ""}`,
    aoAbrir: (f, d) => {
      let padrao = !m.permissoes;
      const marcar = () => { padrao = false; };
      $$("[data-perm],[data-flag]", d).forEach(x => x.addEventListener("change", marcar));
      f.papel.addEventListener("change", () => { $("[data-perms]", d).innerHTML = tabelaPermissoes(PERM_PADRAO[f.papel.value] || {}, f.papel.value !== "admin"); padrao = true; $$("[data-perm],[data-flag]", d).forEach(x => x.addEventListener("change", marcar)); });
      const bp = $("[data-padrao]", d); if (bp) bp.addEventListener("click", () => { $("[data-perms]", d).innerHTML = tabelaPermissoes(PERM_PADRAO[f.papel.value] || {}, true); padrao = true; $$("[data-perm],[data-flag]", d).forEach(x => x.addEventListener("change", marcar)); });
      d._padrao = () => padrao;
    },
    salvar: async f => {
      const d = { nome: f.nome.value.trim() };
      if (!eu) {
        const dlg = $("#dlg"), perm = {};
        $$("[data-perm]", dlg).forEach(x => { if (x.value) perm[x.dataset.perm] = x.value; });
        $$("[data-flag]", dlg).forEach(x => { if (x.checked) perm[x.dataset.flag] = true; });
        Object.assign(d, { papel: f.papel.value, ativo: f.ativo.checked, exige_mfa: f.mfa.checked, permissoes: dlg._padrao() || f.papel.value === "admin" ? null : perm });
      }
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
/* =====================================================================
   PÁGINA: CONTAS CAUÇÃO (Cadastro locação)
   O dinheiro da caução fica nas contas de poupança e NÃO passa pelo caixa.
   ===================================================================== */
const CAUC = { contas: [], movs: [], ctt: {} };
async function carregarCauc() {
  const [contas, movs, ctts] = await Promise.all([
    fetchAll("cauc_contas", b => b.order("numero", { ascending: true, nullsFirst: false })),
    fetchAll("cauc_mov", b => b.order("data_entrada", { ascending: false, nullsFirst: false })),
    fetchAll("contratos", b => b.order("codigo"), "codigo,situacao,locatario,locador,endereco,garantia,inicio,ficha")
  ]);
  CAUC.contas = contas; CAUC.movs = movs; CAUC.ctt = Object.fromEntries(ctts.map(c => [c.codigo, c]));
  CAUC.vig = {}; CAUC.somadas = {};
  movs.forEach(m => { if (m.data_saida) return; if (m.somada) (CAUC.somadas[m.conta_id] = CAUC.somadas[m.conta_id] || []).push(m); else CAUC.vig[m.conta_id] = m; });
  CAUC.vigPorCtt = {}; movs.forEach(m => { if (!m.data_saida && m.contrato_codigo) CAUC.vigPorCtt[m.contrato_codigo] = m; });
}
const contaCaucTxt = c => c ? `${c.banco || "Banco"} · Ag. ${c.agencia || "?"} · Conta ${c.conta || c.conta_antiga || "?"}${c.numero != null ? ` (nº ${c.numero})` : ""}` : "";
const ehCaucao = c => /CAU/i.test(norm((c && ((c.ficha && c.ficha.garantia) || c.garantia)) || ""));
// estado da conta: bloqueada / livre / ocupada / aguardando baixa (o locatário já saiu)
function estadoCauc(conta) {
  if (conta.bloqueada) return "bloq";
  const m = CAUC.vig[conta.id];
  if (!m) return "livre";
  const c = CAUC.ctt[m.contrato_codigo];
  return c && ["ENCERRADO", "DÉBITO EM ABERTO", "CANCELADO"].includes(c.situacao) ? "baixa" : "ocup";
}
const EST_CAUC = { livre: ["Livre", "ok"], ocup: ["Ocupada", "info"], baixa: ["Aguardando baixa", "bad"], bloq: ["Bloqueada", "idle"] };
const vigDe = c => CAUC.vig[c.id] || {};
const COLS_CAUC = [
  { k: "numero", t: "Nº", tipo: "num", v: c => c.numero, f: c => c.numero == null ? "" : String(c.numero), fixo: true },
  { k: "banco", t: "Banco", v: c => c.banco },
  { k: "agencia", t: "Ag.", v: c => c.agencia, cls: "mono" },
  { k: "conta", t: "Conta", v: c => c.conta, cls: "mono" },
  { k: "conta_antiga", t: "Conta antiga", v: c => c.conta_antiga, cls: "mono", oculta: true },
  { k: "estado", t: "Situação", v: c => EST_CAUC[estadoCauc(c)][0], html: c => { const e = EST_CAUC[estadoCauc(c)]; return `<span class="tag ${e[1]}">${e[0]}</span>`; } },
  { k: "ctt", t: "Contrato", v: c => vigDe(c).contrato_codigo || "", cls: "mono" },
  { k: "imovel", t: "Imóvel", v: c => vigDe(c).imovel || "", cls: "trunc" },
  { k: "locador", t: "Locador", v: c => vigDe(c).locador || "", cls: "trunc" },
  { k: "locatario", t: "Locatário", v: c => vigDe(c).locatario || "", cls: "trunc" },
  { k: "valor", t: "Caução", tipo: "num", v: c => vigDe(c).valor_entrada ?? null, f: c => vigDe(c).valor_entrada != null ? n2(vigDe(c).valor_entrada) : "" },
  { k: "entrada", t: "Entrada", tipo: "data", v: c => vigDe(c).data_entrada || null, f: c => dt(vigDe(c).data_entrada) },
  { k: "passagens", t: "Histórico", tipo: "num", int: true, cls: "centro", v: c => CAUC.movs.filter(m => m.conta_id === c.id && m.data_saida).length, dica: "Quantos locatários já passaram pela conta" },
  { k: "somadas", t: "Somadas", tipo: "num", int: true, cls: "centro", v: c => (CAUC.somadas[c.id] || []).length || null, dica: "Cauções de outros contratos somadas nesta conta" },
  { k: "obs", t: "Obs.", v: c => c.obs, cls: "trunc", oculta: true }
];
PAGES.caucao = async pg => {
  await carregarCauc();
  if (!CTT.length && pode.ver("contratos")) CTT = await fetchAll("contratos", b => b.order("codigo", { ascending: false }));
  setRd(pg, () => desenharCauc());
  desenharCauc(pg);
};
// contratos com caução (ativos ou em elaboração) que ainda não têm conta vinculada
const caucDireto = c => (c.ficha || {}).caucao_modo === "proprietario";
const caucSemConta = () => Object.values(CAUC.ctt).filter(c => ["ATIVO", "EM ELABORAÇÃO"].includes(c.situacao) && ehCaucao(c) && !CAUC.vigPorCtt[c.codigo] && !caucDireto(c));
function desenharCauc(pg) {
  pg = pg || $("#page");
  const f = S.f.cauc || "todas", busca = S.f.caucBusca || "";
  const cont = { todas: CAUC.contas.length, livre: 0, ocup: 0, baixa: 0, bloq: 0 };
  CAUC.contas.forEach(c => cont[estadoCauc(c)]++);
  let lista = CAUC.contas.filter(c => f === "todas" || estadoCauc(c) === f);
  if (busca) { const b = norm(busca); lista = lista.filter(c => norm([c.numero, c.banco, c.agencia, c.conta, c.conta_antiga, c.obs, ...CAUC.movs.filter(m => m.conta_id === c.id).map(m => [m.contrato_codigo, m.imovel, m.locador, m.locatario].join(" "))].join(" ")).includes(b)); }
  const g = grade("caucao", COLS_CAUC, lista, { attr: c => `data-act="cauc-ver" data-id="${c.id}" style="cursor:pointer"`, sort: { k: "numero", dir: "asc" }, rodape: fl => `${fl.length} contas · caução nas contas ocupadas: ${brl(fl.reduce((a, c) => a + (+vigDe(c).valor_entrada || 0), 0))}`,
    cls: c => ({ livre: "ct-ativo", baixa: "ct-deb", bloq: "ct-canc" })[estadoCauc(c)] || "" });
  g.redesenhar = () => desenharCauc();
  const semConta = caucSemConta(), termoPend = CAUC.movs.filter(m => m.data_saida && m.termo === "pendente");
  const chips = [["todas", "Todas", ""], ["livre", "Livres", "st-LVR"], ["ocup", "Ocupadas", "st-ALG"], ["baixa", "Aguardando baixa", "st-INTV"], ["bloq", "Bloqueadas", "st-CANC"]];
  pg.innerHTML = `<div class="grid">
    <div class="filters">
      <div class="chips">${chips.map(([k, t, cls]) => `<button class="chip ${cls}${f === k ? " on" : ""}" data-act="chip" data-k="cauc" data-v="${k}">${t}<span class="c">${cont[k]}</span></button>`).join("")}</div>
      <input type="search" placeholder="Buscar conta, contrato, imóvel, nomes…" value="${esc(busca)}" data-busca="caucBusca">
      <span class="spacer"></span>
      ${!CAUC.contas.length && pode.ed("caucao") ? avisoBtn("cauc-vazio", "Nenhuma conta: importe a planilha", "warn", "Contas caução", `<p>Use <b>Importar planilha</b> com o arquivo "Gerador de Contratos" (aba <b>Contas Caução</b>) para trazer as contas e o histórico.</p>`) : ""}
      ${cont.baixa ? `<button class="btn sm aviso danger" data-act="chip" data-k="cauc" data-v="baixa" title="O locatário já saiu: falta a devolução e o termo">⚠ ${cont.baixa} aguardando baixa</button>` : ""}
      ${termoPend.length ? avisoBtn("cauc-termos", `⚠ ${termoPend.length} termo(s)`, "danger", "Termo de devolução de caução pendente", listaBtns(termoPend.map(m => `<button class="btn sm" data-act="cauc-termo" data-id="${m.id}">💰 ${esc(m.contrato_codigo || "?")} · ${esc(curtoTxt(m.locatario, 40))}</button>`))) : ""}
      ${semConta.length ? avisoBtn("cauc-sem", `⚠ ${semConta.length} sem conta`, "warn", "Contratos com caução sem conta vinculada", listaBtns(semConta.map(c => `<button class="btn sm" data-act="cauc-vinc-ctt" data-id="${esc(c.codigo)}">${esc(c.codigo)} · ${esc(curtoTxt(c.locatario, 40))}</button>`))) : ""}
      ${(() => { const dir = Object.values(CAUC.ctt).filter(caucDireto), atv = c => c.situacao === "ATIVO", nA = dir.filter(atv).length; return dir.length ? avisoBtn("cauc-dir", `${dir.length} pagas ao proprietário (${nA} ativas)`, "", "Cauções pagas direto ao proprietário",
        `<p class="hint">Todas as cauções pagas direto ao proprietário, inclusive de contratos encerrados. Em destaque, os contratos <b>ativos</b>.</p><div class="tw"><table class="compacta"><thead><tr><th>Contrato</th><th>Situação</th><th>Locatário</th><th>Locador</th><th>Imóvel</th><th class="num">Caução</th></tr></thead><tbody>${dir.sort((a, b) => (atv(b) - atv(a)) || COLL.compare(b.codigo, a.codigo)).map(c => `<tr class="${atv(c) ? "ct-ativo" : "muted"}" ${atv(c) ? 'style="font-weight:600"' : ""}><td class="mono">${esc(c.codigo)}</td><td><span class="tag ${SIT_CTT[c.situacao] || "idle"}">${esc(c.situacao)}</span></td><td>${esc(c.locatario || "")}</td><td>${esc(c.locador || "")}</td><td>${esc(c.endereco || "")}</td><td class="num">${esc((c.ficha || {}).caucao_valor || "")}</td></tr>`).join("")}</tbody></table></div>`) : ""; })()}
      ${gradeBarra("caucao")}
      ${pode.ed("caucao") ? `<button class="btn" data-act="cauc-nova">+ Conta</button>` : ""}
    </div>
    ${gradeHTML("caucao")}</div>`;
  ligarBusca(pg);
}
ACT["xls-cauc"] = () => exportarGrade("caucao", `contas-caucao-${hoje()}.xlsx`, "Contas caução");
function histCaucHTML(conta) {
  const ms = CAUC.movs.filter(m => m.conta_id === conta.id).sort((a, b) => (b.data_entrada || "").localeCompare(a.data_entrada || ""));
  if (!ms.length) return `<p class="hint">Nenhum locatário passou por esta conta ainda.</p>`;
  return `<div class="tw"><table class="compacta cx-hist"><thead><tr><th>Contrato</th><th>Imóvel</th><th>Locador</th><th>Locatário</th><th class="num">Entrada</th><th>Data E</th><th class="num">Saída</th><th>Data S</th><th>Termo de devolução</th></tr></thead><tbody>
    ${ms.map(m => `<tr${m.data_saida ? "" : ' class="ct-ativo"'}><td class="mono">${esc(m.contrato_codigo || "—")}${m.somada ? ' <span class="tag info" title="Caução somada nesta conta (a conta já tinha outra caução)">somada</span>' : ""}</td><td class="trunc">${esc(m.imovel)}</td><td class="trunc">${esc(m.locador)}</td><td class="trunc">${esc(m.locatario)}</td>
      <td class="num">${m.valor_entrada != null ? n2(m.valor_entrada) : ""}</td><td>${dt(m.data_entrada)}</td><td class="num">${m.valor_saida != null ? n2(m.valor_saida) : ""}</td><td>${m.data_saida ? dt(m.data_saida) : "<b>vigente</b>"}</td>
      <td>${m.data_saida ? (m.termo === "pendente" ? `<span class="tag bad">pendente</span>` : esc(m.termo || "—")) : ""}</td></tr>`).join("")}
    </tbody></table></div>`;
}
ACT["cauc-ver"] = el => {
  const c = CAUC.contas.find(x => x.id === el.dataset.id); if (!c) return;
  const ed = pode.ed("caucao"), dis = ed ? "" : "disabled", est = estadoCauc(c), m = CAUC.vig[c.id];
  const vigs = [m].concat(CAUC.somadas[c.id] || []).filter(Boolean);
  const acoes = !ed ? "" : (vigs.map(v => `<button type="button" class="btn pri" data-baixa="${v.id}">Dar baixa: ${esc(v.contrato_codigo || v.locatario.split(" ")[0])}</button>`).join("") + (!m && !c.bloqueada ? `<button type="button" class="btn pri" data-vinc>Vincular contrato</button>` : m ? `<button type="button" class="btn" data-somar title="Outro contrato do mesmo locatário que somou a caução nesta conta">+ Somar outra caução</button>` : ""));
  modal({ titulo: `Conta caução nº ${c.numero ?? "—"}`, xl: true, semOk: !ed, ok: "Salvar conta",
    corpo: `<div class="row">
        <label class="fl"><span>Nº (referência)</span><input name="numero" type="number" value="${c.numero ?? ""}" ${dis}></label>
        <label class="fl"><span>Banco</span><input name="banco" value="${esc(c.banco)}" ${dis}></label>
        <label class="fl"><span>Agência</span><input name="agencia" value="${esc(c.agencia)}" ${dis}></label>
        <label class="fl"><span>Conta atual</span><input name="conta" value="${esc(c.conta)}" ${dis}></label>
        <label class="fl"><span>Conta antiga</span><input name="conta_antiga" value="${esc(c.conta_antiga)}" ${dis}></label></div>
      <label class="chk"><input type="checkbox" name="bloqueada" ${c.bloqueada ? "checked" : ""} ${dis} ${m ? "disabled title=\"Com locatário vigente não dá para bloquear\"" : ""}> Conta bloqueada (não recebe novas cauções)</label>
      <label class="fl"><span>Observações</span><textarea name="obs" rows="2" ${dis}>${esc(c.obs)}</textarea></label>
      <div class="box ${est === "baixa" ? "bad" : ""}"><b>Situação: ${EST_CAUC[est][0]}</b>${m ? ` — contrato <b>${esc(m.contrato_codigo || "?")}</b> · ${esc(m.locatario)} · caução ${brl(m.valor_entrada)} desde ${dt(m.data_entrada)}${est === "baixa" ? `<br>O contrato está <b>${esc(CAUC.ctt[m.contrato_codigo].situacao)}</b>: faça a baixa e o termo de devolução.` : ""}` : ""}</div>
      <h3 style="margin-top:12px">Histórico de quem passou pela conta</h3>${histCaucHTML(c)}`,
    extra: acoes + (pode.admin() && !CAUC.movs.some(x => x.conta_id === c.id) ? `<span class="spacer"></span><button type="button" class="btn danger" data-del>Excluir</button>` : ""),
    aoAbrir: (f, d) => {
      $$("[data-baixa]", d).forEach(b1 => b1.addEventListener("click", () => { const mv = vigs.find(v => v.id === b1.dataset.baixa); d.close(); setTimeout(() => darBaixaCauc(mv), 0); }));
      const bs = $("[data-somar]", d); if (bs) bs.addEventListener("click", () => { d.close(); setTimeout(() => vincularCauc(c, "", true), 0); });
      const b2 = $("[data-vinc]", d); if (b2) b2.addEventListener("click", () => { d.close(); setTimeout(() => vincularCauc(c, ""), 0); });
      const b3 = $("[data-del]", d); if (b3) b3.addEventListener("click", async () => { d.close(); if (!(await confirmar("Excluir conta", `Excluir a conta caução nº ${esc(c.numero ?? "")}?`, "Excluir"))) return; try { await q(sb.from("cauc_contas").delete().eq("id", c.id)); toast("Excluída."); render(); } catch (e) { falha(e); } });
    },
    salvar: async f => {
      const n = f.numero.value === "" ? null : +f.numero.value;
      await q(sb.from("cauc_contas").update({ numero: n, banco: f.banco.value.trim(), agencia: f.agencia.value.trim(), conta: f.conta.value.trim(), conta_antiga: f.conta_antiga.value.trim(), bloqueada: f.bloqueada.checked, obs: f.obs.value }).eq("id", c.id));
      toast("Conta salva."); render();
    }
  });
};
ACT["cauc-nova"] = () => modal({ titulo: "Nova conta caução", ok: "Cadastrar",
  corpo: `<div class="row"><label class="fl"><span>Nº (referência)</span><input name="numero" type="number" value="${Math.max(0, ...CAUC.contas.map(c => c.numero || 0)) + 1}"></label>
    <label class="fl"><span>Banco</span><input name="banco" value="Brasil"></label><label class="fl"><span>Agência</span><input name="agencia" value="${esc((CAUC.contas[0] || {}).agencia || "")}"></label>
    <label class="fl"><span>Conta</span><input name="conta" required></label></div>`,
  salvar: async f => { await q(sb.from("cauc_contas").insert({ numero: f.numero.value === "" ? null : +f.numero.value, banco: f.banco.value.trim(), agencia: f.agencia.value.trim(), conta: f.conta.value.trim() })); toast("Conta cadastrada."); render(); } });

// vincular: conta livre + contrato com caução (ativo ou em elaboração)
async function gravarVinculoCauc(conta, ctt, valor, data, somada) {
  if (CAUC.vig[conta.id] && !somada) throw new Error("Esta conta já tem um locatário vigente.");
  if (conta.bloqueada) throw new Error("Conta bloqueada.");
  if (CAUC.vigPorCtt[ctt.codigo]) throw new Error(`O contrato ${ctt.codigo} já está vinculado a outra conta caução.`);
  const fx = ctt.ficha || {};
  await q(sb.from("cauc_mov").insert({ conta_id: conta.id, contrato_codigo: ctt.codigo, imovel: ctt.endereco || fx.end_rua || "", locador: ctt.locador || "", locatario: ctt.locatario || "", valor_entrada: valor, data_entrada: data || null, somada: !!(somada && CAUC.vig[conta.id]) }));
  // a ficha do contrato passa a mostrar a conta (texto usado nos documentos)
  if (ctt.ficha && Object.keys(ctt.ficha).length && pode.ed("contratos")) {
    try { await q(sb.from("contratos").update({ ficha: Object.assign({}, ctt.ficha, { caucao_conta: contaCaucTxt(conta), situacao: ctt.situacao }) }).eq("codigo", ctt.codigo)); } catch (e) { console.warn(e); }
  }
}
async function vincularCauc(conta, codigo, somar) {
  if (!CAUC.contas.length) await carregarCauc();
  const livres = CAUC.contas.filter(c => estadoCauc(c) === "livre"), ocupadas = CAUC.contas.filter(c => ["ocup", "baixa"].includes(estadoCauc(c)));
  const cands = Object.values(CAUC.ctt).filter(c => ["ATIVO", "EM ELABORAÇÃO"].includes(c.situacao) && !CAUC.vigPorCtt[c.codigo]).sort((a, b) => (ehCaucao(b) - ehCaucao(a)) || COLL.compare(b.codigo, a.codigo));
  const ocupTxt = c => { const v = CAUC.vig[c.id]; return contaCaucTxt(c) + (v ? " — hoje: " + v.locatario : ""); };
  modal({ titulo: somar ? "Somar outra caução nesta conta" : "Vincular caução a uma conta", ok: "Gravar", largo: true,
    corpo: `<label class="fl"><span>Contrato</span><select name="ctt" required>${opt("", "Escolha…", !codigo)}${cands.map(c => opt(c.codigo, `${c.codigo} · ${c.locatario || "?"} · ${c.endereco || ""}${ehCaucao(c) ? "" : " (garantia: " + (c.garantia || "?") + ")"}`, c.codigo === codigo)).join("")}</select></label>
      <label class="fl"><span>Onde está a caução</span><select name="conta" required>
        ${conta ? opt(conta.id, somar ? ocupTxt(conta) : contaCaucTxt(conta), true) : opt("", "Escolha…", true) +
          `<optgroup label="Conta caução livre">${livres.map(c => opt(c.id, contaCaucTxt(c), false)).join("")}</optgroup>` +
          `<optgroup label="Somada a uma conta já ocupada (mesmo locatário)">${ocupadas.map(c => opt("s:" + c.id, ocupTxt(c), false)).join("")}</optgroup>` +
          `<optgroup label="Sem conta">${opt("direto", "Paga direto ao proprietário (não fica com a imobiliária)", false)}</optgroup>`}</select></label>
      <div class="row" data-vals><label class="fl"><span>Valor da caução</span><input name="valor" inputmode="decimal"></label><label class="fl"><span>Data do depósito</span><input type="date" name="data"></label></div>
      <p class="hint">A caução vai direto para a poupança: não entra no caixa da imobiliária. "Somada": quando o locatário já tinha caução numa conta e a nova foi depositada junto (cada contrato tem sua própria baixa).</p>`,
    aoAbrir: (f, d) => {
      mascaraMoeda(f.valor);
      const pre = () => { const c = CAUC.ctt[f.ctt.value]; if (!c) return; const fx = c.ficha || {}; const v = parseMoney(fx.caucao_valor); if (v) f.valor.value = moedaFmt(v); if (c.inicio) f.data.value = c.inicio; };
      const vis = () => { $("[data-vals]", d).hidden = f.conta.value === "direto"; };
      f.ctt.addEventListener("change", pre); f.conta.addEventListener("change", vis); pre(); vis();
    },
    salvar: async f => {
      const cc = CAUC.ctt[f.ctt.value]; if (!cc) throw new Error("Escolha o contrato.");
      if (f.conta.value === "direto") {
        if (!pode.ed("contratos")) throw new Error("Sem permissão para alterar o contrato.");
        const ficha = Object.assign({}, cc.ficha && Object.keys(cc.ficha).length ? cc.ficha : fichaDe(cc), { caucao_modo: "proprietario", caucao_conta: "Paga diretamente ao proprietário", situacao: cc.situacao });
        await q(sb.from("contratos").update({ ficha }).eq("codigo", cc.codigo));
        toast(`Contrato ${cc.codigo}: caução paga direto ao proprietário.`); render(); return;
      }
      const somada = somar || f.conta.value.startsWith("s:"), id = f.conta.value.replace(/^s:/, "");
      const ct = CAUC.contas.find(c => c.id === id), v = parseMoney(f.valor.value);
      if (!ct) throw new Error("Escolha onde está a caução.");
      if (!(v > 0)) throw new Error("Informe o valor da caução.");
      await gravarVinculoCauc(ct, cc, v, f.data.value, somada);
      toast(`Caução do contrato ${cc.codigo} ${somada ? "somada à" : "vinculada à"} conta nº ${ct.numero ?? ""}.`); render();
    } });
}
ACT["cauc-vinc-ctt"] = el => vincularCauc(null, el.dataset.id);

// baixa: devolução da caução + termo de devolução (obrigatório, ou dispensa com motivo)
function darBaixaCauc(m) {
  const c = CAUC.ctt[m.contrato_codigo] || {};
  modal({ titulo: "Baixa da caução (devolução)", largo: true, ok: "Registrar baixa",
    corpo: `<div class="box"><b>Contrato ${esc(m.contrato_codigo || "?")}</b> · ${esc(m.imovel)}<br>Locatário: <b>${esc(m.locatario)}</b> · Locador: ${esc(m.locador)}<br>Caução: <b>${brl(m.valor_entrada)}</b> em ${dt(m.data_entrada)}${c.situacao ? ` · contrato <b>${esc(c.situacao)}</b>` : ""}</div>
      <div class="row"><label class="fl"><span>Valor devolvido (com rendimento, ou descontado)</span><input name="valor" inputmode="decimal" required></label>
        <label class="fl"><span>Data da devolução</span><input type="date" name="data" value="${hoje()}" required></label></div>
      <label class="fl"><span>Observações (descontos, combinado…)</span><input name="obs" value="${esc(m.obs)}"></label>
      <div class="obrig" data-obrig><b>💰 Termo de devolução de caução: OBRIGATÓRIO.</b> Ao registrar a baixa, o termo abre já preenchido; ele só conta como feito quando o PDF for gerado/baixado.
        <label class="chk" style="margin-top:6px"><input type="checkbox" name="semtermo"> Neste caso específico o termo <b>não é necessário</b></label>
        <label class="fl" data-motivo hidden><span>Motivo (fica registrado)</span><input name="motivo"></label></div>
      <p class="hint">A devolução sai da poupança da caução: não passa pelo caixa. Depois da baixa a conta fica <b>livre</b> para outra locação.</p>`,
    aoAbrir: (f, d) => {
      f.valor.value = m.valor_entrada != null ? n2(m.valor_entrada) : ""; mascaraMoeda(f.valor);
      f.semtermo.addEventListener("change", () => { $("[data-motivo]", d).hidden = !f.semtermo.checked; $("[data-obrig]", d).classList.toggle("ok", f.semtermo.checked); });
    },
    salvar: async f => {
      const v = parseMoney(f.valor.value), sem = f.semtermo.checked, mot = f.motivo.value.trim();
      if (v == null || v < 0) throw new Error("Informe o valor devolvido.");
      if (sem && mot.length < 5) throw new Error("Explique por que o termo de devolução não é necessário.");
      if (!pedeConfirmacao(f, `<b>Confirma a baixa?</b> Devolução de <b>${brl(v)}</b> a ${esc(m.locatario)} em <b>${dt(f.data.value)}</b>. ${sem ? `Termo <b>DISPENSADO</b>: “${esc(mot)}”.` : "Em seguida abre o <b>termo de devolução</b>."}${c.situacao === "ATIVO" ? `<br>⚠️ Atenção: o contrato ainda está <b>ATIVO</b> (a saída do locatário não foi registrada em Imóveis).` : ""}`, "Sim, registrar a baixa")) return false;
      await q(sb.from("cauc_mov").update({ valor_saida: v, data_saida: f.data.value, obs: f.obs.value, termo: sem ? "dispensado: " + mot : "pendente" }).eq("id", m.id));
      if (m.contrato_codigo) try { await rpc("marcar_termo", { p_codigo: m.contrato_codigo, p_tipo: "caucao", p_estado: sem ? "dispensado" : "pendente", p_motivo: mot }); } catch (e) { console.warn(e); }
      toast("Baixa registrada: a conta está livre."); render();
      if (!sem) setTimeout(() => abrirTermoCauc(m.id, m.contrato_codigo), 300);
    } });
}
function abrirTermoCauc(movId, codigo) {
  abrirTermo("caucao", codigo || "", "", { aoBaixar: async () => {
    try { await q(sb.from("cauc_mov").update({ termo: "feito " + new Date().toLocaleDateString("pt-BR") }).eq("id", movId));
      if (codigo) await rpc("marcar_termo", { p_codigo: codigo, p_tipo: "caucao", p_estado: "feito", p_motivo: "" }).catch(() => null);
      toast("Termo de devolução registrado como feito."); $("#dlg").dataset.mudou = "1"; }
    catch (e) { falha(e); }
  } });
}
ACT["cauc-termo"] = el => { const m = CAUC.movs.find(x => x.id === el.dataset.id); if (m) abrirTermoCauc(m.id, m.contrato_codigo); };

// ---- importação da aba "Contas Caução" do Gerador de Contratos (.xlsm) ----
// Colunas: A banco, B ag., C nº, D conta antiga, E conta atual; vigente F..N (Ctt, Imv, LCD, LCT, valor, dia, mês, ano, data);
// depois 7 blocos "locatário anterior" de 14 colunas (Ctt, Imv, Lcd, Lct, valor E, dia/mês/ano/data E, valor S, dia/mês/ano/data S).
function lerAbaCaucao(rows) {
  const vz = v => { const s = String(v == null ? "" : v).trim(); return !s || /^-+$/.test(s) ? "" : s; };
  const cod = v => { if (typeof v === "number") v = v.toFixed(3); const s = vz(v).replace(/^L\.?/i, ""); return /^\d{2}\.\d{3}$/.test(s) ? "L." + s : ""; };
  const num = v => { if (typeof v === "number") return v; const n = parseMoney(vz(v)); return n == null ? null : n; };
  const data = (d, m, a, txt) => {
    const D = +d, M = +m, A = +a;
    if (D && M && A) return `${A < 100 ? 2000 + A : A}-${pad(M)}-${pad(D)}`;
    if (txt instanceof Date && !isNaN(txt)) return iso(txt);
    const t = vz(txt); if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
    return dataDeTexto(t) || null;
  };
  const contas = [];
  rows.slice(4).forEach(r => {
    const numero = typeof r[2] === "number" ? r[2] : parseInt(vz(r[2]), 10);
    if (!numero && numero !== 0) return;
    const c = { numero, banco: vz(r[0]), agencia: vz(r[1]), conta_antiga: vz(r[3]), conta: vz(r[4]), bloqueada: /BLOQUEAD/i.test(String(r[8] || "") + String(r[6] || "")), movs: [] };
    const bloco = (b, saida) => {
      const m = { contrato_codigo: cod(r[b]), imovel: vz(r[b + 1]), locador: vz(r[b + 2]), locatario: vz(r[b + 3]), valor_entrada: num(r[b + 4]), data_entrada: data(r[b + 5], r[b + 6], r[b + 7], r[b + 8]) };
      if (saida) Object.assign(m, { valor_saida: num(r[b + 9]), data_saida: data(r[b + 10], r[b + 11], r[b + 12], r[b + 13]) });
      if (/BLOQUEAD/i.test(m.locatario)) return;
      if (!m.locatario && !m.contrato_codigo && !m.imovel) return;
      if (saida && !m.data_saida) m.data_saida = m.data_entrada || "1900-01-01"; // anterior sem data de saída
      c.movs.push(m);
    };
    for (let n = 7; n >= 1; n--) bloco(14 + 14 * (n - 1), true);
    bloco(5, false);
    contas.push(c);
  });
  return contas;
}
ACT["cauc-importar"] = () => {
  let lidas = null;
  modal({ titulo: "Importar contas caução", xl: true, ok: "Importar",
    corpo: `<p>Escolha o arquivo <b>Gerador de Contratos – OFICIAL</b> (.xlsm). O sistema lê a aba <b>Contas Caução</b>: as contas (banco, agência, conta), o locatário vigente e os anteriores (entrada e saída). Pode importar de novo: o que já existe não é duplicado.</p>
      <input type="file" data-arq accept=".xlsx,.xlsm"><div data-res></div>`,
    aoAbrir: (f, d) => {
      $("[data-arq]", d).addEventListener("change", async e => {
        const arq = e.target.files[0], res = $("[data-res]", d); if (!arq) return;
        res.innerHTML = `<p class="hint">Lendo…</p>`;
        try {
          await carregarXLSX();
          const wb = XLSX.read(await arq.arrayBuffer(), { type: "array", cellDates: true, sheets: ["Contas Caução"] });
          const ws = wb.Sheets["Contas Caução"]; if (!ws) throw new Error('A aba "Contas Caução" não foi encontrada neste arquivo.');
          lidas = lerAbaCaucao(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }));
          const vig = lidas.filter(c => c.movs.some(m => !m.data_saida)).length, ant = lidas.reduce((a, c) => a + c.movs.filter(m => m.data_saida).length, 0);
          res.innerHTML = `<div class="box"><b>${lidas.length}</b> contas · <b>${vig}</b> com locatário vigente · <b>${lidas.filter(c => c.bloqueada).length}</b> bloqueadas · <b>${ant}</b> locatários anteriores no histórico.</div>
            <div class="tw" style="max-height:340px"><table class="compacta"><thead><tr><th>Nº</th><th>Conta</th><th>Vigente</th><th class="num">Caução</th><th>Entrada</th><th>Anteriores</th></tr></thead><tbody>
            ${lidas.map(c => { const v = c.movs.find(m => !m.data_saida); return `<tr><td>${c.numero}</td><td>${esc(c.banco)} ${esc(c.agencia)} · ${esc(c.conta)}</td><td>${c.bloqueada ? "<i>bloqueada</i>" : v ? esc((v.contrato_codigo ? v.contrato_codigo + " · " : "") + v.locatario) : "<i>livre</i>"}</td><td class="num">${v && v.valor_entrada != null ? n2(v.valor_entrada) : ""}</td><td>${v ? dt(v.data_entrada) : ""}</td><td>${c.movs.filter(m => m.data_saida).length}</td></tr>`; }).join("")}
            </tbody></table></div>`;
        } catch (err) { res.innerHTML = `<p class="err">${esc(erroMsg(err))}</p>`; lidas = null; }
      });
    },
    salvar: async f => {
      if (!lidas) throw new Error("Escolha o arquivo primeiro.");
      await carregarCauc();
      const porNum = new Map(CAUC.contas.map(c => [c.numero, c]));
      let novas = 0, movsN = 0, ligados = 0, avisos = [];
      // vigente sem nº de contrato na planilha: tenta achar o contrato pelo locatário ou pelo endereço
      const so = t => norm(t).replace(/[^a-z0-9]/g, "");
      const ctts = Object.values(CAUC.ctt).filter(c => ["ATIVO", "EM ELABORAÇÃO", "DÉBITO EM ABERTO"].includes(c.situacao));
      lidas.forEach(c => c.movs.forEach(m => {
        if (m.data_saida || (m.contrato_codigo && CAUC.ctt[m.contrato_codigo])) return;
        const p1 = t => so(String(t || "").split(" - ")[0].replace(/\(.*?\)/g, ""));
        const lt = p1(m.locatario), ed = so(m.imovel);
        const cand = ctts.filter(x => (lt.length > 6 && p1(x.locatario) === lt) || (ed.length > 8 && so(x.endereco) === ed));
        if (cand.length === 1 && !CAUC.vigPorCtt[cand[0].codigo]) { m.contrato_codigo = cand[0].codigo; ligados++; }
      }));
      for (const c of lidas) {
        let ex = porNum.get(c.numero);
        const dados = { numero: c.numero, banco: c.banco, agencia: c.agencia, conta: c.conta, conta_antiga: c.conta_antiga, bloqueada: c.bloqueada };
        if (ex) await q(sb.from("cauc_contas").update(dados).eq("id", ex.id));
        else { ex = await q(sb.from("cauc_contas").insert(dados).select().single()); novas++; }
        const jaTem = CAUC.movs.filter(m => m.conta_id === ex.id);
        const chave = m => [norm(m.locatario).trim(), m.data_entrada || ""].join("|");
        const vistos = new Map(jaTem.map(m => [chave(m), m]));
        for (const m of c.movs) { const e = vistos.get(chave(m)); if (e && !e.contrato_codigo && m.contrato_codigo) await q(sb.from("cauc_mov").update({ contrato_codigo: m.contrato_codigo }).eq("id", e.id)); }
        const novosMovs = c.movs.filter(m => !vistos.has(chave(m))).map(m => Object.assign({ conta_id: ex.id }, m));
        const temVig = jaTem.some(m => !m.data_saida);
        const ins = novosMovs.filter(m => m.data_saida || !temVig);
        if (novosMovs.length > ins.length) avisos.push(`conta ${c.numero}: já tem locatário vigente diferente no sistema`);
        if (ins.length) { await q(sb.from("cauc_mov").insert(ins)); movsN += ins.length; }
      }
      toast(`Importado: ${novas} contas novas, ${movsN} registros de histórico${ligados ? `, ${ligados} ligados ao contrato pelo nome/endereço` : ""}.${avisos.length ? " Atenção: " + avisos.join("; ") : ""}`, !!avisos.length);
      render();
    } });
};

/* =====================================================================
   PÁGINA: TAREFAS (diárias, semanais, mensais e avulsas, com responsável)
   ===================================================================== */
let TAR = { ls: [], membros: [] };
const FREQ_TAR = { unica: "Avulsa", diaria: "Todo dia", semanal: "Toda semana", mensal: "Todo mês" };
const DIAS_SEM = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const PRIO_TAR = { alta: ["Alta", "bad"], normal: ["Média", "warn"], baixa: ["Baixa", "idle"] };
const inicioSemana = () => { const d = new Date(hoje() + "T12:00:00"); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return iso(d); };
// feita no período atual (hoje / nesta semana / neste mês)?
function tarefaFeita(t) {
  if (t.frequencia === "unica") return t.status === "feito";
  const u = t.ultima_conclusao || "";
  if (t.frequencia === "diaria") return u === hoje();
  if (t.frequencia === "semanal") return u >= inicioSemana();
  return u >= inicioMes(hoje());
}
// pendente para hoje (as semanais a partir do dia marcado, as mensais a partir do dia do mês)
function tarefaPendente(t) {
  if (!t.ativa || tarefaFeita(t)) return false;
  const d = new Date(hoje() + "T12:00:00");
  if (t.frequencia === "semanal" && t.dia_semana != null) return ((d.getDay() + 6) % 7) >= ((t.dia_semana + 6) % 7);
  if (t.frequencia === "mensal" && t.regra === "ultima") return hoje() >= ultimoDiaSemMes(t.dia_semana ?? 5);
  if (t.frequencia === "mensal" && t.dia_mes) return d.getDate() >= t.dia_mes;
  if (t.frequencia === "unica" && t.prazo) return true;
  return true;
}
// última <dia da semana> do mês atual (ex.: última sexta-feira)
function ultimoDiaSemMes(ds, mais) { const h = new Date(hoje() + "T12:00:00"), d = new Date(h.getFullYear(), h.getMonth() + 1 + (mais || 0), 0, 12); while (d.getDay() !== ds) d.setDate(d.getDate() - 1); return iso(d); }
// data da tarefa: prazo (avulsa) ou a próxima vez que ela deve ser feita (repetidas)
function dataTarefa(t) {
  const h = new Date(hoje() + "T12:00:00"), feita = tarefaFeita(t);
  if (t.frequencia === "unica") return t.prazo || null;
  if (t.frequencia === "diaria") { if (feita) h.setDate(h.getDate() + 1); return iso(h); }
  if (t.frequencia === "semanal") { const d = new Date(inicioSemana() + "T12:00:00"); d.setDate(d.getDate() + ((((t.dia_semana ?? 1) + 6) % 7))); if (feita) d.setDate(d.getDate() + 7); return iso(d); }
  if (t.regra === "ultima") return ultimoDiaSemMes(t.dia_semana ?? 5, feita ? 1 : 0);
  const m = new Date(h.getFullYear(), h.getMonth() + (feita ? 1 : 0), 1, 12), ult = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  m.setDate(Math.min(t.dia_mes || 1, ult)); return iso(m);
}
const quandoTar = t => t.frequencia === "semanal" ? `Toda ${DIAS_SEM[t.dia_semana ?? 1]}` : t.frequencia === "mensal" && t.regra === "ultima" ? `Última ${DIAS_SEM[t.dia_semana ?? 5]} do mês (${dt(ultimoDiaSemMes(t.dia_semana ?? 5)).slice(0, 5)})` : t.frequencia === "mensal" ? `Todo dia ${t.dia_mes || 1}` : t.frequencia === "diaria" ? "Todo dia" : t.prazo ? `Até ${dt(t.prazo)}` : "Avulsa";
const nomeMembro = id => (TAR.membros.find(m => m.id === id) || {}).nome || "";
const COLS_TAR = [
  { k: "data", t: "Data", tipo: "data", w: 150, v: dataTarefa, html: t => { const d = dataTarefa(t); if (!d) return `<span class="muted">sem data</span>`;
      const feita = tarefaFeita(t) && t.frequencia === "unica", dias = diasEntre(hoje(), d), cls = feita ? "ok" : dias < 0 ? "atr" : dias <= 7 ? "prox" : "folga";
      const txt = feita ? "feita" : dias < 0 ? `Atrasado ${-dias} dia${dias === -1 ? "" : "s"}` : dias === 0 ? "Hoje" : `Em ${dias} dia${dias === 1 ? "" : "s"}`;
      return `<span class="tar-dt ${cls}"><b>${d.slice(8, 10)}</b><small>${MESES[+d.slice(5, 7) - 1].slice(0, 3).toUpperCase()}</small></span><span class="tar-dtx ${cls}">${txt}</span>`; } },
  { k: "situacao", t: "Situação", v: t => tarefaFeita(t) ? "Feito" : t.status === "fazendo" ? "Fazendo" : "A fazer",
    html: t => { const atual = tarefaFeita(t) ? "feito" : t.status === "fazendo" ? "fazendo" : "a_fazer", ed = pode.ed("tarefas");
      return `<span class="tar-pills">${[["a_fazer", "A fazer"], ["fazendo", "Fazendo"], ["feito", "Feito"]].map(([k, x]) => `<button type="button" class="tar-pill p-${k}${atual === k ? " on" : ""}" ${ed ? `data-act="tar-st" data-id="${t.id}" data-v="${k}"` : "disabled"}>${x}</button>`).join("")}</span>`; } },
  { k: "prioridade", t: "Prioridade", v: t => PRIO_TAR[t.prioridade][0], html: t => `<span class="tag ${PRIO_TAR[t.prioridade][1]}">${PRIO_TAR[t.prioridade][0]}</span>` },
  { k: "titulo", t: "Tarefa", cls: "trunc", html: t => `<b>${esc(t.titulo)}</b>${t.descricao ? `<span class="sub">${esc(curtoTxt(t.descricao, 90))}</span>` : ""}` },
  { k: "resp", t: "Responsável", v: t => nomeMembro(t.responsavel) || "(todos)" },
  { k: "ultima", t: "Última vez", tipo: "data", v: t => t.ultima_conclusao, f: t => t.ultima_conclusao ? dt(t.ultima_conclusao) + (t.concluida_por ? " · " + nomeMembro(t.concluida_por) : "") : "" },
  { k: "quando", t: "Quando", v: quandoTar }
];
PAGES.tarefas = async pg => {
  const [ls, membros] = await Promise.all([q(sb.from("tarefas").select("*").order("ordem").order("titulo")), rpc("lista_membros").catch(() => [])]);
  TAR = { ls, membros: membros || [] };
  setRd(pg, () => desenharTarefas());
  desenharTarefas(pg);
};
function desenharTarefas(pg) {
  pg = pg || $("#page");
  const f = S.f.tar || "hoje", quem = S.f.tarQuem == null ? "eu" : S.f.tarQuem;
  const doResp = t => !quem || (quem === "eu" ? (!t.responsavel || t.responsavel === S.user.id) : t.responsavel === quem);
  const base = TAR.ls.filter(t => t.ativa && doResp(t));
  const teste = { hoje: t => tarefaPendente(t), todas: () => true, feitas: t => tarefaFeita(t), atrasadas: t => t.frequencia === "unica" && t.prazo && t.prazo < hoje() && !tarefaFeita(t) };
  const lista = base.filter(teste[f] || teste.todas);
  const g = grade("tarefas2", COLS_TAR, lista, { attr: t => `data-act="tar-ed" data-id="${t.id}" style="cursor:pointer"`, sort: { k: "data", dir: "asc" },
    cls: t => tarefaFeita(t) ? "tar-feita" : "", vazio: f === "hoje" ? "Nada pendente para hoje. 🎉" : "Nenhuma tarefa." });
  g.redesenhar = () => desenharTarefas();
  const inat = TAR.ls.filter(t => !t.ativa).length;
  pg.innerHTML = `<div class="grid">
    <div class="filters">
      <div class="fgrupo"><span>Mostrar</span>${[["hoje", "Para hoje"], ["atrasadas", "Atrasadas"], ["todas", "Todas"], ["feitas", "Feitas"]].map(([k, t]) => `<button class="chip${f === k ? " on" : ""}" data-act="chip" data-k="tar" data-v="${k}">${t}<span class="c">${base.filter(teste[k]).length}</span></button>`).join("")}</div>
      <div class="fgrupo"><span>De quem</span><select data-tar-quem>${opt("eu", "Minhas (e de todos)", quem === "eu")}${opt("", "Todos", quem === "")}${TAR.membros.map(m => opt(m.id, m.nome, quem === m.id)).join("")}</select></div>
      <span class="spacer"></span>${gradeBarra("tarefas2")}${pode.ed("tarefas") ? `<button class="btn pri" data-act="tar-ed">+ Tarefa</button>` : ""}
    </div>
    ${gradeHTML("tarefas2")}
    ${inat ? `<p class="hint">${inat} tarefa(s) desativada(s): abra em "Todas" com "Todos" para ver… <button class="btn sm" data-act="tar-inat">mostrar desativadas</button></p>` : ""}
    <p class="hint">As tarefas que se repetem voltam sozinhas: diárias todo dia, semanais na semana seguinte, mensais no mês seguinte. "Para hoje" mostra o que falta fazer hoje.</p>
  </div>`;
  const sq = $("[data-tar-quem]", pg); sq.addEventListener("change", () => { S.f.tarQuem = sq.value; desenharTarefas(); requestAnimationFrame(ajustarAlturas); });
}
// situação: a fazer / fazendo / feito (nas que se repetem, "feito" vale para o período atual)
ACT["tar-st"] = async el => {
  const t = TAR.ls.find(y => y.id === el.dataset.id); if (!t) return;
  const v = el.dataset.v, unica = t.frequencia === "unica", feita = tarefaFeita(t);
  const u = v === "feito" ? (unica ? { status: "feito", ultima_conclusao: hoje(), concluida_por: S.user.id } : { ultima_conclusao: hoje(), concluida_por: S.user.id, status: "a_fazer" })
    : Object.assign({ status: v }, feita ? { ultima_conclusao: null } : {});
  try { const r = await q(sb.from("tarefas").update(u).eq("id", t.id).select().single()); Object.assign(t, r); desenharTarefas(); atualizarContadores(); } catch (e) { falha(e); }
};
ACT["tar-inat"] = () => modal({ titulo: "Tarefas desativadas", semOk: true, corpo: `<div class="aviso-lista">${TAR.ls.filter(t => !t.ativa).map(t => `<button class="btn sm" data-act="tar-ed" data-id="${t.id}">${esc(t.titulo)}</button>`).join("")}</div>` });
ACT["tar-fazendo"] = async el => {
  const t = TAR.ls.find(y => y.id === el.dataset.id); if (!t) return;
  try { const r = await q(sb.from("tarefas").update({ status: t.status === "fazendo" ? "a_fazer" : "fazendo" }).eq("id", t.id).select().single()); Object.assign(t, r); desenharTarefas(); } catch (e) { falha(e); }
};
ACT["tar-ed"] = el => {
  const t = TAR.ls.find(x => x.id === el.dataset.id) || { frequencia: "diaria", prioridade: "normal", ativa: true, status: "a_fazer", responsavel: null };
  const ed = pode.ed("tarefas"), dis = ed ? "" : "disabled";
  modal({ titulo: t.id ? "Tarefa" : "Nova tarefa", largo: true, semOk: !ed,
    corpo: `<label class="fl"><span>Tarefa</span><input name="titulo" value="${esc(t.titulo || "")}" required ${dis} placeholder="Ex.: Conferir o caixa com o extrato"></label>
      <label class="fl"><span>Detalhes (opcional)</span><textarea name="descricao" rows="3" ${dis}>${esc(t.descricao || "")}</textarea></label>
      <div class="row"><label class="fl"><span>Responsável</span><select name="resp" ${dis}>${opt("", "(todos)", !t.responsavel)}${TAR.membros.map(m => opt(m.id, m.nome, t.responsavel === m.id)).join("")}</select></label>
        <label class="fl"><span>Frequência</span><select name="freq" ${dis}>${Object.entries(FREQ_TAR).map(([k, v]) => opt(k, v, t.frequencia === k)).join("")}</select></label>
        <label class="fl" data-q="semanal"><span>Dia da semana</span><select name="dsem" ${dis}>${DIAS_SEM.map((d, i) => opt(i, d, (t.dia_semana ?? 1) === i)).join("")}</select></label>
        <label class="fl" data-q="mensal"><span>No mês</span><select name="regra" ${dis}>${opt("", "num dia fixo", t.regra !== "ultima")}${opt("ultima", "na última … do mês", t.regra === "ultima")}</select></label>
        <label class="fl" data-q="mensal" data-r=""><span>Dia do mês</span><input type="number" name="dmes" min="1" max="31" value="${t.dia_mes || 1}" ${dis}></label>
        <label class="fl" data-q="mensal" data-r="ultima"><span>Dia da semana</span><select name="dsemu" ${dis}>${DIAS_SEM.map((d, i) => opt(i, d, (t.dia_semana ?? 5) === i)).join("")}</select></label>
        <label class="fl" data-q="unica"><span>Prazo</span><input type="date" name="prazo" value="${t.prazo || ""}" ${dis}></label>
        <label class="fl"><span>Prioridade</span><select name="prio" ${dis}>${Object.entries(PRIO_TAR).map(([k, v]) => opt(k, v[0], t.prioridade === k)).join("")}</select></label></div>
      <label class="chk"><input type="checkbox" name="ativa" ${t.ativa ? "checked" : ""} ${dis}> Ativa</label>`,
    extra: t.id && ed ? `<button type="button" class="btn danger" data-del>Excluir</button>` : "",
    aoAbrir: (f, d) => {
      const vis = () => $$("[data-q]", d).forEach(x => (x.hidden = x.dataset.q !== f.freq.value || (x.dataset.r != null && x.dataset.r !== f.regra.value))); f.freq.addEventListener("change", vis); f.regra.addEventListener("change", vis); vis();
      const b = $("[data-del]", d); if (b) b.addEventListener("click", async () => { d.close(); if (!(await confirmar("Excluir tarefa", `Excluir <b>${esc(t.titulo)}</b>? Prefira desmarcar "Ativa".`, "Excluir"))) return; try { await q(sb.from("tarefas").delete().eq("id", t.id)); toast("Excluída."); render(); } catch (e) { falha(e); } });
    },
    salvar: async f => {
      const u = { titulo: f.titulo.value.trim(), descricao: f.descricao.value.trim(), responsavel: f.resp.value || null, frequencia: f.freq.value, prioridade: f.prio.value, ativa: f.ativa.checked,
        dia_semana: f.freq.value === "semanal" ? +f.dsem.value : f.freq.value === "mensal" && f.regra.value === "ultima" ? +f.dsemu.value : null, regra: f.freq.value === "mensal" ? f.regra.value : "",
        dia_mes: f.freq.value === "mensal" && f.regra.value !== "ultima" ? +f.dmes.value || 1 : null, prazo: f.freq.value === "unica" ? f.prazo.value || null : null };
      if (!u.titulo) throw new Error("Escreva a tarefa.");
      if (t.id) await q(sb.from("tarefas").update(u).eq("id", t.id)); else await q(sb.from("tarefas").insert(u));
      toast("Salvo."); render();
    } });
};

/* =====================================================================
   PÁGINA: VENDAS (como a planilha "Mapa de Vendas")
   ===================================================================== */
let VEN = [], VIT = {}; // VIT: venda_id -> itens (parcelas do preço, da comissão e custas)
const pctVenda = v => +v.valor > 0 && v.comissao != null ? +v.comissao / +v.valor * 100 : null;
const anoVenda = v => (v.data || "").slice(0, 4) || ("20" + v.codigo.slice(2, 4));
// v13: valor total da venda e quanto é do vendedor (quando a comissão está incluída no valor)
const inclusa = v => v.comissao_inclusa !== false;
const valorVendedor = v => r2((+v.valor || 0) - (inclusa(v) ? +v.comissao || 0 : 0));
// totais de uma venda: vendedor e comissão (total, pago, a receber) e custas adiantadas
function totVenda(v) {
  const its = VIT[v.id] || [], soma = (t, pago) => r2(its.filter(i => i.tipo === t && (pago == null || !!i.pago_em === pago)).reduce((a, i) => a + +i.valor, 0));
  const r = { precoPago: soma("preco", true), comPago: soma("comissao", true), custas: soma("custo", true), custasReemb: r2(its.filter(i => i.tipo === "custo" && i.reembolso_em).reduce((a, i) => a + +i.valor, 0)) };
  if (!its.some(i => i.tipo === "comissao") && v.lancamento_id) r.comPago = +v.comissao || 0; // comissão lançada de uma vez (antes da v11)
  r.precoFalta = +v.valor > 0 && its.some(i => i.tipo === "preco") ? r2(Math.max(0, valorVendedor(v) - r.precoPago)) : null;
  r.comFalta = +v.comissao > 0 ? r2(Math.max(0, +v.comissao - r.comPago)) : null;
  r.custasFalta = r2(r.custas - r.custasReemb);
  r.prev = its.filter(i => !i.pago_em && i.vencimento && i.tipo !== "custo").sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  return r;
}
const COLS_VEN = [
  { k: "codigo", t: "Venda", cls: "mono", fixo: true },
  { k: "data", t: "Data", tipo: "data" },
  { k: "endereco", t: "Imóvel", cls: "trunc" },
  { k: "matricula", t: "Matrícula", cls: "trunc", oculta: true },
  { k: "insc_cad", t: "Insc. cad.", cls: "trunc", oculta: true },
  { k: "valor", t: "Valor", tipo: "num", grp: "preco", dica: "Valor total da venda" },
  { k: "vendedor", t: "Vendedor", tipo: "num", grp: "preco", oculta: true, v: valorVendedor, dica: "Parte do vendedor (valor − comissão, quando a comissão está incluída)" },
  { k: "preco_pago", t: "Pago", tipo: "num", grp: "preco", v: v => totVenda(v).precoPago || null, dica: "Parcelas já pagas ao vendedor" },
  { k: "preco_falta", t: "A receber", tipo: "num", grp: "preco", v: v => totVenda(v).precoFalta, html: v => { const x = totVenda(v).precoFalta; return x == null ? `<span class="muted" title="Sem parcelas lançadas">—</span>` : x > 0 ? `<b class="neg">${n2(x)}</b>` : `<span class="tag ok">quitado</span>`; } },
  { k: "comissao", t: "Comissão", tipo: "num", grp: "com" },
  { k: "pct", t: "%", tipo: "num", grp: "com", v: pctVenda, f: v => pctVenda(v) == null ? "" : n2(pctVenda(v)) + "%" },
  { k: "com_pago", t: "Pago", tipo: "num", grp: "com", v: v => totVenda(v).comPago || null, dica: "Comissão já recebida" },
  { k: "com_falta", t: "A receber", tipo: "num", grp: "com", v: v => totVenda(v).comFalta, html: v => { const x = totVenda(v).comFalta; return x == null ? "" : x > 0 ? `<b class="neg">${n2(x)}</b>` : `<span class="tag ok">recebida</span>`; } },
  { k: "custas", t: "Custas a reembolsar", tipo: "num", grp: "custo", v: v => totVenda(v).custasFalta || null, html: v => { const x = totVenda(v).custasFalta; return x > 0 ? `<b class="neg">${n2(x)}</b>` : ""; } },
  { k: "prev", t: "Próxima parcela", v: v => (totVenda(v).prev[0] || {}).vencimento || "", html: v => { const p = totVenda(v).prev[0]; return p ? `<span class="${p.vencimento < hoje() ? "neg" : ""}">${dt(p.vencimento)} · ${n2(p.valor)}</span>` : ""; } },
  { k: "vendedores", t: "Vendedores", cls: "trunc" },
  { k: "compradores", t: "Compradores", cls: "trunc" },
  { k: "forma", t: "Pagamento", cls: "trunc", oculta: true },
  { k: "parcelas", t: "Parcelas / obs. do pagamento", cls: "trunc", oculta: true }
];
PAGES.vendas = async pg => {
  const [vs, its] = await Promise.all([q(sb.from("vendas").select("*").order("codigo", { ascending: false })), q(sb.from("venda_itens").select("*").order("vencimento", { nullsFirst: false }).order("criado_em")).catch(() => [])]);
  VEN = vs; VIT = {}; its.forEach(i => (VIT[i.venda_id] = VIT[i.venda_id] || []).push(i));
  setRd(pg, () => desenharVendas());
  desenharVendas(pg);
};
function desenharVendas(pg) {
  pg = pg || $("#page");
  const anos = Array.from(new Set(VEN.map(anoVenda))).sort().reverse();
  const ano = S.f.venAno == null ? (anos[0] || "") : S.f.venAno, busca = S.f.venBusca || "", fv = S.f.venF || "";
  const teste = { "": () => true, areceber: v => (totVenda(v).comFalta || 0) > 0 || (totVenda(v).precoFalta || 0) > 0, custas: v => totVenda(v).custasFalta > 0 };
  let lista = VEN.filter(v => (!ano || anoVenda(v) === ano) && teste[fv](v));
  if (busca) { const b = norm(busca); lista = lista.filter(v => norm([v.codigo, v.endereco, v.vendedores, v.compradores, v.matricula].join(" ")).includes(b)); }
  const tot = lista.reduce((a, v) => { const t = totVenda(v); a.v += +v.valor || 0; a.c += +v.comissao || 0; a.cp += t.comPago; a.cf += t.comFalta || 0; a.cu += t.custasFalta; return a; }, { v: 0, c: 0, cp: 0, cf: 0, cu: 0 });
  const prev = VEN.flatMap(v => totVenda(v).prev.map(i => Object.assign({ venda: v }, i))).filter(i => i.tipo === "comissao");
  const g = grade("vendas2", COLS_VEN, lista, { attr: v => `data-act="ven-ed" data-id="${v.id}" style="cursor:pointer"`, sort: { k: "codigo", dir: "desc" }, divisor: { k: "codigo", g: v => "Vendas de " + anoVenda(v) },
    rodape: fl => `${fl.length} vendas · total ${brl(fl.reduce((a, v) => a + (+v.valor || 0), 0))} · comissão ${brl(fl.reduce((a, v) => a + (+v.comissao || 0), 0))}` });
  g.redesenhar = () => desenharVendas();
  pg.innerHTML = `<div class="grid">
    <div class="kpis">${kpi("Vendas", String(lista.length), ano ? "em " + ano : "todas")}${kpi("Total vendido", brl(tot.v), "")}
      ${kpi("Comissão", `<span class="pos">${brl(tot.c)}</span>`, `recebida ${brl(tot.cp)} · a receber ${brl(tot.cf)}`, true)}
      ${kpi("Previsão de comissão", brl(prev.reduce((a, i) => a + +i.valor, 0)), prev.length ? `${prev.length} parcela(s) · próxima ${dt(prev.sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0].vencimento)}` : "nenhuma parcela prevista")}
      ${kpi("Custas a reembolsar", `<span class="${tot.cu ? "neg" : ""}">${brl(tot.cu)}</span>`, "pagas pela imobiliária")}</div>
    <div class="filters">
      <div class="fgrupo"><span>Ano</span>${[""].concat(anos).map(a => `<button class="chip${ano === a ? " on" : ""}" data-act="chip" data-k="venAno" data-v="${a}">${a || "Todos"}</button>`).join("")}</div>
      <div class="fgrupo"><span>Mostrar</span>${[["", "Todas"], ["areceber", "Com valores a receber"], ["custas", "Custas a reembolsar"]].map(([k, t]) => `<button class="chip${fv === k ? " on" : ""}" data-act="chip" data-k="venF" data-v="${k}">${t}<span class="c">${VEN.filter(v => (!ano || anoVenda(v) === ano) && teste[k](v)).length}</span></button>`).join("")}</div>
      <input type="search" placeholder="Buscar código, endereço, nomes…" value="${esc(busca)}" data-busca="venBusca">
      <span class="spacer"></span>${gradeBarra("vendas2")}<button class="btn" data-act="ven-termos-menu">📄 Termos ▾</button>
      ${pode.ed("vendas") ? `<button class="btn pri" data-act="ven-ed">+ Venda</button>` : ""}
    </div>
    ${gradeHTML("vendas2")}</div>`;
  ligarBusca(pg);
}
function proximaVenda() {
  const yy = hoje().slice(2, 4), n = VEN.filter(v => v.codigo.startsWith("V." + yy + ".")).map(v => +v.codigo.slice(5)).filter(x => x > 0);
  return "V." + yy + "." + String((n.length ? Math.max(...n) : 0) + 1).padStart(3, "0");
}
const TIPO_VI = { preco: ["Vendedor (preço do imóvel)", "Pago pelo comprador ao vendedor"], comissao: ["Comissão", "Recebida pela imobiliária: entra no Caixa"], custo: ["Custas", "Pagas pela imobiliária e reembolsadas pelo proprietário"] };
const FORMAS_VEN = ["Dinheiro", "PIX", "Depósito / TED", "Cheque", "Carro / bem", "Outro"];
// ---- partes da venda: os mesmos campos do gerador de contratos (vnd = vendedores, cmp = compradores) ----
const campoVen = (g, k) => Object.assign({}, CPK["lcd" + k.slice(3)] || { t: k }, { k });
// lê os campos das partes (mesmas conversões da ficha do contrato)
function lerFichaVen(d) {
  const f = {};
  $$("[data-f]", d).forEach(x => { const k = x.dataset.f, cp = CPK["lcd" + k.slice(3)] || {}; let v = x.value.trim();
    if (cp.tipo === "dext" && x.type === "date") v = dataExt(v);
    if (cp.tipo === "tel") v = v.replace(/\D/g, ""); f[k] = v; });
  return f;
}
const pessoaVenKs = p => ["nome", "sexo", "nac", "est_civil", "prof", "rg", "oe", "cpf", "tel", "email"].map(x => p + "_" + x);
const endVenKs = g => ["qtd", "casados", "regime", "data_casamento", "end1_rua", "end1_bairro", "end1_cidade", "end2_rua", "end2_bairro", "end2_cidade"].map(x => g + "_" + x);
const IMV_VEN = [["imv_rua", "Rua e nº"], ["imv_bairro", "Bairro"], ["imv_cidade", "Município/UF"], ["imv_cep", "CEP"], ["imv_matricula", "Matrícula (CRI)"], ["imv_insc", "Inscrição cadastral"], ["imv_desc", "Descrição (lote, quadra, área, benfeitorias…)"]];
const nomesParte = (f, g) => [f[g + "1_nome"], /PJ/i.test(f[g + "_qtd"] || "") ? "" : f[g + "2_nome"]].filter(Boolean);
function qualParte(v, g) {
  const f = v.ficha || {};
  if (f[g + "1_nome"]) return qualifGrupo(f, g);
  const txt = g === "vnd" ? v.vend_qualif : v.comp_qualif, ns = nomesLista(g === "vnd" ? v.vendedores : v.compradores);
  return txt ? esc(txt) : `<b>${esc(ns.join(" e ").toUpperCase())}</b>, ${lin_(60)}`;
}
const resumoParte = (v, g) => { const f = v.ficha || {}, ns = nomesParte(f, g); return ns.length ? ns.join(" e ") : (g === "vnd" ? v.vendedores : v.compradores) || ""; };
function blocoPartesVen(f, g, rot, dis) {
  const b = (titulo, ks, r) => `<fieldset class="ficha-b"><legend>${esc(titulo)}</legend><div class="ficha-g">${ks.map(k => campoHTML(campoVen(g, k), f[k] || "", dis)).join("")}</div></fieldset>`;
  return b(`${rot} 1 (ou empresa, quando PJ)`, pessoaVenKs(g + "1"), rot + " 1") + b(`${rot} 2 (ou representante, quando PJ)`, pessoaVenKs(g + "2"), rot + " 2") + b("Quantidade, casamento e endereços", endVenKs(g), rot + "es");
}
ACT["ven-ed"] = el => {
  const v = VEN.find(x => x.id === el.dataset.id) || { codigo: proximaVenda(), data: hoje(), comissao_inclusa: true, ficha: {} };
  const f = Object.assign({}, v.ficha || {});
  if (!f.imv_rua && v.endereco) f.imv_rua = v.endereco;
  if (!f.imv_matricula && v.matricula) f.imv_matricula = v.matricula;
  if (!f.imv_insc && v.insc_cad) f.imv_insc = v.insc_cad;
  if (!f.imv_desc && v.imovel_desc) f.imv_desc = v.imovel_desc;
  if (!f.vnd1_nome && v.vendedores) { const ns = nomesLista(v.vendedores); f.vnd1_nome = ns[0] || ""; if (ns[1]) { f.vnd2_nome = ns[1]; f.vnd_qtd = "2"; } }
  if (!f.cmp1_nome && v.compradores) { const ns = nomesLista(v.compradores); f.cmp1_nome = ns[0] || ""; if (ns[1]) { f.cmp2_nome = ns[1]; f.cmp_qtd = "2"; } }
  const ed = pode.ed("vendas"), dis = ed ? "" : "disabled";
  const imvRes = [f.imv_rua, f.imv_bairro].filter(Boolean).join(" – ") || "—";
  modal({ titulo: v.id ? "Venda " + v.codigo : "Nova venda", xl: true, semOk: !ed,
    corpo: `<div class="abas ficha-abas"><button type="button" class="aba on" data-aba="venda">Venda e parcelas</button><button type="button" class="aba" data-aba="imv">Imóvel</button><button type="button" class="aba" data-aba="vnd">Vendedores</button><button type="button" class="aba" data-aba="cmp">Compradores</button></div>
      <div class="ficha-sec" data-sec="venda">
        <div class="ven-l1"><label class="fl"><span>Código</span><input name="codigo" value="${esc(v.codigo)}" ${v.id ? "disabled" : dis}></label>
          <label class="fl"><span>Data</span><input type="date" name="data" value="${v.data || ""}" ${dis}></label>
          <label class="fl"><span>Valor total da venda</span><input name="valor" inputmode="numeric" value="${v.valor != null ? moedaFmt(v.valor) : ""}" ${dis}></label>
          <label class="fl"><span>Comissão <small data-pct></small></span><input name="comissao" inputmode="numeric" value="${v.comissao != null ? moedaFmt(v.comissao) : ""}" ${dis}></label>
          <label class="fl"><span>Forma de pagamento</span><input name="forma" list="dl-forma-ven" value="${esc(v.forma || "")}" ${dis}><datalist id="dl-forma-ven"><option value="À vista"><option value="Financiamento"><option value="Parcelado"><option value="Depósito + carro"></datalist></label></div>
        <label class="chk"><input type="checkbox" name="inclusa" ${inclusa(v) ? "checked" : ""} ${dis}> A comissão está <b>incluída</b> no valor total (o vendedor recebe <b data-vendedor></b>)</label>
        <div class="ven-l2"><div><small>Imóvel</small><b>${esc(imvRes)}</b><button type="button" class="btn sm ghost" data-ir="imv">editar</button></div>
          <div><small>Vendedores</small><b>${esc(resumoParte({ ficha: f, vendedores: v.vendedores }, "vnd") || "—")}</b><button type="button" class="btn sm ghost" data-ir="vnd">editar</button></div>
          <div><small>Compradores</small><b>${esc(resumoParte({ ficha: f, compradores: v.compradores }, "cmp") || "—")}</b><button type="button" class="btn sm ghost" data-ir="cmp">editar</button></div></div>
        ${v.id ? itensVendaHTML(v, ed) : `<p class="hint">Salve a venda para lançar as parcelas.</p>`}
        <label class="fl"><span>Observações</span><textarea name="obs" rows="2" ${dis}>${esc(v.obs || "")}</textarea></label>
        ${v.parcelas ? `<p class="hint">Anotação antiga do pagamento: ${esc(v.parcelas)}</p>` : ""}</div>
      <div class="ficha-sec" data-sec="imv" hidden><div class="ficha-g">${IMV_VEN.map(([k, t]) => `<label class="fl${k === "imv_rua" || k === "imv_desc" ? " largo" : ""}"><span>${t}</span>${k === "imv_desc" ? `<textarea data-vf="${k}" rows="3" ${dis}>${esc(f[k] || "")}</textarea>` : `<input data-vf="${k}" value="${esc(f[k] || "")}" ${dis}>`}</label>`).join("")}</div></div>
      <div class="ficha-sec" data-sec="vnd" hidden>${blocoPartesVen(f, "vnd", "Vendedor", dis)}</div>
      <div class="ficha-sec" data-sec="cmp" hidden>${blocoPartesVen(f, "cmp", "Comprador", dis)}</div>`,
    extra: (v.id ? `<button type="button" class="btn" data-termos-ven>📄 Termos ▾</button>` : "") + (v.id && pode.admin() ? `<button type="button" class="btn danger" data-del>Excluir</button>` : ""),
    aoAbrir: (fm, d) => {
      const abas = $$(".ficha-abas .aba", d), ir = a => { abas.forEach(x => x.classList.toggle("on", x.dataset.aba === a)); $$(".ficha-sec", d).forEach(s => (s.hidden = s.dataset.sec !== a)); };
      abas.forEach(b => b.addEventListener("click", () => ir(b.dataset.aba))); $$("[data-ir]", d).forEach(b => b.addEventListener("click", () => ir(b.dataset.ir)));
      if (S.f.venAba) { S.f.venAba = ""; }
      $$("[data-f]", d).forEach(x => { const t = (CPK["lcd" + x.dataset.f.slice(3)] || {}).tipo; if (t === "tel") mascaraTel(x); if (t === "doc") mascaraDoc(x); });
      [fm.valor, fm.comissao].forEach(x => mascaraMoeda(x));
      const pct = () => { const a = parseMoney(fm.valor.value), c = parseMoney(fm.comissao.value); $("[data-pct]", d).textContent = a > 0 && c != null ? `(${n2(c / a * 100)}%)` : ""; $("[data-vendedor]", d).textContent = brl(r2((a || 0) - (fm.inclusa.checked ? c || 0 : 0))); };
      [fm.valor, fm.comissao, fm.inclusa].forEach(x => x.addEventListener("input", pct)); pct();
      const tv = $("[data-termos-ven]", d); if (tv) tv.addEventListener("click", () => menuTermos(tv, "Termos desta venda", TERMOS_VEN.map(x => ({ ic: x.ic, t: x.t, d: x.d, fn: () => { d.close(); ACT["ven-termo"]({ dataset: { id: v.id, tipo: x.k } }); } }))));
      const b = $("[data-del]", d); if (b) b.addEventListener("click", async () => { d.close(); if (!(await confirmar("Excluir venda", `Excluir a venda ${esc(v.codigo)} e suas parcelas?`, "Excluir"))) return; try { await q(sb.from("vendas").delete().eq("id", v.id)); toast("Excluída."); render(); } catch (e) { falha(e); } });
      if (v.id) ligarItensVenda(d, v, ed, () => lerVenda(fm, d));
    },
    salvar: async fm => { await gravarVenda(v, lerVenda(fm, $("#dlg"))); toast("Salvo."); render(); } });
};
function lerVenda(fm, d) {
  const fi = lerFichaVen(d);
  $$("[data-vf]", d).forEach(x => (fi[x.dataset.vf] = x.value.trim()));
  Object.keys(fi).forEach(k => { if (!/^(vnd|cmp|imv)_?/.test(k)) delete fi[k]; });
  return { codigo: fm.codigo.value.trim().toUpperCase(), data: fm.data.value || null, valor: parseMoney(fm.valor.value), comissao: parseMoney(fm.comissao.value), comissao_inclusa: fm.inclusa.checked, forma: fm.forma.value.trim(), obs: fm.obs.value.trim(), ficha: fi,
    endereco: fi.imv_rua || "", matricula: fi.imv_matricula || "", insc_cad: fi.imv_insc || "", imovel_desc: fi.imv_desc || "",
    vendedores: nomesParte(fi, "vnd").join(" - "), compradores: nomesParte(fi, "cmp").join(" - ") };
}
async function gravarVenda(v, u) {
  const cod = u.codigo; delete u.codigo;
  if (v.id) return q(sb.from("vendas").update(u).eq("id", v.id));
  if (!/^V\.\d{2}\.\d{3}$/.test(cod)) throw new Error("Código no formato V.26.001.");
  return q(sb.from("vendas").insert(Object.assign({ codigo: cod }, u)));
}
function itensVendaHTML(v, ed) {
  const t = totVenda(v), its = VIT[v.id] || [];
  const bloco = tipo => {
    const ls = its.filter(i => i.tipo === tipo);
    const res = tipo === "preco" ? `Vendedor ${brl(valorVendedor(v))} · pago <b class="pos">${brl(t.precoPago)}</b> · a receber <b class="${t.precoFalta ? "neg" : ""}">${t.precoFalta == null ? brl(valorVendedor(v)) : brl(t.precoFalta)}</b>`
      : tipo === "comissao" ? `Comissão ${brl(v.comissao || 0)} · paga <b class="pos">${brl(t.comPago)}</b> · a receber <b class="${t.comFalta ? "neg" : ""}">${brl(t.comFalta || 0)}</b>`
      : `Adiantado ${brl(t.custas)} · reembolsado <b class="pos">${brl(t.custasReemb)}</b> · a reembolsar <b class="${t.custasFalta ? "neg" : ""}">${brl(t.custasFalta)}</b>`;
    return `<div class="vi-b"><div class="vi-h"><b>${TIPO_VI[tipo][0]}</b><span class="hint">${TIPO_VI[tipo][1]}</span><span class="spacer"></span><span>${res}</span>${ed ? `<button type="button" class="btn sm" data-vi-add="${tipo}">+ ${tipo === "custo" ? "Custa" : "Parcela"}</button>` : ""}</div>
      ${ls.length ? `<table class="compacta vi-t"><thead><tr><th>Descrição</th><th class="num">Valor</th><th>Vencimento</th><th>${tipo === "custo" ? "Paga pela imob. em" : "Pago em"}</th><th>Forma</th>${tipo === "custo" ? "<th>Reembolsada em</th>" : ""}<th></th></tr></thead><tbody>
        ${ls.map(i => `<tr class="${i.pago_em ? "" : i.vencimento && i.vencimento < hoje() ? "ct-deb" : "ct-pend"}"><td>${esc(i.descricao)}${i.obs ? ` <small class="muted">${esc(i.obs)}</small>` : ""}</td><td class="num">${n2(i.valor)}</td><td>${dt(i.vencimento)}</td>
          <td>${i.pago_em ? dt(i.pago_em) + (i.lancamento_id ? ` <span class="tag ok" title="Lançado no Caixa">caixa</span>` : "") : `<span class="tag warn">previsto</span>`}</td><td>${esc(i.forma)}</td>
          ${tipo === "custo" ? `<td>${i.reembolso_em ? dt(i.reembolso_em) : i.pago_em && ed ? `<button type="button" class="btn sm" data-vi-reemb="${i.id}">Reembolsada</button>` : ""}</td>` : ""}
          <td class="acts">${ed && !i.pago_em ? `<button type="button" class="btn sm pri" data-vi-pagar="${i.id}">${tipo === "custo" ? "Paga" : "Recebida"}</button>` : ""}${i.pago_em && tipo !== "custo" ? `<button type="button" class="btn sm" data-vi-recibo="${i.id}" title="Recibo desta parcela">🧾</button>` : ""}${ed ? `<button type="button" class="btn sm ghost" data-vi-ed="${i.id}" title="Editar">✎</button><button type="button" class="btn sm ghost" data-vi-del="${i.id}" title="Excluir">✕</button>` : ""}</td></tr>`).join("")}</tbody></table>` : `<p class="hint">Nenhum lançamento.</p>`}</div>`;
  };
  return `<div data-vi>${bloco("preco")}${bloco("comissao")}${bloco("custo")}</div>`;
}
// reabre a venda depois de mexer numa parcela
const reabrirVenda = async id => { await PAGES.vendas($("#page")); ACT["ven-ed"]({ dataset: { id } }); };
const catVenda = (grupo, re) => (S.categorias.find(c => c.grupo === grupo && re.test(c.nome)) || {}).id;
const ORD = n => n + "ª";
function ligarItensVenda(d, v, ed, lerAtual) {
  if (!ed) return;
  const it = id => (VIT[v.id] || []).find(i => i.id === id);
  // salva o que foi digitado na venda antes de abrir a parcela (para não perder)
  const salvaAntes = async () => { try { const u = lerAtual(); await gravarVenda(v, u); Object.assign(v, u); } catch (e) { console.warn(e); } };
  $$("[data-vi-recibo]", d).forEach(b => b.addEventListener("click", () => termoVenda(v, "recibo", it(b.dataset.viRecibo))));
  $$("[data-vi-add],[data-vi-ed]", d).forEach(b => b.addEventListener("click", async () => {
    const i = b.dataset.viEd ? it(b.dataset.viEd) : { tipo: b.dataset.viAdd }, tipo = i.tipo;
    await salvaAntes(); d.close();
    const ls = (VIT[v.id] || []).filter(x => x.tipo === tipo && x.id !== i.id), nums = ls.map(x => +((x.descricao || "").match(/^(\d+)ª/) || [])[1] || 0);
    const prox = (nums.length ? Math.max(...nums) : 0) + 1;
    const integral = tipo === "preco" ? valorVendedor(v) : tipo === "comissao" ? +v.comissao || 0 : null;
    const ops = tipo === "custo" ? ["ITBI", "Escritura", "Registro (cartório)", "Certidões", "Avaliação", "Despachante", "Outra"] : [ORD(prox) + " parcela", "Sinal / entrada", "Valor integral", "Saldo"].concat([1, 2, 3, 4, 5, 6].filter(n => n !== prox).map(n => ORD(n) + " parcela"));
    const atual = i.descricao || ops[0];
    modal({ titulo: (i.id ? "Editar · " : "Nova · ") + TIPO_VI[tipo][0], ok: "Salvar",
      corpo: `<div class="row"><label class="fl" style="grid-column:span 2"><span>Parcela</span><select name="desc">${ops.concat(ops.includes(atual) ? [] : [atual]).map(o => opt(o, o, o === atual)).join("")}</select></label>
          <label class="fl"><span>Valor</span><input name="valor" inputmode="numeric" value="${i.valor != null ? moedaFmt(i.valor) : ""}" placeholder="R$ 0,00"></label></div>
        <div class="row"><label class="fl"><span>Vencimento ${tipo === "custo" ? "" : "(previsão)"}</span><input type="date" name="venc" value="${i.vencimento || ""}"></label>
          <label class="fl"><span>Forma</span><select name="forma">${opt("", "—", !i.forma)}${FORMAS_VEN.map(x => opt(x, x, i.forma === x)).join("")}</select></label></div>
        ${!i.id && tipo !== "custo" ? `<label class="chk"><input type="checkbox" name="rep"> Lançar várias parcelas iguais, uma por mês:</label><div class="row" data-rep hidden><label class="fl"><span>Quantas parcelas</span><input type="number" name="n" min="2" max="120" value="2"></label><p class="hint" data-rep-txt style="align-self:end"></p></div>` : ""}
        <label class="fl"><span>Observações</span><input name="obs" value="${esc(i.obs || "")}"></label>
        ${integral != null ? `<p class="hint">Valor integral: ${brl(integral)}</p>` : ""}`,
      aoAbrir: (f, dd) => {
        mascaraMoeda(f.valor);
        f.desc.addEventListener("change", () => { if (f.desc.value === "Valor integral" && integral != null) f.valor.value = moedaFmt(integral); });
        if (f.rep) { const txt = () => { const n = +f.n.value || 2, val = parseMoney(f.valor.value) || 0; $("[data-rep-txt]", dd).textContent = val ? `${n} × ${brl(val)} = ${brl(r2(n * val))}, da ${f.desc.value.match(/^\d+ª/) ? f.desc.value.match(/^\d+ª/)[0] : ORD(prox)} em diante, vencendo todo mês.` : ""; };
          f.rep.addEventListener("change", () => { $("[data-rep]", dd).hidden = !f.rep.checked; txt(); }); [f.n, f.valor, f.desc].forEach(x => x.addEventListener("input", txt)); }
      },
      salvar: async f => {
        const base = { venda_id: v.id, tipo, descricao: f.desc.value, valor: parseMoney(f.valor.value), vencimento: f.venc.value || null, forma: f.forma.value, obs: f.obs.value.trim() };
        if (!(base.valor > 0)) throw new Error("Informe o valor.");
        if (i.id) await q(sb.from("venda_itens").update(base).eq("id", i.id));
        else if (f.rep && f.rep.checked) {
          const n = Math.max(2, Math.min(120, +f.n.value || 2)), ini = +((f.desc.value.match(/^(\d+)ª/) || [])[1] || prox);
          if (!base.vencimento) throw new Error("Informe o vencimento da primeira parcela.");
          const ls2 = Array.from({ length: n }, (_, k) => { const dv = new Date(base.vencimento + "T12:00:00"); dv.setMonth(dv.getMonth() + k); return Object.assign({}, base, { descricao: ORD(ini + k) + " parcela", vencimento: iso(dv) }); });
          await q(sb.from("venda_itens").insert(ls2));
        } else await q(sb.from("venda_itens").insert(base));
        setTimeout(() => reabrirVenda(v.id), 0);
      } });
  }));
  $$("[data-vi-del]", d).forEach(b => b.addEventListener("click", async () => {
    const i = it(b.dataset.viDel); await salvaAntes(); d.close();
    if (!(await confirmar("Excluir", `Excluir “${esc(i.descricao)}” (${brl(i.valor)})?${i.lancamento_id || i.reembolso_lanc ? " Os lançamentos do Caixa ligados a ela também serão apagados." : ""}`, "Excluir"))) return reabrirVenda(v.id);
    try { for (const l of [i.lancamento_id, i.reembolso_lanc].filter(Boolean)) await q(sb.from("lancamentos").delete().eq("id", l)); await q(sb.from("venda_itens").delete().eq("id", i.id)); } catch (e) { falha(e); }
    reabrirVenda(v.id);
  }));
  const pagar = async (i, reemb) => {
    const tipo = i.tipo, caixa = tipo === "comissao" || tipo === "custo";
    await salvaAntes(); d.close();
    modal({ titulo: reemb ? "Reembolso da custa" : tipo === "custo" ? "Custa paga pela imobiliária" : "Parcela recebida", ok: "Registrar",
      corpo: `<div class="box"><b>${esc(i.descricao)}</b> · ${brl(i.valor)} · venda ${esc(v.codigo)}</div>
        <div class="row"><label class="fl"><span>Data</span><input type="date" name="data" value="${hoje()}"></label>
          ${reemb ? "" : `<label class="fl"><span>Forma</span><select name="forma">${FORMAS_VEN.map(x => opt(x, x, i.forma === x)).join("")}</select></label>`}
          ${caixa ? `<label class="fl"><span>${reemb || tipo === "comissao" ? "Entrou na conta" : "Saiu da conta"}</span><select name="conta">${contasOpts()}</select></label>` : ""}</div>
        ${caixa ? `<label class="chk"><input type="checkbox" name="lanca" checked> lançar no Caixa</label>` : `<p class="hint">Parcela do vendedor: não entra no Caixa da imobiliária.</p>`}`,
      salvar: async f => {
        let lanc = null;
        if (caixa && f.lanca.checked) {
          const cat = reemb ? catVenda("terceiros_entrada", /reembolso de custas/i) : tipo === "custo" ? catVenda("terceiros_saida", /custas de venda/i) : catVenda("receita", /comiss[aã]o de venda/i);
          if (!cat) throw new Error("Categoria não encontrada no plano de contas (rode o SQL da versão 11).");
          lanc = await q(sb.from("lancamentos").insert({ data: f.data.value, competencia: f.data.value.slice(0, 8) + "01", tipo: reemb || tipo === "comissao" ? "entrada" : "saida", categoria_id: cat, conta_id: f.conta.value, valor: +i.valor,
            descricao: `${reemb ? "Reembolso " : tipo === "custo" ? "Custas " : "Comissão "}venda ${v.codigo} - ${i.descricao} - ${v.endereco}`.slice(0, 300) }).select().single());
        }
        if (reemb) await q(sb.from("venda_itens").update({ reembolso_em: f.data.value, reembolso_lanc: lanc && lanc.id }).eq("id", i.id));
        else await q(sb.from("venda_itens").update({ pago_em: f.data.value, forma: f.forma.value, lancamento_id: lanc && lanc.id }).eq("id", i.id));
        setTimeout(() => reabrirVenda(v.id), 0);
      } });
  };
  $$("[data-vi-pagar]", d).forEach(b => b.addEventListener("click", () => pagar(it(b.dataset.viPagar))));
  $$("[data-vi-reemb]", d).forEach(b => b.addEventListener("click", () => pagar(it(b.dataset.viReemb), true)));
}
const TERMOS_VEN = [
  { ic: "🧾", k: "recibo", t: "Recibo de parcela", d: "vendedor recebe do comprador" },
  { ic: "💼", k: "recibo_com", t: "Recibo de comissão", d: "imobiliária recebe a comissão" },
  { ic: "🏦", k: "primeiro", t: "Declaração de primeiro imóvel", d: "financiamento · art. 290 Lei 6.015/73" },
  { ic: "✍️", k: "renuncia", t: "Renúncia ao direito de preferência", d: "locatário do imóvel · art. 27 Lei 8.245/91" }
];
ACT["ven-termos-menu"] = el => menuTermos(el, "Termos de vendas", TERMOS_VEN.map(x => ({ ic: x.ic, t: x.t, d: x.d, fn: () => {
  const rot = v => `${v.codigo} · ${v.endereco || ""}`;
  modal({ titulo: x.t + " · qual venda?", ok: "Continuar",
    corpo: `<label class="fl"><span>Venda (código ou endereço)</span><input name="v" list="dl-ven-esc" autocomplete="off"><datalist id="dl-ven-esc">${VEN.map(v => `<option value="${esc(rot(v))}">`).join("")}</datalist></label>`,
    salvar: async f => { const v = VEN.find(z => rot(z) === f.v.value) || VEN.find(z => z.codigo === f.v.value.trim().toUpperCase()); if (!v) throw new Error("Escolha uma venda da lista."); setTimeout(() => ACT["ven-termo"]({ dataset: { id: v.id, tipo: x.k } }), 0); } });
} })));
// ---- termos da venda: recibo de parcela, declaração de primeiro imóvel, renúncia ao direito de preferência ----
const nomesLista = s => String(s || "").split(/\s+-\s+|\s*;\s*|\s+e\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/).map(x => x.trim()).filter(Boolean);
const qualOuLinha = (q, nomes) => q ? esc(q) : `<b>${esc(nomes.join(" e ").toUpperCase())}</b>, ${lin_(60)}`;
ACT["ven-termo"] = el => {
  const v = VEN.find(x => x.id === el.dataset.id); if (!v) return;
  const pagos = (VIT[v.id] || []).filter(i => i.tipo !== "custo");
  modal({ titulo: "Termos da venda " + v.codigo, ok: "Gerar documento",
    corpo: `<label class="fl"><span>Documento</span><select name="tipo">${TERMOS_VEN.map(x => opt(x.k, x.ic + " " + x.t + " (" + x.d + ")", x.k === (el.dataset.tipo || "recibo"))).join("")}</select></label>
      <div data-p="recibo recibo_com"><label class="fl"><span>Parcela</span><select name="item">${opt("", "— valor livre —", !pagos.length)}${pagos.map((i, n) => opt(i.id, `${TIPO_VI[i.tipo][0]}: ${i.descricao} · ${n2(i.valor)}${i.pago_em ? " · pago " + dt(i.pago_em) : " · previsto"}`, n === 0)).join("")}</select></label>
        <div class="row"><label class="fl"><span>Valor (se livre)</span><input name="valor" inputmode="numeric"></label><label class="fl"><span>Referente (se livre)</span><input name="ref" placeholder="1ª (primeira) parcela"></label></div></div>
      <div data-p="renuncia" hidden><label class="fl"><span>Contrato de locação do imóvel (para puxar os locatários)</span><input name="ctt" placeholder="L.25.012"></label></div>
      <p class="hint">Os nomes e qualificações vêm das abas Imóvel, Vendedores e Compradores da venda. O documento abre para conferir e completar antes de imprimir.</p>`,
    aoAbrir: (f, d) => { mascaraMoeda(f.valor); mascaraContrato(f.ctt); const m = () => $$("[data-p]", d).forEach(x => (x.hidden = !x.dataset.p.split(" ").includes(f.tipo.value))); f.tipo.addEventListener("change", m); m(); },
    salvar: async f => {
      const tipo = f.tipo.value; let extra = {};
      if (tipo.startsWith("recibo")) { const i = pagos.find(x => x.id === f.item.value); extra = i ? { item: i } : { item: { valor: parseMoney(f.valor.value) || 0, descricao: f.ref.value.trim() || "pagamento", pago_em: hoje() } }; }
      if (tipo === "renuncia" && f.ctt.value.trim()) extra.ctt = await q(sb.from("contratos").select("*").eq("codigo", f.ctt.value.trim()).maybeSingle());
      setTimeout(() => termoVenda(v, tipo, extra.item, extra.ctt), 0);
    } });
};
function termoVenda(v, tipo, item, ctt) {
  const fv0 = v.ficha || {}, vend = nomesParte(fv0, "vnd").length ? nomesParte(fv0, "vnd") : nomesLista(v.vendedores), comp = nomesParte(fv0, "cmp").length ? nomesParte(fv0, "cmp") : nomesLista(v.compradores), pl = vend.length > 1, data = item && item.pago_em ? item.pago_em : hoje();
  const imv = fv0.imv_desc ? esc(fv0.imv_desc) : v.imovel_desc ? esc(v.imovel_desc) : `o imóvel situado na ${esc(v.endereco)}${v.matricula ? `, objeto da matrícula nº ${esc(v.matricula)} do Cartório de Registro de Imóveis de ${esc(TIMBRE.cidade)}/SP` : ""}${v.insc_cad ? `, cadastrado na Prefeitura sob nº ${esc(v.insc_cad)}` : ""}`;
  const ass = ns => `<div class="doc-ass">${ns.map(n => `<div>${esc(n)}</div>`).join("") || "<div></div>"}</div>`;
  let titulo, html, timbre = false;
  if (tipo === "recibo") {
    titulo = "Recibo"; const val = +item.valor;
    html = `<h2 class="doc-tit">RECIBO</h2><p style="text-align:right"><b>Valor ${brl(val)}</b></p>
      <p class="doc-rec">${pl ? "Nós, infra-assinados" : "Eu, infra-assinado(a)"}, ${qualParte(v, "vnd")}, pelo presente ${pl ? "declaramos e confessamos que recebemos" : "declaro e confesso que recebi"} de ${qualParte(v, "cmp")}, a importância de <b>${brl(val)}</b> (${esc(extensoReais(val).toLowerCase())}), referente ao pagamento da <b>${esc(item.descricao || "parcela")}</b> da venda que ${pl ? "fizemos" : "fiz"} ao(s) mesmo(s) de ${imv}, dando plena quitação da referida importância.</p>
      <p class="doc-rec">Para maior clareza e para que produza todos os devidos e legais efeitos, ${pl ? "firmamos" : "firmo"} o presente.</p>
      <p class="doc-data">${esc(TIMBRE.cidade)} (SP), ${dataExt(data)}.</p>${ass(vend)}`;
  } else if (tipo === "recibo_com") {
    titulo = "Recibo de comissão"; timbre = true; const val = +item.valor;
    html = `<h2 class="doc-tit">RECIBO</h2><p style="text-align:right"><b>Valor ${brl(val)}</b></p>
      <p class="doc-rec">${esc(TIMBRE.razao.split(" — ")[0])}, inscrita no CNPJ sob nº ${esc(TIMBRE.cnpj)}, declara que recebeu de <b>${esc((vend.join(" e ") || "").toUpperCase())}</b> a importância de <b>${brl(val)}</b> (${esc(extensoReais(val).toLowerCase())}), referente à <b>${esc(item.descricao || "comissão")}</b> da comissão pela intermediação da venda de ${imv} (venda ${esc(v.codigo)}), dando plena quitação da referida importância.</p>
      <p class="doc-data">${esc(TIMBRE.cidade)} (SP), ${dataExt(data)}.</p>${ass([TIMBRE.razao.split(" — ")[0]])}`;
  } else if (tipo === "primeiro") {
    titulo = "Declaração de primeiro imóvel";
    html = `<p><b>ILMO(A). SR(A). OFICIAL DE REGISTRO DE IMÓVEIS DA COMARCA DE ${esc(TIMBRE.cidade.toUpperCase())}/SP</b></p><div style="height:40px"></div>
      <p class="doc-rec">${comp.length > 1 ? "Nós" : "Eu"}, ${qualParte(v, "cmp")}, ${comp.length > 1 ? "DECLARAMOS" : "DECLARO"}, para os devidos fins e sob as penas da lei, tratar-se de ${comp.length > 1 ? "nossa" : "minha"} <b>primeira aquisição imobiliária financiada pelo Sistema Financeiro da Habitação</b>, referente a ${imv}, habilitando-${comp.length > 1 ? "nos" : "me"}, por conseguinte, à redução de 50% (cinquenta por cento) dos emolumentos devidos pelo registro do respectivo contrato, nos termos do artigo 290 da Lei nº 6.015/73.</p>
      <p class="doc-rec">Por ser verdade, ${comp.length > 1 ? "firmamos" : "firmo"} o presente.</p>
      <p class="doc-data">${esc(TIMBRE.cidade)}, ${dataExt(hoje())}.</p>${ass(comp)}`;
  } else {
    titulo = "Declaração de renúncia ao direito de preferência";
    const f = ctt ? fichaDe(ctt) : {}, lct = ctt ? nomesGrupo(f, "lct") : [];
    html = `<h2 class="doc-tit">DECLARAÇÃO DE RENÚNCIA AO DIREITO DE PREFERÊNCIA</h2>
      <p class="doc-rec">${lct.length > 1 ? "Nós, infra-assinados" : "Eu, infra-assinado(a)"}, ${ctt ? qualifGrupo(f, "lct").replace(/, residentes? na .*$/, "") : `<b>${lin_(40)}</b>, ${lin_(60)}`}, locatário${lct.length > 1 ? "s" : "(a)"} do imóvel situado na ${esc(ctt ? endImovelFicha(f, ctt) : v.endereco)}, ${lct.length > 1 ? "declaramos" : "declaro"}, para os devidos fins, que:</p>
      <p class="doc-rec">${lct.length > 1 ? "Fomos procurados" : "Fui procurado(a)"} por ${qualParte(v, "vnd")}, proprietário(s) do imóvel locado, que ${lct.length > 1 ? "nos" : "me"} informou(aram) a intenção de vender o referido imóvel${+v.valor > 0 ? ` pelo preço de ${brl(v.valor)} (${esc(extensoReais(+v.valor).toLowerCase())})${v.forma ? `, com pagamento ${esc(v.forma.toLowerCase())}` : ""}` : ""}.</p>
      <p class="doc-rec">Em atenção ao direito de preferência previsto no art. 27 da Lei nº 8.245/91 (Lei do Inquilinato), ${lct.length > 1 ? "declaramos que não temos" : "declaro que não tenho"} interesse na aquisição do imóvel, motivo pelo qual ${lct.length > 1 ? "renunciamos" : "renuncio"} expressamente a qualquer direito de preferência, autorizando o proprietário a vendê-lo a terceiros, pelo preço e nas condições que entender convenientes, sem prejuízo da locação em vigor.</p>
      <p class="doc-rec">Por ser expressão da verdade e para que produza os efeitos legais, ${lct.length > 1 ? "firmamos" : "firmo"} a presente declaração na presença de duas testemunhas.</p>
      <p class="doc-data">${esc(TIMBRE.cidade)}/SP, ${dataExt(hoje())}.</p>${ass(lct.length ? lct : ["Locatário(a)"])}
      <p style="margin-top:24px"><b>Testemunhas:</b></p>${ass([f.test1_nome || "", f.test2_nome || ""])}`;
  }
  abrirDocEditavel(titulo + " · " + v.codigo, html, { semTimbre: !timbre });
}
// importação da aba "Contratos Vendas" do Mapa de Vendas (.xlsm)
ACT["ven-importar"] = () => {
  let lidas = null;
  modal({ titulo: "Importar vendas", largo: true, ok: "Importar",
    corpo: `<p>Escolha o arquivo <b>Mapa de Vendas</b> (.xlsm). O sistema lê a aba <b>Contratos Vendas</b>. Pode importar de novo: vendas com o mesmo código são atualizadas.</p><input type="file" data-arq accept=".xlsx,.xlsm"><div data-res></div>`,
    aoAbrir: (f, d) => $("[data-arq]", d).addEventListener("change", async e => {
      const arq = e.target.files[0], res = $("[data-res]", d); if (!arq) return;
      res.innerHTML = `<p class="hint">Lendo…</p>`;
      try {
        await carregarXLSX();
        const wb = XLSX.read(await arq.arrayBuffer(), { type: "array", cellDates: true });
        const nome = wb.SheetNames.find(n => /vendas/i.test(n)) || wb.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: "" });
        const txt = x => String(x == null ? "" : x).trim(), num = x => typeof x === "number" ? x : parseMoney(txt(x));
        const valida = d => { if (!d) return null; const x = new Date(d + "T12:00:00"); return !isNaN(x) && iso(x) === d ? d : null; };
        const data = r => { if (r[7] instanceof Date && !isNaN(r[7])) return iso(r[7]); const D = +r[4], M = +r[5], A = +r[6]; const t = txt(r[7]);
          return valida(D && M && A ? `${A}-${pad(M)}-${pad(D)}` : "") || valida(/^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : "") || null; };
        lidas = rows.filter(r => /^V\.\d{2}\.\d{3}$/.test(txt(r[0]))).map(r => ({ codigo: txt(r[0]), endereco: txt(r[1]), matricula: txt(r[2]), insc_cad: txt(r[3]), data: data(r), valor: num(r[8]), comissao: num(r[9]),
          vendedores: txt(r[11]), compradores: txt(r[12]), forma: txt(r[13]), parcelas: txt(r[14]) })).filter(v => v.endereco || v.valor);
        res.innerHTML = `<div class="box">Aba <b>${esc(nome)}</b>: <b>${lidas.length}</b> vendas · total ${brl(lidas.reduce((a, v) => a + (v.valor || 0), 0))} · comissão ${brl(lidas.reduce((a, v) => a + (v.comissao || 0), 0))}</div>`;
      } catch (err) { lidas = null; res.innerHTML = `<p class="err">${esc(erroMsg(err))}</p>`; }
    }),
    salvar: async () => {
      if (!lidas) throw new Error("Escolha o arquivo.");
      await q(sb.from("vendas").upsert(lidas, { onConflict: "codigo" }));
      toast(`${lidas.length} vendas importadas.`); render();
    } });
};

/* =====================================================================
   PÁGINA: LOCADORES (cadastro + grupos de locadores)
   ===================================================================== */
const grupoDoLoc = n => ((S.gruposCfg || []).find(g => (g.locadores || []).includes(n)) || {}).nome || "";
// v12: ficha completa do locador, com os mesmos campos do contrato (lcd1_*, lcd2_*, endereços, casamento) + dados bancários (pg_*)
const locPor = n => (S.locadores || []).find(l => l.nome === n);
const tiraPrefixo = n => String(n || "").replace(/^[A-Z]{1,6}\s+-\s+/, "").trim();
// nome verdadeiro (para recibos e documentos), sem o "título resumido" de agrupamento (ex.: "PFC - MARIA…")
function nomeRealLocador(n) {
  const l = locPor(n), f = (l && l.ficha) || {};
  const ns = [f.lcd1_nome, /PJ/i.test(f.lcd_qtd || "") ? "" : f.lcd2_nome].map(x => String(x || "").trim()).filter(Boolean);
  return ns.length ? ns.join(" e ") : tiraPrefixo(n);
}
const docLocador = n => { const f = ((locPor(n) || {}).ficha) || {}; return [f.lcd1_cpf, /PJ/i.test(f.lcd_qtd || "") ? "" : f.lcd2_cpf].filter(Boolean).join(" / ") || (locPor(n) || {}).cpf_cnpj || ""; };
const PG_CAMPOS = [["pg_titular", "Titular da conta"], ["pg_doc", "CPF/CNPJ do titular"], ["pg_banco", "Banco"], ["pg_agencia", "Agência"], ["pg_conta", "Conta"], ["pg_tipo", "Tipo (corrente/poupança)"], ["pg_pix", "Chave PIX"]];
const resumoBanco = f => [f.pg_pix ? "PIX " + f.pg_pix : "", f.pg_banco ? `${f.pg_banco}${f.pg_agencia ? " ag. " + f.pg_agencia : ""}${f.pg_conta ? " c/c " + f.pg_conta : ""}` : "", f.pg_titular && f.pg_titular !== f.lcd1_nome ? "tit. " + f.pg_titular : ""].filter(Boolean).join(" · ");
const fichaLocCompleta = l => !!((l.ficha || {}).lcd1_nome && (l.ficha || {}).lcd1_cpf);
const COLS_LOC = [
  { k: "nome", t: "Locador (título)", cls: "trunc", fixo: true },
  { k: "real", t: "Nome(s) completo(s)", cls: "trunc", v: l => { const f = l.ficha || {}; return [f.lcd1_nome, f.lcd2_nome].filter(Boolean).join(" e "); } },
  { k: "cpf_cnpj", t: "CPF / CNPJ", cls: "mono", v: l => docLocador(l.nome) },
  { k: "tel", t: "Telefone", f: l => fmtTel(l.tel || (l.ficha || {}).lcd1_tel) },
  { k: "email", t: "E-mail", cls: "trunc", oculta: true },
  { k: "banco_pix", t: "Banco / PIX", cls: "trunc", v: l => resumoBanco(l.ficha || {}) || l.banco_pix },
  { k: "ficha", t: "Ficha", v: l => fichaLocCompleta(l) ? "completa" : "incompleta", html: l => fichaLocCompleta(l) ? `<span class="tag ok">completa</span>` : `<span class="tag warn">incompleta</span>` },
  { k: "imoveis", t: "Imóveis", tipo: "num", int: true, cls: "centro", v: l => S.imoveis.filter(i => i.locador === l.nome).length },
  { k: "alugados", t: "Alugados", tipo: "num", int: true, cls: "centro", v: l => S.imoveis.filter(i => i.locador === l.nome && i.status === "ALG").length },
  { k: "grupo", t: "Grupo", v: l => grupoDoLoc(l.nome), cls: "trunc" },
  { k: "pagamento", t: "Pagamento (depósito)", v: l => ((S.favsLoc || []).find(f => (f.locadores || []).includes(l.nome)) || {}).nome || "", cls: "trunc" },
  { k: "obs", t: "Obs.", cls: "trunc", oculta: true }
];
PAGES.locadores = async pg => {
  const [grupos, favs] = await Promise.all([q(sb.from("grupos_locador").select("*").order("ordem").order("nome")), q(sb.from("depositos_fav").select("id,nome,locadores")).catch(() => []), recarregarLocadores()]);
  S.gruposCfg = grupos; S.favsLoc = favs;
  setRd(pg, () => desenharLocadores());
  desenharLocadores(pg);
};
function desenharLocadores(pg) {
  pg = pg || $("#page");
  const aba = S.f.locAba || "locadores", busca = S.f.locBusca || "", f = S.f.loc || "ativos";
  let html = "";
  if (aba === "grupos") {
    const g = grade("grupos", COLS_GRUPOS, S.gruposCfg || [], { attr: x => `data-act="grupo-ed" data-id="${esc(x.nome)}" style="cursor:pointer"` }); g.redesenhar = () => desenharLocadores();
    html = `<div class="filters"><span class="hint">Cada grupo junta locadores da mesma família ou empresa (como no Excel). "Destaque" aparece separado nos gráficos; "Principal locador" entra em "Principais locadores".</span><span class="spacer"></span>${gradeBarra("grupos")}${pode.ed("locadores") ? `<button class="btn pri" data-act="grupo-ed">+ Grupo</button>` : ""}</div>${gradeHTML("grupos")}`;
  } else {
    const teste = { ativos: l => l.ativo, incompletos: l => l.ativo && !fichaLocCompleta(l), semimovel: l => l.ativo && !S.imoveis.some(i => i.locador === l.nome), inativos: l => !l.ativo, todos: () => true };
    let lista = (S.locadores || []).filter(teste[f] || teste.ativos);
    if (busca) { const b = norm(busca); lista = lista.filter(l => norm([l.nome, l.cpf_cnpj, l.tel, l.email, grupoDoLoc(l.nome), JSON.stringify(l.ficha || {})].join(" ")).includes(b)); }
    const g = grade("locadores", COLS_LOC, lista, { attr: l => `data-act="loc-ed" data-id="${l.id}" style="cursor:pointer"`, sort: { k: "nome", dir: "asc" }, rodape: fl => `${fl.length} locadores` });
    g.redesenhar = () => desenharLocadores();
    html = `<div class="filters"><div class="fgrupo"><span>Mostrar</span>${[["ativos", "Ativos"], ["incompletos", "Ficha incompleta"], ["semimovel", "Sem imóvel"], ["inativos", "Inativos"], ["todos", "Todos"]].map(([k, t]) => `<button class="chip${f === k ? " on" : ""}" data-act="chip" data-k="loc" data-v="${k}">${t}<span class="c">${(S.locadores || []).filter(teste[k]).length}</span></button>`).join("")}</div>
      <input type="search" placeholder="Buscar nome, CPF, telefone…" value="${esc(busca)}" data-busca="locBusca"><span class="spacer"></span>${gradeBarra("locadores")}
      ${pode.ed("locadores") ? `<button class="btn" data-act="loc-puxar" title="Copia os dados dos locadores (nomes, CPF, RG, endereço, casamento) dos contratos dos imóveis de cada um">⇣ Completar com os contratos</button><button class="btn pri" data-act="loc-ed">+ Locador</button>` : ""}</div>
      ${gradeHTML("locadores")}
      <p class="hint">O <b>título</b> é o nome curto usado no mapa e nos relatórios (ex.: “Breno, Murilo e Renan Quitzau”). Dentro da ficha ficam os dados completos de cada pessoa, iguais aos do contrato. Recibos e documentos usam os nomes completos.</p>`;
  }
  pg.innerHTML = `<div class="grid"><div class="seg cobr-abas"><a href="#" data-act="chip" data-k="locAba" data-v="locadores" class="${aba !== "grupos" ? "on" : ""}">Locadores</a><a href="#" data-act="chip" data-k="locAba" data-v="grupos" class="${aba === "grupos" ? "on" : ""}">Grupos de locadores</a></div>${html}</div>`;
  ligarBusca(pg);
}
// contratos dos imóveis do locador (o mais recente primeiro)
async function contratosDoLocador(nome) {
  const ims = S.imoveis.filter(i => i.locador === nome), ids = ims.map(i => i.id), cods = ims.map(i => i.contrato_codigo).filter(Boolean);
  if (!ids.length) return [];
  const cs = await fetchAll("contratos", b => b.in("imovel_id", ids).order("codigo", { ascending: false }), "codigo,imovel_id,situacao,locatario,ficha").catch(() => []);
  const extra = cods.filter(c => !cs.some(x => x.codigo === c));
  if (extra.length) cs.push(...(await q(sb.from("contratos").select("codigo,imovel_id,situacao,locatario,ficha").in("codigo", extra)).catch(() => [])));
  return cs.filter(c => (c.ficha || {}).lcd1_nome).sort((a, b) => COLL.compare(b.codigo, a.codigo));
}
const LCD_KS = () => CP.filter(c => c.sec === "lcd").map(c => c.k);
const fichaLcdDe = ficha => Object.fromEntries(LCD_KS().filter(k => ficha[k]).map(k => [k, ficha[k]]));
// mantém as colunas simples (usadas em listas e buscas) iguais à ficha
const planoLoc = f => ({ cpf_cnpj: f.lcd1_cpf || "", rg: f.lcd1_rg || "", tel: String(f.lcd1_tel || "").replace(/\D/g, ""), email: f.lcd1_email || "",
  endereco: [f.lcd_end1_rua, f.lcd_end1_bairro, f.lcd_end1_cidade].filter(Boolean).join(" – "), banco_pix: resumoBanco(f) });
ACT["loc-puxar"] = async () => {
  const sem = (S.locadores || []).filter(l => l.ativo && !(l.ficha || {}).lcd1_nome && S.imoveis.some(i => i.locador === l.nome));
  if (!sem.length) return toast("Todos os locadores com imóvel já têm a ficha preenchida.");
  modal({ titulo: "Completar locadores com os contratos", ok: `Completar ${sem.length}`,
    corpo: `<p><b>${sem.length}</b> locadores com imóvel ainda estão sem os dados das pessoas. O sistema copia, do contrato mais recente de um dos imóveis de cada um, os dados dos locadores (nomes, CPF, RG, profissão, endereço e casamento).</p>
      <p class="hint">Só preenche fichas vazias; nada que já foi digitado é apagado. Depois confira cada um (filtro “Ficha incompleta”).</p><div data-prog class="hint"></div>`,
    salvar: async (f, d) => {
      const prog = $("[data-prog]", $("#dlg")); let ok = 0, sc = 0;
      const todos = await fetchAll("contratos", b => b.order("codigo", { ascending: false }), "codigo,imovel_id,ficha");
      for (const [n, l] of sem.entries()) {
        prog.textContent = `${n + 1} de ${sem.length}…`;
        const ids = new Set(S.imoveis.filter(i => i.locador === l.nome).map(i => i.id)), cods = new Set(S.imoveis.filter(i => i.locador === l.nome).map(i => i.contrato_codigo).filter(Boolean));
        const c = todos.find(x => (ids.has(x.imovel_id) || cods.has(x.codigo)) && (x.ficha || {}).lcd1_nome);
        if (!c) { sc++; continue; }
        const fi = Object.assign({}, l.ficha || {}, fichaLcdDe(c.ficha), { _origem: c.codigo });
        await q(sb.from("locadores").update(Object.assign({ ficha: fi }, planoLoc(fi))).eq("id", l.id)); ok++;
      }
      await recarregarLocadores(); toast(`${ok} locador(es) completados com os contratos${sc ? ` · ${sc} sem contrato com dados` : ""}.`); render();
    } });
};
ACT["loc-ed"] = async el => {
  const l = (S.locadores || []).find(x => x.id === el.dataset.id) || { ativo: true, ficha: {} };
  const ed = pode.ed("locadores") || pode.ed("imoveis"), dis = ed ? "" : "disabled";
  const ims = l.nome ? S.imoveis.filter(i => i.locador === l.nome).sort((a, b) => (a.status === "ALG" ? 0 : 1) - (b.status === "ALG" ? 0 : 1) || COLL.compare(a.endereco, b.endereco)) : [];
  // ficha: se ainda vazia, aproveita o que já foi digitado nas colunas simples
  const f = Object.assign({ lcd_qtd: "1" }, l.ficha || {});
  if (!f.lcd1_nome && l.nome) Object.assign(f, { lcd1_nome: tiraPrefixo(l.nome), lcd1_cpf: f.lcd1_cpf || l.cpf_cnpj || "", lcd1_rg: f.lcd1_rg || l.rg || "", lcd1_tel: f.lcd1_tel || l.tel || "", lcd1_email: f.lcd1_email || l.email || "" });
  if (!f.lcd_end1_rua && l.endereco) f.lcd_end1_rua = l.endereco;
  if (!resumoBanco(f) && l.banco_pix) f.pg_pix = l.banco_pix;
  const bloco = (titulo, ks) => `<fieldset class="ficha-b"><legend>${esc(titulo)}</legend><div class="ficha-g">${ks.map(k => campoHTML(CPK[k], f[k] || "", dis)).join("")}</div></fieldset>`;
  const pessoaKs = p => ["nome", "sexo", "nac", "est_civil", "prof", "rg", "oe", "cpf", "tel", "email"].map(x => p + "_" + x);
  const endKs = ["lcd_qtd", "lcd_casados", "lcd_regime", "lcd_data_casamento", "lcd_end1_rua", "lcd_end1_bairro", "lcd_end1_cidade", "lcd_end2_rua", "lcd_end2_bairro", "lcd_end2_cidade"];
  const linhaImv = i => `<tr data-imv="${i.id}" style="cursor:pointer" title="Abrir a ficha do imóvel"><td>${esc(i.endereco)}</td><td><span class="tag ${(STATUS_IMV[i.status] || ["", "idle"])[1]}">${(STATUS_IMV[i.status] || [i.status])[0]}</span></td>
    <td class="trunc">${esc(i.status === "ALG" ? i.locatario || "" : "")}</td><td>${i.status === "ALG" ? dt(i.data_entrada) : ""}</td><td class="mono">${esc(i.contrato_codigo || "")}</td><td>${i.dia_venc ? "dia " + i.dia_venc : ""}</td><td class="num">${i.valor ? n2(i.valor) : ""}</td><td class="num">${i.taxa_adm != null ? n2(i.taxa_adm) + "%" : ""}</td></tr>`;
  modal({ titulo: l.id ? "Locador · " + l.nome : "Novo locador", xl: true, semOk: !ed,
    corpo: `<div class="abas ficha-abas"><button type="button" class="aba on" data-aba="geral">Título e situação</button><button type="button" class="aba" data-aba="pessoas">Pessoas (como no contrato)</button><button type="button" class="aba" data-aba="banco">Dados bancários</button>${ims.length ? `<button type="button" class="aba" data-aba="imv">Imóveis (${ims.length})</button>` : ""}</div>
      <div class="ficha-sec" data-sec="geral">
        <label class="fl"><span>Título (nome curto, como aparece no mapa e nos relatórios)</span><input name="nome" value="${esc(l.nome || "")}" required ${dis} placeholder="Ex.: Breno, Murilo e Renan Quitzau"></label>
        ${l.id ? `<p class="hint">Mudar o título atualiza todos os imóveis, aluguéis, depósitos e grupos deste locador. Os nomes completos de cada pessoa ficam na aba “Pessoas”.</p>` : ""}
        <label class="fl"><span>Observações</span><textarea name="obs" rows="3" ${dis}>${esc(l.obs || "")}</textarea></label>
        <label class="chk"><input type="checkbox" name="ativo" ${l.ativo ? "checked" : ""} ${dis}> Ativo</label>
        ${f._origem ? `<p class="hint">Dados das pessoas copiados do contrato ${esc(f._origem)}.</p>` : ""}</div>
      <div class="ficha-sec" data-sec="pessoas" hidden>
        ${ed && l.nome ? `<div class="filters" style="margin-bottom:8px"><button type="button" class="btn sm" data-puxar>⇣ Copiar de um contrato…</button><span class="hint">Quantidade “2” = duas pessoas; “PJ” = empresa (Locador 1) e representante (Locador 2).</span></div>` : ""}
        ${bloco("Locador 1 (ou empresa, quando PJ)", pessoaKs("lcd1"))}${bloco("Locador 2 (ou representante, quando PJ)", pessoaKs("lcd2"))}${bloco("Quantidade, casamento e endereços", endKs)}</div>
      <div class="ficha-sec" data-sec="banco" hidden><div class="ficha-g">${PG_CAMPOS.map(([k, t]) => `<label class="fl"><span>${t}</span><input name="${k}" value="${esc(f[k] || "")}" ${dis}></label>`).join("")}</div>
        <p class="hint">Usado no cadastro do pagamento (Pgto locador › favorecido › “Copiar do cadastro do locador”).</p></div>
      ${ims.length ? `<div class="ficha-sec" data-sec="imv" hidden><div class="tw"><table class="compacta loc-imv"><thead><tr><th>Imóvel</th><th>Situação</th><th>Locatário</th><th>Entrada</th><th>Contrato</th><th>Venc.</th><th class="num">Aluguel</th><th class="num">T. Adm.</th></tr></thead><tbody>${ims.map(linhaImv).join("")}</tbody></table></div><p class="hint">Clique num imóvel para abrir a ficha dele.</p></div>` : ""}`,
    extra: (l.id && pode.editar() ? `<button type="button" class="btn" data-novoctt title="Abre o gerador de contratos já com os dados deste locador">📄 Novo contrato com este locador</button>` : "") + (l.id && pode.admin() && !ims.length ? `<button type="button" class="btn danger" data-del>Excluir</button>` : ""),
    aoAbrir: (fm, d) => {
      $$(".ficha-abas .aba", d).forEach(b => b.addEventListener("click", () => { $$(".ficha-abas .aba", d).forEach(x => x.classList.toggle("on", x === b)); $$(".ficha-sec", d).forEach(s => (s.hidden = s.dataset.sec !== b.dataset.aba)); }));
      $$("[data-f]", d).forEach(x => { const t = CPK[x.dataset.f].tipo; if (t === "tel") mascaraTel(x); if (t === "doc") mascaraDoc(x); });
      $$("[data-imv]", d).forEach(tr => tr.addEventListener("click", () => { d.close(); setTimeout(() => ACT["imv-ed"]({ dataset: { id: tr.dataset.imv } }), 0); }));
      const bn = $("[data-novoctt]", d); if (bn) bn.addEventListener("click", () => { d.close(); novoContratoPreenchido(l.nome, null); });
      const bp = $("[data-puxar]", d); if (bp) bp.addEventListener("click", async () => {
        const cs = await contratosDoLocador(l.nome);
        if (!cs.length) return toast("Nenhum contrato com dados de locador nos imóveis deste locador.", true);
        const sel = document.createElement("div"); sel.className = "box"; sel.innerHTML = `<b>Copiar os dados de qual contrato?</b> ${cs.slice(0, 12).map(c => `<button type="button" class="btn sm" data-c="${esc(c.codigo)}">${esc(c.codigo)} · ${esc(String(c.ficha.lcd1_nome).slice(0, 30))}</button>`).join(" ")}`;
        bp.parentElement.after(sel);
        $$("[data-c]", sel).forEach(b => b.addEventListener("click", () => {
          const c = cs.find(x => x.codigo === b.dataset.c), src = fichaLcdDe(c.ficha);
          LCD_KS().forEach(k => { const i = $(`[data-f="${k}"]`, d); if (!i) return; const v = src[k] || ""; const cp = CPK[k]; i.value = cp.tipo === "dext" && i.type === "date" ? dataDeTexto(v) : cp.tipo === "tel" ? fmtTel(v) : v; });
          sel.remove(); toast(`Dados copiados do contrato ${c.codigo}. Confira e salve.`);
        }));
      });
      const b = $("[data-del]", d); if (b) b.addEventListener("click", async () => { d.close(); if (!(await confirmar("Excluir locador", `Excluir <b>${esc(l.nome)}</b> do cadastro?`, "Excluir"))) return; try { await q(sb.from("locadores").delete().eq("id", l.id)); await recarregarLocadores(); toast("Excluído."); render(); } catch (e) { falha(e); } });
    },
    salvar: async (fm, d) => {
      const nome = fm.nome.value.trim().replace(/\s+/g, " ");
      if (!nome) throw new Error("Informe o título.");
      const fi = Object.assign({}, l.ficha || {}, lerFicha(d || $("#dlg"), {}));
      Object.keys(fi).forEach(k => { if (CPK[k] && CPK[k].sec !== "lcd") delete fi[k]; });
      PG_CAMPOS.forEach(([k]) => (fi[k] = fm[k].value.trim()));
      const u = Object.assign({ obs: fm.obs.value.trim(), ativo: fm.ativo.checked, ficha: fi }, planoLoc(fi));
      if (l.id) {
        if (nome !== l.nome) { if (!pedeConfirmacao(fm, `Renomear o título <b>${esc(l.nome)}</b> para <b>${esc(nome)}</b> em todo o sistema (${ims.length} imóvel(is), aluguéis, depósitos e grupos)?`, "Sim, renomear")) return false; await rpc("renomear_locador", { p_antigo: l.nome, p_novo: nome }); }
        await q(sb.from("locadores").update(u).eq("id", l.id));
      } else { if (locadorExiste(nome)) throw new Error("Já existe um locador com esse título."); await q(sb.from("locadores").insert(Object.assign({ nome }, u))); }
      await recarregarLocadores(); await recarregarImoveis(); toast("Salvo."); render();
    } });
};
// gerador de contratos já preenchido com o locador (e o imóvel, quando vier da ficha do imóvel)
async function novoContratoPreenchido(locNome, im) {
  try {
    CTT = await fetchAll("contratos", b => b.order("codigo", { ascending: false }));
    const l = locPor(locNome) || {}, f = Object.assign({}, l.ficha || {});
    Object.keys(f).forEach(k => { if (!CPK[k] || CPK[k].sec !== "lcd") delete f[k]; });
    if (!f.lcd1_nome) f.lcd1_nome = tiraPrefixo(locNome);
    if (im) Object.assign(f, { end_rua: im.endereco, end_cidade: "Monte Mor/SP", valor: im.valor ? n2(im.valor) : "" });
    const novo = proximoCodigo();
    await abrirTermo("gerador", "", novo, { prefill: { codigo: novo, ficha: f } });
  } catch (e) { falha(e); }
}

/* =====================================================================
   PÁGINA: PRESTADORES DE SERVIÇO E LOJAS
   ===================================================================== */
const ESPEC_FORN = { prestador: ["Pedreiro", "Pintor", "Eletricista", "Encanador", "Marceneiro", "Calheiro", "Serralheiro", "Vidraceiro", "Jardineiro", "Chaveiro", "Desentupidora", "Dedetização", "Limpeza", "Outros"],
  loja: ["Material de construção", "Loja de tintas", "Elétrica", "Hidráulica", "Madeireira", "Vidraçaria", "Ferragens", "Outros"] };
let FORN_GASTO = {};
const COLS_FORN = [
  { k: "nome", t: "Nome", cls: "trunc", fixo: true },
  { k: "tipo", t: "Tipo", v: x => x.tipo === "loja" ? "Loja" : "Prestador", html: x => `<span class="tag ${x.tipo === "loja" ? "info" : "warn"}">${x.tipo === "loja" ? "Loja" : "Prestador"}</span>` },
  { k: "especialidade", t: "Serviço / ramo", cls: "trunc" },
  { k: "tel", t: "Telefone", f: x => fmtTel(x.tel) },
  { k: "pix", t: "PIX", cls: "trunc" },
  { k: "qtd", t: "Lançamentos (12 meses)", tipo: "num", int: true, cls: "centro", v: x => (FORN_GASTO[x.id] || {}).n || null },
  { k: "total", t: "Total (12 meses)", tipo: "num", v: x => (FORN_GASTO[x.id] || {}).v || null },
  { k: "obs", t: "Obs.", cls: "trunc", oculta: true }
];
PAGES.fornecedores = async pg => {
  const [, ls] = await Promise.all([recarregarLocadores(), q(sb.from("lancamentos").select("fornecedor_id,valor").not("fornecedor_id", "is", null).gte("data", iso(new Date(Date.now() - 365 * 86400000)))).catch(() => [])]);
  FORN_GASTO = {}; ls.forEach(l => { const g = FORN_GASTO[l.fornecedor_id] = FORN_GASTO[l.fornecedor_id] || { n: 0, v: 0 }; g.n++; g.v = r2(g.v + +l.valor); });
  setRd(pg, () => desenharForn());
  desenharForn(pg);
};
function desenharForn(pg) {
  pg = pg || $("#page");
  const f = S.f.forn || "", busca = S.f.fornBusca || "";
  let lista = (S.fornecedores || []).filter(x => x.ativo && (!f || x.tipo === f));
  if (busca) { const b = norm(busca); lista = lista.filter(x => norm([x.nome, x.especialidade, x.tel, x.obs].join(" ")).includes(b)); }
  const g = grade("fornecedores", COLS_FORN, lista, { attr: x => `data-act="forn-ed" data-id="${x.id}" style="cursor:pointer"`, sort: { k: "nome", dir: "asc" }, divisor: "especialidade",
    rodape: fl => `${fl.length} cadastrados · gasto em 12 meses: ${brl(fl.reduce((a, x) => a + ((FORN_GASTO[x.id] || {}).v || 0), 0))}` });
  g.redesenhar = () => desenharForn();
  pg.innerHTML = `<div class="grid"><div class="filters"><div class="fgrupo"><span>Tipo</span>${[["", "Todos"], ["prestador", "Prestadores de serviço"], ["loja", "Lojas"]].map(([k, t]) => `<button class="chip${f === k ? " on" : ""}" data-act="chip" data-k="forn" data-v="${k}">${t}</button>`).join("")}</div>
    <input type="search" placeholder="Buscar nome, serviço, telefone…" value="${esc(busca)}" data-busca="fornBusca"><span class="spacer"></span>${gradeBarra("fornecedores")}
    ${pode.ed("fornecedores") || pode.ed("caixa") ? `<button class="btn pri" data-act="forn-ed">+ Cadastrar</button>` : ""}</div>
    ${gradeHTML("fornecedores")}
    <p class="hint">Nas despesas dos proprietários (Pgto locatário › Repassar ou Pgto locador › ±) escolha se é serviço ou material e quem fez/vendeu: assim dá para ver aqui quanto se gasta com cada um.</p></div>`;
  ligarBusca(pg);
}
ACT["forn-ed"] = async el => {
  const x = (S.fornecedores || []).find(y => y.id === el.dataset.id) || { tipo: "prestador", ativo: true };
  const ed = pode.ed("fornecedores") || pode.ed("caixa"), dis = ed ? "" : "disabled";
  const lancs = x.id ? await q(sb.from("lancamentos").select("data,valor,descricao,imovel_id,natureza").eq("fornecedor_id", x.id).order("data", { ascending: false }).limit(30)).catch(() => []) : [];
  modal({ titulo: x.id ? x.nome : "Novo prestador / loja", largo: true, semOk: !ed,
    corpo: `<div class="row"><label class="fl" style="grid-column:span 2"><span>Nome</span><input name="nome" value="${esc(x.nome || "")}" required ${dis}></label>
        <label class="fl"><span>Tipo</span><select name="tipo" ${dis}>${opt("prestador", "Prestador de serviço", x.tipo === "prestador")}${opt("loja", "Loja (material)", x.tipo === "loja")}</select></label></div>
      <div class="row"><label class="fl"><span>Serviço / ramo</span><input name="esp" list="dl-esp" value="${esc(x.especialidade || "")}" ${dis}><datalist id="dl-esp">${ESPEC_FORN.prestador.concat(ESPEC_FORN.loja).map(t => `<option value="${t}">`).join("")}</datalist></label>
        <label class="fl"><span>Telefone</span><input name="tel" value="${esc(fmtTel(x.tel || ""))}" ${dis}></label><label class="fl"><span>PIX</span><input name="pix" value="${esc(x.pix || "")}" ${dis}></label><label class="fl"><span>CPF / CNPJ</span><input name="doc" value="${esc(x.doc || "")}" ${dis}></label></div>
      <label class="fl"><span>Observações</span><textarea name="obs" rows="2" ${dis}>${esc(x.obs || "")}</textarea></label>
      <label class="chk"><input type="checkbox" name="ativo" ${x.ativo ? "checked" : ""} ${dis}> Ativo</label>
      ${lancs.length ? `<h3 style="margin-top:10px">Últimos lançamentos</h3><div class="tw"><table class="compacta"><tbody>${lancs.map(l => `<tr><td>${dt(l.data)}</td><td>${esc(l.natureza === "material" ? "Material" : l.natureza === "servico" ? "Serviço" : "")}</td><td class="trunc">${esc(l.descricao)}</td><td class="trunc">${esc((S.imovelPor[l.imovel_id] || {}).endereco || "")}</td><td class="num">${n2(l.valor)}</td></tr>`).join("")}</tbody></table></div>` : ""}`,
    extra: x.id && pode.admin() ? `<button type="button" class="btn danger" data-del>Excluir</button>` : "",
    aoAbrir: (f, d) => { mascaraTel(f.tel); const b = $("[data-del]", d); if (b) b.addEventListener("click", async () => { d.close(); if (!(await confirmar("Excluir", `Excluir <b>${esc(x.nome)}</b>? Prefira desmarcar "Ativo".`, "Excluir"))) return; try { await q(sb.from("fornecedores").delete().eq("id", x.id)); await recarregarLocadores(); toast("Excluído."); render(); } catch (e) { falha(e); } }); },
    salvar: async f => {
      const u = { nome: f.nome.value.trim(), tipo: f.tipo.value, especialidade: f.esp.value.trim(), tel: f.tel.value.replace(/\D/g, ""), pix: f.pix.value.trim(), doc: f.doc.value.trim(), obs: f.obs.value.trim(), ativo: f.ativo.checked };
      if (!u.nome) throw new Error("Informe o nome.");
      if (x.id) await q(sb.from("fornecedores").update(u).eq("id", x.id)); else await q(sb.from("fornecedores").insert(u));
      await recarregarLocadores(); toast("Salvo."); render();
    } });
};

/* =====================================================================
   PÁGINA: TUTORIAIS
   ===================================================================== */
// mini "telas" para ilustrar os passos
const ui = {
  menu: t => `<span class="tu-menu">☰ ${t}</span>`, btn: (t, pri) => `<span class="tu-btn${pri ? " pri" : ""}">${t}</span>`, campo: (r, v) => `<span class="tu-campo"><small>${r}</small>${v}</span>`,
  tag: (t, c) => `<span class="tag ${c}">${t}</span>`
};
const TUTORIAIS = [
  { id: "novo-imovel", titulo: "Imóvel novo: locador → imóvel → contrato", resumo: "A ordem certa para colocar um imóvel novo para alugar.", passos: [
    ["Cadastre o locador (se for novo)", `Vá em ${ui.menu("Cadastros › Locadores")} e clique ${ui.btn("+ Locador", 1)}. Preencha nome, CPF, telefone e PIX. O nome é o que vai aparecer no mapa e nos relatórios.`],
    ["Cadastre o imóvel", `Em ${ui.menu("Cadastros › Imóveis")} clique ${ui.btn("+ Imóvel", 1)}. Escolha o locador na lista (${ui.campo("Locador", "JOSÉ DA SILVA ▾")}). Se não estiver lá, use ${ui.btn("+ novo")}.`],
    ["Situação inicial: Livre", `O imóvel entra como ${ui.tag("Livre", "ok")}. Pode entrar como ${ui.tag("Ocupado", "warn")} ou ${ui.tag("Inativo", "bad")} (o sistema pede confirmação), mas nunca direto como Alugado.`],
    ["Faça o contrato", `Em ${ui.menu("Cadastros › Contratos")} use ${ui.btn("📄 Novo contrato", 1)} (gerador). Ao terminar, clique ${ui.btn("💾 Salvar no sistema", 1)}. O contrato fica ${ui.tag("Em elaboração", "warn")}.`],
    ["Ligue o contrato ao imóvel", `Abra o contrato e, embaixo, escolha ${ui.btn("Ligar a um imóvel LIVRE do mapa")}. Só aparecem imóveis livres.`],
    ["Pronto", `Ao salvar, o imóvel vira ${ui.tag("Alugado", "info")} e o contrato vira ${ui.tag("ATIVO", "ok")} sozinhos. O aluguel entra no Pgto locatário no próximo “Atualizar lista”.`]] },
  { id: "receber", titulo: "Receber um aluguel", resumo: "Registrar o pagamento do locatário (inclusive metade PIX, metade dinheiro).", passos: [
    ["Abra o mês", `${ui.menu("Financeiro › Pgto locatário")} — confira o mês no canto de cima.`],
    ["Encontre o aluguel", `Use a busca (imóvel, locatário ou locador) ou os filtros ${ui.tag("Em aberto", "bad")} ${ui.tag("Atrasados", "bad")}.`],
    ["Clique em Receber", `Na coluna Recebido, clique ${ui.btn("Receber", 1)}. Se tiver multa, juros, IPTU ou desconto, adicione em ${ui.btn("+ Acréscimo")} / ${ui.btn("− Desconto")} (multa já vem com 10%).`],
    ["Data, valor e conta", `Confira ${ui.campo("Valor recebido", "R$ 1.100,00")} e ${ui.campo("Entrou na conta", "Caixa Recepção ▾")}. Pagou em duas formas? Marque “Pago em duas formas”.`],
    ["Registrar", `Clique ${ui.btn("Registrar", 1)}. Entra no Caixa, gera o número do recibo e aparece em ${ui.menu("Recibos locatário")} para imprimir.`]] },
  { id: "estornar", titulo: "Desfazer (estornar) um pagamento ou repasse", resumo: "Quando lançou errado.", passos: [
    ["Abra o aluguel", `Em ${ui.menu("Pgto locatário")} clique na linha do aluguel.`],
    ["Repasse primeiro", `Se já foi repassado, clique ${ui.btn("Estornar repasse")} (o lançamento de saída some do Caixa).`],
    ["Depois o recebimento", `Clique ${ui.btn("Estornar recebimento")}. Os lançamentos do Caixa são apagados e o aluguel volta para ${ui.tag("Em aberto", "bad")}.`],
    ["Mês fechado?", `Se o mês já foi fechado em Configurações › Fechamento, o sistema não deixa: peça ao administrador para reabrir.`]] },
  { id: "repassar", titulo: "Repassar ao proprietário (com despesas)", resumo: "Pagar o locador, descontando reparos, materiais etc.", passos: [
    ["Pelo aluguel ou pelo locador", `Um a um: ${ui.menu("Pgto locatário")} › ${ui.btn("Repassar", 1)}. Vários de uma vez: ${ui.menu("Pgto locador")} › clique no favorecido.`],
    ["Despesas do proprietário", `Teve reparo ou material? Em “Despesas do proprietário” clique ${ui.btn("+ Despesa")}, escolha ${ui.campo("Tipo", "Serviço ▾")}, o prestador/loja e o valor. Vai para o Caixa e sai do repasse.`],
    ["Repasse sem receber", `Se o locatário ainda não pagou, dá para repassar mesmo assim (a imobiliária adianta). Isso é só interno: não aparece no relatório do proprietário.`],
    ["Registrar", `Confira valor, forma (PIX, depósito, dinheiro) e conta de saída, e clique ${ui.btn("Registrar repasse", 1)}. Gera o recibo do locador.`]] },
  { id: "saida", titulo: "Saída do locatário (encerrar contrato)", resumo: "Entrega de chaves, débitos e caução.", passos: [
    ["Pelo imóvel", `${ui.menu("Cadastros › Imóveis")} › clique no imóvel › ${ui.btn("🚪 Registrar saída do locatário")}.`],
    ["Data e situação", `Informe a data de saída e como o imóvel fica (${ui.tag("Livre", "ok")} normalmente).`],
    ["Ficou devendo?", `Marque “Ficou devendo”, os aluguéis em aberto e outros itens (pintura, contas…). O devedor vai para ${ui.menu("Cobrança › Devedores")}.`],
    ["Termos obrigatórios", `O termo de entrega de chaves abre em seguida. Com caução, faça a baixa em ${ui.menu("Contas caução")} (gera o termo de devolução).`],
    ["Resultado", `O contrato vira ${ui.tag("ENCERRADO", "info")} ou ${ui.tag("DÉBITO EM ABERTO", "bad")} e a data de encerramento é preenchida sozinha.`]] },
  { id: "fechamento", titulo: "Fechamento do mês", resumo: "Última sexta-feira do mês.", passos: [
    ["Confira o caixa", `${ui.menu("Caixa")}: compare cada conta com o extrato do banco. Lance o que faltar e marque os previstos pagos.`],
    ["Relatórios dos proprietários", `${ui.menu("Pgto locador")} › ${ui.btn("📄 Relatórios dos proprietários")}.`],
    ["Feche o mês", `${ui.menu("Configurações › Fechamento")} › ${ui.btn("Fechar até…", 1)}. Depois disso ninguém altera lançamentos daquele mês.`]] }
];
let TUT_DB = [];
PAGES.tutoriais = async pg => {
  TUT_DB = await q(sb.from("tutoriais").select("*").order("ordem").order("titulo")).catch(() => []);
  const ab = S.f.tut || TUTORIAIS[0].id;
  const todos = TUTORIAIS.map(t => ({ id: t.id, titulo: t.titulo, resumo: t.resumo, html: t.passos.map(([tt, txt], i) => `<div class="tu-passo"><b class="tu-n">${i + 1}</b><div><h3>${tt}</h3><p>${txt}</p></div></div>`).join("") }))
    .concat(TUT_DB.map(t => ({ id: t.id, titulo: t.titulo, resumo: "", db: t, html: t.conteudo.split(/\n+/).filter(Boolean).map((l, i) => `<div class="tu-passo"><b class="tu-n">${i + 1}</b><div><p>${esc(l)}</p></div></div>`).join("") })));
  const at = todos.find(t => t.id === ab) || todos[0];
  pg.innerHTML = `<div class="tu"><aside class="tu-lista">${todos.map(t => `<button class="tu-item${t === at ? " on" : ""}" data-act="chip" data-k="tut" data-v="${esc(t.id)}"><b>${esc(t.titulo)}</b>${t.resumo ? `<small>${esc(t.resumo)}</small>` : ""}</button>`).join("")}
      ${pode.admin() ? `<button class="btn sm" data-act="tut-ed">+ Novo tutorial</button>` : ""}</aside>
    <article class="tu-art"><h2>${esc(at.titulo)}</h2>${at.resumo ? `<p class="hint">${esc(at.resumo)}</p>` : ""}${at.html}
      ${at.db && pode.admin() ? `<p><button class="btn sm" data-act="tut-ed" data-id="${at.db.id}">Editar</button></p>` : ""}</article></div>`;
};
ACT["tut-ed"] = el => {
  const t = TUT_DB.find(x => x.id === el.dataset.id) || {};
  modal({ titulo: t.id ? "Editar tutorial" : "Novo tutorial", largo: true,
    corpo: `<label class="fl"><span>Título</span><input name="titulo" value="${esc(t.titulo || "")}" required></label>
      <label class="fl"><span>Passos (um por linha)</span><textarea name="conteudo" rows="12">${esc(t.conteudo || "")}</textarea></label>`,
    extra: t.id ? `<button type="button" class="btn danger" data-del>Excluir</button>` : "",
    aoAbrir: (f, d) => { const b = $("[data-del]", d); if (b) b.addEventListener("click", async () => { d.close(); try { await q(sb.from("tutoriais").delete().eq("id", t.id)); S.f.tut = ""; render(); } catch (e) { falha(e); } }); },
    salvar: async f => { const u = { titulo: f.titulo.value.trim(), conteudo: f.conteudo.value }; if (t.id) await q(sb.from("tutoriais").update(u).eq("id", t.id)); else { const r = await q(sb.from("tutoriais").insert(u).select().single()); S.f.tut = r.id; } render(); } });
};

/* =====================================================================
   RECIBOS (locatário e locador) — histórico e impressão, como no BRimob
   ===================================================================== */
let REC = [], REC_DESP = {};
const recTipo = pg => pg === "recibos_lcd" ? "locador" : "locatario";
// número da parcela: meses entre a entrada do locatário e o vencimento
function parcelaDe(c) {
  const im = S.imovelPor[c.imovel_id] || {}, ini = im.data_entrada;
  if (!ini || !c.vencimento) return "";
  const m = (+c.vencimento.slice(0, 4) - +ini.slice(0, 4)) * 12 + (+c.vencimento.slice(5, 7) - +ini.slice(5, 7));
  return Math.max(1, m);
}
const endRec = c => (S.imovelPor[c.imovel_id] || {}).endereco || "";
const COLS_REC_LCT = [
  { k: "recibo_locatario", t: "Nº", tipo: "num", int: true, w: 70, fixo: true },
  { k: "data_pagamento", t: "Pago em", tipo: "data", f: c => dt(c.data_pagamento) },
  { k: "imovel", t: "Imóvel", v: endRec, cls: "trunc" },
  { k: "locatario", t: "Locatário", cls: "trunc" },
  { k: "locador", t: "Locador", cls: "trunc", oculta: true },
  { k: "competencia", t: "Referente", v: c => c.competencia, f: c => mesCurto(c.competencia) },
  { k: "vencimento", t: "Vencimento", tipo: "data", f: c => dt(c.vencimento) },
  { k: "valor_pago", t: "Valor pago", tipo: "num" },
  { k: "imp", t: "", nf: true, w: 70, html: c => `<button class="btn sm" data-act="rec-ver" data-id="${c.id}">🧾 Ver</button>` }
];
const COLS_REC_LCD = [
  { k: "recibo_locador", t: "Nº", tipo: "num", int: true, w: 70, fixo: true },
  { k: "repasse_data", t: "Repassado em", tipo: "data", f: c => dt(c.repasse_data) },
  { k: "locador", t: "Locador", cls: "trunc" },
  { k: "imovel", t: "Imóvel", v: endRec, cls: "trunc" },
  { k: "locatario", t: "Locatário", cls: "trunc" },
  { k: "competencia", t: "Referente", v: c => c.competencia, f: c => mesCurto(c.competencia) },
  { k: "valor", t: "Aluguel", tipo: "num" },
  { k: "taxa", t: "Comissão", tipo: "num", v: c => calcCob(c).taxa },
  { k: "repasse_valor", t: "Valor repassado", tipo: "num" },
  { k: "imp", t: "", nf: true, w: 70, html: c => `<button class="btn sm" data-act="rec-ver" data-id="${c.id}">🧾 Ver</button>` }
];
const addMeses = (comp, n) => { const d = new Date(+comp.slice(0, 4), +comp.slice(5, 7) - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`; };
// busca por pessoa, grupo ou endereço: procura em todos os meses
async function carregarRecibos(tipo) {
  const col = tipo === "locador" ? "recibo_locador" : "recibo_locatario";
  const per = S.f.recPer || "mes", nb = (S.f.recBusca || "").trim(), txt = (S.f.recBuscaT || "").trim();
  const base = () => sb.from("cobrancas").select("*").not(col, "is", null);
  if (/^\d+$/.test(nb)) REC = await q(base().eq(col, +nb));
  else if (txt.length >= 3) {
    const t = norm(txt), por = new Map();
    // locadores pelo título, pelos nomes completos da ficha ou pelo grupo
    const locs = (S.locadores || []).filter(l => norm([l.nome, (l.ficha || {}).lcd1_nome, (l.ficha || {}).lcd2_nome, grupoDoLoc(l.nome)].join(" ")).includes(t)).map(l => l.nome);
    const ims = S.imoveis.filter(i => norm(i.endereco).includes(t)).map(i => i.id);
    const consultas = [fetchAll("cobrancas", b => b.not(col, "is", null).ilike("locatario", `%${txt}%`).order("id"))];
    if (tipo === "locador") consultas.push(fetchAll("cobrancas", b => b.not(col, "is", null).ilike("locador", `%${txt}%`).order("id")));
    for (let i = 0; i < locs.length; i += 80) { const p = locs.slice(i, i + 80); consultas.push(fetchAll("cobrancas", b => b.not(col, "is", null).in("locador", p).order("id"))); }
    for (let i = 0; i < ims.length; i += 80) { const p = ims.slice(i, i + 80); consultas.push(fetchAll("cobrancas", b => b.not(col, "is", null).in("imovel_id", p).order("id"))); }
    (await Promise.all(consultas)).flat().forEach(c => por.set(c.id, c));
    REC = [...por.values()];
  }
  else if (per === "mes") REC = await q(base().eq("competencia", S.mes).order(col, { ascending: false }).limit(3000));
  else if (per === "12") REC = await fetchAll("cobrancas", b => b.not(col, "is", null).gte("competencia", addMeses(S.mes, -11)).lte("competencia", S.mes).order("id"));
  else REC = await fetchAll("cobrancas", b => b.not(col, "is", null).order("id"));
  const comps = Array.from(new Set(REC.map(c => c.competencia)));
  REC_DESP = {};
  for (let i = 0; i < comps.length; i += 60) (await q(sb.from("lancamentos").select("id,imovel_id,valor,descricao,data,competencia").eq("desconta_repasse", true).in("competencia", comps.slice(i, i + 60))).catch(() => []))
    .forEach(l => (REC_DESP[l.imovel_id + l.competencia] = REC_DESP[l.imovel_id + l.competencia] || []).push(l));
}
async function paginaRecibos(pg) {
  const tipo = recTipo(S.page);
  if (!S.gruposCfg) S.gruposCfg = await q(sb.from("grupos_locador").select("nome,locadores")).catch(() => []);
  await carregarRecibos(tipo);
  setRd(pg, () => desenharRecibos());
  desenharRecibos(pg);
}
PAGES.recibos_lct = paginaRecibos;
PAGES.recibos_lcd = paginaRecibos;
function desenharRecibos(pg) {
  pg = pg || $("#page");
  const tipo = recTipo(S.page), id = "rec_" + tipo, per = S.f.recPer || "mes", txt = (S.f.recBuscaT || "").trim(), buscando = txt.length >= 3;
  const quem = c => tipo === "locador" ? c.locador : c.locatario, pessoa = S.f.recPessoa || "";
  // pessoas encontradas (clique para ver só os recibos dela)
  const pessoas = buscando ? Object.entries(REC.reduce((a, c) => { const n = quem(c); a[n] = (a[n] || 0) + 1; return a; }, {})).sort((a, b) => COLL.compare(a[0], b[0])) : [];
  let lista = buscando && pessoa ? REC.filter(c => quem(c) === pessoa) : REC;
  const g = grade(id, tipo === "locador" ? COLS_REC_LCD : COLS_REC_LCT, lista, { attr: c => `data-act="rec-ver" data-id="${c.id}" style="cursor:pointer"`,
    sort: buscando ? { k: "imovel", dir: "asc" } : { k: tipo === "locador" ? "recibo_locador" : "recibo_locatario", dir: "desc" }, divisor: buscando ? "imovel" : undefined,
    rodape: fl => `${fl.length} recibo(s) · ${brl(fl.reduce((a, c) => a + (+(tipo === "locador" ? c.repasse_valor : c.valor_pago) || 0), 0))}${buscando ? ` · ${new Set(fl.map(c => c.imovel_id)).size} imóvel(is)` : ""}`, vazio: buscando ? "Nada encontrado." : "Nenhum recibo neste período." });
  g.redesenhar = () => desenharRecibos();
  pg.innerHTML = `<div class="grid"><div class="filters">
      ${buscando ? `<span class="tag info">busca em todos os meses</span>` : `<div class="fgrupo"><span>Período</span>${[["mes", "Mês selecionado"], ["12", "Últimos 12 meses"], ["todos", "Todos"]].map(([k, t]) => `<button class="chip${per === k ? " on" : ""}" data-act="rec-per" data-v="${k}">${t}</button>`).join("")}</div>`}
      <input type="search" placeholder="Procurar ${tipo === "locador" ? "locador, grupo" : "locatário"} ou endereço (todos os meses)" style="min-width:300px" value="${esc(txt)}" data-rec-txt>
      <input type="search" inputmode="numeric" placeholder="Nº do recibo" style="width:120px" value="${esc(S.f.recBusca || "")}" data-rec-num>
      <span class="spacer"></span>${gradeBarra(id)}
      <button class="btn" data-act="rec-imp-todos">🖨 Imprimir os da lista</button>${tipo === "locatario" ? `<button class="btn" data-act="rec-quitacao" title="Declaração de quitação em A4 com os recibos da lista (de um locatário)">✅ Declaração de quitação</button>` : ""}
      ${pode.admin() ? `<button class="btn" data-act="rec-num">Numeração</button>` : ""}</div>
    ${pessoas.length > 1 ? `<div class="filters"><div class="chips">${[["", "Todos"]].concat(pessoas.map(([n]) => [n, n])).map(([k, t]) => `<button class="chip${pessoa === k ? " on" : ""}" data-act="rec-pessoa" data-v="${esc(k)}">${esc(t)}${k ? `<span class="c">${pessoas.find(p => p[0] === k)[1]}</span>` : ""}</button>`).join("")}</div></div>` : ""}
    ${gradeHTML(id)}
    <p class="hint">${buscando ? "Os recibos aparecem separados por imóvel. Clique num nome acima para ver só os dele." : tipo === "locador" ? "O recibo do locador é numerado quando o repasse é registrado. Estornar o repasse cancela o número." : "O recibo do locatário é numerado quando o pagamento é registrado em Pgto locatário › Receber. Estornar o recebimento cancela o número."}</p></div>`;
  const n = $("[data-rec-num]", pg); n.addEventListener("change", () => { S.f.recBusca = n.value.replace(/\D/g, ""); render(); });
  const t = $("[data-rec-txt]", pg); t.addEventListener("change", () => { S.f.recBuscaT = t.value.trim(); S.f.recPessoa = ""; S.f.recBusca = ""; render(); });
  t.addEventListener("search", () => { if (!t.value) { S.f.recBuscaT = ""; S.f.recPessoa = ""; render(); } });
}
ACT["rec-quitacao"] = () => {
  const g = G.rec_locatario, ls = (g && g.filtradas) || REC;
  const nomes = Array.from(new Set(ls.map(c => c.locatario)));
  if (!ls.length) return toast("Nenhum recibo na lista.", true);
  if (nomes.length > 1) return toast("A lista tem mais de um locatário: procure pelo nome e clique nele para ficar só os recibos dele.", true);
  const ends = Array.from(new Set(ls.map(endRec)));
  abrirDocEditavel("Declaração de quitação · " + nomes[0], quitacaoHTML(ls, `<b>${esc(nomes[0].toUpperCase())}</b>`, esc(ends.join("; ")), / - /.test(nomes[0])));
};
ACT["rec-per"] = el => { S.f.recPer = el.dataset.v; S.f.recBusca = ""; render(); };
ACT["rec-pessoa"] = el => { S.f.recPessoa = el.dataset.v; desenharRecibos(); };
// ---- o recibo: linhas fixas (bom para a matricial), sem marca d'água ----
const REC_LINHAS = 6;
function reciboHTML(c, tipo, via) {
  const im = S.imovelPor[c.imovel_id] || {}, k = calcCob(Object.assign({}, c)), aj = ajustesDe(c);
  const desp = REC_DESP[c.imovel_id + c.competencia] || (DESP[c.imovel_id] || []).filter(l => l.competencia === c.competencia);
  const itens = []; const lin = (t, v, neg) => itens.push([t, (neg ? "-" : "") + n2(v)]);
  let num, data, total, de, l4, assin;
  const ctt = im.contrato_codigo && im.locatario === c.locatario ? im.contrato_codigo : "";
  const locReal = nomeRealLocador(c.locador);
  if (tipo === "locador") {
    num = c.recibo_locador; data = c.repasse_data; total = +c.repasse_valor;
    de = TIMBRE.recebedor; l4 = `Locatário: <b>${esc(c.locatario)}</b>${ctt ? ` · Contrato nº <b>${esc(ctt)}</b>` : ""}`;
    const tx = c.taxa_valor != null ? +c.taxa_valor : k.taxa, pct = n2(c.taxa_adm_pct).replace(",00", "");
    lin("Aluguel", c.valor); aj.filter(x => x.tipo === "acr" && (x.de || "prop") === "prop").forEach(x => lin(ajRot(x) || "Acréscimo", x.valor));
    lin(`Comissão (taxa de administração ${pct}%)`, tx, true);
    aj.filter(x => x.tipo === "desc" && (x.de || "prop") === "prop").forEach(x => lin("Desconto: " + ajRot(x), x.valor, true));
    desp.forEach(l => lin((l.descricao || "Despesa") + (l.data ? " (" + dt(l.data) + ")" : ""), l.valor, true));
    const doc = docLocador(c.locador);
    assin = `${esc(locReal)}${doc ? "<br><small>CPF/CNPJ " + esc(doc) + "</small>" : ""}`;
  } else {
    num = c.recibo_locatario; data = c.data_pagamento; total = +c.valor_pago;
    de = c.locatario; l4 = `Locador: <b>${esc(locReal)}</b>${ctt ? ` · Contrato nº <b>${esc(ctt)}</b>` : ""}`;
    lin("Aluguel", c.valor); aj.filter(x => x.tipo === "acr").forEach(x => lin(ajRot(x) || "Acréscimo", x.valor));
    aj.filter(x => x.tipo === "desc").forEach(x => lin("Desconto: " + ajRot(x), x.valor, true));
    const soma = r2(+c.valor + aj.filter(x => x.tipo === "acr").reduce((a, x) => a + +x.valor, 0) - aj.filter(x => x.tipo === "desc").reduce((a, x) => a + +x.valor, 0));
    if (Math.abs(soma - total) > 0.005) lin(total > soma ? "Diferença (juros/arredondamento)" : "Pago a menor (saldo em aberto)", Math.abs(total - soma), total < soma);
    assin = esc(TIMBRE.razao.split(" — ")[0]);
  }
  while (itens.length < REC_LINHAS) itens.push(["", ""]);
  const parc = parcelaDe(c);
  return `<div class="recibo">
    <div class="rc-top"><svg class="rc-logo" aria-hidden="true"><use href="#logo-casa"/></svg><div class="rc-emp"><small>${esc(TIMBRE.razao)}</small><b>${esc(TIMBRE.nome)}</b></div>
      <div class="rc-tit">RECIBO ${tipo === "locador" ? "DO LOCADOR" : "DE ALUGUEL"}${via ? `<small>${esc(via)}</small>` : ""}</div><div class="rc-num">Nº <b>${num || "—"}</b></div><div class="rc-val">${brl(total)}</div></div>
    <div class="rc-l">Recebemos de: <b>${esc(de)}</b></div>
    <div class="rc-l">A quantia de: <b>${brl(total)}</b> (${esc(extensoReais(total).toLowerCase() || "zero real")})</div>
    <div class="rc-l">Referente: aluguel de <b>${esc(mesTxt(c.competencia))}</b> · imóvel <b>${esc(im.endereco || "")}</b></div>
    <div class="rc-l">${l4}</div>
    <table class="rc-desc"><thead><tr><th>Descritivo</th><th class="v">Valor (R$)</th></tr></thead><tbody>${itens.map(([t, v]) => `<tr><td>${esc(t) || "&nbsp;"}</td><td class="v">${v}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>TOTAL</td><td class="v">${n2(total)}</td></tr></tfoot></table>
    <div class="rc-pe"><span>Parcela / Vencimento: <b>${parc ? parc + " » " : ""}${dt(c.vencimento)}</b></span><span>${esc(TIMBRE.cidade)}, ${dataExt(data || hoje())}.</span></div>
    <div class="rc-ass"><div class="linha">${assin}</div></div>
    <div class="rc-rod">${esc(TIMBRE.rodape[0])} · ${esc(String(TIMBRE.rodape[1] || "").replace(/ – WhatsApp.*/, ""))}</div>
  </div>`;
}
// modos de impressão: meia folha (matricial, 2 vias no formulário contínuo) ou A4 com as duas vias para cortar
const REC_MODOS = { meia: "Matricial (24 × 14 cm)", a4: "A4 com 2 vias (cortar ao meio)" };
function recibosPaginas(lista, tipo, modo) {
  const v1 = tipo === "locador" ? "1ª via · locador" : "1ª via · locatário";
  if (modo === "a4") return lista.map(c => `<div class="rc-pg rc-a4">${reciboHTML(c, tipo, v1)}<div class="rc-corte">✂ · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · ·</div>${reciboHTML(c, tipo, "2ª via · imobiliária")}</div>`).join("");
  return lista.map(c => `<div class="rc-pg rc-meia">${reciboHTML(c, tipo)}</div>`).join("");
}
function imprimirRecibos(html, modo) {
  const area = $("#print-area"); area.innerHTML = `<div class="rc-print">${html}</div>`;
  let pgs = $("#print-page"); if (!pgs) { pgs = document.createElement("style"); pgs.id = "print-page"; document.head.appendChild(pgs); }
  pgs.textContent = modo === "a4" ? "@media print{@page{size:A4 portrait;margin:8mm 10mm}}" : "@media print{@page{size:240mm 140mm;margin:5mm 10mm}}";
  document.body.classList.add("imprimindo");
  const fim = () => { document.body.classList.remove("imprimindo"); area.innerHTML = ""; window.removeEventListener("afterprint", fim); };
  window.addEventListener("afterprint", fim);
  setTimeout(() => window.print(), 50);
}
function abrirRecibos(titulo, lista, tipo) {
  let modo = lsGet("recModo", "meia"); if (!REC_MODOS[modo]) modo = "meia";
  modal({ titulo, largo: true, semOk: true,
    extra: `<div class="seg" style="margin-right:auto">${Object.entries(REC_MODOS).map(([k, t]) => `<button type="button" data-modo="${k}" class="${k === modo ? "on" : ""}">${t}</button>`).join("")}</div><button type="button" class="btn pri" data-imp>🖨 Imprimir</button>`,
    corpo: `<div class="rel-prev rc-prev" data-prev></div>`,
    aoAbrir: (f, d) => {
      const desenha = () => { $("[data-prev]", d).innerHTML = recibosPaginas(lista, tipo, modo); $$("[data-modo]", d).forEach(b => b.classList.toggle("on", b.dataset.modo === modo)); };
      $$("[data-modo]", d).forEach(b => b.addEventListener("click", () => { modo = b.dataset.modo; lsSet("recModo", modo); desenha(); }));
      $("[data-imp]", d).addEventListener("click", () => imprimirRecibos(recibosPaginas(lista, tipo, modo), modo));
      desenha();
    } });
}
ACT["rec-ver"] = el => {
  const c = REC.find(x => x.id === el.dataset.id) || (typeof COB !== "undefined" ? COB.find(x => x.id === el.dataset.id) : null); if (!c) return;
  const tipo = el.dataset.tipo || recTipo(S.page);
  abrirRecibos(`Recibo nº ${(tipo === "locador" ? c.recibo_locador : c.recibo_locatario) || ""}`, [c], tipo);
};
ACT["rec-imp-todos"] = () => {
  const tipo = recTipo(S.page), g = G["rec_" + tipo], lista = g && g.filtradas ? g.filtradas : REC;
  if (!lista.length) return toast("Nenhum recibo na lista.");
  if (lista.length > 200) return toast("Mais de 200 recibos: filtre um período menor.");
  abrirRecibos(`${lista.length} recibo(s)`, lista.slice().sort((a, b) => (tipo === "locador" ? a.recibo_locador - b.recibo_locador : a.recibo_locatario - b.recibo_locatario)), tipo);
};
ACT["rec-num"] = async () => {
  const p = await rpc("proximos_recibos", {}).catch(() => ({}));
  modal({ titulo: "Numeração dos recibos",
    corpo: `<p class="hint">Escolha o número do <b>próximo</b> recibo (por exemplo, para continuar a numeração do BRimob). Recibos já emitidos não mudam.</p>
      <div class="row"><label class="fl"><span>Próximo recibo do locatário</span><input name="lct" inputmode="numeric" value="${(p && p.locatario) || ""}"></label>
      <label class="fl"><span>Próximo recibo do locador</span><input name="lcd" inputmode="numeric" value="${(p && p.locador) || ""}"></label></div>`,
    salvar: async f => {
      const a = +f.lct.value, b = +f.lcd.value;
      if (a && a !== +(p || {}).locatario) await rpc("ajustar_recibo", { p_tipo: "locatario", p_proximo: a });
      if (b && b !== +(p || {}).locador) await rpc("ajustar_recibo", { p_tipo: "locador", p_proximo: b });
      toast("Numeração ajustada.");
    } });
};

/* ---- Backup e dados: Excel (todos), importar e zerar (somente o administrador) ---- */
const xlsCols = async (nome, aba, cols, linhas) => baixarXLSX(nome, { [aba]: linhas.map(r => Object.fromEntries(cols.filter(c => !c.nf && c.t).map(c => { let v; try { v = gVal(c, r); } catch (e) { v = ""; } return [c.t, c.tipo === "num" ? (v == null || v === "" ? "" : +v) : (() => { try { return gTxt(c, r); } catch (e) { return v == null ? "" : String(v); } })()]; }))) });
// v13: na mesma ordem do menu; Excel para todos, Importar e Zerar só o administrador (sempre com confirmação)
const DADOS = [
  { k: "caixa", t: "Caixa (lançamentos)", ver: "caixa", dica: "todos os lançamentos, de todos os meses", zerar: "movimento",
    xls: async () => { const ls = await fetchAll("lancamentos", b => b.order("data").order("id")); await xlsCols(`caixa-${hoje()}.xlsx`, "Lancamentos", COLS_LANC, ls); } },
  { k: "alugueis", t: "Pgto locatário (aluguéis)", ver: "alugueis", dica: "aluguéis de todos os meses", zerar: "movimento",
    xls: async () => { const ls = await fetchAll("cobrancas", b => b.order("competencia").order("id")); await xlsCols(`alugueis-${hoje()}.xlsx`, "Alugueis", COLS_COB, ls); } },
  { k: "favorecidos", t: "Pgto locador (favorecidos)", ver: "depositos", dica: "quem recebe o depósito, forma, conta e locadores ligados", imp: "dep-importar", zerar: "favorecidos",
    pre: async () => { DEP.favs = await q(sb.from("depositos_fav").select("*")); },
    xls: async () => { const fs = await q(sb.from("depositos_fav").select("*").order("dia").order("nome")); await baixarXLSX(`favorecidos-${hoje()}.xlsx`, { Favorecidos: fs.map(f => ({ Favorecido: f.nome, Dia: f.dia || "", Forma: FORMAS[f.forma] || f.forma || "", "Conta / PIX": f.conta_bancaria || "", Locadores: (f.locadores || []).join(" · "), Ativo: f.ativo ? "sim" : "não", Obs: f.obs || "" })) }); } },
  { k: "inadimplencia", t: "Cobrança · inadimplência", ver: "atrasados", dica: "aluguéis vencidos e não pagos",
    xls: async () => { const ls = await fetchAll("cobrancas", b => b.is("data_pagamento", null).is("devedor_id", null).lt("vencimento", hoje()).order("vencimento").order("id")); await xlsCols(`inadimplencia-${hoje()}.xlsx`, "Inadimplencia", COLS_COB, ls); } },
  { k: "devedores", t: "Cobrança · devedores", ver: "devedores", dica: "importar: contratos com situação “débito” da planilha de contratos", imp: "dev-importar", zerar: "devedores",
    xls: async () => { const ds = await q(sb.from("devedores").select("*").order("devedor")); await xlsCols(`devedores-${hoje()}.xlsx`, "Devedores", COLS_DEV, ds); } },
  { k: "recibos", t: "Recibos (locatário e locador)", ver: "recibos", dica: "todos os aluguéis com recibo numerado",
    xls: async () => { const [a, b2] = await Promise.all([fetchAll("cobrancas", b => b.not("recibo_locatario", "is", null).order("recibo_locatario")), fetchAll("cobrancas", b => b.not("recibo_locador", "is", null).order("recibo_locador"))]);
      await baixarXLSX(`recibos-${hoje()}.xlsx`, { "Recibos locatário": a.map(c => ({ "Nº": c.recibo_locatario, "Pago em": c.data_pagamento, Imóvel: endRec(c), Locatário: c.locatario, Referente: mesCurto(c.competencia), Valor: +c.valor_pago })),
        "Recibos locador": b2.map(c => ({ "Nº": c.recibo_locador, "Repassado em": c.repasse_data, Locador: c.locador, Imóvel: endRec(c), Referente: mesCurto(c.competencia), Valor: +c.repasse_valor })) }); } },
  { k: "notas", t: "Notas fiscais", ver: "notas", dica: "notas registradas (número, tomador, valor)", zerar: "notas",
    xls: async () => { const ns = await q(sb.from("notas_fiscais").select("*").order("competencia").order("numero")); await baixarXLSX(`notas-fiscais-${hoje()}.xlsx`, { Notas: ns.map(n => ({ Mês: mesCurto(n.competencia), Origem: n.origem, Referente: n.descricao, Tomador: n.tomador, "CPF/CNPJ": n.tomador_doc, Valor: +n.valor, "Nº": n.numero, "Emitida em": n.emitida_em || "", Obs: n.obs })) }); } },
  { k: "locadores", t: "Locadores", ver: "locadores", dica: "importar: planilha baixada daqui (título e dados simples); zerar apaga só os que não têm imóvel", imp: "gen-importar", zerar: "locadores",
    xls: async () => { await recarregarLocadores(); await xlsCols(`locadores-${hoje()}.xlsx`, "Locadores", COLS_LOC, S.locadores); } },
  { k: "imoveis", t: "Imóveis (mapa do aluguel)", ver: "imoveis", dica: "zerar apaga imóveis, contratos, aluguéis e caixa juntos (tudo do movimento)", zerar: "movimento",
    xls: async () => xlsCols(`imoveis-${hoje()}.xlsx`, "Imoveis", COLS_IMV, S.imoveis) },
  { k: "cpfl", t: "Imóveis · CPFL e SABESP", ver: "imoveis", dica: "importar: conferência da lista antiga (arquivo da pasta 4 do pacote)", imp: "cpfl-importar", xls: () => ACT["cpfl-xls"]() },
  { k: "contratos", t: "Contratos", ver: "contratos", dica: "fichas completas (todas as colunas do Excel)", imp: "ctt-importar", zerar: "contratos",
    pre: async () => { CTT = await fetchAll("contratos", b => b.order("codigo", { ascending: false })); },
    xls: async () => { CTT = await fetchAll("contratos", b => b.order("codigo", { ascending: false })); await xlsCols(`contratos-${hoje()}.xlsx`, "Contratos", COLS_CTT, CTT); } },
  { k: "caucao", t: "Contas caução", ver: "caucao", dica: "contas, saldos e vínculos", imp: "cauc-importar", zerar: "caucao",
    pre: async () => { CTT = await fetchAll("contratos", b => b.order("codigo", { ascending: false })); await carregarCauc(); },
    xls: async () => { await carregarCauc(); await xlsCols(`contas-caucao-${hoje()}.xlsx`, "Contas caução", COLS_CAUC, CAUC.contas); } },
  { k: "fornecedores", t: "Prestadores e lojas", ver: "fornecedores", dica: "importar: planilha baixada daqui", imp: "gen-importar", zerar: "fornecedores",
    xls: async () => { await recarregarLocadores(); await xlsCols(`prestadores-lojas-${hoje()}.xlsx`, "Prestadores", COLS_FORN, S.fornecedores); } },
  { k: "vendas", t: "Vendas", ver: "vendas", imp: "ven-importar", zerar: "vendas",
    xls: async () => { const [vs, its] = await Promise.all([q(sb.from("vendas").select("*").order("codigo", { ascending: false })), q(sb.from("venda_itens").select("*")).catch(() => [])]); VEN = vs; VIT = {}; its.forEach(i => (VIT[i.venda_id] = VIT[i.venda_id] || []).push(i)); await xlsCols(`vendas-${hoje()}.xlsx`, "Vendas", COLS_VEN, VEN); } },
  { k: "tarefas", t: "Tarefas", ver: "tarefas", dica: "importar: planilha baixada daqui", imp: "gen-importar", zerar: "tarefas",
    xls: async () => { const ls = await q(sb.from("tarefas").select("*").order("titulo")); await baixarXLSX(`tarefas-${hoje()}.xlsx`, { Tarefas: ls.map(t => ({ Tarefa: t.titulo, Detalhes: t.descricao, Frequencia: t.frequencia, "Dia da semana": t.dia_semana ?? "", "Dia do mês": t.dia_mes ?? "", Regra: t.regra || "", Prazo: t.prazo || "", Prioridade: t.prioridade, Ativa: t.ativa ? "sim" : "não" })) }); } }
];
const ZERAR_TXT = { caucao: "todas as contas caução e o histórico de entradas e baixas (os contratos não são apagados)", vendas: "todas as vendas, parcelas e custas",
  favorecidos: "todos os favorecidos de depósito e o registro mensal dos depósitos (repasses e Caixa não são apagados)", fornecedores: "todos os prestadores e lojas (os lançamentos do Caixa ficam, só sem o prestador)",
  locadores: "os locadores que não têm nenhum imóvel ligado", notas: "todos os registros de notas fiscais", tarefas: "todas as tarefas", devedores: "todos os devedores (ex-locatários) e os pagamentos registrados neles",
  contratos: "todas as fichas de contratos (os imóveis, aluguéis e o Caixa ficam)", movimento: "TUDO do movimento: imóveis, contratos, aluguéis, Caixa, devedores, histórico do mapa e notas (ficam usuários, contas, plano de contas, locadores, grupos, favorecidos, contas caução e vendas)" };
ACT["dado-xls"] = async el => { const d = DADOS.find(x => x.k === el.dataset.k); el.disabled = true; try { await d.xls(); } catch (e) { falha(e); } el.disabled = false; };
ACT["dado-imp"] = async el => {
  if (!pode.admin()) return;
  const d = DADOS.find(x => x.k === el.dataset.k);
  if (!(await confirmar("Importar · " + d.t, `Importar uma planilha em <b>${esc(d.t)}</b>? Os dados do sistema podem ser criados ou alterados. Faça um backup antes.`, "Sim, escolher o arquivo"))) return;
  try { if (d.pre) await d.pre(); ACT[d.imp](el); } catch (e) { falha(e); }
};
ACT["dado-zerar"] = el => {
  if (!pode.admin()) return;
  const d = DADOS.find(x => x.k === el.dataset.k);
  modal({ titulo: "Zerar · " + d.t, ok: "Apagar",
    corpo: `<div class="box bad">Apaga <b>${ZERAR_TXT[d.zerar]}</b>. Faça um backup antes. Não dá para desfazer (só restaurando o backup).</div><label class="fl"><span>Para confirmar, digite ZERAR</span><input name="conf" autocomplete="off"></label>`,
    salvar: async f => { if (f.conf.value.trim().toUpperCase() !== "ZERAR") throw new Error("Digite ZERAR para confirmar."); await rpc("zerar_dados", { p_alvo: d.zerar, p_confirma: "ZERAR" }); await recarregarLocadores(); if (d.zerar === "movimento") await recarregarImoveis(); toast("Apagado."); render(); } });
};
// importação genérica: a planilha baixada aqui (mesmos títulos de coluna) volta para o sistema
const GEN_IMP = {
  locadores: { tabela: "locadores", chave: "nome", campos: { "Locador (título)": "nome", "Telefone": "tel", "E-mail": "email", "Obs.": "obs" } },
  fornecedores: { tabela: "fornecedores", chave: "nome", campos: { Nome: "nome", Tipo: "tipo", "Serviço / ramo": "especialidade", Telefone: "tel", PIX: "pix", "Obs.": "obs" }, conv: { tipo: v => /loja/i.test(v) ? "loja" : "prestador" } },
  tarefas: { tabela: "tarefas", chave: "titulo", campos: { Tarefa: "titulo", Detalhes: "descricao", Frequencia: "frequencia", "Dia da semana": "dia_semana", "Dia do mês": "dia_mes", Regra: "regra", Prazo: "prazo", Prioridade: "prioridade", Ativa: "ativa" },
    conv: { dia_semana: v => v === "" ? null : +v, dia_mes: v => v === "" ? null : +v, prazo: v => v || null, ativa: v => !/n[aã]o|false/i.test(String(v)), frequencia: v => ["unica", "diaria", "semanal", "mensal"].includes(v) ? v : "unica", prioridade: v => ["alta", "normal", "baixa"].includes(v) ? v : "normal" } }
};
ACT["gen-importar"] = el => {
  const cfg = GEN_IMP[el.dataset.k]; let linhas = null;
  modal({ titulo: "Importar planilha", largo: true, ok: "Importar",
    corpo: `<p>Use a planilha baixada no botão <b>Excel</b> desta mesma linha (pode editar e incluir linhas). Linhas com o mesmo <b>${esc(Object.keys(cfg.campos).find(k => cfg.campos[k] === cfg.chave))}</b> são atualizadas; as novas são criadas. Nada é apagado.</p>
      <input type="file" data-arq accept=".xlsx,.xls"><div data-res></div>`,
    aoAbrir: (f, d) => $("[data-arq]", d).addEventListener("change", async e => {
      const arq = e.target.files[0]; if (!arq) return;
      try { await carregarXLSX(); const wb = XLSX.read(await arq.arrayBuffer(), { type: "array", cellDates: true }); const ws = wb.Sheets[wb.SheetNames[0]];
        linhas = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false }).map(r => { const o = {}; Object.entries(cfg.campos).forEach(([t, k]) => { if (t in r) o[k] = (cfg.conv && cfg.conv[k]) ? cfg.conv[k](String(r[t]).trim()) : String(r[t]).trim(); }); return o; }).filter(o => o[cfg.chave]);
        $("[data-res]", d).innerHTML = `<div class="box">${linhas.length} linha(s) lidas.</div>`;
      } catch (x) { $("[data-res]", d).innerHTML = `<div class="box bad">${esc(erroMsg(x))}</div>`; }
    }),
    salvar: async () => {
      if (!linhas || !linhas.length) throw new Error("Escolha a planilha.");
      const atuais = await q(sb.from(cfg.tabela).select("id," + cfg.chave)); const por = new Map(atuais.map(a => [a[cfg.chave], a.id])); let n = 0, u = 0;
      for (const o of linhas) { if (por.has(o[cfg.chave])) { await q(sb.from(cfg.tabela).update(o).eq("id", por.get(o[cfg.chave]))); u++; } else { await q(sb.from(cfg.tabela).insert(o)); n++; } }
      await recarregarLocadores(); toast(`${n} criado(s), ${u} atualizado(s).`); render();
    } });
};

/* =====================================================================
   COBRANÇA: inadimplência por mês, lista para imprimir e termos
   ===================================================================== */
const COLS_INAD_MES = [
  { k: "vencimento", t: "Venc.", tipo: "data", f: c => dt(c.vencimento) },
  { k: "imovel", t: "Imóvel", v: c => (S.imovelPor[c.imovel_id] || {}).endereco || "?", cls: "trunc" },
  { k: "locatario", t: "Locatário", cls: "trunc" },
  { k: "locador", t: "Locador", cls: "trunc" },
  { k: "dias", t: "Dias", tipo: "num", int: true, v: c => diasEntre(c.vencimento, hoje()) },
  { k: "devido", t: "Valor", tipo: "num", v: devido, html: c => `<b class="neg">${n2(devido(c))}</b>` },
  { k: "outros", t: "Outros meses em aberto", v: c => INAD.filter(x => x.id === c.imovel_id).flatMap(x => x.cobs).filter(o => o.id !== c.id).map(o => mesCurto(o.competencia)).join(", "), cls: "trunc" },
  { k: "acoes", t: "Ações", nf: true, fixo: true, html: c => `<span class="acts"><button class="btn sm" data-act="ir-mes" data-m="${c.competencia}" data-imv="${c.imovel_id}">Abrir no Pgto locatário</button><button class="btn sm" data-act="cob-termo" data-src="inad" data-id="${c.imovel_id}">📄 Termos</button></span>` }
];
// "Abrir mês": vai para o Pgto locatário daquele mês, já filtrado no imóvel
ACT["ir-mes"] = el => {
  S.mes = el.dataset.m; ssSet("mes", S.mes); S.f.cob = "todos";
  S.f.cobBusca = el.dataset.imv ? (S.imovelPor[el.dataset.imv] || {}).endereco || "" : "";
  location.hash = "#alugueis";
};
function desenharAtrasados(pg) {
  pg = pg || $("#page");
  const per = S.f.inadPer || "mes";
  const cobsMes = INAD.flatMap(x => x.cobs).filter(c => c.competencia === S.mes);
  const lista = per === "mes" ? cobsMes : INAD;
  const total = per === "mes" ? cobsMes.reduce((a, c) => a + devido(c), 0) : INAD.reduce((a, x) => a + x.total, 0);
  const faixa = { "até 30 dias": 0, "31 a 60": 0, "61 a 90": 0, "mais de 90": 0 };
  INAD.forEach(x => { faixa[x.dias <= 30 ? "até 30 dias" : x.dias <= 60 ? "31 a 60" : x.dias <= 90 ? "61 a 90" : "mais de 90"] += x.total; });
  const g = per === "mes"
    ? grade("inadmes", COLS_INAD_MES, cobsMes, { sort: { k: "vencimento", dir: "asc" }, vazio: `Nenhum aluguel de ${mesTxt(S.mes)} em atraso. 🎉`, rodape: fl => `${fl.length} aluguéis · ${brl(fl.reduce((a, c) => a + devido(c), 0))}` })
    : grade("inad", COLS_INAD, INAD, { sort: { k: "dias", dir: "desc" }, vazio: "Nenhum aluguel em atraso. 🎉", rodape: fl => `${fl.length} imóveis · total ${brl(fl.reduce((a, x) => a + x.total, 0))}` });
  g.redesenhar = () => desenharAtrasados();
  pg.innerHTML = `<div class="grid">${cobrancaAbas("atrasados")}
    <div class="kpis">${kpi(per === "mes" ? "Em atraso de " + mesTxt(S.mes) : "Total em atraso", `<span class="neg">${brl(total)}</span>`, per === "mes" ? `${cobsMes.length} aluguéis` : `${INAD.reduce((a, x) => a + x.cobs.length, 0)} aluguéis · ${INAD.length} imóveis`, true)}
      ${Object.entries(faixa).map(([k, v]) => kpi(k, brl(v), "todos os meses")).join("")}</div>
    <div class="filters"><div class="fgrupo"><span>Mostrar</span>${[["mes", "Mês selecionado (" + mesCurto(S.mes) + ")"], ["todos", "Todos os meses (por imóvel)"]].map(([k, t]) => `<button class="chip${per === k ? " on" : ""}" data-act="chip" data-k="inadPer" data-v="${k}">${t}</button>`).join("")}</div>
      <span class="hint">Aluguéis vencidos e não pagos. Para dar baixa, abra no Pgto locatário.</span><span class="spacer"></span>${gradeBarra(per === "mes" ? "inadmes" : "inad")}
      <button class="btn" data-act="cob-termos-menu">📄 Termos ▾</button><button class="btn" data-act="inad-imp">🖨 Lista de inadimplentes</button></div>
    ${gradeHTML(per === "mes" ? "inadmes" : "inad")}
  </div>`;
}
ACT["xls-inad"] = () => (S.f.inadPer || "mes") === "mes" ? exportarGrade("inadmes", `inadimplencia-${S.mes.slice(0, 7)}.xlsx`, "Inadimplencia") : exportarGrade("inad", `inadimplencia-${hoje()}.xlsx`, "Inadimplencia");
ACT["inad-imp"] = () => {
  const per = S.f.inadPer || "mes", g = G[per === "mes" ? "inadmes" : "inad"], fl = (g && g.filtradas) || [];
  const end = id => (S.imovelPor[id] || {}).endereco || "";
  const linhas = per === "mes"
    ? fl.map((c, i) => `<tr><td>${i + 1}</td><td>${dt(c.vencimento)}</td><td>${esc(end(c.imovel_id))}</td><td>${esc(c.locatario)}</td><td>${esc(c.locador)}</td><td class="num">${diasEntre(c.vencimento, hoje())}</td><td class="num">${n2(devido(c))}</td></tr>`).join("")
    : fl.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.meses.join(", "))}</td><td>${esc(x.imovel)}</td><td>${esc(x.locatario)}</td><td>${esc(x.locador)}</td><td class="num">${x.dias}</td><td class="num">${n2(x.total)}</td></tr>`).join("");
  const tot = per === "mes" ? fl.reduce((a, c) => a + devido(c), 0) : fl.reduce((a, x) => a + x.total, 0);
  abrirRelatorio("Inadimplentes", `<div class="rel-tit"><b>Inadimplentes${per === "mes" ? " · " + esc(mesTxt(S.mes)) : " · todos os meses"}</b><span>posição em ${dt(hoje())}</span></div>
    <table class="rel-t"><thead><tr><th>#</th><th>${per === "mes" ? "Venc." : "Meses"}</th><th>Imóvel</th><th>Locatário</th><th>Locador</th><th class="num">Dias</th><th class="num">Valor</th></tr></thead>
    <tbody>${linhas || `<tr><td colspan="8">Nenhum inadimplente.</td></tr>`}</tbody><tfoot><tr><td colspan="6"><b>Total</b></td><td class="num"><b>${n2(tot)}</b></td></tr></tfoot></table>`, { paisagem: true });
};

// ---- dados das partes (qualificação), a partir da ficha do contrato ----
function qualifPessoa(f, p) {
  const v = k => String(f[p + "_" + k] || "").trim(), nome = v("nome");
  if (!nome) return "";
  const fem = /^f/i.test(v("sexo")), pj = /PJ/i.test(f[p.slice(0, 3) + "_qtd"] || "") && p.endsWith("1");
  if (pj) return `<b>${esc(nome.toUpperCase())}</b>, pessoa jurídica de direito privado, inscrita no CNPJ sob nº ${esc(v("cpf"))}`;
  const resto = [v("nac") || (fem ? "brasileira" : "brasileiro"), v("est_civil"), v("prof"), v("rg") ? `portador${fem ? "a" : ""} do RG/${v("oe") || "SSP/SP"} nº ${v("rg")}` : "", v("cpf") ? `inscrit${fem ? "a" : "o"} no CPF/MF sob nº ${v("cpf")}` : ""].filter(Boolean);
  return [`<b>${esc(nome.toUpperCase())}</b>`].concat(resto.map(esc)).join(", ");
}
function qualifGrupo(f, g) {
  const a = qualifPessoa(f, g + "1"), b = qualifPessoa(f, g + "2"), pj = /PJ/i.test(f[g + "_qtd"] || "");
  const end = [f[g + "_end1_rua"], f[g + "_end1_bairro"], f[g + "_end1_cidade"]].filter(Boolean).join(" – ");
  let t = a;
  if (b) t += pj ? `, neste ato representada por ${b}` : `; e ${b}`;
  return t + (end ? `, ${b && !pj ? "residentes" : pj ? "com sede" : "residente"} na ${esc(end)}` : "");
}
const nomesGrupo = (f, g) => [f[g + "1_nome"], /PJ/i.test(f[g + "_qtd"] || "") ? "" : f[g + "2_nome"]].filter(Boolean);
const endImovelFicha = (f, c) => [f.end_rua || (c && c.endereco), f.end_bairro, f.end_cidade].filter(Boolean).join(" – ");

// documento editável com papel timbrado (o texto pode ser corrigido antes de imprimir)
function abrirDocEditavel(titulo, corpo, opts) {
  opts = opts || {};
  const montar = (el, timbre) => timbre ? timbrado(el) : `<div class="relatorio sem-timbre">${el}</div>`;
  modal({ titulo, xl: true, semOk: true,
    extra: `<label class="chk" style="margin-right:auto"><input type="checkbox" data-tb ${opts.semTimbre ? "" : "checked"}> papel timbrado</label><button type="button" class="btn pri" data-imp>🖨 Imprimir / salvar PDF</button>`,
    corpo: `<p class="hint">✏️ Clique no texto para corrigir ou completar antes de imprimir (as alterações não ficam salvas no sistema).</p><div class="rel-prev"><div class="doc-ed" contenteditable="true" spellcheck="true">${corpo}</div></div>`,
    aoAbrir: (f, d) => $("[data-imp]", d).addEventListener("click", () => { imprimir(montar(`<div class="doc-ed">${$(".doc-ed", d).innerHTML}</div>`, $("[data-tb]", d).checked)); if (opts.aoImprimir) { opts.aoImprimir(); opts.aoImprimir = null; } }) });
}

const TERMOS_COB = {
  notificacao: "Notificação extrajudicial de cobrança",
  acordo: "Instrumento de acordo / confissão de dívida",
  despejo: "Petição: ação de despejo por falta de pagamento"
};
ACT["cob-termo"] = async el => {
  try {
    let ctt = null, debitos = [], nomeDev = "", imv = null, dev = null;
    if (el.dataset.src === "dev") {
      dev = (DEV || []).find(x => x.id === el.dataset.id); if (!dev) return;
      if (dev.contrato_codigo) ctt = await q(sb.from("contratos").select("*").eq("codigo", dev.contrato_codigo).maybeSingle());
      imv = dev.imovel_id ? S.imovelPor[dev.imovel_id] : null; nomeDev = dev.devedor;
      debitos = (dev.itens || []).map(x => ({ desc: x.descricao, valor: +x.valor || 0, venc: x.venc || null }));
      if (+dev.valor_pago) debitos.push({ desc: "(−) Pagamentos já feitos", valor: -(+dev.valor_pago) });
    } else {
      const x = INAD.find(y => y.id === el.dataset.id); if (!x) return;
      imv = S.imovelPor[x.id]; nomeDev = x.locatario;
      if (imv && imv.contrato_codigo) ctt = await q(sb.from("contratos").select("*").eq("codigo", imv.contrato_codigo).maybeSingle());
      debitos = x.cobs.map(c => ({ desc: "Aluguel " + mesCurto(c.competencia), venc: c.vencimento, valor: devido(c), aluguel: +c.valor }));
    }
    const ficha = ctt ? fichaDe(ctt) : {}, total = r2(debitos.reduce((a, d) => a + d.valor, 0));
    const adv = (() => { try { return JSON.parse(lsGet("advogado") || "{}"); } catch (e) { return {}; } })();
    modal({ titulo: "Termos de cobrança · " + nomeDev, largo: true, ok: "Gerar documento",
      corpo: `<div class="box"><b>${esc(nomeDev)}</b> · ${esc((imv && imv.endereco) || (dev && dev.endereco) || "")}${ctt ? ` · contrato <b>${esc(ctt.codigo)}</b>` : ` · <span class="neg">sem contrato ligado: a qualificação das partes sai em branco para completar</span>`}<br>Débito: <b>${brl(total)}</b> (${debitos.length} item(ns))</div>
        <label class="fl"><span>Documento</span><select name="tipo">${Object.entries(TERMOS_COB).map(([k, t]) => opt(k, t, k === el.dataset.tipo)).join("")}</select></label>
        <div data-p="notificacao"><div class="row"><label class="fl"><span>Prazo para pagar (dias)</span><input name="prazo" type="number" value="5"></label></div></div>
        <div data-p="acordo" hidden><div class="row"><label class="fl"><span>Valor total do acordo</span><input name="ac_total" inputmode="numeric" value="${moedaFmt(Math.max(0, total))}"></label>
            <label class="fl"><span>Entrada</span><input name="ac_ent" inputmode="numeric" placeholder="R$ 0,00"></label><label class="fl"><span>Data da entrada</span><input type="date" name="ac_ent_data" value="${hoje()}"></label></div>
          <div class="row"><label class="fl"><span>Nº de parcelas</span><input name="ac_n" type="number" min="1" value="1"></label><label class="fl"><span>Valor da parcela</span><input name="ac_parc" inputmode="numeric" placeholder="calculado"></label>
            <label class="fl"><span>1º vencimento</span><input type="date" name="ac_venc"></label><label class="fl"><span>Multa se atrasar (%)</span><input name="ac_multa" type="number" value="20"></label></div>
          <label class="chk"><input type="checkbox" name="ac_mudar" ${dev ? "" : "disabled"}> registrar o acordo no cadastro do devedor (situação “Acordo”)</label></div>
        <div data-p="despejo" hidden><div class="row"><label class="fl"><span>Multa por aluguel atrasado (%)</span><input name="dp_multa" type="number" value="10"></label>
            <label class="fl"><span>Multa contratual (R$)</span><input name="dp_mc" inputmode="numeric" placeholder="R$ 0,00 (se houver)"></label><label class="fl"><span>Cláusula da multa</span><input name="dp_cl" value="11ª"></label></div>
          <div class="row"><label class="fl"><span>Advogado(a)</span><input name="adv" value="${esc(adv.nome || "")}"></label><label class="fl"><span>OAB</span><input name="oab" value="${esc(adv.oab || "")}" placeholder="OAB/SP 000.000"></label><label class="fl"><span>Comarca</span><input name="comarca" value="${esc(adv.comarca || TIMBRE.cidade)}"></label></div></div>`,
      aoAbrir: (f, d) => {
        [f.ac_total, f.ac_ent, f.ac_parc, f.dp_mc].forEach(mascaraMoeda);
        const mostra = () => $$("[data-p]", d).forEach(x => (x.hidden = x.dataset.p !== f.tipo.value)); f.tipo.addEventListener("change", mostra); mostra();
        const calc = () => { if (f.ac_parc.dataset.mexeu) return; const n = +f.ac_n.value || 1, v = r2(((parseMoney(f.ac_total.value) || 0) - (parseMoney(f.ac_ent.value) || 0)) / n); f.ac_parc.value = v > 0 ? moedaFmt(v) : ""; };
        [f.ac_total, f.ac_ent, f.ac_n].forEach(x => x.addEventListener("input", calc)); f.ac_parc.addEventListener("input", () => (f.ac_parc.dataset.mexeu = 1)); calc();
        const v1 = new Date(); v1.setMonth(v1.getMonth() + 1); f.ac_venc.value = iso(v1);
      },
      salvar: async f => {
        const tipo = f.tipo.value, dados = { ctt, ficha, debitos, total, nomeDev, imv, dev };
        if (tipo === "despejo") { lsSet("advogado", JSON.stringify({ nome: f.adv.value.trim(), oab: f.oab.value.trim(), comarca: f.comarca.value.trim() })); Object.assign(dados, { multa: +f.dp_multa.value || 0, mc: parseMoney(f.dp_mc.value) || 0, cl: f.dp_cl.value.trim(), adv: f.adv.value.trim(), oab: f.oab.value.trim(), comarca: f.comarca.value.trim() || TIMBRE.cidade }); }
        if (tipo === "acordo") {
          Object.assign(dados, { acTotal: parseMoney(f.ac_total.value) || 0, ent: parseMoney(f.ac_ent.value) || 0, entData: f.ac_ent_data.value, n: +f.ac_n.value || 1, parc: parseMoney(f.ac_parc.value) || 0, venc: f.ac_venc.value, multaAc: +f.ac_multa.value || 0 });
          if (!dados.acTotal || !dados.parc || !dados.venc) throw new Error("Acordo: informe o valor total, a parcela e o 1º vencimento.");
          if (f.ac_mudar.checked && dev) await q(sb.from("devedores").update({ situacao: "ACORDO", acordo: { parcelas: dados.n, valor_parcela: dados.parc, primeiro_venc: dados.venc, desde: hoje(), entrada: dados.ent || null } }).eq("id", dev.id));
        }
        if (tipo === "notificacao") dados.prazo = +f.prazo.value || 5;
        setTimeout(() => abrirDocEditavel(TERMOS_COB[tipo] + " · " + nomeDev, TERMO_COB_HTML[tipo](dados), { semTimbre: tipo === "despejo" }), 0);
      } });
  } catch (e) { falha(e); }
};
const lin_ = n => "_".repeat(n);
const tabDebitos = (ds, multaPct) => `<table class="doc-t"><thead><tr><th>Vencimento</th><th>Referente</th>${multaPct != null ? `<th class="num">Aluguel</th><th class="num">Multa ${multaPct}%</th>` : ""}<th class="num">Valor (R$)</th></tr></thead><tbody>
  ${ds.map(d => { const m = multaPct != null && d.aluguel ? r2(d.aluguel * multaPct / 100) : 0, base = multaPct != null && d.aluguel ? d.aluguel : d.valor;
    return `<tr><td>${d.venc ? dt(d.venc) : ""}</td><td>${esc(d.desc)}</td>${multaPct != null ? `<td class="num">${n2(base)}</td><td class="num">${m ? n2(m) : ""}</td>` : ""}<td class="num">${n2(multaPct != null && d.aluguel ? base + m : d.valor)}</td></tr>`; }).join("")}</tbody></table>`;
const TERMO_COB_HTML = {
  notificacao: d => {
    const f = d.ficha, cred = (d.imv && d.imv.locador) || (d.ctt && d.ctt.locador) || (d.dev && d.dev.locador) || "";
    return `<h2 class="doc-tit">NOTIFICAÇÃO EXTRAJUDICIAL</h2>
    <p><b>NOTIFICANTE:</b> ${esc(TIMBRE.razao.split(" — ")[0])}, CNPJ nº ${esc(TIMBRE.cnpj)}, administradora do imóvel, em nome e por conta do(a) locador(a) <b>${esc(cred)}</b>.</p>
    <p><b>NOTIFICADO(S):</b> ${d.ctt ? qualifGrupo(f, "lct") : `<b>${esc(d.nomeDev.toUpperCase())}</b>, ${lin_(40)}`}${d.ctt && nomesGrupo(f, "fdr").length ? `; e, na qualidade de fiador(es) e principal(is) pagador(es), ${qualifGrupo(f, "fdr")}` : ""}.</p>
    <p><b>IMÓVEL:</b> ${esc(endImovelFicha(f, d.ctt) || (d.imv && d.imv.endereco) || (d.dev && d.dev.endereco) || "")}${d.ctt ? ` · Contrato de locação ${esc(d.ctt.codigo)}` : ""}.</p>
    <p>Pela presente, fica(m) V.Sa.(s) <b>NOTIFICADO(S)</b> de que se encontra(m) em aberto, junto a esta administradora, os seguintes débitos decorrentes da locação acima:</p>
    ${tabDebitos(d.debitos)}
    <p class="doc-tot">TOTAL EM ABERTO: <b>${brl(d.total)}</b> (${esc(extensoReais(d.total).toLowerCase())}), sem prejuízo de juros, correção monetária e demais encargos previstos no contrato até a data do efetivo pagamento.</p>
    <p>Solicitamos a regularização do débito no prazo de <b>${d.prazo} (${porExtenso(d.prazo)}) dias</b> a contar do recebimento desta, no escritório da administradora (${esc(TIMBRE.rodape[0])}) ou por meio de depósito/PIX em conta indicada pela administradora, mediante recibo.</p>
    <p>O não atendimento desta notificação no prazo indicado poderá implicar a adoção das medidas judiciais cabíveis, inclusive <b>ação de despejo por falta de pagamento cumulada com cobrança</b> (art. 62 da Lei nº 8.245/91), com acréscimo de custas processuais e honorários advocatícios, e a inclusão do(s) nome(s) do(s) devedor(es) e fiador(es) nos órgãos de proteção ao crédito.</p>
    <p>Caso o pagamento já tenha sido efetuado, pedimos desconsiderar esta notificação e apresentar o comprovante. Estamos à disposição para negociar o débito.</p>
    <p class="doc-data">${esc(TIMBRE.cidade)}, ${dataExt(hoje())}.</p>
    <div class="doc-ass"><div>${esc(TIMBRE.razao.split(" — ")[0])}<br><small>Administradora</small></div></div>
    <div class="doc-receb"><b>CIENTE / RECEBIDO EM:</b> ____/____/________ &nbsp;&nbsp; Nome: ${lin_(30)} &nbsp; Assinatura: ${lin_(28)}</div>`;
  },
  acordo: d => {
    const f = d.ficha, cred = (d.ctt && d.ctt.locador) || (d.imv && d.imv.locador) || (d.dev && d.dev.locador) || "";
    const devs = d.ctt ? nomesGrupo(f, "lct").concat(nomesGrupo(f, "fdr")) : [d.nomeDev];
    const parcTxt = d.n === 1 ? `em 1 (uma) parcela de ${brl(d.parc)} (${esc(extensoReais(d.parc).toLowerCase())}), com vencimento em ${dt(d.venc)}` : `em ${d.n} (${porExtenso(d.n)}) parcelas mensais e consecutivas de ${brl(d.parc)} (${esc(extensoReais(d.parc).toLowerCase())}) cada uma, vencendo-se a primeira em ${dt(d.venc)} e as demais no mesmo dia dos meses subsequentes, até a quitação do débito`;
    let n = 0; const cl = () => `<b>CLÁUSULA ${["PRIMEIRA", "SEGUNDA", "TERCEIRA", "QUARTA", "QUINTA", "SEXTA", "SÉTIMA", "OITAVA", "NONA", "DÉCIMA", "DÉCIMA PRIMEIRA"][n++]}</b> –`;
    return `<h2 class="doc-tit">INSTRUMENTO PARTICULAR DE ACORDO EXTRAJUDICIAL<br><small>E CONFISSÃO DE DÍVIDA</small></h2>
    <p>Os signatários do presente, que contratam nas qualidades indicadas neste Instrumento Particular de Acordo Extrajudicial e Confissão de Dívida, de um lado, denominado <b>CREDOR</b>, ${d.ctt && f.lcd1_nome ? qualifGrupo(f, "lcd") : `<b>${esc(String(cred).toUpperCase())}</b>, ${lin_(40)}`}, neste ato representado por sua administradora ${esc(TIMBRE.razao.split(" — ")[0])}, inscrita no CNPJ sob nº ${esc(TIMBRE.cnpj)}; e, de outro lado, denominado(s) <b>DEVEDOR(ES)</b>, ${d.ctt ? qualifGrupo(f, "lct") + (nomesGrupo(f, "fdr").length ? "; e " + qualifGrupo(f, "fdr") : "") : `<b>${esc(d.nomeDev.toUpperCase())}</b>, ${lin_(50)}`}, acordam mediante as seguintes cláusulas e condições:</p>
    <p>${cl()} O(s) DEVEDOR(ES) reconhece(m) e confessa(m) o débito existente junto ao CREDOR no valor total de <b>${brl(d.acTotal)}</b> (${esc(extensoReais(d.acTotal).toLowerCase())}), relativo à locação do imóvel situado na ${esc(endImovelFicha(f, d.ctt) || (d.imv && d.imv.endereco) || (d.dev && d.dev.endereco) || "")}${d.ctt ? ` (contrato ${esc(d.ctt.codigo)})` : ""}, composto pelos seguintes valores:</p>
    ${tabDebitos(d.debitos)}
    <p>${cl()} O valor constante da cláusula primeira será pago da seguinte forma: ${d.ent ? `<b>${brl(d.ent)}</b> (${esc(extensoReais(d.ent).toLowerCase())}) de entrada, em ${dt(d.entData)}; e o restante ` : ""}${parcTxt}.</p>
    <p>${cl()} Os pagamentos deverão ser efetuados no escritório da administradora ${esc(TIMBRE.razao.split(" — ")[0])}, CNPJ nº ${esc(TIMBRE.cnpj)}, situada na ${esc(TIMBRE.rodape[0])}, mediante recibo, ou por depósito bancário${TIMBRE.banco ? ` no ${esc(TIMBRE.banco)}` : ""}.</p>
    <p>${cl()} O não pagamento de qualquer parcela na data do vencimento dará ao CREDOR o direito de considerar rescindido de pleno direito o presente acordo, com o vencimento antecipado das demais parcelas e multa de ${d.multaAc}% (${porExtenso(d.multaAc)} por cento) sobre o saldo devedor, podendo pleitear judicialmente o débito restante com todos os acréscimos legais. Antes da propositura de qualquer ação judicial, o CREDOR notificará extrajudicialmente o(s) DEVEDOR(ES) para que, no prazo de 5 (cinco) dias, regularize(m) integralmente o débito.</p>
    <p>${cl()} O(s) DEVEDOR(ES) reconhece(m) ainda os débitos de energia elétrica, água e demais encargos do imóvel, obrigando-se a quitá-los junto às concessionárias e a apresentar o comprovante de quitação no prazo máximo de 90 (noventa) dias, deixando o imóvel livre e desimpedido de qualquer ônus.</p>
    <p>${cl()} Os valores recebidos pela administradora serão repassados ao CREDOR no prazo de até 2 (dois) dias úteis após o recebimento.</p>
    <p>${cl()} As partes reconhecem a dívida aqui descrita como líquida, certa e exigível, atribuindo a este instrumento, assinado por duas testemunhas, a eficácia de título executivo extrajudicial, nos termos do art. 784, III, do Código de Processo Civil.</p>
    <p>${cl()} O presente acordo não implica novação, permanecendo válidas as garantias do contrato de locação até a quitação integral do débito.</p>
    <p>${cl()} Dá-se ao presente instrumento o valor de ${brl(d.acTotal)} (${esc(extensoReais(d.acTotal).toLowerCase())}). O presente é firmado em caráter irrevogável e irretratável, obrigando as partes, seus herdeiros e sucessores.</p>
    <p>E, por estarem de comum acordo, assinam o presente em 2 (duas) vias de igual forma e teor, na presença das testemunhas abaixo, elegendo o Foro da Comarca de ${esc(TIMBRE.cidade)}/SP para dirimir quaisquer dúvidas oriundas deste instrumento.</p>
    <p class="doc-data">${esc(TIMBRE.cidade)}, ${dataExt(hoje())}.</p>
    <div class="doc-ass"><div>${esc(cred)}<br><small>CREDOR (p.p. ${esc(TIMBRE.razao.split(" — ")[0])})</small></div>${devs.map(x => `<div>${esc(x)}<br><small>DEVEDOR</small></div>`).join("")}
      <div>${esc(f.test1_nome || "")}${f.test1_rg ? " – RG " + esc(f.test1_rg) : ""}<br><small>TESTEMUNHA</small></div><div>${esc(f.test2_nome || "")}${f.test2_rg ? " – RG " + esc(f.test2_rg) : ""}<br><small>TESTEMUNHA</small></div></div>`;
  },
  despejo: d => {
    const f = d.ficha, alug = d.debitos.filter(x => x.aluguel || /alug/i.test(x.desc));
    const outros = d.debitos.filter(x => !alug.includes(x));
    const totAlug = r2(alug.reduce((a, x) => a + (x.aluguel ? x.aluguel * (1 + d.multa / 100) : x.valor), 0)), totOut = r2(outros.reduce((a, x) => a + x.valor, 0)), geral = r2(totAlug + totOut + d.mc);
    return `<p class="doc-enderecamento"><b>EXMO(A). SR(A). DR(A). JUIZ(A) DE DIREITO DA ___ VARA CÍVEL DA COMARCA DE ${esc(d.comarca.toUpperCase())} – SP</b></p><div style="height:60px"></div>
    <p class="doc-rec">${d.ctt && f.lcd1_nome ? qualifGrupo(f, "lcd") : `<b>${esc(((d.imv && d.imv.locador) || "").toUpperCase())}</b>, ${lin_(50)}`}, por seu procurador e advogado infra-assinado (DOC. I), vem respeitosamente à presença de Vossa Excelência propor</p>
    <h2 class="doc-tit">AÇÃO DE DESPEJO POR FALTA DE PAGAMENTO<br><small>CUMULADA COM COBRANÇA DE ALUGUÉIS E ENCARGOS</small></h2>
    <p class="doc-rec">em face de ${d.ctt ? qualifGrupo(f, "lct") : `<b>${esc(d.nomeDev.toUpperCase())}</b>, ${lin_(50)}`}${d.ctt && nomesGrupo(f, "fdr").length ? `; e de seu(s) fiador(es) ${qualifGrupo(f, "fdr")}` : ""}, com fundamento no art. 62 e demais dispositivos da Lei do Inquilinato (Lei nº 8.245/91), pelos fatos e fundamentos a seguir expostos:</p>
    <h3>I – DOS FATOS</h3>
    <p class="doc-rec">O(A) autor(a) locou ao(à) requerido(a) o imóvel de sua propriedade situado na ${esc(endImovelFicha(f, d.ctt) || (d.imv && d.imv.endereco) || "")}, mediante aluguel mensal e atual de ${brl((d.imv && d.imv.valor) || (d.ctt && d.ctt.valor) || 0)} (${esc(extensoReais((d.imv && d.imv.valor) || (d.ctt && d.ctt.valor) || 0).toLowerCase())}), conforme Contrato de Locação escrito${d.ctt ? ` (${esc(d.ctt.codigo)})` : ""}, pelo prazo de ${esc(String(f.prazo || "___").split(" (")[0])} meses, com início em ${esc(f.inicio || "___")} e término em ${esc(f.termino || "___")}, para fins ${esc(String(f.fins || "RESIDENCIAIS").toUpperCase())} (DOC. II).</p>
    <p class="doc-rec">Ocorre que o(a) requerido(a) não vem cumprindo a obrigação legal e contratual de pagar os aluguéis e encargos em seus vencimentos, estando em atraso com os seguintes:</p>
    <h3>ALUGUÉIS VENCIDOS</h3>
    ${tabDebitos(alug, d.multa)}
    ${outros.length ? `<h3>ENCARGOS E OUTROS DÉBITOS</h3>${tabDebitos(outros)}` : ""}
    <table class="doc-t doc-tots"><tbody><tr><td>Total dos aluguéis com multa</td><td class="num">${n2(totAlug)}</td></tr>${totOut ? `<tr><td>Encargos e outros débitos</td><td class="num">${n2(totOut)}</td></tr>` : ""}${d.mc ? `<tr><td>Multa contratual (cláusula ${esc(d.cl)})</td><td class="num">${n2(d.mc)}</td></tr>` : ""}
      <tr class="tot"><td>TOTAL GERAL</td><td class="num">${n2(geral)}</td></tr></tbody></table>
    <p class="doc-tot">(${esc(extensoReais(geral).toUpperCase())})</p>
    <p class="doc-rec">O inadimplemento da obrigação de pagar os aluguéis e/ou acessórios constitui infração contratual e legal (art. 9º, III, da Lei nº 8.245/91), dando justo motivo ao despejo do locatário em mora.</p>
    <h3>II – DOS REQUERIMENTOS</h3>
    <p class="doc-rec">Isto posto, requer a Vossa Excelência:</p>
    <p class="doc-rec">a) a citação do(s) requerido(s) para, querendo, contestar(em) a ação no prazo legal ou, no prazo de 15 (quinze) dias, purgar(em) a mora (art. 62, II, da Lei nº 8.245/91), hipótese em que deverão ser pagos todos os aluguéis e encargos vencidos até a data do efetivo pagamento, acrescidos de juros, correção monetária, multa contratual, custas processuais e honorários advocatícios;</p>
    <p class="doc-rec">b) não purgada a mora, a procedência da ação, com a decretação do despejo e a condenação do(s) requerido(s) ao pagamento dos aluguéis e encargos vencidos e vincendos até a efetiva desocupação, custas processuais e honorários advocatícios;</p>
    <p class="doc-rec">c) a concessão de liminar para desocupação em 15 (quinze) dias, nos termos do art. 59, § 1º, IX, da Lei nº 8.245/91, caso o contrato esteja desprovido de garantia, mediante a caução legal;</p>
    <p class="doc-rec">d) que a citação e demais atos processuais sejam realizados, se necessário, nos termos do art. 212, § 2º, do Código de Processo Civil.</p>
    <p class="doc-rec">Protesta provar o alegado por todos os meios de prova em direito admitidos, em especial a documental, a testemunhal e o depoimento pessoal do(s) réu(s), sob pena de confissão.</p>
    <p class="doc-rec">Dá-se à causa o valor de ${brl(geral)} (${esc(extensoReais(geral).toLowerCase())}).</p>
    <p class="doc-rec">Termos em que,<br>pede deferimento.</p>
    <p class="doc-data">${esc(d.comarca)}, ${dataExt(hoje())}.</p>
    <div class="doc-ass"><div>${esc(d.adv || "")}<br><small>${esc(d.oab || "OAB/SP")}</small></div></div>`;
  }
};

// ---- devedores a partir dos contratos com situação "DÉBITO EM ABERTO" (vindos da planilha de contratos) ----
ACT["dev-importar"] = async () => {
  if (!pode.admin()) return;
  const [ctts, devs] = await Promise.all([q(sb.from("contratos").select("codigo,imovel_id,endereco,locador,locatario,inicio,termino,data_encerramento,saldo_devedor,pendencias,obs,contatos").eq("situacao", "DÉBITO EM ABERTO").order("codigo")), q(sb.from("devedores").select("contrato_codigo"))]);
  const ja = new Set(devs.map(d => d.contrato_codigo).filter(Boolean)), novos = ctts.filter(c => !ja.has(c.codigo)), semValor = novos.filter(c => !(+c.saldo_devedor > 0));
  modal({ titulo: "Devedores a partir dos contratos", largo: true, ok: novos.length ? `Criar ${novos.length} devedor(es)` : "Fechar", semOk: !novos.length,
    corpo: `<p>Contratos com situação <b>DÉBITO EM ABERTO</b> (importados da planilha de contratos): <b>${ctts.length}</b>. Já estão em Devedores: <b>${ctts.length - novos.length}</b>. Novos: <b>${novos.length}</b>.</p>
      ${novos.length ? `<div class="tw" style="max-height:340px"><table class="compacta"><thead><tr><th>Contrato</th><th>Locatário</th><th>Imóvel</th><th class="num">Saldo na planilha</th></tr></thead><tbody>${novos.map(c => `<tr class="${+c.saldo_devedor > 0 ? "" : "ct-pend"}"><td class="mono">${esc(c.codigo)}</td><td>${esc(c.locatario)}</td><td class="trunc">${esc(c.endereco)}</td><td class="num">${+c.saldo_devedor > 0 ? n2(c.saldo_devedor) : `<span class="tag warn">sem valor</span>`}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${semValor.length ? `<div class="box warn"><b>${semValor.length}</b> sem valor na planilha (linhas amarelas): entram com o item “Saldo devedor (valor a confirmar)” marcado como <b>estimado</b>. Depois, abra cada um em Cobrança › Devedores e informe os valores.</div>` : ""}`,
    salvar: async () => {
      let ok = 0;
      for (const c of novos) {
        const v = +c.saldo_devedor > 0 ? +c.saldo_devedor : 0;
        await q(sb.from("devedores").insert({ imovel_id: c.imovel_id, contrato_codigo: c.codigo, endereco: c.endereco || "", locador: c.locador || "", devedor: c.locatario || c.codigo, contatos: c.contatos || [],
          data_entrada: c.inicio, data_saida: c.data_encerramento || c.termino, situacao: "EM ABERTO", obs: [c.pendencias, c.obs].filter(Boolean).join("\n"),
          itens: [{ descricao: v ? "Saldo devedor (planilha de contratos)" : "Saldo devedor (valor a confirmar)", valor: v, estimado: !v }] }));
        ok++;
      }
      toast(`${ok} devedor(es) criados${semValor.length ? ` · ${semValor.length} precisam de valor` : ""}.`); render();
    } });
};

/* =====================================================================
   NOTAS FISCAIS do mês: aluguéis com "Declarar IR = Sim" e comissões de vendas
   ===================================================================== */
let NF = [];
const IR_PARA = ["Locador", "Locatário", "Locador e locatário"];
const COLS_NF = [
  { k: "origem", t: "Origem", v: x => x.origem === "venda" ? "Venda" : "Aluguel", html: x => `<span class="tag ${x.origem === "venda" ? "warn" : "info"}">${x.origem === "venda" ? "Venda" : "Aluguel"}</span>`, w: 80 },
  { k: "ref", t: "Imóvel / venda", cls: "trunc" },
  { k: "tomador", t: "Tomador (nome na nota)", cls: "trunc", html: x => `${esc(x.tomador || "")}${x.tomador2 ? `<span class="sub">e ${esc(x.tomador2)}</span>` : ""}` },
  { k: "doc", t: "CPF / CNPJ", cls: "mono" },
  { k: "ir_para", t: "IR declarado por", cls: "trunc" },
  { k: "base", t: "Aluguel / venda", tipo: "num" },
  { k: "valor", t: "Valor da nota", tipo: "num", dica: "Aluguel: taxa de administração do mês · Venda: comissão (pode mudar ao registrar)" },
  { k: "receb", t: "Recebido", v: x => x.recebido ? "sim" : "não", html: x => x.recebido ? `<span class="tag ok">${dt(x.recebido)}</span>` : `<span class="tag ${x.previsto ? "idle" : "warn"}">${x.previsto ? "previsão" : "não"}</span>` },
  { k: "sit", t: "Nota", v: x => x.nf && x.nf.numero ? "emitida" : "a emitir", html: x => x.nf && x.nf.numero ? `<span class="tag ok">nº ${esc(x.nf.numero)}${x.nf.emitida_em ? " · " + dt(x.nf.emitida_em) : ""}</span>` : `<span class="tag ${x.previsto ? "idle" : "bad"}">${x.previsto ? "prevista" : "a emitir"}</span>` },
  { k: "obs", t: "Obs.", cls: "trunc", oculta: true, v: x => (x.nf || {}).obs || "" }
];
PAGES.notas = async pg => {
  const fim = fimMes(S.mes);
  const [cobs, notas, vendas, itens] = await Promise.all([
    fetchAll("cobrancas", b => b.eq("competencia", S.mes).order("id"), "id,imovel_id,competencia,vencimento,locador,locatario,valor,taxa_valor,taxa_adm_pct,ajustes,acrescimos,descontos,valor_pago,data_pagamento"),
    q(sb.from("notas_fiscais").select("*").eq("competencia", S.mes)).catch(() => []),
    pode.ver("vendas") ? q(sb.from("vendas").select("id,codigo,data,endereco,valor,comissao,vendedores,vend_qualif")).catch(() => []) : [],
    pode.ver("vendas") ? q(sb.from("venda_itens").select("*").eq("tipo", "comissao").or(`and(pago_em.gte.${S.mes},pago_em.lte.${fim}),and(pago_em.is.null,vencimento.gte.${S.mes},vencimento.lte.${fim})`)).catch(() => []) : []
  ]);
  const ir = cobs.filter(c => (S.imovelPor[c.imovel_id] || {}).declarar_ir === "Sim");
  const cods = Array.from(new Set(ir.map(c => (S.imovelPor[c.imovel_id] || {}).contrato_codigo).filter(Boolean)));
  const ctts = cods.length ? await q(sb.from("contratos").select("codigo,ficha").in("codigo", cods)).catch(() => []) : [];
  const cttPor = Object.fromEntries(ctts.map(c => [c.codigo, c.ficha || {}]));
  const nfDe = (campo, id) => notas.find(n => n[campo] === id);
  NF = ir.map(c => {
    const im = S.imovelPor[c.imovel_id] || {}, fi = cttPor[im.contrato_codigo] || {}, para = im.ir_para || "Locador";
    const lct = [fi.lct1_nome || c.locatario, fi.lct1_cpf || ""], lcd = [nomeRealLocador(c.locador), docLocador(c.locador)];
    const [tom, doc] = para === "Locatário" ? lct : lcd;
    return { id: c.id, origem: "aluguel", cobranca_id: c.id, ref: im.endereco || "", tomador: tom, doc, tomador2: para === "Locador e locatário" ? lct[0] : "",
      ir_para: im.ir_para || "(não informado: Locador)", base: +c.valor, valor: c.taxa_valor != null ? +c.taxa_valor : calcCob(c).taxa, recebido: c.data_pagamento, nf: nfDe("cobranca_id", c.id) };
  });
  const vPor = Object.fromEntries(vendas.map(v => [v.id, v]));
  itens.forEach(i => { const v = vPor[i.venda_id] || {}; NF.push({ id: "vi" + i.id, origem: "venda", venda_item_id: i.id, venda_id: i.venda_id, ref: `${v.codigo || ""} · ${v.endereco || ""} (${i.descricao})`, tomador: v.vendedores || "", doc: "",
    ir_para: "Vendedor", base: +v.valor || 0, valor: +i.valor, recebido: i.pago_em, previsto: !i.pago_em, nf: nfDe("venda_item_id", i.id) }); });
  // vendas do mês sem parcelas de comissão lançadas: previsão pela comissão total
  vendas.filter(v => v.data && v.data >= S.mes && v.data <= fim && +v.comissao > 0 && !itens.some(i => i.venda_id === v.id)).forEach(v => NF.push({ id: "v" + v.id, origem: "venda", venda_id: v.id, ref: `${v.codigo} · ${v.endereco || ""} (comissão)`,
    tomador: v.vendedores || "", doc: "", ir_para: "Vendedor", base: +v.valor || 0, valor: +v.comissao, recebido: null, previsto: true, nf: notas.find(n => n.venda_id === v.id && !n.venda_item_id) }));
  setRd(pg, () => desenharNotas());
  desenharNotas(pg);
};
function desenharNotas(pg) {
  pg = pg || $("#page");
  const f = S.f.nf || "todas";
  const teste = { todas: () => true, aemitir: x => !(x.nf && x.nf.numero) && !x.previsto, emitidas: x => !!(x.nf && x.nf.numero), aluguel: x => x.origem === "aluguel", venda: x => x.origem === "venda" };
  const lista = NF.filter(teste[f] || teste.todas);
  const tot = t => brl(NF.filter(teste[t]).reduce((a, x) => a + (+((x.nf && x.nf.valor) || x.valor) || 0), 0));
  const g = grade("notas", COLS_NF, lista, { attr: x => `data-act="nf-ed" data-id="${x.id}" style="cursor:pointer"`, sort: { k: "ref", dir: "asc" }, divisor: "origem", vazio: `Nenhuma nota em ${mesTxt(S.mes)}. Marque “Declarar IR = Sim” no cadastro do imóvel.`,
    rodape: fl => `${fl.length} nota(s) · ${brl(fl.reduce((a, x) => a + (+((x.nf && x.nf.valor) || x.valor) || 0), 0))}` });
  g.redesenhar = () => desenharNotas();
  pg.innerHTML = `<div class="grid">
    <div class="kpis">${kpi("A emitir", `<span class="${NF.filter(teste.aemitir).length ? "neg" : ""}">${NF.filter(teste.aemitir).length}</span>`, tot("aemitir"), true)}${kpi("Emitidas", String(NF.filter(teste.emitidas).length), tot("emitidas"))}
      ${kpi("Aluguéis com IR", String(NF.filter(teste.aluguel).length), tot("aluguel"))}${kpi("Vendas (comissão)", String(NF.filter(teste.venda).length), tot("venda"))}</div>
    <div class="filters"><div class="fgrupo"><span>Mostrar</span>${[["todas", "Todas"], ["aemitir", "A emitir"], ["emitidas", "Emitidas"], ["aluguel", "Aluguéis"], ["venda", "Vendas"]].map(([k, t]) => `<button class="chip${f === k ? " on" : ""}" data-act="chip" data-k="nf" data-v="${k}">${t}<span class="c">${NF.filter(teste[k]).length}</span></button>`).join("")}</div>
      <span class="spacer"></span>${gradeBarra("notas")}<button class="btn" data-act="nf-imp">🖨 Lista para emitir</button><button class="btn" data-act="nf-xls">Excel</button></div>
    ${gradeHTML("notas")}
    <p class="hint">Aluguéis dos imóveis com <b>Declarar IR = Sim</b> (cadastro do imóvel, com “IR declarado por”). O valor sugerido é a taxa de administração do mês; nas vendas, a comissão recebida ou prevista no mês. Clique numa linha para registrar o número da nota.</p></div>`;
}
ACT["nf-xls"] = () => exportarGrade("notas", `notas-fiscais-${S.mes.slice(0, 7)}.xlsx`, "Notas");
ACT["nf-imp"] = () => {
  const g = G.notas, fl = (g && g.filtradas) || NF;
  abrirRelatorio("Notas fiscais", `<div class="rel-tit"><b>Notas fiscais a emitir · ${esc(mesTxt(S.mes))}</b><span>emitido em ${dt(hoje())}</span></div>
    <table class="rel-t"><thead><tr><th>#</th><th>Origem</th><th>Imóvel / venda</th><th>Tomador</th><th>CPF/CNPJ</th><th>IR por</th><th class="num">Valor</th><th>Nº da nota</th></tr></thead>
    <tbody>${fl.map((x, i) => `<tr><td>${i + 1}</td><td>${x.origem === "venda" ? "Venda" : "Aluguel"}</td><td>${esc(x.ref)}</td><td>${esc(x.tomador)}${x.tomador2 ? " e " + esc(x.tomador2) : ""}</td><td>${esc(x.doc)}</td><td>${esc(x.ir_para)}</td><td class="num">${n2((x.nf && x.nf.valor) || x.valor)}</td><td>${esc((x.nf || {}).numero || "")}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="6"><b>Total</b></td><td class="num"><b>${n2(fl.reduce((a, x) => a + (+((x.nf && x.nf.valor) || x.valor) || 0), 0))}</b></td><td></td></tr></tfoot></table>`, { paisagem: true });
};
ACT["nf-ed"] = el => {
  const x = NF.find(y => y.id === el.dataset.id); if (!x) return;
  const n = x.nf || {}, ed = pode.ed("notas");
  modal({ titulo: "Nota fiscal · " + (x.origem === "venda" ? "venda" : "aluguel"), largo: true, semOk: !ed,
    corpo: `<div class="box"><b>${esc(x.ref)}</b><br>IR declarado por: ${esc(x.ir_para)}${x.recebido ? ` · recebido em ${dt(x.recebido)}` : x.previsto ? " · previsão" : " · <span class=\"neg\">ainda não recebido</span>"}</div>
      <div class="row"><label class="fl" style="grid-column:span 2"><span>Tomador (nome na nota)</span><input name="tomador" value="${esc(n.tomador || x.tomador || "")}"></label><label class="fl"><span>CPF / CNPJ</span><input name="doc" value="${esc(n.tomador_doc || x.doc || "")}"></label></div>
      <div class="row"><label class="fl"><span>Valor da nota</span><input name="valor" inputmode="numeric" value="${moedaFmt(n.valor != null && n.id ? n.valor : x.valor)}"></label><label class="fl"><span>Nº da nota</span><input name="numero" value="${esc(n.numero || "")}"></label>
        <label class="fl"><span>Emitida em</span><input type="date" name="data" value="${n.emitida_em || (n.numero ? "" : hoje())}"></label></div>
      <label class="fl"><span>Descrição / observações</span><textarea name="obs" rows="2">${esc(n.obs || "")}</textarea></label>`,
    extra: n.id && ed ? `<button type="button" class="btn danger" data-del>Desfazer registro</button>` : "",
    aoAbrir: (f, d) => { mascaraMoeda(f.valor); mascaraDoc(f.doc); const b = $("[data-del]", d); if (b) b.addEventListener("click", async () => { d.close(); try { await q(sb.from("notas_fiscais").delete().eq("id", n.id)); toast("Registro desfeito."); render(); } catch (e) { falha(e); } }); },
    salvar: async f => {
      const u = { competencia: S.mes, origem: x.origem, cobranca_id: x.cobranca_id || null, venda_item_id: x.venda_item_id || null, venda_id: x.venda_id || null, tomador: f.tomador.value.trim(), tomador_doc: f.doc.value.trim(),
        valor: parseMoney(f.valor.value) || 0, numero: f.numero.value.trim(), emitida_em: f.numero.value.trim() ? f.data.value || hoje() : null, obs: f.obs.value.trim(), descricao: x.ref };
      if (n.id) await q(sb.from("notas_fiscais").update(u).eq("id", n.id)); else await q(sb.from("notas_fiscais").insert(u));
      toast(u.numero ? "Nota registrada." : "Salvo (sem número: continua a emitir)."); render();
    } });
};

/* =====================================================================
   v13: menu de termos (com ícones) e termos do próprio sistema
   ===================================================================== */
// itens: [{ ic, t, d, fn }]
function menuTermos(el, titulo, itens) {
  const p = pop(el, `<div class="gp-h">${esc(titulo)}</div><div class="tm-lista">${itens.map((x, i) => `<button type="button" class="tm-item" data-i="${i}"><span class="tm-ic">${x.ic}</span><span><b>${esc(x.t)}</b>${x.d ? `<small>${esc(x.d)}</small>` : ""}</span></button>`).join("")}</div>`, 340);
  $$("[data-i]", p).forEach(b => b.addEventListener("click", () => { fecharPop(); itens[+b.dataset.i].fn(); }));
}
// escolher um contrato (para os termos abertos pelo menu, sem contrato definido)
async function escolherContrato(titulo, filtro) {
  if (!CTT.length) CTT = await fetchAll("contratos", b => b.order("codigo", { ascending: false }));
  const ls = CTT.filter(c => c.situacao !== "CANCELADO" && (!filtro || filtro(c)));
  const rot = c => `${c.codigo} · ${c.locatario || ""} · ${c.endereco || endImovelFicha(fichaDe(c), c)}`;
  let escolhido = null;
  return new Promise(res => modal({ titulo, ok: "Continuar",
    corpo: `<label class="fl"><span>Contrato (digite código, nome ou endereço)</span><input name="c" list="dl-ctt-esc" autocomplete="off" required><datalist id="dl-ctt-esc">${ls.map(c => `<option value="${esc(rot(c))}">`).join("")}</datalist></label>`,
    aoAbrir: f => { f.c.focus(); }, aoFechar: () => res(escolhido),
    salvar: async f => { const c = ls.find(x => rot(x) === f.c.value) || ls.find(x => x.codigo === f.c.value.trim().toUpperCase()); if (!c) throw new Error("Escolha um contrato da lista."); escolhido = c; } }));
}
const nomesLct = f => nomesGrupo(f, "lct");
const cttDataTxt = f => f.data_contrato ? `conforme contrato de locação firmado em ${esc(f.data_contrato)}` : "referente a contrato de locação firmado nesta imobiliária";
const admTxt = () => `sob administração de <b>${esc(TIMBRE.razao.split(" — ")[0])}</b>, inscrita no CNPJ sob nº ${esc(TIMBRE.cnpj)} e CRECI 4419-J, com sede na ${esc(TIMBRE.rodape[0])}`;
const assinaturas = ns => `<div class="doc-ass">${ns.map(n => `<div>${esc(n)}</div>`).join("") || "<div></div>"}</div>`;
// termos do próprio sistema (substituem os arquivos externos)
async function abrirTermoNativo(tipo, codigo, opts) {
  opts = opts || {};
  try {
    if (!CTT.length) CTT = await fetchAll("contratos", b => b.order("codigo", { ascending: false }));
    let c = codigo ? CTT.find(x => x.codigo === codigo) || await q(sb.from("contratos").select("*").eq("codigo", codigo).maybeSingle()) : null;
    if (!c) c = await escolherContrato({ entrega: "Entrega de chaves", caucao: "Devolução de caução", moradia: "Declaração de moradia", quitacao: "Declaração de quitação" }[tipo] + " · escolha o contrato");
    if (!c) return;
    const f = fichaDe(c), end = esc(endImovelFicha(f, c) || c.endereco || ""), lct = nomesLct(f).length ? nomesLct(f) : [c.locatario || ""];
    const pl = lct.length > 1 && !/PJ/i.test(f.lct_qtd || "");
    const quem = f.lct1_nome ? qualifGrupo(f, "lct").replace(/, (residentes?|com sede) na .*$/, "") : `<b>${esc(String(c.locatario || "").toUpperCase())}</b>`;
    if (tipo === "moradia") {
      return abrirDocEditavel("Declaração de moradia · " + c.codigo, `<h2 class="doc-tit">DECLARAÇÃO DE MORADIA</h2>
        <p class="doc-rec">Declaramos, para os devidos fins, que ${quem}, <b>${pl ? "RESIDEM" : "RESIDE"}</b> na ${end}, ${cttDataTxt(f)}, ${admTxt()}.</p>
        <p class="doc-rec">Por ser verdade, firmamos a presente declaração.</p>
        <p class="doc-data">${esc(TIMBRE.cidade)}, ${dataExt(hoje())}.</p>${assinaturas([TIMBRE.razao.split(" — ")[0]])}`, opts);
    }
    if (tipo === "entrega") {
      const prm = await pedirParams("Entrega de chaves · " + c.codigo, `<div class="row"><label class="fl"><span>Data da entrega das chaves</span><input type="date" name="data" value="${opts.data || hoje()}"></label></div>
        <p><b>Ficam em aberto acertos de:</b></p><div class="chips">${["aluguel", "água (SABESP)", "energia (CPFL)", "limpeza do imóvel", "pintura"].map(x => `<label class="chk"><input type="checkbox" name="pend" value="${esc(x)}"> ${esc(x)}</label>`).join("")}</div>`,
        fm => ({ data: fm.data.value || hoje(), pend: $$("[name=pend]:checked", $("#dlg")).map(x => x.value) }));
      if (!prm) return;
      const pend = prm.pend.length ? `, ficando em aberto acertos de ${prm.pend.length > 1 ? prm.pend.slice(0, -1).join(", ") + " e " + prm.pend.slice(-1) : prm.pend[0]} a serem feitos` : "";
      return abrirDocEditavel("Entrega de chaves · " + c.codigo, `<h2 class="doc-tit">DECLARAÇÃO DE ENTREGA DE CHAVES</h2>
        <p class="doc-rec">Declaramos, para os devidos fins, que ${quem}, nesta data, <b>${pl ? "PROCEDERAM" : "PROCEDEU"}</b> à entrega das chaves do imóvel situado na ${end}, ${cttDataTxt(f)}, ${admTxt()}${pend}.</p>
        <p class="doc-data">${esc(TIMBRE.cidade)}, ${dataExt(prm.data)}.</p>${assinaturas([TIMBRE.razao.split(" — ")[0]].concat(lct))}`, Object.assign({}, opts, { aoImprimir: opts.aoBaixar }));
    }
    if (tipo === "caucao") {
      const mov = (CAUC.movs || []).find(m => m.contrato_codigo === c.codigo && !m.data_saida) || (CAUC.movs || []).find(m => m.contrato_codigo === c.codigo);
      const val0 = (mov && (+mov.valor_saida || +mov.valor_entrada)) || parseMoney(f.caucao_valor) || 0;
      const prm = await pedirParams("Devolução de caução · " + c.codigo, `<div class="row"><label class="fl"><span>Valor devolvido</span><input name="valor" inputmode="numeric" value="${moedaFmt(val0)}"></label><label class="fl"><span>Data</span><input type="date" name="data" value="${hoje()}"></label></div>`,
        fm => ({ valor: parseMoney(fm.valor.value) || 0, data: fm.data.value || hoje() }), fm => mascaraMoeda(fm.valor));
      if (!prm) return;
      return abrirDocEditavel("Devolução de caução · " + c.codigo, `<h2 class="doc-tit">DECLARAÇÃO DE DEVOLUÇÃO DE CAUÇÃO</h2>
        <p class="doc-rec">${pl ? "Nós" : "Eu"}, ${quem}, ${pl ? "declaramos" : "declaro"} que ${pl ? "recebemos" : "recebi"} da empresa <b>${esc(TIMBRE.razao.split(" — ")[0])}</b>, inscrita no CNPJ sob nº ${esc(TIMBRE.cnpj)} e CRECI 4419-J, com sede na ${esc(TIMBRE.rodape[0])}, a importância de <b>${brl(prm.valor)} (${esc(extensoReais(prm.valor).toLowerCase())})</b>, referente à devolução da caução que ${pl ? "fizemos" : "fiz"} para a locação do imóvel situado na ${end}, ${cttDataTxt(f)}, dando plena e geral quitação.</p>
        <p class="doc-data">${esc(TIMBRE.cidade)}, ${dataExt(prm.data)}.</p>${assinaturas(lct)}`, Object.assign({ semTimbre: false }, opts, { aoImprimir: opts.aoBaixar }));
    }
    if (tipo === "quitacao") {
      const im = c.imovel_id ? S.imovelPor[c.imovel_id] : null;
      const cobs = c.imovel_id ? await fetchAll("cobrancas", b => b.eq("imovel_id", c.imovel_id).not("data_pagamento", "is", null).order("competencia", { ascending: false }), "id,competencia,vencimento,valor_pago,data_pagamento,locatario,imovel_id,recibo_locatario") : [];
      const meus = cobs.filter(x => norm(x.locatario).includes(norm(lct[0]).split(" ")[0]));
      if (!meus.length) return toast("Nenhum aluguel recebido deste contrato no sistema.", true);
      const prm = await pedirParams("Declaração de quitação · " + c.codigo, `<p>Marque os meses pagos que entram na declaração:</p><div class="tw" style="max-height:300px"><table class="compacta"><tbody>${meus.map((x, i) => `<tr><td><input type="checkbox" name="m" value="${x.id}" ${i < 12 ? "checked" : ""}></td><td>${esc(mesTxt(x.competencia))}</td><td>pago em ${dt(x.data_pagamento)}</td><td class="num">${n2(x.valor_pago)}</td></tr>`).join("")}</tbody></table></div>`,
        () => ({ ids: $$("[name=m]:checked", $("#dlg")).map(x => x.value) }));
      if (!prm || !prm.ids.length) return;
      return abrirDocEditavel("Declaração de quitação · " + c.codigo, quitacaoHTML(meus.filter(x => prm.ids.includes(x.id)), quem, end || esc((im || {}).endereco || ""), pl), opts);
    }
  } catch (e) { falha(e); }
}
function quitacaoHTML(cobs, quem, end, pl) {
  cobs = cobs.slice().sort((a, b) => a.competencia.localeCompare(b.competencia));
  const tot = r2(cobs.reduce((a, x) => a + +x.valor_pago, 0)), um = cobs.length === 1;
  return `<h2 class="doc-tit">DECLARAÇÃO DE QUITAÇÃO</h2>
    <p class="doc-rec">Declaramos, para os devidos fins, que ${quem} ${pl ? "efetuaram" : "efetuou"} o pagamento ${um ? `referente ao aluguel do mês de <b>${esc(mesTxt(cobs[0].competencia))}</b>` : "referente aos aluguéis abaixo relacionados"} do imóvel situado na ${end}, ${admTxt()}, dando plena e geral quitação ${um ? "do referido mês" : "dos meses relacionados"}.</p>
    <table class="doc-t"><thead><tr><th>Mês</th><th>Vencimento</th><th>Pago em</th><th>Recibo nº</th><th class="num">Valor (R$)</th></tr></thead><tbody>
    ${cobs.map(x => `<tr><td>${esc(mesTxt(x.competencia))}</td><td>${dt(x.vencimento)}</td><td>${dt(x.data_pagamento)}</td><td>${x.recibo_locatario || ""}</td><td class="num">${n2(x.valor_pago)}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="4"><b>Total</b></td><td class="num"><b>${n2(tot)}</b></td></tr></tfoot></table>
    <p class="doc-data">${esc(TIMBRE.cidade)}, ${dataExt(hoje())}.</p>${assinaturas([TIMBRE.razao.split(" — ")[0]])}`;
}
// pequeno formulário antes de gerar o termo
function pedirParams(titulo, corpo, ler, aoAbrir) {
  return new Promise(res => { let val = null; modal({ titulo, ok: "Gerar documento", corpo, aoAbrir: (f, d) => aoAbrir && aoAbrir(f, d), aoFechar: () => res(val),
    salvar: async f => { val = ler(f); } }); });
}
// lista de termos de contratos (sem o gerador: ele tem botão próprio)
const TERMOS_CTT = [
  { ic: "🔑", k: "entrega", t: "Entrega de chaves", d: "locatário devolve as chaves (pode marcar acertos em aberto)" },
  { ic: "💰", k: "caucao", t: "Devolução de caução", d: "locatário recebe a caução de volta" },
  { ic: "🏠", k: "moradia", t: "Declaração de moradia", d: "comprova que o locatário reside no imóvel" },
  { ic: "✅", k: "quitacao", t: "Declaração de quitação", d: "aluguéis pagos, para o locatário comprovar" }
];
ACT["ctt-termo"] = el => menuTermos(el, "Termos", TERMOS_CTT.map(x => ({ ic: x.ic, t: x.t, d: x.d, fn: () => abrirTermoNativo(x.k, "") })));
// cobrança: termos com escolha do locatário/devedor
ACT["cob-termos-menu"] = el => menuTermos(el, "Termos de cobrança", [
  { ic: "📨", t: "Notificação extrajudicial", d: "cobra o débito com prazo para pagar", k: "notificacao" },
  { ic: "🤝", t: "Acordo / confissão de dívida", d: "parcelamento com entrada e parcelas", k: "acordo" },
  { ic: "⚖️", t: "Petição de despejo", d: "ação de despejo por falta de pagamento", k: "despejo" }
].map(x => ({ ic: x.ic, t: x.t, d: x.d, fn: async () => {
  const devs = pode.ver("devedores") ? await q(sb.from("devedores").select("id,devedor,endereco,situacao").in("situacao", ["EM ABERTO", "ACORDO"])).catch(() => []) : [];
  const ops = INAD.map(i => [`inad|${i.id}`, `Inadimplente · ${i.locatario} · ${i.imovel}`]).concat(devs.map(d => [`dev|${d.id}`, `Devedor · ${d.devedor} · ${d.endereco}`]));
  if (!ops.length) return toast("Nenhum inadimplente ou devedor em aberto.", true);
  modal({ titulo: x.t + " · para quem?", ok: "Continuar",
    corpo: `<label class="fl"><span>Locatário inadimplente ou devedor (digite para procurar)</span><input name="q" list="dl-cob-q" autocomplete="off"><datalist id="dl-cob-q">${ops.map(o => `<option value="${esc(o[1])}">`).join("")}</datalist></label>`,
    salvar: async f => { const o = ops.find(z => z[1] === f.q.value); if (!o) throw new Error("Escolha da lista."); const [src, id] = o[0].split("|"); if (src === "dev") DEV = await fetchAll("devedores", b => b.order("id")); setTimeout(() => ACT["cob-termo"]({ dataset: { src, id, tipo: x.k } }), 0); } });
} })));

/* ---- v13: conferência da lista antiga de CPFL/SABESP com os imóveis e contratos ---- */
const dig = v => String(v || "").replace(/\D/g, "");
async function ucRgiAtuais() {
  const ctts = await fetchAll("contratos", b => b.order("codigo", { ascending: false }), "codigo,imovel_id,ficha");
  const por = {};
  S.imoveis.forEach(i => { const c = ctts.find(x => x.codigo === i.contrato_codigo) || ctts.find(x => x.imovel_id === i.id); por[i.id] = { c, uc: c ? (c.ficha || {}).uc || "" : "", rgi: c ? (c.ficha || {}).rgi || "" : "", fi: i.ficha || {} }; });
  return por;
}
ACT["cpfl-xls"] = async () => {
  const por = await ucRgiAtuais();
  await baixarXLSX(`cpfl-sabesp-${hoje()}.xlsx`, { "CPFL e SABESP": S.imoveis.map(i => { const a = por[i.id]; return { Imóvel: i.endereco, Situação: (STATUS_IMV[i.status] || [i.status])[0], Contrato: a.c ? a.c.codigo : "", "UC CPFL": a.uc || a.fi.uc || "", "RGI SABESP": a.rgi || a.fi.rgi || "", Origem: a.uc || a.rgi ? "contrato" : a.fi.uc || a.fi.rgi ? "imóvel" : "" }; }) });
};
ACT["cpfl-importar"] = () => {
  let dados = null, por = null;
  modal({ titulo: "CPFL e SABESP · conferir a lista antiga", xl: true, ok: "Gravar o que está marcado",
    corpo: `<p>Escolha o arquivo <b>cpfl-sabesp-conferencia.json</b> (está na pasta 4 do pacote). Ele traz a sua lista de CPFL/SABESP já ligada aos imóveis quando havia certeza. Aqui você confere: <b>novos</b> (o imóvel ainda não tem o dado), <b>iguais</b> e <b>diferentes</b> do contrato (você escolhe qual vale).</p>
      <input type="file" data-arq accept=".json"><div data-res></div>`,
    aoAbrir: (f, d) => $("[data-arq]", d).addEventListener("change", async e => {
      const arq = e.target.files[0], res = $("[data-res]", d); if (!arq) return;
      try {
        dados = JSON.parse(await arq.text()); if (dados.formato !== "cpfl-sabesp-conferencia") throw new Error("Arquivo não é a conferência de CPFL/SABESP.");
        por = await ucRgiAtuais();
        const linha = (it, idx, imvId) => {
          const i = S.imovelPor[imvId], a = por[imvId] || {}, atualUc = a.uc || (a.fi || {}).uc || "", atualRgi = a.rgi || (a.fi || {}).rgi || "";
          const grupos = v => String(v || "").replace(/\D+/g, " ").trim().split(" ").filter(Boolean);
          const mesmo = (x, y) => dig(x) === dig(y) || grupos(y).includes(dig(x)) || grupos(x).includes(dig(y));
          const difUc = it.uc && atualUc && !mesmo(it.uc, atualUc), difRgi = it.rgi && atualRgi && !mesmo(it.rgi, atualRgi);
          const novo = (it.uc && !atualUc) || (it.rgi && !atualRgi), cat = difUc || difRgi ? "dif" : novo ? "novo" : "igual";
          return { cat, html: `<tr class="cp-${cat}"><td><b>${esc(i ? i.endereco : "?")}</b><br><small class="muted">lista: ${esc(it.lista)} (linha ${it.linha})</small></td>
            <td class="mono">${esc(it.uc || "—")}<br>${esc(it.rgi || "—")}</td><td class="mono">${esc(atualUc || "—")}<br>${esc(atualRgi || "—")}<br><small class="muted">${a.c ? "contrato " + esc(a.c.codigo) : (a.fi || {}).uc || (a.fi || {}).rgi ? "imóvel" : ""}</small></td>
            <td>${cat === "igual" ? `<span class="tag ok">igual</span>` : cat === "novo" ? `<label class="chk"><input type="checkbox" data-ap="${idx}" checked> gravar</label>` : `<label class="chk"><input type="radio" name="dc${idx}" value="contrato" checked> manter o atual</label><label class="chk"><input type="radio" name="dc${idx}" value="lista" data-ap="${idx}"> usar a lista</label>`}</td></tr>` };
        };
        const ok = dados.itens.map((it, idx) => ({ it, idx })).filter(x => x.it.imovel_id && S.imovelPor[x.it.imovel_id]);
        const linhas = ok.map(x => Object.assign(linha(x.it, x.idx, x.it.imovel_id), x));
        const duv = dados.itens.map((it, idx) => ({ it, idx })).filter(x => !x.it.imovel_id);
        const n = c => linhas.filter(l => l.cat === c).length;
        res.innerHTML = `<div class="kpis" style="margin:10px 0">${kpi("Novos", String(n("novo")), "o imóvel ainda não tem", true)}${kpi("Diferentes", `<span class="${n("dif") ? "neg" : ""}">${n("dif")}</span>`, "você escolhe")}${kpi("Iguais", String(n("igual")), "nada a fazer")}${kpi("Sem par / dúvida", String(duv.length), "escolha o imóvel, se souber")}</div>
          <div class="seg" style="margin-bottom:8px">${[["dif", "Diferentes"], ["novo", "Novos"], ["duv", "Sem par / dúvida"], ["igual", "Iguais"]].map(([k, t], j) => `<button type="button" data-cpv="${k}" class="${j ? "" : "on"}">${t}</button>`).join("")}</div>
          <div class="tw cp-t" style="max-height:52vh"><table class="compacta"><thead><tr><th>Imóvel</th><th>Lista (UC / RGI)</th><th>Hoje (UC / RGI)</th><th>Decisão</th></tr></thead>
          <tbody>${linhas.map(l => l.html).join("")}${duv.map(x => `<tr class="cp-duv"><td><b>${esc(x.it.lista)}</b> <small class="muted">(linha ${x.it.linha})</small><br><small class="muted">${esc(x.it.motivo || "")}${x.it.nota ? " · obs.: " + esc(x.it.nota) : ""}</small></td>
            <td class="mono">${esc(x.it.uc || "—")}<br>${esc(x.it.rgi || "—")}</td><td colspan="2"><select data-duv="${x.idx}">${opt("", "— não gravar —", true)}${(x.it.candidatos || []).map(id => S.imovelPor[id] ? opt(id, S.imovelPor[id].endereco, false) : "").join("")}<optgroup label="Outro imóvel">${S.imoveis.map(i => opt(i.id, i.endereco, false)).join("")}</optgroup></select></td></tr>`).join("")}</tbody></table></div>`;
        const filtra = k => $$(".cp-t tbody tr", res).forEach(tr => (tr.hidden = !tr.classList.contains("cp-" + k)));
        $$("[data-cpv]", res).forEach(b => b.addEventListener("click", () => { $$("[data-cpv]", res).forEach(x => x.classList.toggle("on", x === b)); filtra(b.dataset.cpv); })); filtra("dif");
      } catch (x) { res.innerHTML = `<div class="box bad">${esc(erroMsg(x))}</div>`; }
    }),
    salvar: async () => {
      if (!dados) throw new Error("Escolha o arquivo.");
      const d = $("#dlg"), grav = [];
      $$("[data-ap]", d).forEach(x => { if (x.checked) { const it = dados.itens[+x.dataset.ap]; grav.push([it.imovel_id, it, x.type === "radio"]); } });
      $$("[data-duv]", d).forEach(x => { if (x.value) grav.push([x.value, dados.itens[+x.dataset.duv], true]); });
      if (!grav.length) throw new Error("Nada marcado para gravar.");
      let nc = 0, ni = 0;
      for (const [id, it, forcar] of grav) {
        const a = por[id] || {}, i = S.imovelPor[id];
        if (a.c) { // com contrato: o dado fica no contrato (vale para o imóvel)
          const f = Object.assign({}, a.c.ficha || {}); if (it.uc && (forcar || !f.uc)) f.uc = it.uc; if (it.rgi && (forcar || !f.rgi)) f.rgi = it.rgi;
          await q(sb.from("contratos").update({ ficha: f }).eq("codigo", a.c.codigo)); a.c.ficha = f; nc++;
        } else {
          const f = Object.assign({}, i.ficha || {}); if (it.uc && (forcar || !f.uc)) f.uc = it.uc; if (it.rgi && (forcar || !f.rgi)) f.rgi = it.rgi;
          await q(sb.from("imoveis").update({ ficha: f }).eq("id", id)); ni++;
        }
      }
      await recarregarImoveis(); toast(`Gravado: ${nc} em contratos, ${ni} em imóveis sem contrato.`); render();
    } });
};

const TABELAS_BKP = ["config", "contas", "categorias", "grupos_locador", "locadores", "fornecedores", "imoveis", "contratos", "reajustes", "devedores", "cobrancas", "lancamentos", "mapa_mensal", "depositos_fav", "depositos_mes", "cauc_contas", "cauc_mov", "vendas", "venda_itens", "notas_fiscais", "tarefas", "tutoriais"];
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
    <div class="card"><div class="card-h"><h2>Planilhas: baixar, importar e zerar</h2></div>
      <p class="hint">Baixar Excel: todos os usuários. ${pode.admin() ? "Importar e zerar: somente o administrador (você)." : "Importar e zerar: somente o administrador."}</p>
      <div class="tw"><table class="compacta dados-t"><tbody>${DADOS.filter(d => !d.ver || pode.ver(d.ver)).map(d => `<tr><td><b>${d.t}</b><div class="hint">${d.dica || ""}</div></td>
        <td><button class="btn sm" data-act="dado-xls" data-k="${d.k}">⬇ Excel</button></td>
        <td>${pode.admin() && d.imp ? `<button class="btn sm" data-act="dado-imp" data-k="${d.k}">Importar planilha</button>` : ""}</td>
        <td>${pode.admin() && d.zerar ? `<button class="btn sm danger" data-act="dado-zerar" data-k="${d.k}">Zerar</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
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
