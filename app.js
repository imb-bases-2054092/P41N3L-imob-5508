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
  ["Financeiro", [["caixa", "Caixa e lançamentos"], ["alugueis", "Pagto aluguel (locatários)"], ["depositos", "Pgto locador (depósitos)"], ["atrasados", "Cobrança · inadimplência"], ["devedores", "Cobrança · devedores (ex-locatários)"], ["recibos", "Recibos (locatário e locador)"], ["notas", "Notas fiscais"]]],
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
  receita: "Receitas diretas (da imobiliária)", terceiros_entrada: "Entradas brutas (parte é do proprietário)",
  despesa: "Despesas da imobiliária", retirada_cilas: "Retirada – Cilas", retirada_eliana: "Retirada – Eliana",
  terceiros_saida: "Saídas de dinheiro dos proprietários", transferencia: "Transferência"
};
// v17: grupos antigos (só para mostrar o nome de algo que ainda não foi reclassificado)
const GRUPOS_ANT = { imposto: "Imposto (antigo)", custo: "Custo (antigo)", retirada: "Retirada sem sócio (reclassifique: Cilas ou Eliana)" };
Object.keys(GRUPOS_ANT).forEach(k => Object.defineProperty(GRUPOS, k, { value: GRUPOS_ANT[k], enumerable: false }));
const grupoDRE = g => g === "imposto" || g === "custo" ? "despesa" : g;
// link do imóvel no site: CFG.SITE_IMOVEL_URL com {codigo} (padrão: busca no Google dentro do site)
const SITE_PADRAO = "https://imobiliariabandeirantes.com.br/{codigo}-imovel.html";
const SITE_MODELOS = [
  "https://imobiliariabandeirantes.com.br/{codigo}-imovel.html",
  "https://imobiliariabandeirantes.com.br/{codigo}-.html",
  "https://imobiliariabandeirantes.com.br/imovel/{codigo}",
  "https://imobiliariabandeirantes.com.br/busca?codigo={codigo}",
  "https://imobiliariabandeirantes.com.br/imoveis?codigo={codigo}",
  "https://imobiliariabandeirantes.com.br/pesquisa?referencia={codigo}",
  "https://imobiliariabandeirantes.com.br/?codigo={codigo}"
];
const urlSite = (cod, modelo) => (modelo || S.siteUrl || CFG.SITE_IMOVEL_URL || SITE_PADRAO).replace(/\{codigo\}/g, encodeURIComponent(String(cod).trim()));
const linkSite = (cod, txt) => `<a class="lnk-site" href="${esc(urlSite(cod))}" target="_blank" rel="noopener" data-pasta title="Abrir o imóvel no site da imobiliária">${esc(txt || String(cod).trim())}</a>`;
const STATUS_IMV = { ALG: ["Alugado", "info"], LVR: ["Livre", "ok"], OCP: ["Ocupado", "warn"], INTV: ["Inativo", "bad"] };
const catPor = id => S.categorias.find(c => c.id === id) || {};
const contaPor = id => S.contas.find(c => c.id === id) || {};

async function carregarBase() {
  const [contas, cats, imv, padroes] = await Promise.all([
    q(sb.from("contas").select("*").order("ordem").order("nome")),
    q(sb.from("categorias").select("*").order("grupo").order("nome")),
    fetchAll("imoveis", b => b.order("endereco").order("id")),
    q(sb.from("config").select("chave,valor").or("chave.like.grade.%,chave.eq.site_url"))
  ]);
  S.contas = contas; S.categorias = cats; setImoveis(imv);
  await recarregarLocadores();
  try { S.perm = await rpc("minhas_permissoes"); } catch (e) { S.perm = PERM_PADRAO[S.papel] || {}; }
  S.gradePadrao = {}; S.siteUrl = ""; padroes.forEach(r => { if (r.chave === "site_url") { S.siteUrl = r.valor || ""; return; } try { S.gradePadrao[r.chave.slice(6)] = JSON.parse(r.valor); } catch (e) { /* ignora */ } });
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
// entradas do menu com abas no alto (a 1ª chave é a que está no menu)
const SUBABAS = [DASH, [["recibos_lct", "Locatário"], ["recibos_lcd", "Locador"], ["recibos_ven", "Vendas"]], [["contratos", "Contratos"], ["cadastros", "📥 Cadastros recebidos"]]];
const grupoSub = p => SUBABAS.find(gr => gr.some(([k]) => k === p));
const PERM_DE = p => ({ recibos_lct: "recibos", recibos_lcd: "recibos", recibos_ven: "vendas", cob_ven: "vendas", imoveis_venda: "vendas", interessados_ven: "vendas", interessados_loc: "imoveis", termos: "tutoriais", cadastros: "contratos" })[p] || p;
const TITULOS = { termos: "Termos", imoveis_venda: "Imóveis à venda", interessados_loc: "Interessados · locação", interessados_ven: "Interessados · vendas", recibos_ven: "Recibos · vendas", cob_ven: "Cobrança · vendas", notas: "Notas fiscais", recibos_lct: "Recibos · locatários", recibos_lcd: "Recibos · locadores", locadores: "Locadores", fornecedores: "Prestadores e lojas", tutoriais: "Tutoriais", painel: "Dashboard", alugueis: "Pagto aluguel (aluguéis do mês)", cadastros: "Cadastros recebidos (formulário do cliente)", atrasados: "Cobrança", caixa: "Caixa e lançamentos", tarefas: "Tarefas", vendas: "Contratos de venda",
  dre: "Dashboard", depositos: "Pagamento de locadores", indicadores: "Indicadores", devedores: "Cobrança", imoveis: "Imóveis de locação", contratos: "Contratos de locação", caucao: "Contas caução", backup: "Backup e dados", config: "Configurações" };
const SEM_MES = ["cadastros", "termos", "imoveis_venda", "interessados_loc", "interessados_ven", "recibos_ven", "cob_ven", "locadores", "fornecedores", "tutoriais", "contratos", "backup", "config", "devedores", "tarefas", "vendas", "caucao"];

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
  const gs = grupoSub(p);
  $$("#nav a").forEach(x => x.classList.toggle("on", x.dataset.p === p || ((p === "devedores" || p === "cob_ven") && x.dataset.p === "atrasados") || !!(gs && x.dataset.p === gs[0][0])));
  $("#subabas").innerHTML = gs ? `<div class="seg cobr-abas dash-abas">${gs.filter(([k]) => pode.ver(PERM_DE(k))).map(([k, t]) => `<a href="#${k}" class="${k === p ? "on" : ""}">${t}</a>`).join("")}</div>` : "";
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
  alugueis: { aperm: "alugueis", rot: "Pagto aluguel", ops: { areceber: "a receber no mês", recebidos: "recebidos no mês", atrasados: "atrasados no mês", nada: "(nada)" } },
  depositos: { aperm: "depositos", rot: "Pgto locador", ops: { afazer: "repasses a fazer", feitos: "repasses feitos no mês", nada: "(nada)" } },
  atrasados: { aperm: "atrasados", rot: "Cobrança", ops: { atraso: "aluguéis em atraso", devedores: "devedores (ex-locatários)", nada: "(nada)" } },
  locadores: { aperm: "locadores", rot: "Locadores", ops: { total: "locadores cadastrados", nada: "(nada)" } },
  imoveis: { aperm: "imoveis", rot: "Imóveis", ops: { ALG: "alugados", LVR: "livres", OCP: "ocupados", INTV: "inativos", nada: "(nada)" } },
  contratos: { aperm: "contratos", rot: "Contratos", ops: { ativos: "ativos", semimovel: "sem imóvel ligado", elab: "em preparo (rascunho, corrigir, pronto)", cadastros: "cadastros recebidos novos (formulário)", nada: "(nada)" } },
  caucao: { aperm: "caucao", rot: "Contas caução", ops: { ocup: "ocupadas", livres: "livres", nada: "(nada)" } },
  tarefas: { aperm: "tarefas", rot: "Tarefas", ops: { hoje: "minhas para hoje", atrasadas: "atrasadas", nada: "(nada)" } },
  caixa: { aperm: "caixa", rot: "Caixa", ops: { prevpagar: "previstos a pagar no mês", lancmes: "lançamentos no mês", nada: "(nada)" } },
  recibos_lct: { aperm: "recibos", rot: "Recibos", ops: { mes: "recibos de locatários no mês", meslcd: "recibos de locadores no mês", nada: "(nada)" } },
  notas: { aperm: "notas", rot: "Notas fiscais", ops: { mesir: "aluguéis com IR no mês", emitidas: "notas registradas no mês", nada: "(nada)" } },
  fornecedores: { aperm: "fornecedores", rot: "Prestadores e lojas", ops: { total: "cadastrados", nada: "(nada)" } },
  vendas: { aperm: "vendas", rot: "Vendas", ops: { ano: "vendas no ano", total: "vendas (todas)", areceber: "com comissão a receber", nada: "(nada)" } },
  tutoriais: { aperm: "tutoriais", rot: "Tutoriais", ops: { total: "tutoriais", nada: "(nada)" } }
};
const NAV_PADRAO = { A: { alugueis: "areceber", depositos: "afazer", atrasados: "atraso", locadores: "nada", imoveis: "ALG", contratos: "ativos", caucao: "ocup", tarefas: "hoje", caixa: "nada", recibos_lct: "nada", notas: "mesir", fornecedores: "nada", vendas: "ano", tutoriais: "nada" },
  B: { alugueis: "recebidos", depositos: "feitos", atrasados: "devedores", locadores: "total", imoveis: "LVR", contratos: "semimovel", caucao: "livres", tarefas: "atrasadas", caixa: "prevpagar", recibos_lct: "mes", notas: "emitidas", fornecedores: "total", vendas: "areceber", tutoriais: "nada" } };
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
    alugueis: { areceber: () => conta(cob().is("data_pagamento", null).is("devedor_id", null).eq("carencia", false)), recebidos: () => conta(cob().not("data_pagamento", "is", null)), atrasados: () => conta(cob().is("data_pagamento", null).is("devedor_id", null).eq("carencia", false).lt("vencimento", hoje())) },
    depositos: { afazer: () => conta(cob().not("data_pagamento", "is", null).is("repasse_data", null)), feitos: () => conta(cob().not("repasse_data", "is", null)) },
    atrasados: { atraso: () => conta(head("cobrancas").is("data_pagamento", null).is("devedor_id", null).eq("carencia", false).lt("vencimento", hoje())), devedores: () => pode.ver("devedores") ? conta(head("devedores").in("situacao", ["EM ABERTO", "ACORDO"])) : null },
    locadores: { total: () => conta(head("locadores").eq("ativo", true)) },
    imoveis: { ALG: () => S.imoveis.filter(i => i.status === "ALG").length, LVR: () => S.imoveis.filter(i => i.status === "LVR").length, OCP: () => S.imoveis.filter(i => i.status === "OCP").length, INTV: () => S.imoveis.filter(i => i.status === "INTV").length },
    contratos: { ativos: () => conta(head("contratos").eq("situacao", "ATIVO")), semimovel: () => conta(head("contratos").in("situacao", ["ATIVO", "PRONTO"]).is("imovel_id", null)), elab: () => conta(head("contratos").in("situacao", PREPARO)), cadastros: () => conta(head("cadastros_recebidos").eq("situacao", "NOVO")) },
    caucao: { ocup: () => conta(head("cauc_mov").is("data_saida", null).eq("somada", false)),
      livres: async () => { const [t, bl, oc] = await Promise.all([conta(head("cauc_contas")), conta(head("cauc_contas").eq("bloqueada", true)), conta(head("cauc_mov").is("data_saida", null).eq("somada", false))]); return t == null ? null : Math.max(0, t - bl - oc); } },
    tarefas: { hoje: () => q(sb.from("tarefas").select("*").eq("ativa", true)).then(ls => ls.filter(t => tarefaPendente(t) && (!t.responsavel || t.responsavel === S.user.id)).length).catch(() => null),
      atrasadas: () => q(sb.from("tarefas").select("*").eq("ativa", true)).then(ls => ls.filter(t => { const d = dataTarefa(t); return d && d < hoje() && !tarefaFeita(t); }).length).catch(() => null) },
    caixa: { prevpagar: () => conta(head("lancamentos").eq("competencia", S.mes).eq("pago", false).eq("tipo", "saida")), lancmes: () => conta(head("lancamentos").eq("competencia", S.mes)) },
    recibos_lct: { mes: () => conta(cob().not("recibo_locatario", "is", null)), meslcd: () => conta(cob().not("recibo_locador", "is", null)) },
    notas: { mesir: () => S.imoveis.filter(i => i.declarar_ir === "Sim" && i.status === "ALG").length, emitidas: () => conta(head("notas_fiscais").eq("competencia", S.mes).neq("numero", "")) },
    fornecedores: { total: () => conta(head("fornecedores").eq("ativo", true)) },
    vendas: { ano: () => conta(head("vendas").gte("data", S.mes.slice(0, 4) + "-01-01").lte("data", S.mes.slice(0, 4) + "-12-31")), total: () => conta(head("vendas")),
      areceber: async () => { try { const [vs, its] = await Promise.all([q(sb.from("vendas").select("id,comissao,lancamento_id")), q(sb.from("venda_itens").select("venda_id,tipo,valor,pago_em").eq("tipo", "comissao"))]);
        return vs.filter(v => { const pg = its.filter(i => i.venda_id === v.id && i.pago_em).reduce((a, i) => a + +i.valor, 0); return +v.comissao > 0 && !v.lancamento_id && pg < +v.comissao - 0.005; }).length; } catch (e) { return null; } } },
    tutoriais: { total: () => conta(head("tutoriais")).then(n => n == null ? null : n + TUTORIAIS.length) }
  };
  const ALERTA = { cadastros: 1, afazer: 1, atraso: 1, devedores: 1, semimovel: 1, hoje: 1, atrasados: 1, prevpagar: 1 };
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
    requestAnimationFrame(ajustarAlturas); setTimeout(ajustarAlturas, 400); // de novo depois que as fontes e os cartões assentam
    atualizarContadores();
  } catch (e) {
    if (tok !== S.rtok) return;
    falha(e); real.innerHTML = `<div class="card empty">Não foi possível carregar: ${esc(erroMsg(e))}</div>`;
  } finally { if (tok === S.rtok) real.classList.remove("loading"); }
}
window.addEventListener("hashchange", () => { if (S.user && S.membro) ir(); });
// v16: clicar no menu lateral zera as pesquisas e os filtros de coluna (e recarrega a tela, mesmo se já estiver nela)
document.addEventListener("click", ev => {
  const a = ev.target.closest("#nav a[data-p], #subabas a"); if (!a) return;
  Object.keys(S.f).forEach(k => { if (/Busca/.test(k)) S.f[k] = ""; });
  S.f.recPessoa = ""; Object.values(G).forEach(g => { g.filtros = {}; });
  if (a.getAttribute("href") === location.hash) { ev.preventDefault(); if (S.user && S.membro) ir(); }
}, true);

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
    modal({ titulo, corpo: `<p>${texto}</p>`, ok, salvar: async () => { feito = true; }, aoFechar: () => res(feito) });
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
const AJ_SUG = { acr: [["Multa", "imob"], ["IPTU", "repassar"], ["Condomínio", "repassar"], ["Água", "repassar"], ["Energia", "repassar"], ["Diferença de dias", "prop"], ["Aluguel proporcional", "prop"], ["Outros", "prop"]],
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
// v15: aluguel com acréscimo, desconto ou despesa do proprietário (recebido ou não, repassado ou não)
const despDe = c => (DESP[c.imovel_id] || []).filter(l => l.competencia === c.competencia);
const temAjuste = c => ajustesDe(c).length > 0 || despDe(c).length > 0;
function ajustesTags(c) {
  const aj = ajustesDe(c), d = despDe(c), t = [];
  if (aj.some(x => x.tipo === "acr")) t.push(`<span class="aj-t acr" title="${esc(aj.filter(x => x.tipo === "acr").map(x => (ajRot(x) || "acréscimo") + " " + n2(x.valor)).join(" · "))}">+ acrésc.</span>`);
  if (aj.some(x => x.tipo === "desc")) t.push(`<span class="aj-t desc" title="${esc(aj.filter(x => x.tipo === "desc").map(x => (ajRot(x) || "desconto") + " " + n2(x.valor)).join(" · "))}">− desc.</span>`);
  if (d.length) t.push(`<span class="aj-t desp" title="${esc(d.map(l => (l.descricao || "despesa") + " " + n2(l.valor)).join(" · "))}">🔧 despesa</span>`);
  return t.join("");
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
// v19: carência do contrato — mês "alugado" sem aluguel a pagar
const valorCobTxt = c => c.carencia ? `<span class="tag warn">CARÊNCIA</span>` : n2(devido(c));
function stCob(c) {
  if (c.carencia && !c.data_pagamento) return "carencia";
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
const podeRepassar = c => !c.repasse_data && !c.devedor_id && !c.carencia;
const ST_COB = { carencia: ["Carência", "warn"], aberto: ["A vencer", "idle"], atrasado: ["Atrasado", "bad"], parcial: ["Pago parcial", "warn"], pago: ["A repassar", "info"], quitado: ["Concluído", "ok"], devedor: ["Em devedores", "idle"], adiantado: ["Repassado sem receber", "warn"] };
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
    fetchAll("cobrancas", b => b.is("data_pagamento", null).is("devedor_id", null).eq("carencia", false).lt("vencimento", hoje()).order("id"), "id,imovel_id,valor,acrescimos,descontos"),
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
  const caucBaixa = caucVig.length ? (await q(sb.from("contratos").select("codigo").in("codigo", caucVig.map(m => m.contrato_codigo).filter(Boolean)).not("situacao", "in", "(ATIVO,RASCUNHO,CORRIGIR,PRONTO)")).catch(() => [])).length : 0;
  const saldos = soMinhasContas(saldosTodos);

  // DRE por mês (realizado)
  const meses = []; for (let i = 0; i < 12; i++) meses.push(addMes(ini, i));
  const porMes = {}; meses.forEach(m => (porMes[m] = { receita: 0, imposto: 0, custo: 0, despesa: 0, retirada: 0 }));
  res.filter(r => r.pago).forEach(r => {
    const g = /^retirada/.test(r.grupo) ? "retirada" : grupoDRE(r.grupo);
    const m = porMes[r.competencia]; if (!m || !(g in m)) return;
    m[g] += r.tipo === "entrada" ? +r.total : -+r.total;
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
    html: c => c.carencia ? valorCobTxt(c) : ajustesDe(c).length ? `<b title="${esc(ajTxt(c))}">*${n2(devido(c))}</b>${ajustesDe(c).some(x => x.conferir) ? ` <span class="tag warn" title="Aluguel proporcional calculado pelo contrato: confira (abra o aluguel)">conferir</span>` : ""}` : n2(devido(c)) },
  { k: "taxa", t: "T. Adm.", tipo: "num", v: c => c.taxa_valor, html: c => c.taxa_valor != null ? n2(c.taxa_valor) : `<span class="muted">${n2(+c.taxa_adm_pct)}%</span>` },
  { k: "valor_pago", t: "Recebido", tipo: "num", v: c => c.valor_pago, html: c => c.data_pagamento ? `${n2(c.valor_pago)}<span class="sub" title="${esc(contaPor(c.conta_pgto_id).nome || "")}">${dt(c.data_pagamento)}</span>`
      : !c.devedor_id && !c.carencia && pode.receber() ? `<button class="btn sm pri" data-act="receber" data-id="${c.id}">Receber</button>` : "" },
  { k: "data_pagamento", t: "Data receb.", tipo: "data", oculta: true },
  { k: "conta", t: "Conta receb.", v: c => contaPor(c.conta_pgto_id).nome || "", oculta: true },
  { k: "repasse_valor", t: "Repasse", tipo: "num", v: c => c.repasse_valor, html: c => c.repasse_data ? `${n2(c.repasse_valor)}<span class="sub">${dt(c.repasse_data)}</span>`
      : podeRepassar(c) && pode.editar() ? `<button class="btn sm pri" data-act="repassar" data-id="${c.id}" title="${c.data_pagamento ? "" : "Repassar sem o locatário ter pago (a imobiliária adianta) · "}valor do proprietário: ${n2(calcCob(c).prop)}">Repassar</button>` : "" },
  { k: "repasse_data", t: "Data repasse", tipo: "data", oculta: true },
  { k: "situacao", t: "Situação", f: c => ST_COB[stCob(c)][0], html: tagCob },
  { k: "carteira", t: "Carteira", f: c => CARTEIRAS[(S.imovelPor[c.imovel_id] || {}).carteira] || "", oculta: true },
  { k: "ajustes", t: "Ajustes", dica: "Acréscimos, descontos e despesas do proprietário lançadas neste aluguel", v: c => [ajustesDe(c).some(x => x.tipo === "acr") ? "acréscimo" : "", ajustesDe(c).some(x => x.tipo === "desc") ? "desconto" : "", despDe(c).length ? "despesa" : ""].filter(Boolean).join(", "), html: ajustesTags },
  { k: "obs", t: "Observações", cls: "trunc", oculta: true }
];
let COB_REAJ = [];
let COB_RES = null; // v19: cards esperado × real × defasagem (vieram da tela Imóveis)
PAGES.alugueis = async pg => {
  const verRes = pode.editar() || S.papel === "leitura", passado = S.mes < inicioMes(hoje());
  let res, mapa;
  [COB, , res, mapa] = await Promise.all([fetchAll("cobrancas", b => b.eq("competencia", S.mes).order("vencimento").order("id")), carregarDesp(S.mes),
    verRes ? rpc("resumo_cobrancas", { p_ini: S.mes, p_fim: S.mes }).catch(() => []) : Promise.resolve(null),
    verRes && passado ? fetchAll("mapa_mensal", b => b.eq("competencia", S.mes).order("imovel_id")).catch(() => []) : Promise.resolve(null)]);
  COB_RES = verRes ? { esp: resumoEsperado(mapa && mapa.length ? mapa.map(h => ({ status: h.status, valor: h.valor, taxa_adm: h.taxa_adm, carteira: h.carteira || (S.imovelPor[h.imovel_id] || {}).carteira || "administrado" })) : S.imoveis), real: resumoReal(res || []) } : null;
  COB_REAJ = pode.editar() ? await q(sb.from("reajustes").select("id").is("aplicado_em", null).lte("competencia", S.mes)) : [];
  setRd(pg, () => desenharAlugueis());
  desenharAlugueis(pg);
};
function desenharAlugueis(pg) {
  pg = pg || $("#page");
  const f = S.f.cob || "todos", busca = S.f.cobBusca || "";
  const conta = { todos: COB.length, carencia: 0, aberto: 0, atrasado: 0, pago: 0, quitado: 0, parcial: 0, devedor: 0, adiantado: 0, ajustes: 0 };
  COB.forEach(c => { conta[stCob(c)]++; if (temAjuste(c)) conta.ajustes++; });
  let lista = COB.filter(c => f === "todos" || stCob(c) === f || (f === "aberto" && stCob(c) === "atrasado") || (f === "ajustes" && temAjuste(c)));
  if (busca) { const b = norm(busca); lista = lista.filter(c => norm((S.imovelPor[c.imovel_id] || {}).endereco + " " + c.locatario + " " + c.locador).includes(b)); }
  const g = grade("alugueis", COLS_COB, lista, {
    sort: { k: "vencimento", dir: "asc" }, divisor: "vencimento", attr: c => `data-act="cob-det" data-id="${c.id}" style="cursor:pointer"`,
    rodape: fl => `${fl.length} aluguéis · valor ${brl(fl.reduce((a, c) => a + devido(c), 0))} · recebido ${brl(fl.reduce((a, c) => a + (+c.valor_pago || 0), 0))} · taxa ${brl(fl.reduce((a, c) => a + (+c.taxa_valor || 0), 0))} · repassado ${brl(fl.reduce((a, c) => a + (+c.repasse_valor || 0), 0))}`
  });
  g.redesenhar = () => desenharAlugueis();
  const chips = [["todos", "Todos", ""], ["aberto", "Em aberto", "st-INTV"], ["atrasado", "Atrasados", "st-INTV"], ["parcial", "Parcial", "st-INTV"], ["pago", "Repasse pendente", "st-ALG"], ["adiantado", "Repassados sem receber", "st-OCP"], ["quitado", "Concluídos", "st-LVR"], ["ajustes", "Com acréscimo, desconto ou despesa", ""]].concat(conta.carencia ? [["carencia", "Carência", "st-OCP"]] : []);
  pg.innerHTML = `<div class="grid">
    ${COB_RES ? `<details class="cob-res"${lerPref("cobRes") === "0" ? "" : " open"}><summary>Resumo de ${esc(mesTxt(S.mes))}: esperado × real</summary>${cardsMes(COB_RES.esp, COB_RES.real, "Resumo de " + mesTxt(S.mes))}</details>` : ""}
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
    </div>
    ${gradeHTML("alugueis")}`}
  </div>`;
  ligarBusca(pg); ligarSelecao(pg);
  const dr = $(".cob-res", pg); if (dr) dr.addEventListener("toggle", () => gravarPref("cobRes", dr.open ? "1" : "0"));
}
const lerPref = k => { try { return localStorage.getItem("imob." + k); } catch (e) { return null; } };
const gravarPref = (k, v) => { try { localStorage.setItem("imob." + k, v); } catch (e) { /* sem armazenamento */ } };
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
  if (!lista.length) return toast("Nenhum reajuste aguardando confirmação.");
  // v16: todos de uma vez, numa lista
  modal({ titulo: `Reajustes do mês (${lista.length})`, xl: true, ok: "Gravar as escolhas",
    corpo: `<p class="hint">Confira o novo valor de cada um e escolha: <b>Aplicar</b> (muda o aluguel do imóvel e os aluguéis ainda não pagos a partir do mês), <b>Depois</b> (continua aguardando) ou <b>Desistir</b> (apaga o reajuste).</p>
      <div class="seg" style="margin:6px 0"><button type="button" data-todos="ap">Marcar todos: Aplicar</button><button type="button" data-todos="dp">Todos: Depois</button></div>
      <div class="tw" style="max-height:60vh"><table class="compacta rj-t"><thead><tr><th>Imóvel</th><th>Locatários</th><th>Contrato</th><th>A partir de</th><th class="num">Atual</th><th class="num">Novo</th><th class="num">%</th><th>O que fazer</th></tr></thead><tbody>
      ${lista.map((r, k) => { const im = S.imovelPor[r.imovel_id] || {};
        return `<tr data-k="${k}"><td>${tagImv(im.endereco || "?")}</td><td>${tagPes(separaNomes(im.locatario), "etq-lct", "", 2)}</td><td>${tagCtt(im.contrato_codigo)}</td><td>${esc(mesCurto(r.competencia))}</td>
          <td class="num">${n2(im.valor || 0)}</td><td class="num"><input data-rv="${k}" inputmode="numeric" value="${esc(moedaFmt(r.valor_novo))}" style="width:110px;text-align:right"></td><td class="num" data-pct="${k}"></td>
          <td><div class="seg rj-seg">${[["ap", "Aplicar"], ["dp", "Depois"], ["no", "Desistir"]].map(([v, t]) => `<button type="button" data-ra="${k}" data-v="${v}" class="${v === "ap" ? "on" : ""}">${t}</button>`).join("")}</div>${r.obs ? `<small class="muted">${esc(r.obs)}</small>` : ""}</td></tr>`; }).join("")}
      </tbody></table></div>`,
    aoAbrir: (f, d) => {
      const pct = k => { const im = S.imovelPor[lista[k].imovel_id] || {}, v = parseMoney($(`[data-rv="${k}"]`, d).value); $(`[data-pct="${k}"]`, d).textContent = im.valor && v ? n2((v / im.valor - 1) * 100) + "%" : ""; };
      $$("[data-rv]", d).forEach(x => { mascaraMoeda(x); x.addEventListener("input", () => pct(+x.dataset.rv)); pct(+x.dataset.rv); });
      $$("[data-ra]", d).forEach(b => b.addEventListener("click", () => { $$(`[data-ra="${b.dataset.ra}"]`, d).forEach(x => x.classList.toggle("on", x === b)); }));
      $$("[data-todos]", d).forEach(b => b.addEventListener("click", () => $$(`[data-ra][data-v="${b.dataset.todos}"]`, d).forEach(x => x.click())));
    },
    salvar: async () => {
      const d = $("#dlg"); let ap = 0, no = 0;
      for (let k = 0; k < lista.length; k++) {
        const v = ($(`[data-ra="${k}"].on`, d) || {}).dataset; const acao = v ? v.v : "dp", r = lista[k];
        if (acao === "ap") { const val = parseMoney($(`[data-rv="${k}"]`, d).value); if (!(val > 0)) throw new Error("Informe o novo valor de " + ((S.imovelPor[r.imovel_id] || {}).endereco || "")); await rpc("aplicar_reajuste", { p_id: r.id, p_valor: val }); ap++; }
        else if (acao === "no") { await q(sb.from("reajustes").delete().eq("id", r.id)); no++; }
      }
      toast(`${ap} reajuste(s) aplicado(s)${no ? `, ${no} desistido(s)` : ""}.`); await recarregarImoveis(); render();
    } });
}
ACT["reaj-conf"] = () => confirmarReajustes();
/* v19: reajuste a cada 12 meses do contrato — lista os que vencem neste mês e no próximo e programa de uma vez */
ACT["reaj-prox"] = async () => {
  const atual = inicioMes(hoje());
  const [ctts, rjs] = await Promise.all([fetchAll("contratos", b => b.eq("situacao", "ATIVO").order("codigo"), "codigo,imovel_id,inicio,data_contrato,valor"),
    fetchAll("reajustes", b => b.gte("competencia", addMes(atual, -2)).order("competencia"), "imovel_id,competencia,aplicado_em")]);
  const linhas = horizonte => S.imoveis.filter(i => i.status === "ALG" && i.contrato_codigo).map(i => {
    const c = ctts.find(x => x.codigo === i.contrato_codigo); if (!c || !c.inicio) return null;
    const fc = addMes(inicioMes(c.inicio), 1); let comp = addMes(fc, 12), k = 1;
    while (comp < atual) { comp = addMes(comp, 12); k++; }
    if (comp > addMes(atual, horizonte)) return null;
    const ja = rjs.some(r => r.imovel_id === i.id && r.competencia >= addMes(comp, -2) && r.competencia <= addMes(comp, 2));
    return { i, c, comp, anos: k, ja, aniv: addMes(c.inicio.slice(0, 7) + "-01", 12 * k).slice(0, 8) + c.inicio.slice(8, 10) };
  }).filter(Boolean).sort((a, b) => a.comp.localeCompare(b.comp) || COLL.compare(rotuloImvDe(a.i), rotuloImvDe(b.i)));
  let H = 1, L = linhas(H);
  const tabela = () => `<div class="tw" style="max-height:52vh"><table class="compacta"><thead><tr><th></th><th>Imóvel</th><th>Locatário</th><th>Contrato</th><th>Início</th><th>Completa</th><th>Vale no aluguel de</th><th class="num">Atual</th><th class="num">Novo</th></tr></thead><tbody>
    ${L.map((x, k) => `<tr><td>${x.ja ? `<span class="tag ok" title="Já existe reajuste programado ou aplicado nessa época">já programado</span>` : `<input type="checkbox" data-rp="${k}" checked>`}</td><td>${tagImv(x.i.endereco)}</td><td>${tagPes(separaNomes(x.i.locatario), "etq-lct", "", 2)}</td><td>${tagCtt(x.c.codigo)}</td><td>${dt(x.c.inicio)}</td>
      <td>${x.anos} ano${x.anos > 1 ? "s" : ""} em ${dt(x.aniv)}</td><td><b>${esc(mesTxt(x.comp))}</b></td><td class="num">${n2(x.i.valor)}</td><td class="num">${x.ja ? "" : `<input data-rn="${k}" inputmode="numeric" style="width:110px;text-align:right">`}</td></tr>`).join("") || `<tr><td colspan="9" class="muted">Nenhum contrato completa 12 meses nesse período.</td></tr>`}</tbody></table></div>`;
  modal({ titulo: "Reajustes a programar (aniversário do contrato)", xl: true, ok: "Programar os marcados",
    corpo: `<p class="hint">Todo contrato é reajustado a cada 12 meses contados do início. O novo valor vale a partir do aluguel que vence depois do aniversário (ex.: início 25/10/2025 → reajuste no aluguel de nov/2026). Informe o índice do período (IGP-M, IPCA…) para calcular todos de uma vez, ou digite o valor de cada um.</p>
      <div class="row"><label class="fl" style="max-width:200px"><span>Índice acumulado (%)</span><input data-rp-pct inputmode="decimal" placeholder="ex.: 4,25"></label>
        <label class="fl" style="max-width:240px"><span>Mostrar</span><select data-rp-h>${opt("1", "este mês e o próximo", true)}${opt("3", "próximos 3 meses", false)}${opt("12", "próximos 12 meses", false)}</select></label></div>
      <div data-rp-t>${tabela()}</div>`,
    aoAbrir: (f, d) => {
      const pct = $("[data-rp-pct]", d), liga = () => { $$("[data-rn]", d).forEach(x => mascaraMoeda(x)); calc(); };
      const calc = () => { const p = parseMoney(pct.value); if (p == null) return; L.forEach((x, k) => { const inp = $(`[data-rn="${k}"]`, d); if (inp) inp.value = moedaFmt(r2(+x.i.valor * (1 + p / 100))); }); };
      pct.addEventListener("input", calc);
      $("[data-rp-h]", d).addEventListener("change", e => { H = +e.target.value; L = linhas(H); $("[data-rp-t]", d).innerHTML = tabela(); liga(); });
      liga();
    },
    salvar: async () => {
      const d = $("#dlg"), ins = [];
      L.forEach((x, k) => { const ck = $(`[data-rp="${k}"]`, d); if (!ck || !ck.checked) return; const v = parseMoney($(`[data-rn="${k}"]`, d).value);
        if (!(v > 0)) throw new Error(`Informe o novo valor de ${rotuloImvDe(x.i)} (ou o índice no alto).`);
        ins.push({ imovel_id: x.i.id, competencia: x.comp, valor_novo: v, obs: `Aniversário de ${x.anos} ano(s) do contrato ${x.c.codigo}` }); });
      if (!ins.length) throw new Error("Nenhum reajuste marcado.");
      await q(sb.from("reajustes").insert(ins)); toast(`${ins.length} reajuste(s) programado(s). Eles aparecem para confirmar quando chegar o mês.`); render();
    } });
};
// editor de acréscimos / descontos (cada item com descrição e de quem é)
function ajustesHTML(c, ed) {
  const extra = x => { const o = Object.assign({}, x); ["tipo", "desc", "valor", "de", "obs"].forEach(k => delete o[k]); return Object.keys(o).length ? ` data-x="${esc(JSON.stringify(o))}"` : ""; };
  const lin = (x, i) => `<div class="aj-l${x.conferir ? " aj-conf" : ""}" data-aj="${i}"${extra(x)}>
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
  const ler = () => $$("[data-aj]", ls).map(l => { let ex = {}; try { ex = l.dataset.x ? JSON.parse(l.dataset.x) : {}; } catch (e) { ex = {}; }
    const x = Object.assign({ tipo: $("[data-k=tipo]", l).value, desc: $("[data-k=desc]", l).value.trim(), valor: parseMoney($("[data-k=valor]", l).value) || 0, de: $("[data-k=de]", l).value }, ex), o = $("[data-k=obs]", l).value.trim(); if (o) x.obs = o; else delete x.obs; return x; }).filter(x => x.desc || x.valor);
  const ligar = l => {
    const tipo = $("[data-k=tipo]", l), desc = $("[data-k=desc]", l), de = $("[data-k=de]", l);
    tipo.addEventListener("change", () => { de.innerHTML = Object.entries(AJ_DE[tipo.value]).map(([k, t]) => opt(k, t, false)).join(""); desc.innerHTML = `<option value="">— escolha o item —</option>` + AJ_SUG[tipo.value].map(([t]) => opt(t, t, false)).join(""); aoMudar && aoMudar(); });
    const val = $("[data-k=valor]", l); mascaraMoeda(val);
    const obs = $("[data-k=obs]", l);
    desc.addEventListener("change", () => {
      if ((desc.value === "Outros" || /^multa/i.test(desc.value)) && !obs.value) { if (/^multa/i.test(desc.value)) obs.placeholder = "atraso ou rescisão antecipada? (ex.: atraso ref. set/26)"; obs.focus(); }
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
/* ---------- v19: aluguel proporcional calculado pelo contrato (confirmar ou abonar dias) ---------- */
function propConfHTML(c) {
  const k = ajustesDe(c).findIndex(x => x.conferir); if (k < 0) return "";
  const x = ajustesDe(c)[k], dias = +x.dias || 0, dia = r2(+c.valor / 30);
  return `<div class="box warn prop-conf" data-prop="${k}"><b>Aluguel proporcional calculado pelo contrato:</b> ${esc(x.obs || "")} → ${dias} × ${brl(dia)} (aluguel ÷ 30) = <b>${brl(x.valor)}</b>.
    ${pode.editar() ? `<div class="row" style="margin-top:6px;align-items:end"><label class="fl" style="max-width:150px"><span>Dias a cobrar</span><input type="number" data-prop-dias min="0" max="${Math.max(dias, 31)}" value="${dias}"></label><span class="hint" data-prop-v style="align-self:center">${brl(x.valor)}</span>
      <button type="button" class="btn pri" data-prop-ok>Confirmar</button><button type="button" class="btn" data-prop-abona>Abonar tudo</button></div>
      <p class="hint" style="margin:4px 0 0">Abonar alguns dias: diminua os dias e confirme. Até confirmar, o recebimento fica bloqueado.</p>` : `<p class="hint">Peça a quem cuida do financeiro para confirmar.</p>`}</div>`;
}
function ligarPropConf(d, c, reabrir) {
  const box = $("[data-prop]", d); if (!box) return;
  const k = +box.dataset.prop, inp = $("[data-prop-dias]", box), v = $("[data-prop-v]", box);
  const calc = () => r2(+c.valor * (Math.max(0, +inp.value || 0)) / 30);
  if (inp) inp.addEventListener("input", () => (v.textContent = brl(calc())));
  const gravar = async abona => {
    const aj = ajustesDe(c).map(x => Object.assign({}, x)), x = aj[k], n = abona ? 0 : Math.max(0, +inp.value || 0);
    if (!n) aj.splice(k, 1);
    else { const orig = +x.dias_contrato || +x.dias; Object.assign(x, { valor: calc(), dias: n, dias_contrato: orig, conferir: false, obs: String(x.obs || "").replace(/^\d+ dias/, `${n} dias`) + (n < orig ? ` (abonados ${orig - n})` : "") }); }
    try { await salvarAjustes(c, aj); toast(abona ? "Proporcional abonado." : "Proporcional confirmado."); d.close(); setTimeout(reabrir, 30); } catch (e) { falha(e); }
  };
  const ok = $("[data-prop-ok]", box), ab = $("[data-prop-abona]", box);
  if (ok) ok.addEventListener("click", () => gravar(false)); if (ab) ab.addEventListener("click", () => gravar(true));
}
// v19: aluguéis desta pessoa neste imóvel (para saber qual mês está pagando)
async function histLocatarioHTML(c) {
  const im = S.imovelPor[c.imovel_id] || {};
  const cs = await fetchAll("cobrancas", b => b.eq("imovel_id", c.imovel_id).order("competencia", { ascending: false }), "id,competencia,vencimento,valor,acrescimos,descontos,valor_pago,data_pagamento,locatario,devedor_id,carencia,repasse_data,ajustes").catch(() => []);
  const nl = norm(separaNomes(c.locatario)[0] || ""), desde = im.data_entrada && norm(separaNomes(im.locatario)[0] || "") === nl ? inicioMes(im.data_entrada) : "";
  const ls = cs.filter(x => (desde ? x.competencia >= desde : true) && norm(separaNomes(x.locatario)[0] || "") === nl);
  const abertos = ls.filter(x => !x.data_pagamento && !x.carencia && !x.devedor_id && x.competencia < c.competencia);
  return `${abertos.length ? `<div class="box bad">⚠ ${abertos.length} aluguel(éis) anterior(es) em aberto: <b>${abertos.map(x => mesCurto(x.competencia)).reverse().join(", ")}</b> (${brl(abertos.reduce((a, x) => a + devido(x), 0))}). Confira qual mês a pessoa está pagando.</div>` : ""}
    <div class="tw" style="max-height:34vh"><table class="compacta"><thead><tr><th>Mês</th><th>Vencimento</th><th class="num">Valor</th><th>Pago em</th><th class="num">Pago</th><th>Situação</th></tr></thead><tbody>
    ${ls.map(x => `<tr${x.id === c.id ? ' class="cur-l"' : ""}><td>${esc(mesCurto(x.competencia))}${x.id === c.id ? " <small>(este)</small>" : ""}</td><td>${dt(x.vencimento)}</td><td class="num">${valorCobTxt(x)}</td><td>${x.data_pagamento ? dt(x.data_pagamento) : ""}</td><td class="num">${x.data_pagamento ? n2(x.valor_pago) : ""}</td><td>${tagCob(x)}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">Sem outros aluguéis.</td></tr>`}</tbody></table></div>`;
}
const histLctBox = c => `<details class="hist-lct" open><summary>Aluguéis de ${esc(nomeTag(separaNomes(c.locatario)[0] || "?"))} neste imóvel</summary><div data-hist-lct><p class="hint">Carregando…</p></div></details>`;
const ligarHistLct = async (d, c) => { const b = $("[data-hist-lct]", d); if (b) b.innerHTML = await histLocatarioHTML(c); };
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
    corpo: `<div class="info-cob">${(S.imovelPor[c.imovel_id] || {}).contrato_codigo ? `<div style="order:4"><small>Contrato</small>${tagCtt(S.imovelPor[c.imovel_id].contrato_codigo)}</div>` : ""}<div style="order:1"><small>Imóvel</small>${tagImv(im.endereco)}</div><div style="order:3"><small>Locatários</small>${tagPes(separaNomes(c.locatario), "etq-lct", "", 3)}</div><div><small>Vencimento</small><b>${dt(c.vencimento)}</b></div><div><small>Aluguel</small><b>${brl(c.valor)}</b></div><div class="destaque"><small>Total devido</small><b data-devido>${brl(devido(c))}</b></div></div>
      ${c.repasse_data ? `<div class="box warn">Já repassado ao proprietário em ${dt(c.repasse_data)} (sem ter recebido).</div>` : ""}
      ${propConfHTML(c)}
      ${histLctBox(c)}
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
      ligarPropConf(d, c, () => ACT.receber(el)); ligarHistLct(d, c);
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
      if (aj.some(x => x.conferir)) throw new Error("Confirme (ou abone) o aluguel proporcional no quadro amarelo antes de registrar o recebimento.");
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
      <label class="fl"><span>Ramo / serviço</span><select data-dk="ramo"></select></label>
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
  const ramo = $("[data-dk=ramo]", novo);
  const doTipo = () => (S.fornecedores || []).filter(x => x.ativo && x.tipo === (nat.value === "material" ? "loja" : "prestador"));
  const encherRamo = () => { const v = ramo.value, rs = [...new Set(doTipo().map(x => x.especialidade || "").filter(Boolean))].sort((a, b) => a.localeCompare(b));
    ramo.innerHTML = `<option value="">— todos —</option>` + rs.map(r => opt(r, r, r === v)).join("") + (doTipo().some(x => !x.especialidade) ? opt("-", "(sem ramo cadastrado)", v === "-") : ""); };
  const encherForn = () => { const t = nat.value === "material" ? "loja" : "prestador"; $("[data-dk-fl]", novo).textContent = t === "loja" ? "Loja" : "Prestador";
    const r = ramo.value, ls = doTipo().filter(x => !r || (r === "-" ? !x.especialidade : x.especialidade === r));
    forn.innerHTML = `<option value="">— escolha —</option>` + ls.map(x => opt(x.id, x.nome, false)).join("") + `<option value="+">+ cadastrar novo…</option>`; };
  nat.addEventListener("change", () => { ramo.value = ""; encherRamo(); encherForn(); }); ramo.addEventListener("change", encherForn); encherRamo(); encherForn();
  forn.addEventListener("change", async () => {
    if (forn.value !== "+") return;
    const nome = (prompt(`Nome do ${nat.value === "material" ? "loja" : "prestador"} (cadastro completo em Configurações › Prestadores e lojas):`) || "").trim();
    if (!nome) { forn.value = ""; return; }
    let ram = ramo.value && ramo.value !== "-" ? ramo.value : (prompt(`Serviço / ramo de ${nome} (obrigatório — ex.: ${nat.value === "material" ? "Material de construção" : "Pintor, Eletricista"}):`) || "").trim();
    if (!ram) { toast("Sem o ramo não dá para cadastrar.", true); forn.value = ""; return; }
    try { const r = await q(sb.from("fornecedores").insert({ nome, tipo: nat.value === "material" ? "loja" : "prestador", especialidade: ram }).select().single()); await recarregarLocadores(); encherRamo(); encherForn(); forn.value = r.id; } catch (e) { falha(e); forn.value = ""; }
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
    corpo: `<div class="info-cob">${(S.imovelPor[c.imovel_id] || {}).contrato_codigo ? `<div style="order:4"><small>Contrato</small>${tagCtt(S.imovelPor[c.imovel_id].contrato_codigo)}</div>` : ""}<div style="order:2"><small>Locador</small>${tagLoc(c.locador)}</div><div style="order:1"><small>Imóvel</small>${tagImv(im.endereco)}</div><div style="order:3"><small>Locatários</small>${tagPes(separaNomes(c.locatario), "etq-lct", "", 3)}</div>
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
  const sel = selecionados().filter(c => !c.data_pagamento && !c.carencia);
  if (!sel.length) return toast("Marque na lista os aluguéis em aberto que foram recebidos.", true);
  const conf = sel.filter(c => ajustesDe(c).some(x => x.conferir)); if (conf.length) return toast(`${conf.length} aluguel(éis) marcado(s) têm o proporcional para conferir: abra cada um e confirme antes.`, true);
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
    corpo: `<div class="info-cob">${(S.imovelPor[c.imovel_id] || {}).contrato_codigo ? `<div style="order:4"><small>Contrato</small>${tagCtt(S.imovelPor[c.imovel_id].contrato_codigo)}</div>` : ""}<div style="order:1"><small>Imóvel</small>${tagImv(im.endereco)}</div><div style="order:3"><small>Locatários</small>${tagPes(separaNomes(c.locatario), "etq-lct", "", 3)}</div><div style="order:2"><small>Locador</small>${tagLoc(c.locador)}</div>
        <div class="destaque ${c.data_pagamento ? "ok" : ""}"><small>Recebido</small><b>${c.data_pagamento ? brl(c.valor_pago) + " em " + dt(c.data_pagamento) : "não"}</b></div><div class="destaque ${c.repasse_data ? "ok" : ""}"><small>Repassado</small><b>${c.repasse_data ? brl(c.repasse_valor) + " em " + dt(c.repasse_data) : "não"}</b></div></div>
      <div class="row">
        <label class="fl"><span>Vencimento 🔒</span><input type="date" name="vencimento" value="${c.vencimento}" disabled></label>
        <label class="fl"><span>Aluguel 🔒</span><input name="valor" value="${c.carencia ? "CARÊNCIA" : n2(c.valor)}" disabled></label>
        <label class="fl"><span>Taxa adm. % 🔒</span><input name="taxa" value="${n2(c.taxa_adm_pct)}" disabled></label>
      </div>
      <p class="hint" style="margin-top:-4px">Vencimento, aluguel e taxa são espelho do cadastro do imóvel (só o administrador muda, em Imóveis › Cadastro e reajustes; os aluguéis não pagos acompanham sozinhos).</p>
      ${c.carencia ? `<div class="box warn">Mês de <b>carência</b> do contrato: alugado, sem aluguel a pagar.</div>` : ""}
      ${propConfHTML(c)}
      ${histLctBox(c)}
      ${ajustesHTML(c, ed)}
      <label class="fl"><span>Observações</span><textarea name="obs" rows="4" ${pode.editar() ? "" : "disabled"}>${esc(c.obs)}</textarea></label>
      ${c.data_pagamento || c.repasse_data ? `<div class="box">${c.data_pagamento ? `Recebido ${brl(c.valor_pago)} em ${dt(c.data_pagamento)} (${esc(contaPor(c.conta_pgto_id).nome || "")}) · T. Adm. ${brl(c.taxa_valor)}` : "Ainda não recebido."}${c.repasse_data ? `<br>Repassado ${brl(c.repasse_valor)} em ${dt(c.repasse_data)}${c.data_pagamento ? "" : " <b class=\"neg\">(sem receber)</b>"}` : ""}</div>` : ""}
      ${despPropHTML(c)}<h3 style="margin-top:10px">Valor do proprietário</h3><div data-res-det>${repasseResumoHTML(c, calcCob(c))}</div>`,
    extra, ok: "Salvar", semOk: !pode.editar(),
    salvar: async f => {
      const upd = { obs: f.obs.value };
      if (ed) { const aj = lerAjDet(); if (aj.some(x => !x.desc || !(x.valor > 0))) throw new Error("Cada acréscimo/desconto precisa do item e do valor."); if (aj.some(x => x.desc === "Outros" && !x.obs)) throw new Error('Item "Outros": descreva nas observações.'); Object.assign(upd, { ajustes: aj }, totaisAjustes(aj)); }
      await q(sb.from("cobrancas").update(upd).eq("id", c.id));
      toast("Salvo."); render();
    },
    aoAbrir: (f, d) => { ligarPropConf(d, c, () => ACT["cob-det"](el)); ligarHistLct(d, c); lerAjDet = ligarAjustes(d, null, +c.valor); ligarDespProp(d, c, () => { const r = $("[data-res-det]", d); if (r) r.innerHTML = repasseResumoHTML(c, calcCob(c)); }); $$("[data-x2]", d).forEach(b => b.addEventListener("click", async () => {
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
async function carregarInad() {
  const cobs = await fetchAll("cobrancas", b => b.is("data_pagamento", null).is("devedor_id", null).eq("carencia", false).lt("vencimento", hoje()).order("vencimento").order("id"));
  const grupos = {};
  cobs.forEach(c => { (grupos[c.imovel_id] = grupos[c.imovel_id] || []).push(c); });
  INAD = Object.entries(grupos).map(([id, cs]) => ({
    id, imovel: (S.imovelPor[id] || {}).endereco || "?", locatario: cs[cs.length - 1].locatario, locador: cs[0].locador,
    meses: cs.map(c => mesCurto(c.competencia)), total: cs.reduce((a, c) => a + devido(c), 0), desde: cs[0].vencimento, dias: diasEntre(cs[0].vencimento, hoje()), cobs: cs
  }));
}
PAGES.atrasados = async pg => {
  await carregarInad();
  setRd(pg, () => desenharAtrasados());
  desenharAtrasados(pg);
};
// Cobrança: inadimplência dos locatários ativos e devedores (ex-locatários) na mesma aba
const cobrancaAbas = atual => `<div class="seg cobr-abas"><a href="#atrasados" class="${atual === "atrasados" ? "on" : ""}">Inadimplência (locatários ativos)</a>${pode.ver("devedores") ? `<a href="#devedores" class="${atual === "devedores" ? "on" : ""}">Devedores (ex-locatários)</a>` : ""}${pode.ver("vendas") ? `<a href="#cob_ven" class="${atual === "cob_ven" ? "on" : ""}">Vendas (parcelas e custas)</a>` : ""}</div>`;


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
let CAIXA_SALDOS = { fim: [] }, CAIXA_PREV = 0, CAIXA_SEMVALOR = [];
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
  const doMes = c => c.ativa && c.recorrente && c.grupo !== "transferencia" && (c.periodicidade !== "anual" || c.mes_previsto === +S.mes.slice(5, 7));
  CAIXA_PREV = S.categorias.filter(c => doMes(c) && +c.valor_previsto > 0 && !ja.has(c.id)).length;
  // v19: as fixas entram sozinhas como previstas (mês atual e seguintes), sem precisar clicar
  if (CAIXA_PREV && S.mes >= inicioMes(hoje()) && pode.ed("caixa") && pode.editar() && S.papel !== "recepcao" && !(PAGES.caixa._auto || {})[S.mes]) {
    (PAGES.caixa._auto = PAGES.caixa._auto || {})[S.mes] = 1;
    try { const n = await rpc("gerar_previstos", { p_comp: S.mes }); if (n) { toast(`${n} despesa(s)/receita(s) fixa(s) lançada(s) como prevista(s) em ${mesTxt(S.mes)}.`); return PAGES.caixa(pg); } } catch (e) { console.warn(e); }
  }
  CAIXA_SEMVALOR = S.categorias.filter(c => doMes(c) && !(+c.valor_previsto > 0) && !ja.has(c.id)).map(c => c.nome);
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
  const card = (id, nome, acum, cor, main) => { const m = mov(id);
    return `<button type="button" class="ccard${main ? " main" : ""}${conta === id ? " on" : ""}" data-act="lc-conta" data-v="${id}" style="--cc:${cor}">
      <span class="l">${esc(nome)}</span>
      <span class="kg"><span class="kt">Entradas no mês</span><i>R$</i><b class="pos">${n2(m.e)}</b>
      <span class="kt">Saídas no mês</span><i>R$</i><b class="neg">${n2(m.s)}</b>
      <span class="kt">Saldo do mês</span><i>R$</i><b>${n2(m.e - m.s)}</b>
</span></button>`; };
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
    ${CAIXA_SEMVALOR.length && pode.admin() && S.mes >= inicioMes(hoje()) ? `<div class="alert info"><span>${CAIXA_SEMVALOR.length} despesa(s) fixa(s) não entram sozinhas porque estão <b>sem valor previsto</b>: <span title="${esc(CAIXA_SEMVALOR.join(" · "))}">${esc(CAIXA_SEMVALOR.slice(0, 4).join(", "))}${CAIXA_SEMVALOR.length > 4 ? "…" : ""}</span>. Informe um valor aproximado em Configurações › Plano de contas (o valor certo você corrige ao confirmar o pagamento).</span></div>` : ""}
    <div class="filters">
      <div class="fgrupo"><span>Tipo</span>${chip("lcTipo", "todos", "Todos", "", tipo)}${chip("lcTipo", "entrada", "Só entradas", "st-LVR", tipo)}${chip("lcTipo", "saida", "Só saídas", "st-INTV", tipo)}</div>
      <div class="fgrupo"><span>Situação</span>${chip("lcSit", "todos", "Previstos e realizados", "", sit)}${chip("lcSit", "prev", "Só previstos", "st-OCP", sit)}${chip("lcSit", "real", "Só realizados", "", sit)}</div>
      <input type="search" placeholder="Buscar descrição, documento, categoria…" value="${esc(busca)}" data-busca="lcBusca">
      ${nInt ? `<label class="chk" title="Taxas de administração retidas dos aluguéis: viram receita sem mexer no saldo das contas"><input type="checkbox" data-int ${internos ? "checked" : ""}> lançamentos internos (${nInt})</label>` : ""}
      <span class="spacer"></span>${gradeBarra("caixa6")}
      ${pode.lancar() ? `<button class="btn pri" data-act="lanc-novo" data-tipo="entrada">+ Entrada</button><button class="btn pri" data-act="lanc-novo" data-tipo="saida">+ Saída</button>` : ""}
      ${pode.editar() ? `<button class="btn" data-act="transf">⇄ Transferência</button>` : ""}
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
const GRUPOS_TIPO = { entrada: ["receita", "terceiros_entrada"], saida: ["despesa", "retirada_cilas", "retirada_eliana", "retirada", "imposto", "custo", "terceiros_saida"] };
function formLanc(l, tipo) {
  const ro = l && (l.origem !== "manual" || !pode.editar());
  const soCaixa = S.papel === "recepcao";
  // v15: na lista só as categorias extraordinárias; as mensais/anuais já entram sozinhas como previstas
  const recorr = c => !!c.recorrente; // v19: fixas (mensais/anuais) entram sozinhas como previstas — fora da lista do lançamento manual
  const cats = S.categorias.filter(c => (c.ativa || (l && c.id === l.categoria_id)) && GRUPOS_TIPO[tipo].includes(c.grupo));
  const optsCat = todas => GRUPOS_TIPO[tipo].map(g => { const cs = cats.filter(c => c.grupo === g && (todas || !recorr(c) || (l && c.id === l.categoria_id))).sort((x, y) => COLL.compare(x.nome, y.nome));
    return cs.length ? `<optgroup label="${esc(GRUPOS[g])}">${cs.map(c => opt(c.id, c.nome + (recorr(c) ? " (prevista " + (c.periodicidade === "anual" ? "anual" : "mensal") + ")" : ""), l && l.categoria_id === c.id)).join("")}</optgroup>` : ""; }).join("");
  const temRec = cats.some(recorr) && pode.editar();
  const im = l && l.imovel_id ? S.imovelPor[l.imovel_id] : null;
  const dis = ro ? "disabled" : "";
  const msgOrigem = { pagamento: "Recebimento de aluguel: para corrigir, estorne na tela Aluguéis do mês.", taxa: "Lançamento interno (não mexe no saldo das contas): a taxa de administração sai da parte do proprietário e vira receita da imobiliária. Para corrigir, estorne o recebimento na tela Aluguéis do mês.", repasse: "Repasse ao proprietário: para corrigir, estorne na tela Aluguéis do mês.", devedor: "Pagamento de ex-locatário devedor: use os botões abaixo para excluir aqui ou corrigir na tela Devedores.", transferencia: "Transferência entre contas." };
  const quem0 = l ? partesDesc(l)[1] : "", ref0 = l ? (l.descricao && l.descricao.includes(" - ") ? partesDesc(l)[0] : l.descricao || "") : "";
  const sem0 = !!(l && !l.imovel_id && l.origem === "manual");
  return `${l && l.origem !== "manual" ? `<div class="box">${esc(msgOrigem[l.origem] || "Lançamento automático.")}</div>` : ""}
    <div class="lanc-g4">
      <label class="fl"><span>Data</span><input type="date" name="data" value="${l ? l.data : hoje()}" required ${dis}></label>
      <label class="fl"><span>Valor</span><input name="valor" inputmode="numeric" value="${l ? moedaFmt(+l.valor) : ""}" placeholder="R$ 0,00" required ${dis}></label>
      <label class="fl"><span>Conta</span><select name="conta" required ${dis}>${contasOpts(l ? l.conta_id : null, soCaixa)}</select></label>
      <label class="fl"><span>Competência</span><input type="month" name="comp" value="${(l ? l.competencia : S.mes).slice(0, 7)}" ${dis}></label>
    </div>
    <div class="lanc-g4b">
      <div class="fl"><span>Imóvel *</span><input type="hidden" name="imovel" value="${esc(im ? im.endereco : "")}"><input type="hidden" name="semimv" value="${sem0 ? "1" : ""}">
        <div class="pick-l"><button type="button" class="pick" data-pick="imv" ${dis}>${im ? tagImv(im.endereco) : sem0 ? `<span class="etq etq-sem">🏢 Sem imóvel (imobiliária)</span>` : `<span class="pick-ph">escolher imóvel…</span>`}</button>
        <button type="button" class="btn sm sem-imv${sem0 ? " on" : ""}" data-semimv ${dis} title="Despesa ou receita da própria imobiliária">🏢 Sem imóvel</button></div></div>
      <label class="fl"><span>Categoria</span><select name="categoria" required ${dis}><option value="">Escolha…</option>${optsCat(false)}</select>
        ${temRec && !dis ? `<button type="button" class="lnk-mini" data-cat-todas>mostrar também as previstas mensais/anuais</button>` : ""}</label>
      <div class="fl"><span>${tipo === "entrada" ? "Recebido de *" : "Pago a *"}</span><input type="hidden" name="quem" value="${esc(quem0)}"><input type="hidden" name="quemtipo" value="">
        <button type="button" class="pick" data-pick="quem" ${dis}>${quem0 ? `<span class="etq etq-p">${esc(quem0)}</span>` : `<span class="pick-ph">${tipo === "entrada" ? "de quem…" : "para quem…"}</span>`}</button></div>
      <label class="fl"><span>Documento / nota</span><input name="documento" value="${esc(l ? l.documento : "")}" maxlength="100" ${dis}></label>
    </div>
    <div class="lanc-g4c">
      <label class="fl"><span>Referente a (o quê)</span><input name="ref" value="${esc(ref0)}" maxlength="200" placeholder="ex.: conserto do portão da garagem, material elétrico…" ${dis}></label>
      ${!l && !soCaixa ? `<label class="fl"><span>Repetir nos meses seguintes (como previsto)</span><input type="number" name="repetir" min="0" max="36" value="0"></label>` : "<span></span>"}
    </div>
    ${tipo === "saida" ? `<label class="chk" data-desc-rep ${im ? "" : "hidden"}><input type="checkbox" name="descrep" ${l && l.desconta_repasse ? "checked" : ""} ${dis}> <span><b>Descontar do repasse do proprietário</b> deste imóvel (despesa dele paga pela imobiliária). Aparece como desconto no Pgto locador (repasse); se o repasse desse mês já foi feito, vai para o mês seguinte. Ao descontar, o dinheiro volta para a imobiliária. Exige prestador ou loja em "Pago a".</span></label>` : ""}
    <input type="hidden" name="pago" value="${!l || l.pago ? "1" : "0"}">
    ${l && !soCaixa && !dis ? `<div class="sit-lanc"><span>Situação</span><div class="seg"><button type="button" data-pg="0" class="${l.pago ? "" : "on"}">🕒 Previsto</button><button type="button" data-pg="1" class="${l.pago ? "on" : ""}">✔ ${tipo === "entrada" ? "Recebido" : "Pago"}</button></div></div>` : ""}
    <datalist id="dl-cat-todas" hidden data-todas="${esc(optsCat(true))}"></datalist>`;
}
// listas para escolher (com etiquetas) — dentro da janela do lançamento
function listaPessoasLanc(imvSel) {
  const lct = [], vistos = new Set();
  S.imoveis.filter(i => i.locatario).forEach(i => String(i.locatario).split(/\s+-\s+/).map(n => n.trim()).filter(Boolean).forEach(n => { const k = norm(n); if (vistos.has(k)) return; vistos.add(k); lct.push({ n, sub: i.endereco, imv: i.id }); }));
  const lcd = (S.locadores || []).filter(x => x.ativo).map(x => ({ n: x.nome, t: tiraPrefixo(x.nome), sub: [(x.ficha || {}).lcd1_nome, (x.ficha || {}).lcd2_nome].filter(Boolean).join(" e ") }));
  const forn = t => (S.fornecedores || []).filter(x => x.ativo && x.tipo === t).map(x => ({ n: x.nome, sub: x.especialidade || "" }));
  const out = { lct: { t: "Locatários", cls: "etq-lct", ls: lct }, lcd: { t: "Locadores", cls: "etq-lcd", ls: lcd }, prest: { t: "Prestadores", cls: "etq-fdr", ls: forn("prestador") }, loja: { t: "Lojas", cls: "etq-fdr", ls: forn("loja") } };
  const im = imvSel && S.imovelPor[imvSel];
  if (im) out.deste = { t: "Deste imóvel", cls: "etq-p", ls: String(im.locatario || "").split(/\s+-\s+/).filter(Boolean).map(n => ({ n, sub: "locatário", tp: "lct" })).concat(im.locador ? [{ n: im.locador, t: tiraPrefixo(im.locador), sub: "locador", tp: "lcd" }] : []) };
  return out;
}
function pickerLanc(btn, tipoPick, f, d, tipo) {
  const imvAtual = imovelPorEndereco(f.imovel.value);
  let abas, aba;
  // v19: imóvel com a mesma etiqueta do resto do sistema + locador e locatário em etiquetas
  if (tipoPick === "imv") { abas = { todos: { t: "Imóveis", cls: "etq-imv", ls: S.imoveis.slice().sort((a, b) => (a.status === "INTV") - (b.status === "INTV") || COLL.compare(rotuloImvDe(a), rotuloImvDe(b))).map(i => ({ n: i.endereco, t: rotuloImvDe(i), sub: [i.endereco, i.locatario, i.locador, i.codigo_site].filter(Boolean).join(" "), imv: i.id, im: i })) } }; aba = "todos"; }
  else { abas = listaPessoasLanc(imvAtual && imvAtual.id); aba = abas.deste ? "deste" : tipo === "entrada" ? "lct" : "prest"; abas.outro = { t: "Outro", ls: [] }; }
  const ordem = Object.keys(abas).sort((a, b) => (a === "deste" ? -1 : b === "deste" ? 1 : 0));
  const p = pop(btn, `<div class="pk${tipoPick === "imv" ? " pk-imv" : ""}"><div class="seg pk-abas">${ordem.length > 1 ? ordem.map(k => `<button type="button" data-pa="${k}" class="${k === aba ? "on" : ""}">${esc(abas[k].t)}</button>`).join("") : ""}</div>
      <input type="search" class="pk-busca" placeholder="${tipoPick === "imv" ? "Procure por endereço, condomínio, locador ou locatário…" : "Digite para procurar…"}" autocomplete="off"><div class="pk-lista"></div></div>`, tipoPick === "imv" ? 900 : 560);
  const busca = $(".pk-busca", p), lista = $(".pk-lista", p);
  const escolher = (n, tp, imvId) => {
    if (tipoPick === "imv") { f.imovel.value = n; f.semimv.value = ""; btn.innerHTML = tagImv(n); $("[data-semimv]", d).classList.remove("on"); f.imovel.dispatchEvent(new Event("input")); }
    else { f.quem.value = n; f.quemtipo.value = tp || ""; const cls = (abas[tp] || {}).cls || "etq-p"; btn.innerHTML = `<span class="etq ${cls}">${esc(n)}</span>`; }
    fecharPop();
  };
  const desenha = () => {
    const q2 = norm(busca.value.trim());
    if (aba === "outro") { lista.innerHTML = `<div class="pk-outro"><input class="pk-o" placeholder="Nome de quem ${tipo === "entrada" ? "pagou" : "recebeu"}" value="${esc(busca.value)}"><button type="button" class="btn sm pri" data-po>Usar</button></div>`;
      const o = $(".pk-o", lista), go = () => o.value.trim() && escolher(o.value.trim(), "outro"); $("[data-po]", lista).addEventListener("click", go); o.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); go(); } }); o.focus(); return; }
    const A = abas[aba], ramos = (aba === "prest" || aba === "loja") ? [...new Set(A.ls.map(x => x.sub).filter(Boolean))].sort((a, b) => a.localeCompare(b)) : [];
    if (A.ramo && !ramos.includes(A.ramo)) A.ramo = "";
    const ls = A.ls.filter(x => (!A.ramo || x.sub === A.ramo) && (!q2 || norm(x.n + " " + (x.sub || "")).includes(q2))).slice(0, 120);
    const chipsR = ramos.length ? `<div class="pk-ramos"><span class="hint">Ramo / serviço:</span>${["", ...ramos].map(r => `<button type="button" class="chip${(A.ramo || "") === r ? " on" : ""}" data-ramo="${esc(r)}">${esc(r || "Todos")}</button>`).join("")}</div>` : "";
    const itImv = x => { const i = x.im, st = STATUS_IMV[i.status] || [i.status, "idle"];
      return `<span class="etq etq-imv" title="${esc(i.endereco)}">🏠 ${esc(x.t)}</span><span class="tag ${st[1]}">${esc(st[0])}</span>${i.locador ? `<span class="etq etq-lcd" title="${esc(i.locador)}">${esc(i.locador)}</span>` : ""}${separaNomes(i.locatario).slice(0, 2).map(n => `<span class="etq etq-lct" title="${esc(i.locatario)}">${esc(nomeTag(n))}</span>`).join("")}`; };
    lista.innerHTML = chipsR + (ls.length ? ls.map((x, i) => tipoPick === "imv" ? `<button type="button" class="pk-it pk-it-imv" data-i="${i}">${itImv(x)}</button>` : `<button type="button" class="pk-it" data-i="${i}"><span class="etq ${A.cls || "etq-p"}">${esc(x.t || x.n)}</span><small>${esc(x.sub || "")}</small></button>`).join("") : `<p class="hint" style="padding:8px">Nada encontrado.${tipoPick === "imv" ? "" : " Use a aba Outro para digitar."}</p>`);
    $$("[data-ramo]", lista).forEach(b => b.addEventListener("click", () => { A.ramo = b.dataset.ramo; desenha(); }));
    $$("[data-i]", lista).forEach(b => b.addEventListener("click", () => { const x = ls[+b.dataset.i]; escolher(x.n, x.tp || aba, x.imv); }));
  };
  $$("[data-pa]", p).forEach(b => b.addEventListener("click", () => { aba = b.dataset.pa; $$("[data-pa]", p).forEach(x => x.classList.toggle("on", x === b)); desenha(); if (aba !== "outro") busca.focus(); }));
  busca.addEventListener("input", desenha);
  busca.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); const b1 = $("[data-i]", lista); if (b1) b1.click(); } });
  desenha(); busca.focus();
}
// "Descontar do repasse" só aparece com imóvel; vem marcado para categorias de dinheiro do proprietário
function ligarLanc(f, d, tipo) {
  tipo = tipo || (/Recebido de/.test(d.textContent) ? "entrada" : "saida");
  mascaraMoeda(f.valor);
  $$("[data-pick]", d).forEach(b => b.addEventListener("click", () => pickerLanc(b, b.dataset.pick, f, d, tipo)));
  const bs = $("[data-semimv]", d);
  if (bs) bs.addEventListener("click", () => { const on = !bs.classList.contains("on"); bs.classList.toggle("on", on); f.semimv.value = on ? "1" : "";
    const pb = $("[data-pick=imv]", d); if (on) { f.imovel.value = ""; pb.innerHTML = `<span class="etq etq-sem">🏢 Sem imóvel (imobiliária)</span>`; pb.disabled = true; f.imovel.dispatchEvent(new Event("input")); } else { pb.disabled = false; pb.innerHTML = `<span class="pick-ph">escolher imóvel…</span>`; } });
  if (bs && bs.classList.contains("on")) $("[data-pick=imv]", d).disabled = true;
  const ct = $("[data-cat-todas]", d); if (ct) ct.addEventListener("click", () => { const v = f.categoria.value; f.categoria.innerHTML = `<option value="">Escolha…</option>` + $("#dl-cat-todas", d).dataset.todas; f.categoria.value = v; ct.remove(); });
  $$("[data-pg]", d).forEach(b => b.addEventListener("click", () => { f.pago.value = b.dataset.pg; $$("[data-pg]", d).forEach(x => x.classList.toggle("on", x === b)); }));
  const box = $("[data-desc-rep]", d); if (!box) return;
  const upd = () => {
    const tem = !!imovelPorEndereco(f.imovel.value); box.hidden = !tem;
    const cat = S.categorias.find(c => c.id === f.categoria.value);
    if (tem && cat && cat.grupo === "terceiros_saida" && !f.descrep.dataset.mexeu && !/repasse|caução|caucao/i.test(cat.nome)) f.descrep.checked = true;
  };
  f.descrep.addEventListener("change", () => (f.descrep.dataset.mexeu = 1));
  f.imovel.addEventListener("input", upd); f.categoria.addEventListener("change", upd); upd();
}
function lerLanc(f, tipo) {
  // v14: sempre data válida, valor, de quem / para quem e imóvel (ou "sem imóvel")
  const dtv = f.data.value, ano = +String(dtv).slice(0, 4), anoHoje = +hoje().slice(0, 4);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dtv || "") || ano < 2000 || ano > anoHoje + 2) throw new Error("Informe uma data válida.");
  const v = parseMoney(f.valor.value); if (!v || v <= 0) throw new Error("Informe o valor (maior que zero).");
  if (!f.categoria.value) throw new Error("Escolha a categoria.");
  const quem = f.quem.value.trim().replace(/\s+-\s+/g, " – ");
  if (!quem) throw new Error(tipo === "entrada" ? "Informe de quem foi recebido." : "Informe para quem foi pago (prestador, loja ou pessoa).");
  let imovel_id = null;
  if (f.imovel.value.trim()) { const im = imovelPorEndereco(f.imovel.value); if (!im) throw new Error("Imóvel não encontrado: escolha um endereço da lista."); imovel_id = im.id; }
  else if (f.semimv.value !== "1") throw new Error('Escolha o imóvel ou clique em "🏢 Sem imóvel" (despesa ou receita da própria imobiliária).');
  const descrep = !!(imovel_id && f.descrep && f.descrep.checked);
  const forn = (S.fornecedores || []).find(x => norm(x.nome) === norm(quem));
  if (descrep && !forn) throw new Error("Despesa do proprietário: em \"Pago a\", escolha um prestador ou loja da lista (cadastre em Configurações › Prestadores e lojas, se for novo).");
  const ref = (f.ref.value.trim() || catPor(f.categoria.value).nome || "").replace(/\s+-\s+/g, " – ");
  return { data: dtv, valor: v, tipo, categoria_id: f.categoria.value, conta_id: f.conta.value, competencia: (f.comp.value || dtv.slice(0, 7)) + "-01",
    descricao: (ref + " - " + quem).slice(0, 300), documento: f.documento.value.trim(), imovel_id, pago: f.pago ? f.pago.value !== "0" : true, desconta_repasse: descrep,
    fornecedor_id: forn ? forn.id : null, natureza: forn ? (forn.tipo === "loja" ? "material" : "servico") : "" };
}
// despesa do proprietário: entra no repasse do mês ainda não repassado (se o do mês já foi feito, vai para o seguinte)
async function ajustarCompRepasse(u) {
  if (!u.desconta_repasse || !u.imovel_id) return u;
  for (let i = 0; i < 6; i++) {
    const c = await q(sb.from("cobrancas").select("id,repasse_data").eq("imovel_id", u.imovel_id).eq("competencia", u.competencia).maybeSingle()).catch(() => null);
    if (!c || !c.repasse_data) { if (i) toast(`O repasse já tinha sido feito: o desconto ficou para ${mesTxt(u.competencia)}.`); return u; }
    u.competencia = addMes(u.competencia, 1);
  }
  return u;
}
ACT["lanc-novo"] = el => {
  const tipo = el.dataset.tipo;
  modal({
    titulo: tipo === "entrada" ? "Nova entrada" : "Nova saída", corpo: formLanc(null, tipo), xl: true, ok: tipo === "entrada" ? "✔ Lançar como recebido" : "✔ Lançar como pago",
    extra: S.papel === "recepcao" ? "" : `<button type="button" class="btn prev-btn" data-lanc-prev>🕒 Lançar como previsto</button>`,
    aoAbrir: (f, d) => { ligarLanc(f, d, tipo); f.pago.value = "1"; const bp = $("[data-lanc-prev]", d); if (bp) { const ft = $(".dlg-f", d); ft.insertBefore(bp, $("button[type=submit]", ft)); } if (bp) bp.addEventListener("click", () => { f.pago.value = "0"; f.requestSubmit(); setTimeout(() => { if (d.open) f.pago.value = "1"; }, 50); }); },
    salvar: async f => {
      const base = await ajustarCompRepasse(lerLanc(f, tipo)); const rep = f.repetir ? Math.max(0, Math.min(36, +f.repetir.value || 0)) : 0;
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
    titulo: l.tipo === "entrada" ? "Entrada" : "Saída", corpo: formLanc(l, l.tipo), xl: true, semOk: !editavel, extra,
    salvar: async f => { const u = lerLanc(f, l.tipo); if (u.desconta_repasse && (!l.desconta_repasse || u.competencia !== l.competencia)) await ajustarCompRepasse(u); delete u.tipo; await q(sb.from("lancamentos").update(u).eq("id", l.id)); toast("Salvo."); render(); },
    aoAbrir: (f, d) => {
      ligarLanc(f, d, l.tipo);
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
    const g = grupoDRE(r.grupo);
    ((val[g] = val[g] || {})[r.categoria] = val[g][r.categoria] || {});
    val[g][r.categoria][r.competencia] = (val[g][r.categoria][r.competencia] || 0) + sinal * +r.total;
  });
  const somaG = g => meses.map(m => Object.values(val[g] || {}).reduce((a, c) => a + (c[m] || 0), 0));
  const op = (a, b, s) => a.map((v, i) => v + s * b[i]);
  const rec = somaG("receita"), des = somaG("despesa"), rC = somaG("retirada_cilas"), rE = somaG("retirada_eliana"), rS = somaG("retirada");
  const oper = op(rec, des, -1), fin = op(op(op(oper, rC, -1), rE, -1), rS, -1), temRS = rS.some(v => Math.abs(v) > 0.004);
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
      <span class="spacer"></span><button class="btn" data-act="imprimir">Imprimir</button></div>
    <div class="tw"><table class="dre"><thead><tr><th>${ano}</th>${meses.map(m => `<th class="num">${MES3[+m.slice(5, 7) - 1]}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>
      ${L("Receita bruta", rec, "grp")}${cats("receita")}
      ${L("(−) Despesas da imobiliária (inclui impostos e comissões)", des, "grp")}${cats("despesa")}
      ${L("= Resultado da imobiliária", oper, "tot t3")}
      ${L("Margem (% da receita)", pct(oper, rec), "memo", (() => { const r = rec.reduce((a, b) => a + b, 0); return r ? oper.reduce((a, b) => a + b, 0) / r * 100 : 0; })(), "%")}
      ${L("(−) Retirada – Cilas", rC, "grp")}${cats("retirada_cilas")}
      ${L("(−) Retirada – Eliana", rE, "grp")}${cats("retirada_eliana")}
      ${temRS ? L("(−) Retirada sem sócio (reclassifique)", rS, "grp") + cats("retirada") : ""}
      ${L("= Resultado após retiradas", fin, "tot t4")}
      ${L("Balanço das retiradas: Cilas − Eliana (positivo = Cilas retirou mais)", op(rC, rE, -1), "memo")}
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
  { k: "codigo_site", t: "Site", cls: "mono", html: i => /^\d+$/.test(String(i.codigo_site || "").trim()) ? linkSite(i.codigo_site) : esc(i.codigo_site || "") },
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
  { k: "nf_em", t: "Nota fiscal em nome de", oculta: true, v: i => i.declarar_ir !== "Sim" ? "" : nfOutros(i).length ? nfOutros(i).map(x => x.nome).join(" e ") : "proprietário" },
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
    Promise.resolve([]),
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
    ${aviso}
    <div class="filters">
      <div class="chips">${chips.map(([k, t, cls]) => `<button class="chip ${cls}${f === k ? " on" : ""}" data-act="chip" data-k="imv" data-v="${k}">${t}<span class="c">${cont[k] || 0}</span></button>`).join("")}</div>
      <input type="search" placeholder="Buscar endereço, locador, locatário…" value="${esc(busca)}" data-busca="imvBusca">
      <span class="spacer"></span>
      ${(IMV.termos || []).length ? `<button class="btn danger" data-act="termos-imv" title="Imóveis com termo obrigatório pendente">⚠ ${IMV.termos.length} termo(s) pendente(s)</button>` : ""}${gradeBarra("imoveis")}
      ${podeLib ? (lib ? `<button class="btn" data-act="imv-trava" title="${passado ? "Alterações mudam só o histórico deste mês" : "Alterações valem para o cadastro atual"}">🔓 Edição liberada · bloquear</button>` : `<button class="btn" data-act="imv-libera">🔒 Liberar edição deste mês</button>`) : ""}
<button class="btn" data-act="imv-livres" title="Lista de imóveis livres para deixar na recepção (por tipo)">📄 Lista de livres</button>${pode.ed("imoveis") ? `<button class="btn" data-act="reaj-prox" title="Contratos que completam 12 meses neste mês e no próximo">📅 Reajustes a programar</button>` : ""}
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
// v18: nota fiscal / IR — em nome do proprietário (padrão) ou de outro(s) favorecido(s)
const ehApto = t => /apto|apart/i.test(t || "");
const nfOutros = i => ((i && i.ficha && Array.isArray(i.ficha.nf_outros)) ? i.ficha.nf_outros : []).filter(x => x && x.nome);
function irHTML(i) {
  const dis = pode.editar() ? "" : "disabled", outros = nfOutros(i), sim = i.declarar_ir === "Sim";
  const linha = x => `<div class="ir-l"><input data-irn placeholder="Nome completo" value="${esc(x.nome || "")}" ${dis}><input data-irc placeholder="CPF / CNPJ" value="${esc(x.cpf || "")}" inputmode="numeric" ${dis}>${dis ? "" : `<button type="button" class="btn sm ghost" data-ir-del title="Tirar">✕</button>`}</div>`;
  return `<div class="ir-g">
    <label class="fl"><span>Declara IR?</span><select name="declarar_ir" ${dis}>${opt("", "—", !i.declarar_ir)}${opt("Sim", "Sim", sim)}${opt("Não", "Não", i.declarar_ir === "Não")}</select></label>
    <div class="fl" data-ir-quem ${sim ? "" : "hidden"}><span>Nota fiscal em nome de</span>
      <div class="seg"><button type="button" data-ir-op="lcd" class="${outros.length ? "" : "on"}" ${dis}>Proprietário (locador)</button><button type="button" data-ir-op="outro" class="${outros.length ? "on" : ""}" ${dis}>Outro favorecido</button></div>
      <small class="muted" data-ir-lcd ${outros.length ? "hidden" : ""}>${i.locador ? `${esc(nomeRealLocador(i.locador))}${docLocador(i.locador) ? " · " + esc(docLocador(i.locador)) : " · <b class=\"neg\">sem CPF no cadastro do locador</b>"}` : "o locador escolhido acima"}</small>
      <div data-ir-outros ${outros.length ? "" : "hidden"}><div data-ir-ls>${(outros.length ? outros : [{}]).map(linha).join("")}</div>${dis ? "" : `<button type="button" class="btn sm" data-ir-add>+ outra pessoa</button> <span class="hint">Com mais de uma pessoa, a taxa é dividida em partes iguais (uma nota para cada).</span>`}</div></div></div>`;
}
function ligarIr(d) {
  const sel = $("[name=declarar_ir]", d), quem = $("[data-ir-quem]", d); if (!sel || !quem) return;
  sel.addEventListener("change", () => (quem.hidden = sel.value !== "Sim"));
  $$("[data-ir-op]", d).forEach(b => b.addEventListener("click", () => { $$("[data-ir-op]", d).forEach(x => x.classList.toggle("on", x === b)); const o = b.dataset.irOp === "outro"; $("[data-ir-outros]", d).hidden = !o; $("[data-ir-lcd]", d).hidden = o; }));
  const ls = $("[data-ir-ls]", d);
  const ligaL = l => { const c = $("[data-irc]", l); if (c && typeof mascaraDoc === "function") mascaraDoc(c); const x = $("[data-ir-del]", l); if (x) x.addEventListener("click", () => { if ($$(".ir-l", ls).length > 1) l.remove(); else $$("input", l).forEach(i => (i.value = "")); }); };
  $$(".ir-l", ls).forEach(ligaL);
  const add = $("[data-ir-add]", d); if (add) add.addEventListener("click", () => { const l = $(".ir-l", ls).cloneNode(true); $$("input", l).forEach(i => (i.value = "")); ls.appendChild(l); ligaL(l); $("[data-irn]", l).focus(); });
}
function lerIr(d) {
  const sel = $("[name=declarar_ir]", d); if (!sel) return null;
  const outro = sel.value === "Sim" && $("[data-ir-op=outro]", d) && $("[data-ir-op=outro]", d).classList.contains("on");
  if (!outro) return [];
  const xs = $$(".ir-l", d).map(l => ({ nome: $("[data-irn]", l).value.trim(), cpf: $("[data-irc]", l).value.trim() })).filter(x => x.nome || x.cpf);
  if (!xs.length) throw new Error("Nota fiscal em nome de outro favorecido: informe o nome e o CPF/CNPJ (ou volte para “Proprietário”).");
  xs.forEach(x => { const n = x.cpf.replace(/\D/g, "").length; if (!x.nome) throw new Error("Favorecido sem nome."); if (n !== 11 && n !== 14) throw new Error(`CPF/CNPJ de ${x.nome} incompleto.`); });
  return xs;
}
// ficha do imóvel existente: aluguel, dia, carteira e taxa · IR · observações
function formImovelEd(i) {
  // v19: aluguel, dia, carteira e taxa só o administrador muda (reajuste programado continua liberado)
  const dis = pode.admin() ? "" : "disabled";
  return `${pode.admin() ? "" : `<p class="hint trava-l">🔒 Aluguel, dia do pagamento, carteira e taxa só o administrador altera. Para mudar o aluguel, programe um reajuste abaixo.</p>`}<div class="imv-g4">
      <label class="fl"><span>${i.status === "ALG" ? "Aluguel" : "Aluguel previsto"}</span><input name="valor" inputmode="numeric" value="${i.valor != null ? moedaFmt(i.valor) : ""}" ${dis}></label>
      <label class="fl"><span>Dia do pagamento</span><input type="number" name="dia_venc" min="1" max="31" value="${i.dia_venc || ""}" ${dis}></label>
      <label class="fl"><span>Carteira</span><select name="carteira" ${dis}>${Object.entries(CARTEIRAS).map(([k, v]) => opt(k, v, (i.carteira || "administrado") === k)).join("")}</select></label>
      <label class="fl"><span>Taxa adm. %</span><input name="taxa_adm" inputmode="decimal" value="${n2(i.taxa_adm)}" ${dis}></label></div>
    ${irHTML(i)}
    <label class="fl"><span>Observações do imóvel</span><textarea name="obs" rows="2" ${dis}>${esc(i.obs || "")}</textarea></label>`;
}
function lerImovelEd(f, i) {
  const taxa = parseMoney(f.taxa_adm.value);
  if (taxa == null || taxa < 0 || taxa > 100) throw new Error("Taxa deve estar entre 0 e 100.");
  const d = { tipo: f.tipo.value || i.tipo, codigo_site: f.codigo_site.value.trim(), valor: f.valor.value.trim() ? parseMoney(f.valor.value) : null, taxa_adm: taxa, carteira: f.carteira.value,
    declarar_ir: f.declarar_ir.value, obs: f.obs.value.trim(), dia_venc: +f.dia_venc.value || null };
  if (i.status === "ALG" && !d.valor) throw new Error("Imóvel alugado precisa do valor do aluguel.");
  if (String(i.codigo_site || "").trim() && d.codigo_site !== String(i.codigo_site).trim() && !pode.admin()) throw new Error("O código do site não pode ser trocado (só o administrador).");
  if (d.tipo !== i.tipo && !pode.admin()) throw new Error("O tipo não pode ser trocado (só o administrador).");
  return d;
}
// características: tipo e código do site junto; apartamento mostra vagas (quais / rotativa) no lugar do terreno
const CAR_IMV = [["terreno", "Terreno (m²)", "naoapto"], ["construcao", "Construção / área útil (m²)"], ["quartos", "Quartos"], ["wc", "WCs"], ["suites", "Suítes"], ["garagem", "Garagem (vagas)"]];
function caracteristicasHTML(i, novo) {
  i = i || {}; const fi = i.ficha || {}, dis = pode.editar() ? "" : "disabled", adm = pode.admin() && !dis, apto = ehApto(i.tipo);
  const temCod = !novo && !!String(i.codigo_site || "").trim();
  const trava = (k, tem) => tem ? (adm ? `<button type="button" class="btn sm lk" data-destrava="${k}" title="Só administrador: liberar a alteração">🔒</button>` : `<span class="lk" title="Travado depois de preenchido">🔒</span>`) : "";
  return `<fieldset class="ficha-b"><legend>Características do imóvel</legend><div class="car-g">
    <label class="fl car-tipo"><span>Tipo ${novo ? "" : trava("tipo", true)}</span><select name="tipo" ${novo ? dis : "disabled"}>${tiposImovel(i.tipo).map(t => opt(t, t, i.tipo === t)).join("")}</select></label>
    <label class="fl car-cod"><span>Código no site ${trava("codigo_site", temCod)} ${temCod && /^\d+$/.test(String(i.codigo_site).trim()) ? linkSite(i.codigo_site, "ver") : ""}</span><input name="codigo_site" value="${esc(i.codigo_site || "")}" inputmode="numeric" ${temCod ? "disabled" : dis}></label>
    ${CAR_IMV.map(([k, t, so]) => `<label class="fl car-${k}"${so ? ` data-so="${so}"` : ""}${so === "naoapto" && apto ? " hidden" : ""}><span>${t}</span><input data-car="${k}" value="${esc(fi[k] || "")}" inputmode="decimal" ${dis}></label>`).join("")}
    <div class="fl car-vg" data-so="apto"${apto ? "" : " hidden"}><span>Vagas (quais)</span><div class="vg-w"><input data-car="vagas_ident" value="${esc(fi.vagas_ident || "")}" placeholder="ex.: vagas 12 e 13" ${dis}${fi.vaga_rotativa ? " hidden" : ""}><button type="button" class="btn sm vg-rot${fi.vaga_rotativa ? " on" : ""}" data-vg-rot ${dis} title="${fi.vaga_rotativa ? "Clique para desfazer e digitar as vagas" : "Apartamento sem vaga demarcada"}">${fi.vaga_rotativa ? "✓ Sem vaga demarcada (rotativa) · desfazer" : "Rotativa"}</button><input type="hidden" data-car="vaga_rotativa" value="${fi.vaga_rotativa ? "1" : ""}"></div></div>
    <label class="fl car-etq"><span>Etiqueta (opcional)</span><input data-car="etiqueta" value="${esc(fi.etiqueta || "")}" placeholder="${esc(i.endereco ? rotuloImv(i.endereco) : "")}" ${dis} title="Nome curto do imóvel nas etiquetas; em branco, o sistema monta sozinho"></label></div></fieldset>`;
}
function ligarTipoCar(d) {
  const t = $("[name=tipo]", d); if (!t) return;
  const ap = () => { const a = ehApto(t.value); $$("[data-so=apto]", d).forEach(x => (x.hidden = !a)); $$("[data-so=naoapto]", d).forEach(x => (x.hidden = a)); };
  t.addEventListener("change", ap);
  // v19: botão "Rotativa" fica no lugar do campo das vagas; clicar de novo volta a digitar
  const vr = $("[data-car=vaga_rotativa]", d), vi = $("[data-car=vagas_ident]", d), vb = $("[data-vg-rot]", d);
  if (vr && vi && vb) vb.addEventListener("click", () => { const on = !vr.value; vr.value = on ? "1" : ""; vi.hidden = on; if (on) vi.value = ""; vb.classList.toggle("on", on);
    vb.textContent = on ? "✓ Sem vaga demarcada (rotativa) · desfazer" : "Rotativa"; vb.title = on ? "Clique para desfazer e digitar as vagas" : "Apartamento sem vaga demarcada"; if (!on) vi.focus(); });
}
const lerCar = (d, fi) => { fi = Object.assign({}, fi || {}); $$("[data-if],[data-car]", d).forEach(x => (fi[x.dataset.if || x.dataset.car] = x.type === "checkbox" ? (x.checked ? "1" : "") : x.value.trim())); return fi; };
const carTxt = (fi, tipo) => { fi = fi || {}; const v = k => String(fi[k] || "").trim(), p = (n, s1, s2) => `${n} ${+n === 1 ? s1 : s2}`, ap = ehApto(tipo);
  return [!ap && v("terreno") && `Terreno ${v("terreno")} m²`, v("construcao") && `${ap ? "Área" : "Construção"} ${v("construcao")} m²`, v("quartos") && p(v("quartos"), "quarto", "quartos"), v("suites") && p(v("suites"), "suíte", "suítes"), v("wc") && p(v("wc"), "WC", "WCs"),
    v("garagem") && p(v("garagem"), "vaga", "vagas"), ap && v("vaga_rotativa") && "vaga rotativa (sem demarcação)", ap && !v("vaga_rotativa") && v("vagas_ident") && v("vagas_ident")].filter(Boolean); };
// novo imóvel: mesmos blocos (sem contrato, sem grupo, sem "IR declarado por")
function formImovel() {
  const i = { status: "LVR", tipo: "Casa", taxa_adm: 10, carteira: "administrado" }, dis = pode.editar() ? "" : "disabled";
  const sts = Object.entries(STATUS_IMV).filter(([k]) => k !== "ALG");
  return `<div class="imv-g">
      <label class="fl"><span>Situação</span><select name="status" ${dis}>${sts.map(([k, v]) => opt(k, v[0], i.status === k)).join("")}</select></label>
      <label class="fl s4"><span>Endereço</span><input name="endereco" required ${dis}></label>
      <label class="fl s3"><span>Locador (proprietário) — do cadastro de locadores ${dis ? "" : `<button type="button" class="btn sm" data-novo-loc style="padding:0 6px;margin-left:6px">+ novo</button>`}</span><input name="locador" list="dl-locadores" placeholder="escolha da lista" ${dis}></label>
      <label class="fl"><span>Aluguel previsto</span><input name="valor" inputmode="numeric" ${dis}></label>
      <label class="fl"><span>Carteira</span><select name="carteira" ${dis}>${Object.entries(CARTEIRAS).map(([k, v]) => opt(k, v, i.carteira === k)).join("")}</select></label>
      <label class="fl"><span>Taxa adm. %</span><input name="taxa_adm" inputmode="decimal" value="${n2(i.taxa_adm)}" ${dis}></label>
    </div>
    ${irHTML(i)}
    <label class="fl"><span>Observações do imóvel</span><textarea name="obs" rows="2" ${dis}></textarea></label>
    ${caracteristicasHTML(i, true)}
    <datalist id="dl-locadores">${(S.locadores || []).filter(l => l.ativo).map(l => `<option value="${esc(l.nome)}">`).join("")}</datalist>
    <p class="hint">O imóvel passa a <b>Alugado</b> só quando um contrato é ligado a ele (tela Contratos). Carteira: <b>Administrado</b> = de terceiros · <b>Próprio</b> = da imobiliária (100%) · <b>Particular do sócio</b> = 0%.</p>`;
}
function lerImovel(f) {
  const valor = f.valor.value.trim() ? parseMoney(f.valor.value) : null, taxa = parseMoney(f.taxa_adm.value);
  if (taxa == null || taxa < 0 || taxa > 100) throw new Error("Taxa deve estar entre 0 e 100.");
  const d = { status: f.status.value, tipo: f.tipo.value || "Casa", codigo_site: f.codigo_site.value.trim(), endereco: f.endereco.value.trim(),
    carteira: f.carteira.value, locador: f.locador.value.trim(), valor, taxa_adm: taxa, declarar_ir: f.declarar_ir.value, obs: f.obs.value.trim() };
  if (!d.endereco) throw new Error("Informe o endereço.");
  if (!d.locador) throw new Error("Escolha o locador (Cadastros › Locadores). Se for novo, clique em “+ novo”.");
  if (!locadorExiste(d.locador)) throw new Error(`O locador “${d.locador}” não está no cadastro de locadores. Escolha da lista ou cadastre com “+ novo”.`);
  return d;
}

// v17: ficha do imóvel existente — só o que se edita; situação no cabeçalho, travas no tipo, código e contrato
const grupoDoLocador = nome => { const n = norm(nome || ""); const im = n && S.imoveis.find(x => norm(x.locador) === n && x.grupo_locador); return im ? im.grupo_locador : ""; };
function barraImovel(i) {
  const st = STATUS_IMV[i.status] || [i.status, "idle"], ed = pode.editar();
  const dica = { ALG: "Muda só ao registrar a saída do locatário.", LVR: "Vira Alugado ao ligar um contrato novo; pode sair da locação (Ocupado ou Inativo).", OCP: "Fora da locação. Pode voltar para Livre.", INTV: "Fora da locação. Pode voltar para Livre." }[i.status] || "";
  const b = (s, t, cls, d) => `<button type="button" class="btn sm ${cls || ""}" data-imv-st="${s}" title="${esc(d || "")}">${t}</button>`;
  const bts = !ed ? "" : i.status === "ALG" ? `<button type="button" class="btn sm" data-saida>🚪 Registrar saída do locatário</button>`
    : i.status === "LVR" ? `<button type="button" class="btn sm pri" data-act="imv-novoctt" data-id="${i.id}" title="Abre o gerador com os dados do locador e do imóvel">📄 Novo contrato</button>${b("OCP", "Ocupado", "", "O imóvel saiu da locação (ocupado pelo dono, em obra…)")}${b("INTV", "Inativo", "", "O imóvel deixou de ser administrado pela imobiliária")}`
    : b("LVR", "↺ Voltar para locação (Livre)", "pri");
  return `<div class="ctt-sit"><span class="ctt-sit-l">Situação</span><span class="tag ${st[1]}">${esc(st[0])}</span><small class="muted">${esc(dica)}</small><span class="spacer"></span>${bts}${pode.admin() ? `<button type="button" class="btn sm" data-imv-endloc title="Só administrador">✎ Endereço / locador</button>` : ""}</div>`;
}
function ligarImovelEd(f, d, i, reabrir) {
  mascaraMoeda(f.valor);
  f.carteira.addEventListener("change", () => { const t = { proprio: "100,00", socio: "0,00", administrado: "10,00" }[f.carteira.value]; if (t) f.taxa_adm.value = t; });
  ligarIr(d); ligarTipoCar(d);
  $$("[data-destrava]", d).forEach(b => b.addEventListener("click", e => { e.preventDefault();
    if (!b.dataset.conf) { b.dataset.conf = "1"; b.textContent = "Liberar? clique de novo"; b.classList.add("danger"); return; }
    const inp = $(`[name="${b.dataset.destrava}"]`, b.closest(".fl")) || f[b.dataset.destrava]; inp.disabled = false; inp.focus(); b.textContent = "🔓"; b.classList.remove("danger"); b.disabled = true; }));
  $$("[data-imv-st]", d).forEach(b => b.addEventListener("click", async () => {
    const novo = b.dataset.imvSt, txt = STATUS_IMV[novo][0];
    if (!b.dataset.conf) { b.dataset.conf = "1"; b.dataset.txt = b.textContent; b.textContent = `Confirmar: ${txt}?`; b.classList.add("danger"); return; }
    try { await q(sb.from("imoveis").update({ status: novo }).eq("id", i.id)); await recarregarImoveis(); toast(`Imóvel agora está ${txt}.`); d.close(); render(); setTimeout(reabrir, 50); } catch (e) { falha(e); }
  }));
  const el = $("[data-imv-endloc]", d);
  if (el) el.addEventListener("click", () => { d.close(); setTimeout(() => modal({ titulo: "Corrigir endereço / locador · " + i.endereco, largo: true,
    corpo: `<div class="box warn">Use só para corrigir erro de cadastro ou quando o imóvel mudou de dono. O endereço aparece em todos os lançamentos e contratos.</div>
      <label class="fl"><span>Endereço</span><input name="endereco" value="${esc(i.endereco)}" required></label>
      <label class="fl"><span>Locador (do cadastro de locadores)</span><input name="locador" value="${esc(i.locador || "")}" list="dl-locadores2"></label>
      <datalist id="dl-locadores2">${(S.locadores || []).filter(l => l.ativo).map(l => `<option value="${esc(l.nome)}">`).join("")}</datalist>`,
    aoFechar: () => setTimeout(reabrir, 50),
    salvar: async f2 => { const e2 = f2.endereco.value.trim(), l2 = f2.locador.value.trim();
      if (!e2) throw new Error("Informe o endereço."); if (!locadorExiste(l2)) throw new Error(`O locador “${l2}” não está no cadastro de locadores.`);
      await q(sb.from("imoveis").update({ endereco: e2, locador: l2 }).eq("id", i.id)); await recarregarImoveis(); toast("Salvo."); render(); } }), 50); });
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
ACT["imv-novo"] = () => modal({ titulo: "Novo imóvel", xl: true, corpo: formImovel(), aoAbrir: (f, d) => { ligarNovoLocador(f, d); mascaraMoeda(f.valor); ligarIr(d); ligarTipoCar(d);
    f.carteira.addEventListener("change", () => { const t = { proprio: "100,00", socio: "0,00", administrado: "10,00" }[f.carteira.value]; if (t) f.taxa_adm.value = t; }); },
  salvar: async f => {
    const d = lerImovel(f); d.ficha = lerCar($("#dlg"), {}); d.ficha.nf_outros = lerIr($("#dlg")) || [];
    if (d.status !== "LVR" && !pedeConfirmacao(f, `Cadastrar este imóvel como <b>${esc(STATUS_IMV[d.status][0])}</b>? O normal é cadastrar como <b>Livre</b>.`, "Sim, cadastrar assim")) return false;
    await q(sb.from("imoveis").insert(d)); await recarregarImoveis(); toast("Imóvel cadastrado."); render(); } });
let cttsImv = [];
// v13: ficha completa do imóvel — os dados vêm do contrato (atual ou o último) e ficam travados aqui
const IMV_FICHA_KS = ["end_rua", "end_bairro", "end_cidade", "end_cep", "matricula", "insc_cad", "uc", "rgi"];
// v16: dados físicos do imóvel (ficam na ficha do imóvel)
const residencial = t => /casa|apto|apart/i.test(t || "");
// meses do mapa → contrato daquele mês (pelo locatário e pelas datas)
function cttDoMes(ctts, h) {
  const fim = fimMes(h.competencia), nl = norm(h.locatario || "").replace(/\s+/g, " ").trim();
  const ok = ctts.filter(c => c.situacao !== "CANCELADO" && (!c.inicio || c.inicio <= fim) && (!(c.data_encerramento || c.termino) || (c.data_encerramento || c.termino) >= h.competencia || c.situacao === "ATIVO"));
  return ok.find(c => nl && norm(c.locatario || "").replace(/\s+/g, " ").trim() === nl) || ok.find(c => nl && norm(c.locatario || "").includes(nl.split(" - ")[0])) || null;
}
// períodos alugados: meses seguidos com o mesmo locatário
function periodosImovel(ctts, hist) {
  const ps = [];
  hist.slice().sort((a, b) => a.competencia.localeCompare(b.competencia)).forEach(h => {
    if (h.status !== "ALG") return;
    const u = ps[ps.length - 1];
    if (u && norm(u.locatario) === norm(h.locatario) && addMes(u.ate, 1) === h.competencia) { u.ate = h.competencia; u.valor = h.valor; u.n++; }
    else ps.push({ de: h.competencia, ate: h.competencia, locatario: h.locatario, valor: h.valor, n: 1, ctt: cttDoMes(ctts, h) });
  });
  return ps.reverse();
}
function resumoImovelHTML(i, ctts, hist) {
  const c = ctts.find(x => x.codigo === i.contrato_codigo) || null, f = c ? fichaDe(c) : {}, fi = i.ficha || {};
  const ir = k => `data-ir-aba="${k}" role="button" tabindex="0"`;
  const linha = (t, html, k) => `<div class="res-l"><span class="res-t">${t}</span><div class="res-v">${html || `<span class="muted">—</span>`}${k ? `<button type="button" class="btn sm" ${ir(k)}>dados completos ›</button>` : ""}</div></div>`;
  const st = STATUS_IMV[i.status] || [i.status, "idle"];
  const fdr = c ? nomesCtt(c, "fdr") : separaNomes(i.fiador);
  const car = carTxt(fi, i.tipo), per = periodosImovel(ctts, hist).slice(0, 8);
  return `<div class="res-2col"><div class="ctt-res">
    ${linha("Imóvel", `${tagImv(i.endereco)} <span class="tag ${st[1]}">${esc(st[0])}</span> <small class="muted">${esc(i.tipo || "")}</small>${/^\d+$/.test(String(i.codigo_site || "").trim()) ? " · " + linkSite(i.codigo_site, "ver no site") : ""}`, "imv")}
    ${linha("Locador", tagLoc(i.locador) + (grupoDoLocador(i.locador) ? ` <small class="muted" title="Grupo do locador (Cadastros › Locadores)">grupo: <b>${esc(grupoDoLocador(i.locador))}</b></small>` : ""), "lcd")}
    ${linha("Locatários", i.status === "ALG" ? tagPes(c ? nomesCtt(c, "lct") : separaNomes(i.locatario), "etq-lct") + (i.data_entrada ? ` <small class="muted">desde ${dt(i.data_entrada)}</small>` : "") : "", "lct")}
    ${linha("Fiadores", i.status === "ALG" ? tagPes(fdr, "etq-fdr") : "", "fdr")}
    ${linha("Contrato", i.contrato_codigo ? `${tagCtt(i.contrato_codigo)} ${c ? `<span class="tag ${SIT_CTT[c.situacao] || "idle"}">${esc(sitTxt(c.situacao))}</span>` : `<small class="muted">(não está no sistema)</small>`} · aluguel <b>${i.valor != null ? brl(i.valor) : "—"}</b>${i.dia_venc ? " · dia " + i.dia_venc : ""}${c ? ` · <a class="btn sm" href="${esc(pastaUrl(c))}"${CFG.PASTA_LOCAL ? "" : ' target="_blank" rel="noopener"'} data-pasta>📁 Abrir pasta</a>` : ""}` : `<span class="muted">sem contrato</span> · aluguel ${i.valor != null ? brl(i.valor) : "—"}`)}
    ${linha("Características", car.length ? car.map(x => `<span class="etq etq-p">${esc(x)}</span>`).join("") : `<span class="muted">não informadas</span>`, "cad")}
  </div><div class="res-dir"><div class="res-t">Observações do imóvel</div>${obsLinhas(i.obs).length ? `<ul class="obs-lista">${obsLinhas(i.obs).map(o => `<li>${esc(o)}</li>`).join("")}</ul>` : `<p class="muted">Sem observações.</p>`}${c && obsLinhas(f.obs).length ? `<div class="res-t" style="margin-top:8px">Do contrato ${esc(c.codigo)}</div><ul class="obs-lista">${obsLinhas(f.obs).map(o => `<li>${esc(o)}</li>`).join("")}</ul>` : ""}</div></div>
    <div class="res-l res-hist"><span class="res-t">Histórico</span><div class="res-v" style="display:block">${per.length ? `<table class="compacta hist-res"><tbody>${per.map(p => `<tr${p.ctt ? ` data-act="ir-ctt" data-id="${esc(p.ctt.codigo)}" style="cursor:pointer" title="Abrir o contrato"` : ""}><td>${esc(mesCurto(p.de))} a ${esc(mesCurto(p.ate))} <small class="muted">(${p.n} ${p.n === 1 ? "mês" : "meses"})</small></td><td>${tagPes(separaNomes(p.locatario), "etq-lct", "", 2)}</td><td>${p.ctt ? tagCtt(p.ctt.codigo) : ""}</td><td class="num">${p.valor != null ? n2(p.valor) : ""}</td></tr>`).join("")}</tbody></table>` : `<span class="muted">Sem meses alugados no histórico.</span>`}<button type="button" class="btn sm" ${ir("hist")} style="margin-top:4px">histórico completo ›</button></div></div>`;
}
// v19: histórico com vencimento e data do pagamento de cada mês (como no BRImob); carência aparece como CARÊNCIA
function historicoImovelHTML(i, ctts, hist, cobs) {
  cobs = cobs || []; const cPor = {}; cobs.forEach(c => (cPor[c.competencia] = c));
  // meses que já têm aluguel mas ainda não estão no mapa (ex.: o mês atual)
  const ms = hist.slice(); cobs.forEach(c => { if (!ms.some(h => h.competencia === c.competencia)) ms.push({ competencia: c.competencia, status: "ALG", valor: c.valor, locatario: c.locatario }); });
  ms.sort((a, b) => b.competencia.localeCompare(a.competencia));
  if (!ms.length) return `<p class="muted">Sem histórico no mapa.</p>`;
  const nAlg = ms.filter(h => h.status === "ALG").length;
  return `<div class="filters"><div class="seg"><button type="button" class="on" data-hist-f="todos">Completo (${ms.length} meses)</button><button type="button" data-hist-f="alg">Resumido: só alugados (${nAlg})</button></div><span class="hint">Desde ${esc(mesTxt(ms[ms.length - 1].competencia))}. Clique numa linha com contrato para abrir o contrato.</span></div>
    <div class="tw" style="max-height:58vh"><table class="compacta hist-t"><thead><tr><th>Mês</th><th>Situação</th><th class="num">Aluguel</th><th>Vencimento</th><th>Pago em</th><th class="num">Pago</th><th>Locatário</th><th>Contrato</th></tr></thead><tbody>
    ${ms.map(h => { const c = h.status === "ALG" ? cttDoMes(ctts, h) : null, st = STATUS_IMV[h.status] || [h.status, "idle"], cb = cPor[h.competencia];
      return `<tr class="${h.status === "ALG" ? "h-alg" : ""}"${c ? ` data-act="ir-ctt" data-id="${esc(c.codigo)}" style="cursor:pointer"` : ""}><td>${esc(mesCurto(h.competencia))}</td><td><span class="tag ${st[1]}">${esc(st[0])}</span></td>
        <td class="num">${cb && cb.carencia ? `<span class="tag warn">CARÊNCIA</span>` : h.valor != null && h.status === "ALG" ? n2(h.valor) : ""}</td>
        <td>${cb ? dt(cb.vencimento) : ""}</td><td>${cb && cb.data_pagamento ? dt(cb.data_pagamento) : cb && !cb.carencia && h.status === "ALG" ? `<span class="tag ${cb.vencimento < hoje() ? "bad" : "idle"}">${cb.vencimento < hoje() ? "em aberto" : "a vencer"}</span>` : ""}</td>
        <td class="num">${cb && cb.data_pagamento ? n2(cb.valor_pago) : ""}</td><td>${h.status === "ALG" ? tagPes(separaNomes(h.locatario), "etq-lct", "", 2) : ""}</td><td>${c ? tagCtt(c.codigo) : ""}</td></tr>`; }).join("")}
    </tbody></table></div>`;
}
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
  return { abas: `<div class="abas ficha-abas imv-abas"><button type="button" class="aba on" data-aba="res">Resumo</button><button type="button" class="aba" data-aba="cad">Cadastro e reajustes</button><button type="button" class="aba" data-aba="imv">Imóvel</button><button type="button" class="aba" data-aba="lcd">Locadores</button><button type="button" class="aba" data-aba="lct">Locatários</button><button type="button" class="aba" data-aba="fdr">Fiadores</button><button type="button" class="aba" data-aba="hist">Histórico completo</button></div>`,
    secs: `<div class="ficha-sec" data-sec="imv" hidden>${topo}${imvSec}</div><div class="ficha-sec" data-sec="lcd" hidden>${topo}${blocoP("lcd", "Locador")}</div><div class="ficha-sec" data-sec="lct" hidden>${topo}${blocoP("lct", "Locatário")}</div><div class="ficha-sec" data-sec="fdr" hidden>${topo}${blocoP("fdr", "Fiador")}</div>` };
}
ACT["imv-ed"] = async el => {
  const i = S.imovelPor[el.dataset.id]; if (!i) return;
  const [reaj, hist, cobs, ultAlg] = await Promise.all([
    q(sb.from("reajustes").select("*").eq("imovel_id", i.id).order("competencia", { ascending: false })),
    fetchAll("mapa_mensal", b => b.eq("imovel_id", i.id).order("competencia", { ascending: false }), "competencia,status,valor,locatario"),
    fetchAll("cobrancas", b => b.eq("imovel_id", i.id).order("competencia", { ascending: false }), "competencia,vencimento,valor,acrescimos,descontos,valor_pago,data_pagamento,taxa_valor,repasse_data,locatario,devedor_id,carencia,ajustes,taxa_adm_pct,imovel_id"),
    q(sb.from("mapa_mensal").select("competencia,valor,locatario").eq("imovel_id", i.id).eq("status", "ALG").order("competencia", { ascending: false }).limit(1)),
    q(sb.from("contratos").select("*").or(`imovel_id.eq.${i.id}${i.contrato_codigo ? `,codigo.eq.${i.contrato_codigo}` : ""}`).order("codigo", { ascending: false })).catch(() => [])
  ]).then(r => { cttsImv = r[4]; return r; });
  const saida = "";
  const excluir = pode.admin() ? `<span class="spacer"></span><button type="button" class="btn danger" data-del>Excluir</button>` : "";
  modal({
    titulo: i.endereco, xl: true, semOk: !pode.editar(), extra: saida + excluir,
    corpo: barraImovel(i) + abasImovelHTML(i, cttsImv).abas + `<div class="ficha-sec" data-sec="res">${resumoImovelHTML(i, cttsImv, hist)}</div><div class="ficha-sec" data-sec="cad" hidden>` + formImovelEd(i) + caracteristicasHTML(i) + `
      <h3 style="margin-top:8px">Reajustes programados</h3>
      <div class="tw"><table><thead><tr><th>A partir de</th><th class="num">Novo valor</th><th>Situação</th><th></th></tr></thead><tbody>
        ${reaj.map(r => `<tr><td>${mesTxt(r.competencia)}</td><td class="num">${n2(r.valor_novo)}</td><td>${r.aplicado_em ? `<span class="tag ok">Aplicado</span>` : `<span class="tag warn">Pendente</span>`}</td><td class="acts">${pode.editar() && !r.aplicado_em ? `<button type="button" class="btn sm" data-reaj-del="${r.id}">Remover</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">Nenhum.</td></tr>`}
      </tbody></table></div>
      ${pode.editar() ? `<div class="row"><label class="fl"><span>Novo reajuste a partir de</span><input type="month" data-rj-mes value="${addMes(inicioMes(hoje()), 1).slice(0, 7)}"></label><label class="fl"><span>Novo valor</span><input data-rj-val inputmode="decimal"></label><label class="fl"><span>&nbsp;</span><button type="button" class="btn" data-reaj-add>Programar reajuste</button></label></div>` : ""}
      <h3 style="margin-top:8px">Últimos aluguéis</h3>
      <div class="tw"><table class="compacta"><thead><tr><th>Mês</th><th>Locatário</th><th>Vencimento</th><th class="num">Devido</th><th>Pago em</th><th class="num">Pago</th><th>Situação</th></tr></thead><tbody>
        ${cobs.slice(0, 12).map(c => `<tr><td>${mesCurto(c.competencia)}</td><td>${tagPes(separaNomes(c.locatario), "etq-lct", "", 2)}</td><td>${dt(c.vencimento)}</td><td class="num">${valorCobTxt(c)}</td><td>${c.data_pagamento ? dt(c.data_pagamento) : ""}</td><td class="num">${c.data_pagamento ? n2(c.valor_pago) : ""}</td><td>${tagCob(c)}</td></tr>`).join("") || `<tr><td colspan="7" class="muted">Nenhum.</td></tr>`}
      </tbody></table></div>
</div>` + abasImovelHTML(i, cttsImv).secs + `<div class="ficha-sec" data-sec="hist" hidden>${historicoImovelHTML(i, cttsImv, hist, cobs)}</div>`,
    salvar: async f => {
      const d = lerImovelEd(f, i);
      const fi = lerCar($("#dlg"), i.ficha); fi.nf_outros = lerIr($("#dlg")) || []; d.ficha = fi;
      if (!pode.admin()) ["valor", "dia_venc", "taxa_adm", "carteira"].forEach(k => delete d[k]);
      const mudouCob = pode.admin() && i.status === "ALG" && (+d.valor !== +i.valor || +d.dia_venc !== +i.dia_venc || +d.taxa_adm !== +i.taxa_adm);
      await q(sb.from("imoveis").update(d).eq("id", i.id));
      // v19: corrigiu aluguel, dia ou taxa → os aluguéis ainda não pagos (deste mês em diante) acompanham
      let n = 0; if (mudouCob) n = await rpc("recalcular_cobrancas", { p_imovel: i.id, p_desde: inicioMes(hoje()) });
      await recarregarImoveis(); toast(n ? `Salvo. ${n} aluguel(éis) ainda não pago(s) atualizado(s) (de ${mesCurto(inicioMes(hoje()))} em diante).` : "Salvo."); render();
    },
    aoAbrir: (f, d) => { ligarImovelEd(f, d, i, () => ACT["imv-ed"]({ dataset: { id: i.id } }));
      $$("[data-hist-f]", d).forEach(b => b.addEventListener("click", () => { $$("[data-hist-f]", d).forEach(x => x.classList.toggle("on", x === b)); $$(".hist-t tbody tr", d).forEach(tr => (tr.hidden = b.dataset.histF === "alg" && !tr.classList.contains("h-alg"))); }));
      $$("[data-ir-aba]", d).forEach(b => b.addEventListener("click", () => { const a = $(`.imv-abas [data-aba="${b.dataset.irAba}"]`, d); if (a) a.click(); }));
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
      q(sb.from("cobrancas").select("id,competencia,valor,acrescimos,descontos").eq("imovel_id", i.id).is("data_pagamento", null).is("devedor_id", null).eq("carencia", false).order("competencia")),
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
      <button class="btn" data-act="dev-imp">🖨 Imprimir lista</button><button class="btn" data-act="cob-termos-menu">📄 Termos ▾</button>${pode.editar() ? `<button class="btn pri" data-act="dev-novo">+ Devedor antigo</button>` : ""}
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
  const cs = cobsDoFav(f), pend = cs.filter(precisaRepasse), naoPagos = cs.filter(c => !c.data_pagamento && !c.devedor_id && !c.carencia);
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
      // ± : lançar acréscimo/desconto do aluguel ou despesa do proprietário por aqui (atualiza Caixa e Pagto aluguel)
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
            await salvarAjustes(c, aj); toast("Salvo (também em Pagto aluguel)."); d.close(); setTimeout(() => ACT["dep-ed"]({ dataset: { id: fav.id } }), 0); } catch (e) { falha(e); }
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
  st: ["OK", "NÃO", "N/A", "???"], dc: ["Não", "Desconto", "Carência"], quem: ["ANDRÉ", "ELIANA", "LINYSTON", "VANILDA"]
};
const SIT_CTT = { "RASCUNHO": "idle", "CORRIGIR": "warn", "PRONTO": "info", "ATIVO": "ok", "DÉBITO EM ABERTO": "bad", "ENCERRADO": "info", "CANCELADO": "idle" };
const PREPARO = ["RASCUNHO", "CORRIGIR", "PRONTO"];
const SIT_CTT_CHIP = { "ATIVO": "st-LVR", "RASCUNHO": "st-OCP", "CORRIGIR": "st-OCP", "PRONTO": "st-OCP", "DÉBITO EM ABERTO": "st-INTV", "ENCERRADO": "st-ALG", "CANCELADO": "st-CANC" };
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
const TAG_DE = { end_rua: "tag_imv", lcd1_nome: "tag_lcd", lcd2_nome: "tag_lcd", lct1_nome: "tag_lct", lct2_nome: "tag_lct", fdr1_nome: "tag_fdr", fdr2_nome: "tag_fdr" };
const resumoKs = id => (RESUMOS[id] || RESUMOS.r3)[1] ? Array.from(new Set((RESUMOS[id] || RESUMOS.r3)[1].split(" ").map(l => CP.find(c => c.col === l).k).map(k => TAG_DE[k] || k))).filter(k => k !== "obs") : COLS_TAG_CTT.map(c => c.k).concat(CP.map(c => c.k), ["data_encerramento"]);
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
  const txt = !v || v === "---" ? "—" : ["OK", "SIM", "NÃO", "NAO", "N/A"].includes(u) ? u : "📝";
  const ed = pode.editar() ? ` data-act="ctt-st" data-id="${esc(c.codigo)}" data-k="${k}" role="button" tabindex="0"` : "";
  return `<span class="tag ${cls} st-ed${txt === "📝" ? " st-anot" : ""}"${ed} title="${esc(v || "vazio")}${pode.editar() ? " · clique para alterar" : ""}">${esc(txt)}</span>`;
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
    try { const ficha = Object.assign({}, fichaDe(c), { [k]: b.dataset.o }); const r = await q(sb.from("contratos").update({ ficha }).eq("codigo", c.codigo).select().single()); Object.assign(c, r); delete c._f; toast(`${CPK[k].t}: ${b.dataset.o || "vazio"}`); gRedesenhar("contratos8"); } catch (e) { falha(e); }
  }));
};
const sitTxt = s => s === "DÉBITO EM ABERTO" ? "COM DÉBITO" : s;
function sitPill(c) {
  const ed = pode.editar() ? ` data-act="ctt-st" data-id="${esc(c.codigo)}" data-k="situacao" role="button" tabindex="0" title="Clique para alterar"` : "";
  return `<span class="tag ${SIT_CTT[c.situacao] || "idle"} st-ed"${ed}>${esc(sitTxt(c.situacao))}</span>`;
}
// títulos curtos nas colunas (o nome completo aparece ao passar o mouse)
const CURTO_CTT = { st_ass_lcd: "LCD", st_ass_lct: "LCT/FDR", st_scan: "Scan", st_cpfl: "CPFL", st_condominio: "Condom.", st_brimob: "BRIMOB",
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
// v14: etiquetas (o "resumo" de imóvel e pessoas, usado nas ligações; os dados completos ficam nas fichas)
// v19: empresa vira as 2 primeiras palavras (ex.: "MONTEMAG TRATORES"); pessoa = primeiro + último nome
const nomeTag = n => { n = String(n || "").trim(); const p = n.split(/\s+/).filter(Boolean); if (p.length <= 2) return n;
  if (/\b(LTDA|ME|EIRELI|S\.?\/?A|EPP|MEI|CIA|SOCIEDADE|COMERCIO|COMÉRCIO|INDUSTRIA|INDÚSTRIA|ASSOCIA[CÇ][AÃ]O|PREFEITURA|SERVI[CÇ]OS)\b\.?/i.test(n)) {
    const w = p.filter(x => !/^(LTDA|ME|EIRELI|S\.?\/?A\.?|EPP|MEI|-|–)$/i.test(x)); const r = [];
    let k = 0; for (const x of w) { const con = /^(E|DE|DA|DO|DAS|DOS|&)$/i.test(x); if (con && (!k || /^(E|&)$/i.test(x))) break; r.push(x); if (!con && ++k >= 2) break; }
    return r.join(" ").replace(/[,–-]+$/, ""); }
  return p[0] + " " + p[p.length - 1]; };
// v16: etiqueta do imóvel — apartamento mostra só condomínio/edifício + apto; clicável (abre o imóvel)
function rotuloImv(end) {
  end = String(end || "").trim(); const ps = end.split(/\s+-\s+/), ia = ps.findIndex(x => /^ap(to|\.|artamento)?\s*\d/i.test(x));
  if (ia < 1 || ps.length < 3) return end;
  const curto = x => x.replace(/^Edif[ií]cio\s+/i, "Ed. ").replace(/^Residencial\s+/i, "Res. ").replace(/^Condom[ií]nio\s+/i, "Cond. ").replace(/^Bloco\s+/i, "Bl. ");
  return ps.slice(1, ia + 1).map(curto).join(" - ").replace(/\bApto\b/i, "Apto");
}
let IMV_POR_END = null;
const imvPorEnd = e => { if (!IMV_POR_END || IMV_POR_END._n !== S.imoveis.length) { IMV_POR_END = new Map(S.imoveis.map(i => [norm(i.endereco).trim(), i])); IMV_POR_END._n = S.imoveis.length; } return IMV_POR_END.get(norm(e).trim()) || null; };
const rotuloImvDe = i => ((i && i.ficha) || {}).etiqueta || rotuloImv(i ? i.endereco : "");
const tagImv = (txt, tit, extra) => { if (!txt) return ""; const im = imvPorEnd(txt);
  return `<span class="etq etq-imv${im ? " etq-lnk" : ""}"${extra || ""}${im ? ` data-act="ir-imv" data-id="${im.id}"` : ""} title="${esc(tit || txt)}${im ? " · clique para abrir o imóvel" : ""}">🏠 ${esc((im && (im.ficha || {}).etiqueta) || rotuloImv(txt))}</span>`; };
const tagPes = (nomes, cls, tit, max) => { const ns = (nomes || []).filter(Boolean), m = max || 99;
  return ns.slice(0, m).map(n => `<span class="etq ${cls || "etq-p"}" title="${esc(tit || ns.join(" · "))}">${esc(nomeTag(n))}</span>`).join("") + (ns.length > m ? `<span class="etq-mais" title="${esc(ns.join(" · "))}">+${ns.length - m}</span>` : ""); };
// v16: o TÍTULO do cadastro de locadores é a etiqueta do locador em todo o sistema
function locResolve(n) {
  n = String(n || "").trim(); if (!n) return null;
  const ls = S.locadores || [], k = norm(n).trim();
  return ls.find(l => norm(l.nome).trim() === k) || ls.find(l => norm(tiraPrefixo(l.nome)).trim() === k)
    || ls.find(l => { const f = l.ficha || {}; return [f.lcd1_nome, f.lcd2_nome].some(x => x && norm(x).trim() === k); }) || null;
}
const tagLoc = (n, extra) => { if (!n) return ""; const l = locResolve(n);
  return l ? `<span class="etq etq-lcd etq-lnk" data-act="ir-loc" data-id="${l.id}" title="${esc([(l.ficha || {}).lcd1_nome, (l.ficha || {}).lcd2_nome].filter(Boolean).join(" e ") || l.nome)} · clique para abrir o locador"${extra || ""}>${esc(l.nome)}</span>`
    : `<span class="etq etq-lcd etq-conf" title="“${esc(n)}” não está no cadastro de locadores (Cadastros › Locadores › Conferir etiquetas)">⚠ ${esc(n)}</span>`; };
// títulos dos locadores de um contrato: o do imóvel ligado, senão os nomes da ficha casados com o cadastro
function locadoresDoCtt(c) {
  const im = imvDoCtt(c), out = [];
  if (im && im.locador) out.push(im.locador);
  nomesCtt(c, "lcd").forEach(n => { const l = locResolve(n); const t = l ? l.nome : n; if (!out.some(x => norm(x) === norm(t)) && !(l && out.some(x => locResolve(x) === l))) out.push(t); });
  return out;
}
const tagsLoc = ns => ns.map(n => tagLoc(n)).join("");
// contrato: código clicável + pasta
const tagCtt = cod => { if (!cod) return ""; const c = (CTT || []).find(x => x.codigo === cod) || { codigo: cod };
  return `<span class="ctt-ref"><button type="button" class="lnk-ctt mono" data-act="ir-ctt" data-id="${esc(cod)}" title="Abrir o contrato">${esc(cod)}</button><a class="pasta" href="${esc(pastaUrl(c))}"${CFG.PASTA_LOCAL ? "" : ' target="_blank" rel="noopener"'} data-pasta title="Abrir a pasta do contrato">📁</a></span>`; };
const fecharDlg = () => { const d = $("#dlg"); if (d && d.open) d.close(); };
ACT["ir-imv"] = el => { fecharDlg(); setTimeout(() => ACT["imv-ed"]({ dataset: { id: el.dataset.id } }), 30); };
ACT["ir-loc"] = el => { fecharDlg(); setTimeout(() => ACT["loc-ed"]({ dataset: { id: el.dataset.id } }), 30); };
ACT["ir-ctt"] = async el => { fecharDlg(); if (!CTT.length || !CTT.some(c => c.codigo === el.dataset.id)) CTT = await fetchAll("contratos", b => b.order("codigo", { ascending: false })); if (!CTT.some(c => c.codigo === el.dataset.id)) return toast("Contrato " + el.dataset.id + " não está no sistema.", true); setTimeout(() => ACT["ctt-ed"]({ dataset: { id: el.dataset.id } }), 30); };
// v15: transforma colunas de texto (imóvel, locatário, locador, fiador) em etiquetas, em qualquer tabela
const separaNomes = v => String(v || "").split(/\s+[-–]\s+|\s*;\s*/).map(x => x.trim()).filter(Boolean)
  .reduce((acc, x) => { if (acc.length && (x.length <= 4 || /^(ME|EPP|EIRELI|LTDA|S\/?A|MEI|CIA)\.?$/i.test(x))) acc[acc.length - 1] += " - " + x; else acc.push(x); return acc; }, []);
function etiquetarCols(cols) {
  cols.forEach(c => {
    if (c.html || c._etq) return;
    const val = r => c.v ? c.v(r) : r[c.k];
    const tipo = /^(contrato_codigo|contrato)$/.test(c.k) ? "ctt" : /^(endereco|imovel)$/.test(c.k) ? "imv" : /^(locatario|devedor)$/.test(c.k) ? "lct" : c.k === "locador" ? "lcd" : c.k === "fiador" ? "fdr" : c.k === "quem" ? "p" : "";
    if (!tipo) return;
    c._etq = true; c.cls = tipo === "ctt" ? "mono" : "tags";
    c.html = r => { const v = val(r); if (!v || v === "?") return esc(v || "");
      if (tipo === "ctt") return /^L\.\d{2}\.(\d{3}|R\d+)$/.test(String(v).trim()) ? tagCtt(String(v).trim()) : esc(v);
      if (tipo === "imv") return tagImv(v);
      if (tipo === "lcd") return tagLoc(v);
      if (tipo === "p" && locResolve(v)) return tagLoc(v);
      return tagPes(separaNomes(v), "etq-" + tipo, "", 2); };
  });
  return cols;
}
const nomesCtt = (c, g) => { const f = fichaDe(c); return [f[g + "1_nome"], /PJ/i.test(f[g + "_qtd"] || "") ? "" : f[g + "2_nome"]].map(x => String(x || "").trim()).filter(x => x && x !== "---"); };
const imvDoCtt = c => (c.imovel_id && S.imovelPor[c.imovel_id]) || S.imoveis.find(i => i.contrato_codigo === c.codigo) || null;
const COLS_TAG_CTT = [
  { k: "tag_imv", cls: "tags", t: "Imóvel", grp: "imv", w: 215, dica: "Imóvel do contrato (etiqueta do mapa)", v: c => { const i = imvDoCtt(c); return i ? i.endereco : fv(c, "end_rua"); }, html: c => { const i = imvDoCtt(c); return tagImv(i ? i.endereco : fv(c, "end_rua"), endImovelFicha(fichaDe(c), c)); } },
  { k: "tag_lcd", cls: "tags", t: "Locadores", grp: "lcd", w: 190, dica: "Locadores (título do cadastro de locadores)", v: c => locadoresDoCtt(c).join(" · "), html: c => tagsLoc(locadoresDoCtt(c)) },
  { k: "tag_lct", cls: "tags", t: "Locatários", grp: "lct", w: 215, dica: "Locatários", v: c => nomesCtt(c, "lct").join(" - ") || c.locatario || "", html: c => tagPes(nomesCtt(c, "lct").length ? nomesCtt(c, "lct") : [c.locatario], "etq-lct", "", 2) },
  { k: "tag_fdr", cls: "tags", t: "Fiadores", grp: "fdr", w: 170, dica: "Fiadores", v: c => nomesCtt(c, "fdr").join(" - "), html: c => tagPes(nomesCtt(c, "fdr"), "etq-fdr") }
];
const COLS_CTT = CP.map(c => {
  const col = { k: c.k, t: tituloCurto(c), dica: c.t + " · clique para ordenar, arraste para mover", v: r => fv(r, c.k), cls: "trunc", tip: true };
  col.grp = c.k === "obs" ? "obs" : c.k === "redacao" || c.k === "correcao" ? "red" : c.sec === "st" ? "st" : c.sec;
  if (c.tipo === "st") col.w = 52;
  if (c.k === "codigo") Object.assign(col, { t: "Contrato", cls: "mono", fixo: true, w: 96, tip: false, html: r => `${esc(r.codigo)}<a class="pasta" href="${esc(pastaUrl(r))}"${CFG.PASTA_LOCAL ? "" : ' target="_blank" rel="noopener"'} data-pasta title="${CFG.PASTA_LOCAL ? "Abrir a pasta do contrato no computador (G:)" : r.pasta_url ? "Abrir a pasta do contrato (Google Drive)" : "Procurar a pasta deste contrato no Google Drive"}">📁</a>` });
  if (c.k === "obs") Object.assign(col, { w: 95, cls: "trunc obs-col" });
  if (c.k === "redacao" || c.k === "correcao") Object.assign(col, { w: 76, tip: false, html: r => quemPill(r, c.k) });
  if (c.k === "situacao") col.w = 104;
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
COLS_CTT.splice(1, 0, ...COLS_TAG_CTT);
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
  return { "ATIVO": pendsDe(c).length ? "ct-pend" : "ct-ativo", "RASCUNHO": "ct-elab", "CORRIGIR": "ct-elab", "PRONTO": "ct-elab", "ENCERRADO": "ct-enc", "DÉBITO EM ABERTO": "ct-deb", "CANCELADO": "ct-canc" }[c.situacao] || "";
}
const NAO_ATIVOS = ["ENCERRADO", "DÉBITO EM ABERTO", "CANCELADO"];
const CTT_SEL = new Set();
const COL_SEL_CTT = { k: "sel", t: "Seleção", nf: true, fixo: true, w: 30, th: `<input type="checkbox" data-csel="todos" aria-label="Selecionar todos">`, html: c => `<input type="checkbox" data-csel="${esc(c.codigo)}" ${CTT_SEL.has(c.codigo) ? "checked" : ""} aria-label="Selecionar">` };
function desenharContratos(pg) {
  pg = pg || $("#page");
  let f = S.f.ctt || "todos"; if (!["todos", "ATIVO", "preparo", "naoativos"].includes(f)) f = S.f.ctt = "todos";
  const sub = S.f.cttSub || "", pend = S.f.cttPend || "", gar = S.f.cttGar || "", busca = S.f.cttBusca || "";
  const lim60 = iso(new Date(Date.now() + 60 * 86400000));
  const grupo = { todos: () => true, ATIVO: c => c.situacao === "ATIVO", preparo: c => PREPARO.includes(c.situacao), naoativos: c => NAO_ATIVOS.includes(c.situacao) };
  const subT = { pend: c => pendsDe(c).length > 0, sempend: c => !pendsDe(c).length, vencendo: c => c.termino && c.termino >= hoje() && c.termino <= lim60, redcor: c => pendAtiva(c, "redcor"),
    ENCERRADO: c => c.situacao === "ENCERRADO", "DÉBITO EM ABERTO": c => c.situacao === "DÉBITO EM ABERTO", CANCELADO: c => c.situacao === "CANCELADO", RASCUNHO: c => c.situacao === "RASCUNHO", CORRIGIR: c => c.situacao === "CORRIGIR", PRONTO: c => c.situacao === "PRONTO" };
  const base = CTT.filter(c => !gar || garDe(c) === gar);
  const nG = k => base.filter(grupo[k]).length;
  let lista = base.filter(grupo[f]);
  const subs = f === "ATIVO" ? [["", "Todos os ativos", ""], ["sempend", "Sem pendência", "st-LVR"], ["pend", "Com pendências", "st-OCP"], ["redcor", "Falta redação/correção", ""], ["vencendo", "Terminam em 60 dias", ""]]
    : f === "naoativos" ? [["", "Todos não ativos", ""], ["ENCERRADO", "Encerrados sem débitos", "st-ALG"], ["DÉBITO EM ABERTO", "Encerrados com débito", "st-INTV"], ["CANCELADO", "Cancelados", "st-CANC"]]
    : f === "preparo" ? [["", "Todos em preparo", ""], ["PRONTO", "Prontos (falta ligar ao imóvel)", "st-LVR"], ["CORRIGIR", "A corrigir", "st-OCP"], ["RASCUNHO", "Rascunhos", ""]] : [];
  const subOk = subs.some(x => x[0] === sub) ? sub : "";
  const listaG = lista, nS = k => k ? listaG.filter(subT[k]).length : listaG.length;
  if (subOk) lista = lista.filter(subT[subOk]);
  // pendências por tipo: nos ativos (dentro de "Com pendências") e em preparo
  const verPend = (f === "ATIVO" && subOk === "pend") || f === "preparo";
  const listaP = lista, nP = k => listaP.filter(c => pendAtiva(c, k)).length;
  if (verPend && pend) lista = lista.filter(c => pendAtiva(c, pend));
  if (busca) { const b = norm(busca); lista = lista.filter(c => norm([c.codigo, c.endereco, c.locador, c.locatario, c.fiador, fv(c, "lct1_cpf"), fv(c, "lct2_cpf")].join(" ")).includes(b)); }
  const cols = pode.editar() ? [COL_SEL_CTT].concat(COLS_CTT) : COLS_CTT;
  const g = grade("contratos8", cols, lista, { attr: c => `data-act="ctt-ed" data-id="${esc(c.codigo)}" style="cursor:pointer"`, sort: { k: "codigo", dir: "desc" }, rodape: fl => `${fl.length} contratos`,
    divisor: { k: "codigo", g: c => c.codigo.slice(2, 4) }, cls: corCtt, tcls: "ctt" });
  if (pode.editar() && !g.ordem.includes("sel")) g.ordem.unshift("sel");
  g.redesenhar = () => desenharContratos();
  const chip = (k, t, cls, n, on, key) => `<button class="chip ${cls || ""}${on ? " on" : ""}" data-act="chip" data-k="${key}" data-v="${esc(k)}">${t}<span class="c">${n}</span></button>`;
  const semFicha = CTT.filter(c => !c.ficha || !Object.keys(c.ficha).length).length;
  const sabado = new Date().getDay() === 6, nPendAtivos = CTT.filter(c => pendsDe(c).length).length;
  const selN = [...CTT_SEL].filter(k => CTT.some(c => c.codigo === k)).length;
  pg.innerHTML = `<div class="grid">
    <div class="filters">
      <div class="fgrupo"><span>Situação</span>${chip("todos", "Todos", "", nG("todos"), f === "todos", "ctt")}${chip("ATIVO", "Ativos", "st-LVR", nG("ATIVO"), f === "ATIVO", "ctt")}${chip("preparo", "Em preparo", "st-OCP", nG("preparo"), f === "preparo", "ctt")}${chip("naoativos", "Não ativos", "st-ALG", nG("naoativos"), f === "naoativos", "ctt")}</div>
      <div class="fgrupo"><span>Garantia</span>${[["", "Todas"], ["fiador", "Fiador"], ["caucao", "Caução"], ["sem", "Sem garantia"]].map(([k, t]) => chip(k, t, "", (k ? CTT.filter(c => garDe(c) === k) : CTT).filter(grupo[f]).length, gar === k, "cttGar")).join("")}</div>
      <input type="search" placeholder="Buscar código, nomes, CPF…" value="${esc(busca)}" data-busca="cttBusca" style="width:180px">
      <span class="spacer"></span>${avisosContratos(semFicha, sabado, nPendAtivos)}${gradeBarra("contratos8")}
      <button class="btn" data-act="ctt-termo">🔑 Termos</button>
    </div>
    <div class="filters">
      ${subs.length ? `<div class="chips sub">${subs.map(([k, t, cls]) => chip(k, t, cls, nS(k), subOk === k, "cttSub")).join("")}</div>` : `<div class="leg-ct"><span><i style="background:var(--ok-soft)"></i>Ativo</span><span><i style="background:var(--warn-soft)"></i>Ativo com pendência</span><span><i style="background:color-mix(in srgb,var(--c2) 12%,var(--surface))"></i>Em preparo (rascunho, corrigir, pronto)</span><span><i style="background:var(--info-soft)"></i>Encerrado</span><span><i style="background:var(--bad-soft)"></i>Encerrado com débito</span><span><i style="background:var(--idle-soft)"></i>Cancelado</span></div>`}
      <span class="spacer"></span>
      <button class="btn" data-act="ctt-rel-pend" title="Relatório de pendências para imprimir ou salvar em PDF (sábados)">📋 Pendências</button>
      ${pode.editar() ? `<button class="btn" data-act="ctt-novo" title="Só a ficha, sem gerar o Word">+ Ficha</button><button class="btn pri" data-act="ctt-gerar">📄 Novo contrato</button>` : ""}
    </div>
    ${verPend ? `<div class="filters"><div class="chips sub">${chip("", "Todas as pendências", "", listaP.length, !pend, "cttPend")}${PEND_CTT.map(([k, t]) => chip(k, t, "", nP(k), pend === k, "cttPend")).join("")}</div></div>` : ""}
    ${selN ? `<div class="filters lote-bar"><b>${selN} selecionado(s)</b> · alterar <select data-lote-k>${PEND_CTT.filter(([k]) => k !== "redcor").map(([k], i) => opt(k, CPK[k].t, !i)).join("")}${opt("redacao", "Redação", false)}${opt("correcao", "Correção", false)}</select>
      para <input data-lote-v list="dl-lote" placeholder="valor (vazio = limpar)" style="width:200px"><datalist id="dl-lote">${OPC.st.concat(OPC.quem).map(o => `<option value="${esc(o)}">`).join("")}</datalist>
      <button class="btn pri" data-act="ctt-lote">Aplicar aos selecionados</button><button class="btn" data-act="ctt-lote-limpar">Limpar seleção</button></div>` : ""}
    ${CTT.some(c => c.situacao === "CANCELADO" && ST_K.some(k => String(fv(c, k)).trim().toUpperCase() === "CANCELADO")) && pode.editar() ? `<p class="hint">Há contratos cancelados com "CANCELADO" escrito nos status. <button class="btn sm" data-act="ctt-limpa-canc">Apagar esse texto dos status (fica só na Situação)</button></p>` : ""}
    <div class="resumos"><span class="hint">Colunas:</span>${Object.entries(RESUMOS).map(([id, [t]]) => `<button class="chip${S.f.cttResumo === id ? " on" : ""}" data-act="ctt-resumo" data-r="${id}">${esc(t)}</button>`).join("")}</div>
    ${gradeHTML("contratos8")}</div>`;
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
  const g = G.contratos8, vis = new Set(resumoKs(el.dataset.r));
  g.ordem = COLS_CTT.map(c => c.k); g.ocultas = g.ordem.filter(k => !vis.has(k) && !(gCol(g, k) || {}).fixo);
  S.f.cttResumo = el.dataset.r; gradeSalvar("contratos8"); desenharContratos(); requestAnimationFrame(ajustarAlturas);
};
ACT["ctt-st"] = el => {
  const c = CTT.find(x => x.codigo === el.dataset.id), k = el.dataset.k, sit = k === "situacao";
  if (!c || !pode.editar()) return;
  if (sit) {
    let acs = { RASCUNHO: [["finalizar", "✔ Finalizar contrato"]], CORRIGIR: [["corrigido", "✔ Corrigido"]].concat(pode.admin() ? [["voltar_rascunho", "↩ Voltar para RASCUNHO"]] : []), PRONTO: pode.admin() ? [["voltar_corrigir", "↩ Voltar para CORRIGIR"], ["voltar_rascunho", "↩ Voltar para RASCUNHO"]] : [], "DÉBITO EM ABERTO": [["encerrar", "Encerrar (débito resolvido)"]], CANCELADO: [["reativar", "↺ Reativar"]] }[c.situacao] || [];
    if (["RASCUNHO", "CORRIGIR", "PRONTO", "ATIVO"].includes(c.situacao)) (acs = acs.slice()).push(["cancelar", "⊘ Cancelar contrato"]);
    const p = pop(el, `<div class="gp-h">Situação · ${esc(c.codigo)}</div><p class="st-atual"><b>${esc(c.situacao)}</b> — ${esc(SIT_DICA[c.situacao] || "")}</p>
      ${acs.length ? `<div class="st-ops">${acs.map(([a, t]) => `<button type="button" class="btn sm${a === "cancelar" ? " danger" : a.startsWith("voltar") ? "" : " pri"}" data-a="${a}">${t}</button>`).join("")}</div>` : `<p class="hint">Nenhuma mudança possível por aqui.</p>`}
      ${c.situacao === "PRONTO" ? `<p class="hint">Para ativar, abra a ficha e ligue a um imóvel livre.</p>` : c.situacao === "ATIVO" ? `<p class="hint">Encerra sozinho ao registrar a saída do locatário (Imóveis).</p>` : ""}`, 300);
    $$("[data-a]", p).forEach(b => b.addEventListener("click", async () => { fecharPop(); try { if (await acaoSituacao(c, b.dataset.a)) render(); } catch (e) { falha(e); } }));
    return;
  }
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
      Object.assign(c, r); delete c._f; toast(`${CPK[k].t}: ${v || "vazio"}`); gRedesenhar("contratos8");
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
  const f = c ? fichaDe(c) : { situacao: "RASCUNHO", fins: "RESIDENCIAIS", garantia: "FIADOR", prazo: OPC.prazo[2], end_cidade: "Monte Mor/SP", lcd_qtd: "1", lct_qtd: "1",
    test1_nome: "Linyston Luiz Cavallaro", test1_rg: "35.116.648-8", test1_cpf: "406.955.348-74", test2_nome: "André Cesar Filietaz", test2_rg: "29.257.356-X", test2_cpf: "380.827.298-80",
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
        <label class="fl"><span>Código${novo ? " (rascunho: o número vem ao Finalizar)" : ""}</span><input name="codigo" value="${esc(c ? c.codigo : proximoRascunho())}" placeholder="L.26.001" ${novo ? "" : "disabled"}></label>
        ${["fins", "data_contrato", "inicio", "termino", "prazo", "dia_venc", "valor", "valor_ext"].map(k => campoHTML(CPK[k], f[k] || "", dis)).join("")}
        <label class="fl largo"><span>Pasta do contrato no Google Drive (link)</span><input name="pasta" value="${esc(c ? c.pasta_url || "" : "")}" placeholder="https://drive.google.com/drive/folders/…  (copie o link da pasta no Drive)" ${dis}></label>
        </div>
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
  const secs = c ? [["res", "Resumo"]].concat(SECS) : SECS;
  if (c) {
    const lcd = nomesCtt(c, "lcd"), lct = nomesCtt(c, "lct"), fdr = nomesCtt(c, "fdr"), ir = k => `data-ir-aba="${k}" role="button" tabindex="0"`;
    const linha = (t, k, html) => `<div class="res-l"><span class="res-t">${t}</span><div class="res-v">${html || `<span class="muted">—</span>`}<button type="button" class="btn sm" ${ir(k)}>dados completos ›</button></div></div>`;
    sec.res = `<div class="res-2col"><div class="ctt-res">
      ${linha("Imóvel", "imv", tagImv(im ? im.endereco : f.end_rua, endImovelFicha(f, c)) + (im ? ` <small class="muted">${esc((STATUS_IMV[im.status] || [im.status])[0])}</small>` : ""))}
      ${linha("Locadores", "lcd", tagsLoc(locadoresDoCtt(c)))}
      ${linha("Locatários", "lct", tagPes(lct.length ? lct : [c.locatario], "etq-lct"))}
      ${garDe(c) === "caucao" ? linha("Caução", "gar", f.caucao_valor ? `<b>R$ ${esc(f.caucao_valor)}</b> ${f.caucao_conta ? `<small class="muted">${esc(f.caucao_conta)}</small>` : ""}` : "") : linha("Fiadores", "fdr", tagPes(fdr, "etq-fdr"))}
      <div class="res-l"><span class="res-t">Contrato</span><div class="res-v">${tagCtt(c.codigo)} · ${esc(f.garantia || "")} · aluguel <b>${f.valor ? "R$ " + esc(f.valor) : "—"}</b> · ${esc(f.inicio || "?")} a ${esc(f.termino || "?")}${f.dia_venc ? " · dia " + esc(String(f.dia_venc).split(" (")[0]) : ""}<button type="button" class="btn sm" ${ir("ctt")}>dados completos ›</button></div></div></div>
      <div class="res-dir"><div class="res-t">Observações</div>${obsLinhas(f.obs).length ? `<ul class="obs-lista">${obsLinhas(f.obs).map(o => `<li>${esc(o)}</li>`).join("")}</ul>` : `<p class="muted">Sem observações.</p>`}${dis ? "" : `<button type="button" class="btn sm" ${ir("st")}>editar observações ›</button>`}</div></div>`;
  }
  return `${barraSituacao(c, dis)}<div class="abas ficha-abas">${secs.map(([k, t], i) => `<button type="button" class="aba${i ? "" : " on"}" data-aba="${k}">${t}</button>`).join("")}</div>
    ${secs.map(([k], i) => `<div class="ficha-sec" data-sec="${k}"${i ? " hidden" : ""}>${sec[k]}</div>`).join("")}
    ${pode.editar() ? `<div class="box mapa-opc"><div class="mapa-h"><b>Mapa do aluguel</b>
        ${c && ["PRONTO", "ATIVO"].includes(c.situacao) ? `<div class="seg"><button type="button" data-mapa="nao" class="on">Não mexer no mapa</button><button type="button" data-mapa="sim">Ligar a um imóvel LIVRE do mapa</button></div>` : `<span class="hint">Só um contrato <b>PRONTO</b> pode ser ligado a um imóvel (e aí vira ATIVO).</span>`}</div>
        <div data-mapa-prev class="hint">${atual}</div></div>` : ""}`;
}
// v14: situação no alto da ficha, com os botões do caminho permitido
const SIT_DICA = { RASCUNHO: "ainda sem número de contrato", CORRIGIR: "numerado; falta alguém conferir", PRONTO: "conferido; falta ligar a um imóvel livre", ATIVO: "ligado ao imóvel; só sai daqui pela saída do locatário (ou cancelando)",
  "DÉBITO EM ABERTO": "locatário saiu devendo", ENCERRADO: "não muda mais", CANCELADO: "pode ser reativado" };
// observações: uma por linha (como no Excel)
const obsLinhas = t => { t = String(t || "").trim(); if (!t || t === "---") return [];
  return t.split(/\r?\n|(?:^|\s)-\s+(?=[A-ZÀ-Ú0-9(“"])/).map(x => x.trim().replace(/^[-–•]\s*/, "")).filter(Boolean); };
function barraSituacao(c, dis) {
  const st = c ? c.situacao : "RASCUNHO", f = c ? fichaDe(c) : {}, ed = !dis && !!c;
  const b = (a, t, cls, dica) => `<button type="button" class="btn sm ${cls || ""}" data-sit-acao="${a}" title="${esc(dica || "")}">${t}</button>`;
  const bts = !ed ? "" : [
    st === "RASCUNHO" ? b("finalizar", "✔ Finalizar contrato", "pri", "Dá o número definitivo (L.26.xxx) e coloca você na redação") : "",
    st === "CORRIGIR" ? b("corrigido", "✔ Corrigido", "pri", "Coloca você na correção e o contrato fica PRONTO") : "",
    st === "DÉBITO EM ABERTO" ? b("encerrar", "Encerrar (débito resolvido)", "", "O débito foi pago ou resolvido") : "",
    st === "CANCELADO" ? b("reativar", "↺ Reativar", "", "Volta ao que era antes do cancelamento (ativo só se o imóvel estiver livre)") : "",
    pode.admin() && st === "PRONTO" ? b("voltar_corrigir", "↩ Voltar para CORRIGIR", "", "Só administrador") : "",
    pode.admin() && ["PRONTO", "CORRIGIR"].includes(st) ? b("voltar_rascunho", "↩ Voltar para RASCUNHO", "", "Só administrador · mantém o número do contrato") : "",
    ["RASCUNHO", "CORRIGIR", "PRONTO", "ATIVO"].includes(st) ? b("cancelar", "⊘ Cancelar contrato", "danger") : ""].join("");
  const enc = ["ENCERRADO", "DÉBITO EM ABERTO", "CANCELADO"].includes(st);
  return `<div class="ctt-sit"><span class="ctt-sit-l">Situação</span><span class="tag ${SIT_CTT[st] || "idle"}">${esc(sitTxt(st))}</span><small class="muted">${esc(SIT_DICA[st] || "")}${c && (f.redacao || f.correcao) ? ` · redação: <b>${esc(f.redacao || "—")}</b> · correção: <b>${esc(f.correcao || "—")}</b>` : ""}</small>
    <label class="ctt-enc"${enc ? "" : " hidden"}><span>Encerrado em</span><input type="date" name="data_enc" value="${esc(c ? c.data_encerramento || "" : "")}" title="Para contratos antigos, digite a data. Nos novos ela vem da saída do locatário." ${dis}></label>
    <span class="spacer"></span>${bts}</div>`;
}
async function acaoSituacao(c, acao, form, d) {
  const im = S.imoveis.find(i => i.contrato_codigo === c.codigo);
  let stImv = null;
  if (acao === "cancelar") {
    if (im) {
      stImv = await new Promise(res => { let v = null; modal({ titulo: "Cancelar contrato " + c.codigo, ok: "Cancelar o contrato",
        corpo: `<div class="box bad">O contrato está ligado ao imóvel <b>${esc(im.endereco)}</b>${im.locatario ? ` (${esc(im.locatario)})` : ""}. Ao cancelar, o imóvel é <b>desligado</b> do contrato <b>sem registrar saída</b> do locatário (nada vai para Cobrança).</div>
          <p><b>Como o imóvel fica?</b></p><div class="chips">${[["LVR", "Livre"], ["OCP", "Ocupado"], ["INTV", "Inativo"]].map(([k, t]) => `<label class="chk"><input type="radio" name="st" value="${k}"> ${t}</label>`).join("")}</div>
          <label class="chk" style="margin-top:10px"><input type="checkbox" name="conf"> Confirmo: cancelar o contrato ${esc(c.codigo)} e desligar o imóvel.</label>`,
        aoFechar: () => res(v), salvar: async fm => { const x = $$("[name=st]", $("#dlg")).find(r => r.checked); if (!x) throw new Error("Escolha como o imóvel fica."); if (!fm.conf.checked) throw new Error("Marque a confirmação."); v = x.value; } }); });
      if (!stImv) return false;
    } else if (!(await confirmar("Cancelar contrato", `Cancelar o contrato <b>${esc(c.codigo)}</b>${c.locatario ? ` (${esc(c.locatario)})` : ""}? Depois dá para reativar.`, "Cancelar o contrato"))) return false;
  }
  if (acao === "reativar" && !(await confirmar("Reativar contrato", `Reativar o contrato <b>${esc(c.codigo)}</b>? ${c.ficha && c.ficha._sit_antes && c.ficha._sit_antes !== "ATIVO" ? `Ele volta para <b>${esc(c.ficha._sit_antes)}</b>.` : c.imovel_id ? `Ele volta a ser <b>ATIVO</b> e o imóvel <b>${esc((S.imovelPor[c.imovel_id] || {}).endereco || "")}</b> (precisa estar livre) volta a ser alugado.` : "Ele volta para PRONTO (falta ligar a um imóvel)."}`, "Reativar"))) return false;
  if (acao.startsWith("voltar_")) {
    const para = acao === "voltar_corrigir" ? "CORRIGIR" : "RASCUNHO";
    const ok = await new Promise(res => { let v = false; modal({ titulo: `Voltar ${c.codigo} para ${para}`, ok: `Voltar para ${para}`,
      corpo: `<div class="box warn">O contrato <b>${esc(c.codigo)}</b> sai de <b>${esc(c.situacao)}</b> e volta para <b>${para}</b>. ${para === "CORRIGIR" ? "A correção é apagada: alguém precisa conferir de novo." : "Redação e correção são apagadas; o número do contrato continua o mesmo."} Fica anotado nas observações.</div>
        <label class="chk"><input type="checkbox" name="conf"> Confirmo que preciso voltar este contrato.</label>`,
      aoFechar: () => res(v), salvar: async fm => { if (!fm.conf.checked) throw new Error("Marque a confirmação."); v = true; } }); });
    if (!ok) return false;
  }
  if (acao === "encerrar" && !(await confirmar("Encerrar contrato", `O débito do contrato <b>${esc(c.codigo)}</b> foi resolvido? O contrato passa para <b>ENCERRADO</b> e não muda mais.`, "Encerrar"))) return false;
  if (acao === "finalizar" && !(await confirmar("Finalizar contrato", `O rascunho <b>${esc(c.codigo)}</b> vai ${ehRascunho(c.codigo) ? "receber o próximo número de contrato" : "manter o número"} e ficar <b>CORRIGIR</b>, com a redação em seu nome (<b>${esc(meuQuem())}</b>).`, "Finalizar"))) return false;
  const novo = await rpc("contrato_acao", { p_codigo: c.codigo, p_acao: acao, p_status_imovel: stImv });
  toast({ voltar_corrigir: "O contrato voltou para CORRIGIR.", voltar_rascunho: "O contrato voltou para RASCUNHO.", finalizar: `Contrato finalizado: ${novo}.`, corrigido: "Corrigido: o contrato está PRONTO.", cancelar: "Contrato cancelado.", reativar: "Contrato reativado.", encerrar: "Contrato encerrado." }[acao]);
  CTT = await fetchAll("contratos", b => b.order("codigo", { ascending: false })); await recarregarImoveis();
  return novo || c.codigo;
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
  $$("[data-ir-aba]", d).forEach(b => b.addEventListener("click", () => { const a = $(`.ficha-abas [data-aba="${b.dataset.irAba}"]`, d); if (a) a.click(); }));
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
    const smb = $("[data-mapa=sim]", d), sim = !!(smb && smb.classList.contains("on"));
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
  if (!/^L\.\d{2}\.\d{3}$/.test(codigo) && !ehRascunho(codigo)) throw new Error("Código no formato L.26.001 (digite só os números: 26001), ou deixe o número de rascunho.");
  const ficha = lerFicha(d, c ? fichaDe(c) : {});
  if (novo) { ficha.situacao = ehRascunho(codigo) ? "RASCUNHO" : "CORRIGIR"; if (!ehRascunho(codigo)) ficha.redacao = meuQuem(); }
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
    if (!["PRONTO", "ATIVO"].includes(salvo.situacao)) throw new Error(`Contrato salvo, mas não foi ligado ao imóvel: ele está ${salvo.situacao}. Só um contrato PRONTO vira ATIVO.`);
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
      $$("[data-sit-acao]", d).forEach(b => b.addEventListener("click", async () => {
        b.disabled = true; b.textContent = "⏳ " + b.textContent.replace(/^\S+\s/, "");
        try { await salvarContrato(f, d, c); } catch (e) { b.disabled = false; return toast("Antes, corrija a ficha: " + erroMsg(e), true); }
        d.close();
        try { const cod = await acaoSituacao(c, b.dataset.sitAcao, f, d); render(); setTimeout(() => ACT["ctt-ed"]({ dataset: { id: cod || c.codigo } }), 300); }
        catch (e) { falha(e); setTimeout(() => ACT["ctt-ed"]({ dataset: { id: c.codigo } }), 300); }
      }));
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
const meuQuem = () => norm(String((S.membro && (S.membro.nome || S.membro.email)) || "").split(/[ @]/)[0]).toUpperCase();
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
        <button type="button" class="btn sm" data-ga="rascunho-sistema" title="Guarda no sistema como Rascunho, com número de rascunho (não usa número de contrato)">📝 Salvar rascunho</button>
        <button type="button" class="btn sm pri" data-ga="salvar" title="Contrato completo: grava no sistema com o número definitivo">💾 Salvar no sistema</button><button type="button" class="btn sm pri" data-ga="word">📄 Gerar contrato (Word)</button>`;
      $(".dlg-h", d).insertBefore(bar, $(".dlg-h .x", d));
      $$("[data-ga]", bar).forEach(b => b.addEventListener("click", () => fr.contentWindow.postMessage({ tipo: "acao", acao: b.dataset.ga }, "*")));
      // fechar com algo digitado: pergunta antes (X ou Esc)
      const perguntar = ev => {
        if (!st.sujo) return;
        ev.preventDefault(); ev.stopImmediatePropagation();
        const box = $("[data-sair]", d); box.hidden = false;
        box.innerHTML = `<div class="ger-sair-c"><h3>Fechar o gerador?</h3><p>Você começou a preencher este contrato. O que fazer com ele?</p>
          <button type="button" class="btn pri" data-s="sistema">📝 Salvar rascunho no sistema</button>
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
      await q(sb.from("contratos").insert({ codigo: cod, imovel_id: im ? im.id : null, ficha: Object.assign(novos, { situacao: "CORRIGIR", redacao: meuQuem() }) }));
    }
    // o rascunho vira o contrato definitivo: o número de rascunho some
    if (rascunho && rascunho !== cod) await q(sb.from("contratos").delete().eq("codigo", rascunho));
    CTT = await fetchAll("contratos", b => b.order("codigo", { ascending: false }));
    $("#dlg").dataset.mudou = "1";
    avisar(`✅ Contrato ${cod} salvo no sistema${ex ? " (ficha atualizada)" : " como CORRIGIR (redação: " + meuQuem() + ")"}${rascunho && rascunho !== cod ? ` (o rascunho ${rascunho} foi substituído)` : ""}.`);
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
      const ficha = Object.assign(novos, { situacao: "RASCUNHO", _form: form || {}, obs: novos.obs || "" });
      const im = novos.end_rua ? S.imoveis.find(i => norm(i.endereco).trim() === norm(novos.end_rua).trim()) : null;
      if (st.rascunho) await q(sb.from("contratos").update({ ficha, imovel_id: im ? im.id : null }).eq("codigo", cod));
      else await q(sb.from("contratos").insert({ codigo: cod, imovel_id: im ? im.id : null, ficha }));
      st.rascunho = cod;
      avisar(`📝 Rascunho salvo no sistema como ${cod}. O número definitivo vem quando você clicar em "Salvar no sistema" aqui ou em "Finalizar contrato" na ficha.`);
      toast(`Rascunho salvo como ${cod}.`);
    }
    CTT = await fetchAll("contratos", b => b.order("codigo", { ascending: false }));
    $("#dlg").dataset.mudou = "1"; st.sujo = false;
    return true;
  } catch (e) { avisar("⚠️ Não foi salvo: " + erroMsg(e)); falha(e); return false; }
}
ACT["xls-ctt"] = () => exportarGrade("contratos8", `contratos-${hoje()}.xlsx`, "Contratos");

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
  if (aba === "prestadores") await carregarForn();
  if (aba === "formulario") S.cfgCad = await q(sb.from("config").select("valor").eq("chave", "cadastro_token").maybeSingle()).catch(() => null);
  setRd(pg, () => desenharConfig());
  desenharConfig(pg);
};
function desenharConfig(pg) {
  pg = pg || $("#page");
  let aba = S.f.cfg || "usuarios"; if (aba === "contas") aba = "usuarios";
  const abas = [["usuarios", "Usuários e contas"], ["categorias", "Plano de contas"], ["prestadores", "Prestadores e lojas"], ["fechamento", "Fechamento"], ["site", "Link do site"], ["formulario", "Formulário do cliente"], ["auditoria", "Auditoria"]];
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
    const recRank = c => !c.recorrente ? 2 : c.periodicidade === "anual" ? 1 : 0;
    const ordem = c => `${recRank(c)}${ehEnt(c) ? 0 : 1}${c.nome}`;
    const fr = S.f.catRec || "", bq = norm(S.f.catBusca || "");
    const recK = c => ["mensal", "anual", "extra"][recRank(c)];
    const base = S.categorias.filter(c => c.grupo !== "transferencia" && (!ft || (ft === "entrada" ? ehEnt(c) : !ehEnt(c))));
    const lista = base.filter(c => (!fr || recK(c) === fr) && (!bq || norm(c.nome + " " + (GRUPOS[c.grupo] || "")).includes(bq)));
    const cols = [{ k: "ord", t: "Ordem", oculta: true, v: ordem }].concat(COLS_CATS);
    const grupoTit = c => `${["Mensais (previstas todo mês)", "Anuais (previstas no mês escolhido)", "Extraordinárias (lançadas quando acontecem)"][recRank(c)]} · ${ehEnt(c) ? "entradas" : "saídas"}`;
    const at = lista.filter(x => x.ativa), inat = lista.filter(x => !x.ativa);
    const g1 = grade("categorias3", cols, at, { attr: x => `data-act="cat-ed" data-id="${x.id}" style="cursor:pointer"`, sort: { k: "ord", dir: "asc" }, divisor: { k: "ord", g: grupoTit } }); g1.redesenhar = () => desenharConfig();
    const g2 = grade("categorias2-inat", cols, inat, { attr: x => `data-act="cat-ed" data-id="${x.id}" style="cursor:pointer"`, cls: () => "inativa", vazio: "Nenhuma." }); g2.redesenhar = () => desenharConfig();
    const nR = k => base.filter(c => c.ativa && (!k || recK(c) === k)).length;
    html = `<div class="filters"><div class="fgrupo"><span>Tipo</span>${[["", "Todas"], ["entrada", "Entradas"], ["saida", "Saídas"]].map(([k, t]) => `<button class="chip${ft === k ? " on" : ""}" data-act="chip" data-k="catTipo" data-v="${k}">${t}</button>`).join("")}</div>
      <div class="fgrupo"><span>Recorrência</span>${[["", "Todas"], ["mensal", "Mensais"], ["anual", "Anuais"], ["extra", "Extraordinárias"]].map(([k, t]) => `<button class="chip${fr === k ? " on" : ""}" data-act="chip" data-k="catRec" data-v="${k}">${t}<span class="c">${nR(k)}</span></button>`).join("")}</div>
      <input type="search" placeholder="Procurar categoria…" value="${esc(S.f.catBusca || "")}" data-busca="catBusca" style="width:200px">
      <span class="hint">Mensais e anuais com valor entram sozinhas no Caixa como previstas ao virar o mês.</span><span class="spacer"></span>${gradeBarra("categorias3")}<button class="btn pri" data-act="cat-ed">+ Categoria</button></div>
      ${gradeHTML("categorias3")}${inat.length ? `<h3 style="margin-top:10px;color:var(--bad)">Inativas (${inat.length})</h3><div class="inativas">${gradeHTML("categorias2-inat")}</div>` : ""}`;
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
  } else if (aba === "site") {
    const atual = S.siteUrl || CFG.SITE_IMOVEL_URL || SITE_PADRAO, cod = S.f.siteTeste || "1092";
    html = `<div class="card"><h2>Link do imóvel no site</h2>
      <p>O número azul da coluna <b>Site</b> abre o imóvel no site da imobiliária. Como o site monta o endereço com o nome do bairro (ex.: <span class="mono">/1092-casa-em-monte-mor-bairro-parque-residencial-figueira-iii.html</span>), o app precisa de um modelo que funcione só com o código.</p>
      <p><b>Como achar o modelo certo:</b> digite um código abaixo e clique em <b>Testar</b> em cada linha. A que abrir o imóvel certo, clique em <b>Usar este</b>. Se nenhuma funcionar, faça uma busca pelo código no próprio site, copie o endereço da página de <b>resultados da busca</b> (antes de clicar no imóvel), cole no campo "Outro modelo" e troque o número por <span class="mono">{codigo}</span>.</p>
      <div class="filters"><label class="fl" style="max-width:160px"><span>Código para testar</span><input data-site-cod value="${esc(cod)}" inputmode="numeric"></label></div>
      <table class="compacta site-t"><tbody>${SITE_MODELOS.map(m => `<tr class="${m === atual ? "em-uso" : ""}"><td class="mono site-url">${esc(m)}</td><td class="site-st">${m === atual ? `<span class="tag ok">em uso</span>` : ""}</td>
        <td class="site-b"><a class="btn sm" href="${esc(urlSite(cod, m))}" target="_blank" rel="noopener">Testar</a> <button class="btn sm${m === atual ? "" : " pri"}" data-act="site-usar" data-v="${esc(m)}" ${m === atual ? "disabled" : ""}>Usar este</button></td></tr>`).join("")}</tbody></table>
      <div class="filters" style="margin-top:12px"><label class="fl" style="flex:1"><span>Outro modelo (use {codigo} no lugar do número)</span><input data-site-outro value="${SITE_MODELOS.includes(atual) ? "" : esc(atual)}" placeholder="https://imobiliariabandeirantes.com.br/...{codigo}..."></label>
      <button class="btn" data-act="site-testar-outro">Testar</button><button class="btn pri" data-act="site-usar-outro">Usar este</button></div>
      <p class="hint">Em uso agora: <span class="mono">${esc(atual)}</span></p></div>`;
  } else if (aba === "prestadores") {
    html = `<div id="cfg-forn"></div>`;
  } else if (aba === "formulario") {
    const tk = (S.cfgCad && S.cfgCad.valor) || "";
    html = `<div class="card"><h2>Formulário do cliente → Cadastros recebidos</h2>
      <p>O cliente preenche o formulário de locação (link que vocês já mandam) e clica em <b>Enviar para a imobiliária</b>. Os documentos e o PDF vão para uma pasta no <b>Google Drive da imobiliária</b> e o cadastro aparece em <b>Contratos › 📥 Cadastros recebidos</b>.</p>
      <p>Quem faz a ponte é um pequeno programa do Google (Apps Script) na conta da imobiliária. O passo a passo está no pacote, pasta <b>7-formulario-cliente</b>. Na hora de configurar ele vai pedir estes dois dados:</p>
      ${btnCopiar("Endereço do sistema (SUPABASE_URL)", CFG.SUPABASE_URL || "")}${btnCopiar("Código secreto do formulário (CADASTRO_TOKEN)", tk)}
      <p class="hint">O código secreto só fica aqui e no programa do Google: <b>nunca</b> coloque no formulário nem no GitHub. Se ele vazar, clique em “Gerar outro código” e atualize no programa do Google.</p>
      <div class="filters"><button class="btn danger" data-cad-novotk>Gerar outro código</button></div></div>`;
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
  ligarBusca(pg);
  if (aba === "prestadores") desenharForn($("#cfg-forn", pg));
  $$("[data-copiar]", pg).forEach(b => b.addEventListener("click", async () => { try { await navigator.clipboard.writeText(b.dataset.copiar); const t = b.textContent; b.textContent = "✔ Copiado"; setTimeout(() => (b.textContent = t), 1200); } catch (e) { toast("Não consegui copiar: selecione e use Ctrl+C.", true); } }));
  const ntk = $("[data-cad-novotk]", pg); if (ntk) ntk.addEventListener("click", async () => {
    if (!(await confirmar("Gerar outro código", "O formulário para de funcionar até você colar o código novo no programa do Google (CADASTRO_TOKEN). Continuar?", "Gerar"))) return;
    const a = new Uint8Array(24); crypto.getRandomValues(a); const tk = Array.from(a, b => b.toString(16).padStart(2, "0")).join("");
    try { await q(sb.from("config").upsert({ chave: "cadastro_token", valor: tk })); toast("Código novo gerado. Atualize no programa do Google."); render(); } catch (e) { falha(e); } });
  $$("[data-aud]", pg).forEach(el => el.addEventListener("change", () => { S.f.aud = Object.assign({}, S.f.aud, { [el.dataset.aud]: el.value }); render(); }));
  const sc = $("[data-site-cod]", pg); if (sc) sc.addEventListener("change", () => { siteCod(); desenharConfig(); });
}
ACT["cfg-aba"] = el => { S.f.cfg = el.dataset.v; render(); };
const siteCod = () => { const v = ($("[data-site-cod]") || {}).value; return (S.f.siteTeste = (v || "1092").trim()); };
async function siteGravar(m) {
  if (!/\{codigo\}/.test(m)) throw new Error("O modelo precisa ter {codigo} no lugar do número do imóvel.");
  if (!/^https?:\/\//.test(m)) throw new Error("O modelo precisa começar com https://");
  await q(sb.from("config").upsert({ chave: "site_url", valor: m })); S.siteUrl = m; toast("Link do site atualizado."); render();
}
ACT["site-usar"] = el => siteGravar(el.dataset.v).catch(e => toast(erroMsg(e), "bad"));
ACT["site-usar-outro"] = () => siteGravar((($("[data-site-outro]") || {}).value || "").trim()).catch(e => toast(erroMsg(e), "bad"));
ACT["site-testar-outro"] = () => { const m = (($("[data-site-outro]") || {}).value || "").trim(); if (!/\{codigo\}/.test(m)) return toast("Use {codigo} no lugar do número.", "bad"); window.open(urlSite(siteCod(), m), "_blank", "noopener"); };
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
// v15: código do contrato clicável dentro de outras janelas
const linkCtt = cod => tagCtt(cod);
function ligarLinksCtt(d) {
  $$("[data-abre-ctt]", d).forEach(b => b.addEventListener("click", async e => { e.stopPropagation(); d.close(); if (!CTT.length) CTT = await fetchAll("contratos", x => x.order("codigo", { ascending: false })); setTimeout(() => ACT["ctt-ed"]({ dataset: { id: b.dataset.abreCtt } }), 0); }));
  $$("tr[data-imv]", d).forEach(tr => tr.addEventListener("click", () => { d.close(); setTimeout(() => ACT["imv-ed"]({ dataset: { id: tr.dataset.imv } }), 0); }));
}
ACT["grupo-ed"] = el => {
  const g = (S.gruposCfg || []).find(x => x.nome === el.dataset.id) || { classe: "grande", locadores: [] };
  const usados = new Set(); (S.gruposCfg || []).forEach(x => { if (x.nome !== g.nome) (x.locadores || []).forEach(l => usados.add(l)); });
  const todos = Array.from(new Set((S.locadores || []).map(l => l.nome).concat(S.imoveis.map(i => i.locador).filter(Boolean), g.locadores || []))).sort((a, b) => a.localeCompare(b, "pt-BR"));
  // v14: abas com os dados completos das pessoas, os bancos e os imóveis do grupo
  const membros = (g.locadores || []).map(n => ({ n, l: locPor(n) || { nome: n, ficha: {} } }));
  const pessoasDe = l => { const f = l.ficha || {}; return ["lcd1", "lcd2"].filter(p => f[p + "_nome"]).map(p => ({ p, f })); };
  const linhaP = (rot, v) => v ? `<div><small>${rot}</small><span>${esc(v)}</span></div>` : "";
  const abaPessoas = membros.length ? membros.map(({ n, l }) => { const f = l.ficha || {}, ps = pessoasDe(l), end = [f.lcd_end1_rua, f.lcd_end1_bairro, f.lcd_end1_cidade].filter(Boolean).join(" – ");
    return `<div class="gl-card"><div class="gl-h"><span class="etq etq-lcd">${esc(tiraPrefixo(n))}</span><small class="muted">${esc(n)}</small></div>
      ${ps.length ? ps.map(({ p }) => `<div class="gl-p"><b>${esc(f[p + "_nome"])}</b><div class="gl-g">${linhaP("CPF/CNPJ", f[p + "_cpf"])}${linhaP("RG", [f[p + "_rg"], f[p + "_oe"]].filter(Boolean).join(" "))}${linhaP("Estado civil", f[p + "_est_civil"])}${linhaP("Profissão", f[p + "_prof"])}${linhaP("Nacionalidade", f[p + "_nac"])}${linhaP("Telefone", fmtTel(f[p + "_tel"]))}${linhaP("E-mail", f[p + "_email"])}</div></div>`).join("")
        + (end || f.lcd_regime ? `<div class="gl-g">${linhaP("Endereço", end)}${linhaP("Casamento", [f.lcd_regime, f.lcd_data_casamento].filter(Boolean).join(" · "))}</div>` : "")
        : `<p class="hint">Ficha sem as pessoas preenchidas (abra o locador em Locadores).</p>`}</div>`; }).join("") : `<p class="hint">Marque os locadores do grupo na aba Grupo.</p>`;
  const abaBanco = membros.length ? `<div class="tw"><table class="compacta"><thead><tr><th>Locador</th>${PG_CAMPOS.map(([, t]) => `<th>${esc(t)}</th>`).join("")}</tr></thead><tbody>${membros.map(({ n, l }) => `<tr><td><span class="etq etq-lcd" title="${esc(n)}">${esc(tiraPrefixo(n))}</span></td>${PG_CAMPOS.map(([k]) => `<td>${esc((l.ficha || {})[k] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="hint">Sem locadores.</p>`;
  const imvsG = S.imoveis.filter(i => (g.locadores || []).includes(i.locador)).sort((a, b) => COLL.compare(a.locador, b.locador) || COLL.compare(a.endereco, b.endereco));
  const abaImv = imvsG.length ? `<div class="tw" style="max-height:52vh"><table class="compacta"><thead><tr><th>Imóvel</th><th>Locador (dono)</th><th>Situação</th><th>Locatário</th><th>Entrada</th><th>Contrato</th><th class="num">Aluguel</th></tr></thead><tbody>${imvsG.map(i => `<tr data-imv="${i.id}" style="cursor:pointer" title="Abrir a ficha do imóvel"><td>${tagImv(i.endereco)}</td><td><span class="etq etq-lcd" title="${esc(i.locador)}">${esc(tiraPrefixo(i.locador))}</span></td><td><span class="tag ${(STATUS_IMV[i.status] || [])[1] || "idle"}">${esc((STATUS_IMV[i.status] || [i.status])[0])}</span></td><td>${i.status === "ALG" && i.locatario ? tagPes(separaNomes(i.locatario), "etq-lct", "", 2) : ""}</td><td>${i.status === "ALG" ? dt(i.data_entrada) : ""}</td><td>${linkCtt(i.contrato_codigo)}</td><td class="num">${i.valor != null ? n2(i.valor) : ""}</td></tr>`).join("")}</tbody></table></div>
    <p class="hint">${imvsG.length} imóveis · ${imvsG.filter(i => i.status === "ALG").length} alugados</p>` : `<p class="hint">Nenhum imóvel ligado aos locadores do grupo.</p>`;
  modal({ titulo: g.nome ? "Grupo de locadores · " + g.nome : "Novo grupo", xl: true, corpo: `
    ${g.nome ? `<div class="abas ficha-abas"><button type="button" class="aba on" data-ga="grp">Grupo</button><button type="button" class="aba" data-ga="pes">Pessoas (${membros.length})</button><button type="button" class="aba" data-ga="bco">Dados bancários</button><button type="button" class="aba" data-ga="imv">Imóveis (${imvsG.length})</button></div>
      <div data-gs="pes" hidden>${abaPessoas}</div><div data-gs="bco" hidden>${abaBanco}</div><div data-gs="imv" hidden>${abaImv}</div>` : ""}
    <div data-gs="grp">
    <div class="row"><label class="fl"><span>Nome do grupo</span><input name="nome" value="${esc(g.nome || "")}" required ${g.nome ? "disabled" : ""}></label>
    <label class="fl"><span>Classe</span><select name="classe">${opt("grande", "Principal locador", g.classe === "grande")}${opt("destaque", "Destaque (aparece sozinho)", g.classe === "destaque")}</select></label></div>
    <h3>Locadores deste grupo</h3><p class="hint">Marque os nomes (como estão no cadastro dos imóveis). Nomes já usados em outro grupo aparecem desabilitados.</p>
    <input type="search" placeholder="Pesquisar nome…" data-gbusca style="width:100%;border:1px solid var(--line);border-radius:6px;padding:7px 10px">
    <div class="gp-lista grupo-lista">${todos.map(l => `<label data-txt="${esc(norm(l))}"><input type="checkbox" value="${esc(l)}" ${(g.locadores || []).includes(l) ? "checked" : ""} ${usados.has(l) ? "disabled" : ""}> <span>${esc(l)}</span><small>${S.imoveis.filter(i => i.locador === l).length}</small></label>`).join("")}</div></div>`,
    extra: g.nome ? `<button type="button" class="btn danger left" data-del>Excluir grupo</button>` : "",
    aoAbrir: (f, d) => {
      ligarLinksCtt(d);
      $$("[data-ga]", d).forEach(b => b.addEventListener("click", () => { $$("[data-ga]", d).forEach(x => x.classList.toggle("on", x === b)); $$("[data-gs]", d).forEach(x => (x.hidden = x.dataset.gs !== b.dataset.ga)); }));
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
const caucSemConta = () => Object.values(CAUC.ctt).filter(c => ["ATIVO"].concat(PREPARO).includes(c.situacao) && ehCaucao(c) && !CAUC.vigPorCtt[c.codigo] && !caucDireto(c));
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
  const cands = Object.values(CAUC.ctt).filter(c => ["ATIVO"].concat(PREPARO).includes(c.situacao) && !CAUC.vigPorCtt[c.codigo]).sort((a, b) => (ehCaucao(b) - ehCaucao(a)) || COLL.compare(b.codigo, a.codigo));
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
      const ctts = Object.values(CAUC.ctt).filter(c => ["ATIVO", "DÉBITO EM ABERTO"].concat(PREPARO).includes(c.situacao));
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
const anoVenda = v => { const m = /^V\.?(\d{2})\./i.exec(String(v.codigo || "")); return m ? "20" + m[1] : (v.data || "").slice(0, 4); };
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
  { k: "codigo", t: "Venda", cls: "mono", fixo: true, w: 104, html: v => `${esc(v.codigo)}<a class="pasta" href="${esc(CFG.PASTA_LOCAL ? "imobone:" + v.codigo : (CFG.DRIVE_BUSCA || "https://drive.google.com/drive/search?q=") + encodeURIComponent(v.codigo))}"${CFG.PASTA_LOCAL ? "" : ' target="_blank" rel="noopener"'} data-pasta title="${CFG.PASTA_LOCAL ? "Abrir a pasta da venda no computador (G:\\Meu Drive\\IMOB BAND\\05-Vendas)" : "Procurar a pasta desta venda no Google Drive"}">📁</a>` },
  { k: "data", t: "Data", tipo: "data" },
  { k: "endereco", t: "Imóvel", w: 200, cls: "tags", html: v => tagImv(v.endereco, [(v.ficha || {}).imv_rua || v.endereco, (v.ficha || {}).imv_bairro, (v.ficha || {}).imv_cidade].filter(Boolean).join(" – ")) },
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
  { k: "vendedores", t: "Vendedores", w: 210, cls: "tags", html: v => tagPes(nomesParte(v.ficha || {}, "vnd").length ? nomesParte(v.ficha || {}, "vnd") : nomesLista(v.vendedores), "etq-lcd", "", 2) },
  { k: "compradores", t: "Compradores", w: 210, cls: "tags", html: v => tagPes(nomesParte(v.ficha || {}, "cmp").length ? nomesParte(v.ficha || {}, "cmp") : nomesLista(v.compradores), "etq-lct", "", 2) },
  { k: "custas", t: "Custas a reembolsar", tipo: "num", grp: "custo", v: v => totVenda(v).custasFalta || null, html: v => { const x = totVenda(v).custasFalta; return x > 0 ? `<b class="neg">${n2(x)}</b>` : ""; } },
  { k: "prev", t: "Próxima parcela", v: v => (totVenda(v).prev[0] || {}).vencimento || "", html: v => { const p = totVenda(v).prev[0]; return p ? `<span class="${p.vencimento < hoje() ? "neg" : ""}">${dt(p.vencimento)} · ${n2(p.valor)}</span>` : ""; } },
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
  const g = grade("vendas3", COLS_VEN, lista, { attr: v => `data-act="ven-ed" data-id="${v.id}" style="cursor:pointer"`, sort: { k: "codigo", dir: "desc" }, divisor: { k: "codigo", g: v => "Vendas de " + anoVenda(v) },
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
      <span class="spacer"></span>${gradeBarra("vendas3")}<button class="btn" data-act="ven-termos-menu">📄 Termos ▾</button>
      ${pode.ed("vendas") ? `<button class="btn pri" data-act="ven-ed">+ Venda</button>` : ""}
    </div>
    ${gradeHTML("vendas3")}</div>`;
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
const IMV_VEN = [["imv_rua", "Rua e nº"], ["imv_bairro", "Bairro"], ["imv_cidade", "Município/UF"], ["imv_cep", "CEP"], ["imv_matricula", "Matrícula (CRI)"], ["imv_insc", "Inscrição cadastral"], ["imv_desc", "Descrição (lote, quadra, área, benfeitorias…)"], ["imv_escritura", "Escritura até (data, ex.: 20/05/2026)"], ["imv_posse", "Posse (texto para o contrato, opcional)"]];
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
        <div class="ven-l2"><div><small>Imóvel</small><span>${imvRes !== "—" ? tagImv(imvRes, [f.imv_rua, f.imv_bairro, f.imv_cidade].filter(Boolean).join(" – ")) : "—"}</span><button type="button" class="btn sm ghost" data-ir="imv">dados completos ›</button></div>
          <div><small>Vendedores</small><span>${tagPes(nomesParte(f, "vnd").length ? nomesParte(f, "vnd") : nomesLista(v.vendedores), "etq-lcd") || "—"}</span><button type="button" class="btn sm ghost" data-ir="vnd">dados completos ›</button></div>
          <div><small>Compradores</small><span>${tagPes(nomesParte(f, "cmp").length ? nomesParte(f, "cmp") : nomesLista(v.compradores), "etq-lct") || "—"}</span><button type="button" class="btn sm ghost" data-ir="cmp">dados completos ›</button></div></div>
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
        ${integral != null ? `<p class="hint">Valor integral: ${brl(integral)}${ls.length ? ` · já lançado em outras parcelas (pagas e previstas): ${brl(ls.reduce((a, x) => a + (+x.valor || 0), 0))} · saldo: <b>${brl(integral - ls.reduce((a, x) => a + (+x.valor || 0), 0))}</b>` : ""}</p>` : ""}`,
      aoAbrir: (f, dd) => {
        mascaraMoeda(f.valor);
        const jaLanc = r2(ls.reduce((a, x) => a + (+x.valor || 0), 0)), saldo = integral != null ? r2(integral - jaLanc) : null;
        const preencher = () => { if (f.desc.value === "Valor integral" && integral != null) f.valor.value = moedaFmt(integral);
          if (f.desc.value === "Saldo" && saldo != null) { f.valor.value = saldo > 0 ? moedaFmt(saldo) : ""; if (saldo <= 0) toast("Não há saldo: as parcelas já lançadas (pagas e previstas) somam " + brl(jaLanc) + ".", "bad"); } };
        f.desc.addEventListener("change", preencher); if (!i.id && f.desc.value === "Saldo") preencher();
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
  { ic: "📄", k: "contrato", t: "Contrato de venda (Word)", d: "compromisso de venda e compra com os dados da ficha" },
  { ic: "🧾", k: "recibo", t: "Recibo de parcela", d: "vendedor recebe do comprador" },
  { ic: "💼", k: "recibo_com", t: "Recibo de comissão", d: "imobiliária recebe a comissão" },
  { ic: "🏦", k: "primeiro", t: "Declaração de primeiro imóvel", d: "financiamento · art. 290 Lei 6.015/73" },
  { ic: "✍️", k: "renuncia", t: "Renúncia ao direito de preferência", d: "locatário do imóvel · art. 27 Lei 8.245/91" }
];
async function escolherVenda(titulo) {
  if (!VEN || !VEN.length) { VEN = await q(sb.from("vendas").select("*").order("codigo", { ascending: false })); }
  const it = VEN.map(v => ({ v, busca: [v.codigo, v.endereco, v.vendedores, v.compradores].join(" "), html: `<span class="mono esc-cod">${esc(v.codigo)}</span>${v.endereco ? `<span class="etq etq-imv">🏠 ${esc(rotuloImv(v.endereco))}</span>` : ""}${tagPes(nomesLista(v.vendedores), "etq-lcd", "", 2)}<span class="muted">→</span>${tagPes(nomesLista(v.compradores), "etq-lct", "", 2)}` }));
  const r = await escolherNaLista(titulo, it, "Clique na venda. Use o filtro para diminuir a lista.");
  return r ? r.v : null;
}
ACT["ven-termos-menu"] = el => menuTermos(el, "Termos de vendas", TERMOS_VEN.map(x => ({ ic: x.ic, t: x.t, d: x.d, fn: async () => {
  const v = await escolherVenda(x.t + " · qual venda?"); if (!v) return;
  if (!VIT || !Object.keys(VIT).length) { const its = await q(sb.from("venda_itens").select("*")).catch(() => []); VIT = {}; its.forEach(i => (VIT[i.venda_id] = VIT[i.venda_id] || []).push(i)); }
  setTimeout(() => ACT["ven-termo"]({ dataset: { id: v.id, tipo: x.k } }), 0);
} })));
// ---- termos da venda: recibo de parcela, declaração de primeiro imóvel, renúncia ao direito de preferência ----
const nomesLista = s => String(s || "").split(/\s+-\s+|\s*;\s*|\s+e\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/).map(x => x.trim()).filter(Boolean);
const qualOuLinha = (q, nomes) => q ? esc(q) : `<b>${esc(nomes.join(" e ").toUpperCase())}</b>, ${lin_(60)}`;
ACT["ven-termo"] = el => {
  const v = VEN.find(x => x.id === el.dataset.id); if (!v) return;
  if (el.dataset.tipo === "contrato") return gerarContratoVenda(v).catch(falha);
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
    titulo = "Declaração de renúncia ao direito de preferência"; timbre = true;
    const f = ctt ? fichaDe(ctt) : {}, lct = ctt ? nomesGrupo(f, "lct") : [];
    html = `<h2 class="doc-tit">DECLARAÇÃO DE RENÚNCIA AO DIREITO DE PREFERÊNCIA</h2>
      <p class="doc-rec">${lct.length > 1 ? "Nós, infra-assinados" : "Eu, infra-assinado(a)"}, ${ctt ? qualifGrupo(f, "lct").replace(/, residentes? na .*$/, "") : `<b>${lin_(40)}</b>, ${lin_(60)}`}, locatário${lct.length > 1 ? "s" : "(a)"} do imóvel situado na ${esc(ctt ? endImovelFicha(f, ctt) : v.endereco)}, ${lct.length > 1 ? "declaramos" : "declaro"}, para os devidos fins, que:</p>
      <p class="doc-rec">${lct.length > 1 ? "Fomos procurados" : "Fui procurado(a)"} por ${qualParte(v, "vnd")}, proprietário(s) do imóvel locado, que ${lct.length > 1 ? "nos" : "me"} informou(aram) a intenção de vender o referido imóvel${+v.valor > 0 ? ` pelo preço de ${brl(v.valor)} (${esc(extensoReais(+v.valor).toLowerCase())})${v.forma ? `, com pagamento ${esc(v.forma.toLowerCase())}` : ""}` : ""}.</p>
      <p class="doc-rec">Em atenção ao direito de preferência previsto no art. 27 da Lei nº 8.245/91 (Lei do Inquilinato), ${lct.length > 1 ? "declaramos que não temos" : "declaro que não tenho"} interesse na aquisição do imóvel, motivo pelo qual ${lct.length > 1 ? "renunciamos" : "renuncio"} expressamente a qualquer direito de preferência, autorizando o proprietário a vendê-lo a terceiros, pelo preço e nas condições que entender convenientes, sem prejuízo da locação em vigor.</p>
      <p class="doc-rec">Por ser expressão da verdade e para que produza os efeitos legais, ${lct.length > 1 ? "firmamos" : "firmo"} a presente declaração na presença de duas testemunhas.</p>
      <p class="doc-data">${esc(TIMBRE.cidade)}/SP, ${dataExt(hoje())}.</p>${ass(lct.length ? lct : ["Locatário(a)"])}
      <p style="margin-top:24px"><b>Testemunhas:</b></p>${ass([f.test1_nome || "", f.test2_nome || ""])}`;
  }
  abrirDocEditavel(titulo + " · " + v.codigo, html, { semTimbre: !timbre, clientes: tipo === "recibo_com" ? vend : [], papelCliente: "Vendedor(a)" });
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
    html = `<div class="filters"><span class="hint">Cada grupo junta locadores da mesma família ou empresa. As setas ↑ ↓ só mudam a <b>ordem em que os grupos aparecem nos gráficos do Dashboard</b>. "Destaque" aparece separado nos gráficos; "Principal locador" entra em "Principais locadores". Para ver os locadores dentro de cada grupo, use <b>🗂 Agrupar por grupo</b> na aba Locadores.</span><span class="spacer"></span>${gradeBarra("grupos")}${pode.ed("locadores") ? `<button class="btn pri" data-act="grupo-ed">+ Grupo</button>` : ""}</div>${gradeHTML("grupos")}`;
  } else {
    const teste = { ativos: l => l.ativo, incompletos: l => l.ativo && !fichaLocCompleta(l), semimovel: l => l.ativo && !S.imoveis.some(i => i.locador === l.nome), parados: l => { const ims = S.imoveis.filter(i => i.locador === l.nome); return l.ativo && ims.length && ims.every(i => i.status === "OCP" || i.status === "INTV"); }, inativos: l => !l.ativo, todos: () => true };
    let lista = (S.locadores || []).filter(teste[f] || teste.ativos);
    if (busca) { const b = norm(busca); lista = lista.filter(l => norm([l.nome, l.cpf_cnpj, l.tel, l.email, grupoDoLoc(l.nome), JSON.stringify(l.ficha || {})].join(" ")).includes(b)); }
    const agr = S.f.locAgr === "1";
    const g = grade("locadores", COLS_LOC, lista, { attr: l => `data-act="loc-ed" data-id="${l.id}" style="cursor:pointer"`, sort: agr ? { k: "grupo", dir: "asc" } : { k: "nome", dir: "asc" }, rodape: fl => `${fl.length} locadores`,
      divisor: agr ? { k: "grupo", g: l => grupoDoLoc(l.nome) ? "Grupo " + grupoDoLoc(l.nome) : "Sem grupo" } : undefined });
    if (agr) g.sort = { k: "grupo", dir: "asc" }; else if (g.sort && g.sort.k === "grupo") g.sort = { k: "nome", dir: "asc" };
    g.redesenhar = () => desenharLocadores();
    html = `<div class="filters"><div class="fgrupo"><span>Mostrar</span>${[["ativos", "Ativos"], ["incompletos", "Ficha incompleta"], ["semimovel", "Sem imóvel"], ["parados", "Só imóveis inativos/ocupados"], ["inativos", "Inativos"], ["todos", "Todos"]].map(([k, t]) => `<button class="chip${f === k ? " on" : ""}" data-act="chip" data-k="loc" data-v="${k}">${t}<span class="c">${(S.locadores || []).filter(teste[k]).length}</span></button>`).join("")}</div>
      <button class="btn" data-act="loc-conferir" title="Mostra nomes de locador usados em imóveis e contratos que não batem com o título de nenhum locador">🏷 Conferir etiquetas</button>
      <button class="chip${S.f.locAgr === "1" ? " on" : ""}" data-act="chip" data-k="locAgr" data-v="${S.f.locAgr === "1" ? "" : "1"}" title="Mostra os locadores separados por grupo (família/empresa)">🗂 Agrupar por grupo</button>
      <input type="search" placeholder="Buscar nome, CPF, telefone…" value="${esc(busca)}" data-busca="locBusca"><span class="spacer"></span>${gradeBarra("locadores")}
      ${pode.ed("locadores") ? `<button class="btn" data-act="loc-puxar" title="Copia os dados dos locadores (nomes, CPF, RG, endereço, casamento) dos contratos dos imóveis de cada um">⇣ Completar com os contratos</button><button class="btn pri" data-act="loc-ed">+ Locador</button>` : ""}</div>
      ${gradeHTML("locadores")}
      <p class="hint">O <b>título</b> é o nome curto usado no mapa e nos relatórios (ex.: “Breno, Murilo e Renan Quitzau”). Dentro da ficha ficam os dados completos de cada pessoa, iguais aos do contrato. Recibos e documentos usam os nomes completos.</p>`;
  }
  pg.innerHTML = `<div class="grid"><div class="seg cobr-abas"><a href="#" data-act="chip" data-k="locAba" data-v="locadores" class="${aba !== "grupos" ? "on" : ""}">Locadores</a><a href="#" data-act="chip" data-k="locAba" data-v="grupos" class="${aba === "grupos" ? "on" : ""}">Grupos de locadores</a></div>${html}</div>`;
  ligarBusca(pg);
}
// v16: conferência — todo nome de locador precisa bater com um título do cadastro (a etiqueta)
ACT["loc-conferir"] = async () => {
  if (!CTT.length) CTT = await fetchAll("contratos", b => b.order("codigo", { ascending: false }));
  const semImv = S.imoveis.filter(i => i.locador && !(S.locadores || []).some(l => l.nome === i.locador));
  const ctts = CTT.filter(c => ["ATIVO", "RASCUNHO", "CORRIGIR", "PRONTO"].includes(c.situacao)).map(c => ({ c, ns: nomesCtt(c, "lcd").filter(n => !locResolve(n)), im: imvDoCtt(c) })).filter(x => x.ns.length);
  const dif = CTT.filter(c => c.situacao === "ATIVO").map(c => { const im = imvDoCtt(c), ls = nomesCtt(c, "lcd").map(locResolve).filter(Boolean); return { c, im, ls }; })
    .filter(x => x.im && x.im.locador && x.ls.length && !x.ls.some(l => l.nome === x.im.locador));
  modal({ titulo: "Conferir etiquetas de locadores", xl: true, semOk: true, corpo: `
    <p class="hint">A etiqueta de um locador é o <b>título</b> do cadastro de locadores. Aqui aparecem os nomes que não batem com nenhum título (nem com os nomes completos das pessoas da ficha). Ajuste o nome no imóvel/contrato ou complete a ficha do locador.</p>
    <h3>Imóveis com locador fora do cadastro (${semImv.length})</h3>${semImv.length ? `<div class="tw" style="max-height:220px"><table class="compacta"><tbody>${semImv.map(i => `<tr><td>${tagImv(i.endereco)}</td><td>${tagLoc(i.locador)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Nenhum. ✔</p>`}
    <h3>Contratos com locador que não está no cadastro (${ctts.length})</h3>${ctts.length ? `<div class="tw" style="max-height:240px"><table class="compacta"><thead><tr><th>Contrato</th><th>Nome no contrato</th><th>Imóvel</th><th>Locador do imóvel</th></tr></thead><tbody>${ctts.map(x => `<tr><td>${tagCtt(x.c.codigo)}</td><td>${x.ns.map(n => `<span class="etq etq-conf">${esc(n)}</span>`).join("")}</td><td>${x.im ? tagImv(x.im.endereco) : ""}</td><td>${x.im ? tagLoc(x.im.locador) : ""}</td></tr>`).join("")}</tbody></table></div><p class="hint">Dica: abra o locador do imóvel e coloque o nome completo da pessoa na aba Pessoas — aí o nome do contrato passa a apontar para a mesma etiqueta.</p>` : `<p class="muted">Nenhum. ✔</p>`}
    <h3>Contratos cujo locador é outro título que não o do imóvel (${dif.length})</h3>${dif.length ? `<div class="tw" style="max-height:220px"><table class="compacta"><thead><tr><th>Contrato</th><th>Pelo contrato</th><th>Pelo imóvel</th></tr></thead><tbody>${dif.map(x => `<tr><td>${tagCtt(x.c.codigo)}</td><td>${x.ls.map(l => tagLoc(l.nome)).join("")}</td><td>${tagImv(x.im.endereco)} ${tagLoc(x.im.locador)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Nenhum. ✔</p>`}` });
};
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
    <td class="trunc">${esc(i.status === "ALG" ? i.locatario || "" : "")}</td><td>${i.status === "ALG" ? dt(i.data_entrada) : ""}</td><td>${linkCtt(i.contrato_codigo)}</td><td>${i.dia_venc ? "dia " + i.dia_venc : ""}</td><td class="num">${i.valor ? n2(i.valor) : ""}</td><td class="num">${i.taxa_adm != null ? n2(i.taxa_adm) + "%" : ""}</td></tr>`;
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
    extra: (l.id && pode.editar() ? `<button type="button" class="btn" data-novoctt title="Abre o gerador de contratos já com os dados deste locador">📄 Novo contrato com este locador</button>` : "") + (l.id && pode.editar() && ims.length ? `<button type="button" class="btn" data-int title="Contrato de intermediação e administração com todos os imóveis deste locador">🤝 Contrato de intermediação</button>` : "") + (l.id && pode.admin() && !ims.length ? `<button type="button" class="btn danger" data-del>Excluir</button>` : ""),
    aoAbrir: (fm, d) => { const bInt = $("[data-int]", d); if (bInt) bInt.addEventListener("click", () => { d.close(); setTimeout(() => gerarIntermediacao(l).catch(falha), 30); });
      $$(".ficha-abas .aba", d).forEach(b => b.addEventListener("click", () => { $$(".ficha-abas .aba", d).forEach(x => x.classList.toggle("on", x === b)); $$(".ficha-sec", d).forEach(s => (s.hidden = s.dataset.sec !== b.dataset.aba)); }));
      $$("[data-f]", d).forEach(x => { const t = CPK[x.dataset.f].tipo; if (t === "tel") mascaraTel(x); if (t === "doc") mascaraDoc(x); });
      ligarLinksCtt(d);
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
  { k: "especialidade", t: "Serviço / ramo", cls: "trunc" },
  { k: "tel", t: "Telefone", f: x => fmtTel(x.tel) },
  { k: "pix", t: "PIX", cls: "trunc", oculta: true },
  { k: "obs", t: "Obs.", cls: "trunc", oculta: true }
];
async function carregarForn() {
  const [, ls] = await Promise.all([recarregarLocadores(), q(sb.from("lancamentos").select("fornecedor_id,valor").not("fornecedor_id", "is", null).gte("data", iso(new Date(Date.now() - 365 * 86400000)))).catch(() => [])]);
  FORN_GASTO = {}; ls.forEach(l => { const g = FORN_GASTO[l.fornecedor_id] = FORN_GASTO[l.fornecedor_id] || { n: 0, v: 0 }; g.n++; g.v = r2(g.v + +l.valor); });
}
PAGES.fornecedores = async pg => {
  await carregarForn();
  setRd(pg, () => desenharForn());
  desenharForn(pg);
};
function desenharForn(pg) {
  pg = pg || $("#cfg-forn") || $("#page");
  const busca = S.f.fornBusca || "", inat = S.f.fornInat === "1";
  let lista = (S.fornecedores || []).filter(x => inat ? !x.ativo : x.ativo);
  if (busca) { const b = norm(busca); lista = lista.filter(x => norm([x.nome, x.especialidade, x.tel, x.obs].join(" ")).includes(b)); }
  // v15: prestadores à esquerda, lojas à direita
  const lado = (id, tipo) => { const g = grade(id, COLS_FORN, lista.filter(x => x.tipo === tipo), { attr: x => `data-act="forn-ed" data-id="${x.id}" style="cursor:pointer"`, sort: { k: "nome", dir: "asc" }, divisor: "especialidade", rodape: fl => `${fl.length} ${tipo === "loja" ? "lojas" : "prestadores"}` }); g.redesenhar = () => desenharForn(); };
  lado("forn-prest", "prestador"); lado("forn-loja", "loja");
  const ed = pode.ed("fornecedores") || pode.ed("caixa");
  pg.innerHTML = `<div class="grid"><div class="filters">
    <input type="search" placeholder="Buscar nome, serviço, telefone…" value="${esc(busca)}" data-busca="fornBusca"><button class="chip${inat ? " on" : ""}" data-act="chip" data-k="fornInat" data-v="${inat ? "" : "1"}">Ver inativos</button><span class="spacer"></span></div>
    <div class="dois forn-dois"><div><div class="filters"><h3>🔧 Prestadores de serviço</h3><span class="spacer"></span>${gradeBarra("forn-prest")}${ed ? `<button class="btn pri sm" data-act="forn-ed" data-tipo="prestador">+ Prestador</button>` : ""}</div>${gradeHTML("forn-prest")}</div>
      <div><div class="filters"><h3>🏪 Lojas (material)</h3><span class="spacer"></span>${gradeBarra("forn-loja")}${ed ? `<button class="btn pri sm" data-act="forn-ed" data-tipo="loja">+ Loja</button>` : ""}</div>${gradeHTML("forn-loja")}</div></div>
    <p class="hint">Clique no nome para ver a ficha, com os lançamentos e o total gasto nos últimos 12 meses.</p></div>`;
  ligarBusca(pg);
}
ACT["forn-ed"] = async el => {
  const x = (S.fornecedores || []).find(y => y.id === el.dataset.id) || { tipo: el.dataset.tipo || "prestador", ativo: true };
  const ed = pode.ed("fornecedores") || pode.ed("caixa"), dis = ed ? "" : "disabled";
  const lancs = x.id ? await q(sb.from("lancamentos").select("data,valor,descricao,imovel_id,natureza").eq("fornecedor_id", x.id).order("data", { ascending: false }).limit(30)).catch(() => []) : [];
  const gasto = FORN_GASTO[x.id] || { n: 0, v: 0 };
  modal({ titulo: x.id ? x.nome : "Novo prestador / loja", largo: true, semOk: !ed,
    corpo: `<div class="row"><label class="fl" style="grid-column:span 2"><span>Nome</span><input name="nome" value="${esc(x.nome || "")}" required ${dis}></label>
        <label class="fl"><span>Tipo</span><select name="tipo" ${dis}>${opt("prestador", "Prestador de serviço", x.tipo === "prestador")}${opt("loja", "Loja (material)", x.tipo === "loja")}</select></label></div>
      <div class="row"><label class="fl"><span>Serviço / ramo</span><input name="esp" list="dl-esp" value="${esc(x.especialidade || "")}" ${dis}><datalist id="dl-esp">${ESPEC_FORN.prestador.concat(ESPEC_FORN.loja).map(t => `<option value="${t}">`).join("")}</datalist></label>
        <label class="fl"><span>Telefone</span><input name="tel" value="${esc(fmtTel(x.tel || ""))}" ${dis}></label><label class="fl"><span>PIX</span><input name="pix" value="${esc(x.pix || "")}" ${dis}></label><label class="fl"><span>CPF / CNPJ</span><input name="doc" value="${esc(x.doc || "")}" ${dis}></label></div>
      <label class="fl"><span>Observações</span><textarea name="obs" rows="2" ${dis}>${esc(x.obs || "")}</textarea></label>
      <label class="chk"><input type="checkbox" name="ativo" ${x.ativo ? "checked" : ""} ${dis}> Ativo</label>
      ${x.id ? `<div class="kpis" style="margin-top:10px">${kpi("Lançamentos (12 meses)", String(gasto.n), "")}${kpi("Total (12 meses)", brl(gasto.v), "")}</div>` : ""}
      ${lancs.length ? `<h3 style="margin-top:10px">Últimos lançamentos</h3><div class="tw"><table class="compacta"><tbody>${lancs.map(l => `<tr><td>${dt(l.data)}</td><td>${esc(l.natureza === "material" ? "Material" : l.natureza === "servico" ? "Serviço" : "")}</td><td class="trunc">${esc(l.descricao)}</td><td class="trunc">${esc((S.imovelPor[l.imovel_id] || {}).endereco || "")}</td><td class="num">${n2(l.valor)}</td></tr>`).join("")}</tbody></table></div>` : ""}`,
    extra: x.id && pode.admin() ? `<button type="button" class="btn danger" data-del>Excluir</button>` : "",
    aoAbrir: (f, d) => { mascaraTel(f.tel); const b = $("[data-del]", d); if (b) b.addEventListener("click", async () => { d.close(); if (!(await confirmar("Excluir", `Excluir <b>${esc(x.nome)}</b>? Prefira desmarcar "Ativo".`, "Excluir"))) return; try { await q(sb.from("fornecedores").delete().eq("id", x.id)); await recarregarLocadores(); toast("Excluído."); render(); } catch (e) { falha(e); } }); },
    salvar: async f => {
      const u = { nome: f.nome.value.trim(), tipo: f.tipo.value, especialidade: f.esp.value.trim(), tel: f.tel.value.replace(/\D/g, ""), pix: f.pix.value.trim(), doc: f.doc.value.trim(), obs: f.obs.value.trim(), ativo: f.ativo.checked };
      if (!u.nome) throw new Error("Informe o nome.");
      if (!u.especialidade) throw new Error("Informe o serviço / ramo (ex.: Pintor, Eletricista, Material de construção). Sem ramo não dá para cadastrar.");
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
    ["Faça o contrato", `Em ${ui.menu("Cadastros › Contratos")} use ${ui.btn("📄 Novo contrato", 1)} (gerador). Ao terminar, clique ${ui.btn("💾 Salvar no sistema", 1)}. O contrato fica ${ui.tag("CORRIGIR", "warn")} (redação: quem salvou). Se salvar como rascunho, ele fica ${ui.tag("RASCUNHO", "idle")} até você clicar ${ui.btn("✔ Finalizar contrato", 1)} na ficha.`],
    ["Corrija", `Quem conferir abre a ficha e clica ${ui.btn("✔ Corrigido", 1)}: a correção fica com o nome dele e o contrato vira ${ui.tag("PRONTO", "info")}.`],
    ["Ligue o contrato ao imóvel", `Com o contrato ${ui.tag("PRONTO", "info")}, abra a ficha e, embaixo, escolha ${ui.btn("Ligar a um imóvel LIVRE do mapa")}. Só aparecem imóveis livres.`],
    ["Pronto", `Ao salvar, o imóvel vira ${ui.tag("Alugado", "info")} e o contrato vira ${ui.tag("ATIVO", "ok")} sozinhos. O aluguel entra no Pagto aluguel no próximo “Atualizar lista”.`]] },
  { id: "receber", titulo: "Receber um aluguel", resumo: "Registrar o pagamento do locatário (inclusive metade PIX, metade dinheiro).", passos: [
    ["Abra o mês", `${ui.menu("Financeiro › Pagto aluguel")} — confira o mês no canto de cima.`],
    ["Encontre o aluguel", `Use a busca (imóvel, locatário ou locador) ou os filtros ${ui.tag("Em aberto", "bad")} ${ui.tag("Atrasados", "bad")}.`],
    ["Clique em Receber", `Na coluna Recebido, clique ${ui.btn("Receber", 1)}. Se tiver multa, juros, IPTU ou desconto, adicione em ${ui.btn("+ Acréscimo")} / ${ui.btn("− Desconto")} (multa já vem com 10%).`],
    ["Data, valor e conta", `Confira ${ui.campo("Valor recebido", "R$ 1.100,00")} e ${ui.campo("Entrou na conta", "Caixa Recepção ▾")}. Pagou em duas formas? Marque “Pago em duas formas”.`],
    ["Registrar", `Clique ${ui.btn("Registrar", 1)}. Entra no Caixa, gera o número do recibo e aparece em ${ui.menu("Recibos locatário")} para imprimir.`]] },
  { id: "estornar", titulo: "Desfazer (estornar) um pagamento ou repasse", resumo: "Quando lançou errado.", passos: [
    ["Abra o aluguel", `Em ${ui.menu("Pagto aluguel")} clique na linha do aluguel.`],
    ["Repasse primeiro", `Se já foi repassado, clique ${ui.btn("Estornar repasse")} (o lançamento de saída some do Caixa).`],
    ["Depois o recebimento", `Clique ${ui.btn("Estornar recebimento")}. Os lançamentos do Caixa são apagados e o aluguel volta para ${ui.tag("Em aberto", "bad")}.`],
    ["Mês fechado?", `Se o mês já foi fechado em Configurações › Fechamento, o sistema não deixa: peça ao administrador para reabrir.`]] },
  { id: "repassar", titulo: "Repassar ao proprietário (com despesas)", resumo: "Pagar o locador, descontando reparos, materiais etc.", passos: [
    ["Pelo aluguel ou pelo locador", `Um a um: ${ui.menu("Pagto aluguel")} › ${ui.btn("Repassar", 1)}. Vários de uma vez: ${ui.menu("Pgto locador")} › clique no favorecido.`],
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
let REC = [], REC_DESP = {}, REC_CTT = [];
// v14: nomes completos dos locatários (da ficha do contrato daquele imóvel e daquele locatário)
function cttDoRecibo(c) {
  const cands = REC_CTT.filter(x => x.imovel_id === c.imovel_id || ((S.imovelPor[c.imovel_id] || {}).contrato_codigo === x.codigo));
  const alvo = norm(c.locatario || "").replace(/\s+/g, " ").trim();
  return cands.find(x => norm(x.locatario || "").replace(/\s+/g, " ").trim() === alvo) || cands.find(x => alvo && norm(x.locatario || "").includes(alvo.split(" - ")[0])) || null;
}
const nomesLctRecibo = c => { const x = cttDoRecibo(c), f = x ? fichaDe(x) : {}, ns = [f.lct1_nome, /PJ/i.test(f.lct_qtd || "") ? "" : f.lct2_nome].map(n => String(n || "").trim()).filter(n => n && n !== "---");
  return ns.length ? ns : String(c.locatario || "").split(/\s+-\s+/).map(n => n.trim()).filter(Boolean); };
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
  const idsImv = Array.from(new Set(REC.map(c => c.imovel_id).filter(Boolean)));
  REC_CTT = [];
  for (let i = 0; i < idsImv.length; i += 80) REC_CTT.push(...(await fetchAll("contratos", b => b.in("imovel_id", idsImv.slice(i, i + 80)).order("codigo"), "codigo,imovel_id,locatario,ficha").catch(() => [])));
  const codsImv = Array.from(new Set(idsImv.map(id => (S.imovelPor[id] || {}).contrato_codigo).filter(Boolean))).filter(cd => !REC_CTT.some(x => x.codigo === cd));
  if (codsImv.length) REC_CTT.push(...(await q(sb.from("contratos").select("codigo,imovel_id,locatario,ficha").in("codigo", codsImv)).catch(() => [])));
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
// v15: sugestões enquanto digita (nomes completos, títulos, grupos e endereços)
function sugestoesRecibo(tipo) {
  const out = new Set(), add = n => { n = String(n || "").trim(); if (n.length > 2) out.add(n); };
  if (tipo === "locador") { (S.locadores || []).forEach(l => { add(tiraPrefixo(l.nome)); add((l.ficha || {}).lcd1_nome); add((l.ficha || {}).lcd2_nome); }); (S.gruposCfg || []).forEach(g => add(g.nome)); }
  else { S.imoveis.forEach(i => separaNomes(i.locatario).forEach(add)); REC.forEach(c => separaNomes(c.locatario).forEach(add)); REC_CTT.forEach(c => { const f = c.ficha || {}; add(f.lct1_nome); add(f.lct2_nome); }); }
  S.imoveis.forEach(i => add(i.endereco));
  return Array.from(out).sort((a, b) => COLL.compare(a, b));
}
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
      <input type="search" placeholder="Procurar ${tipo === "locador" ? "locador, grupo" : "locatário"} ou endereço (todos os meses)" style="min-width:300px" value="${esc(txt)}" data-rec-txt list="dl-rec-nomes" autocomplete="off"><datalist id="dl-rec-nomes">${sugestoesRecibo(tipo).map(n => `<option value="${esc(n)}">`).join("")}</datalist>
      <input type="search" inputmode="numeric" placeholder="Nº do recibo" style="width:120px" value="${esc(S.f.recBusca || "")}" data-rec-num>
      <span class="spacer"></span>${gradeBarra(id)}
      <button class="btn" data-act="rec-imp-todos">🖨 Imprimir os da lista</button>${tipo === "locatario" ? `<button class="btn" data-act="rec-quitacao" title="Declaração de quitação em A4 com os recibos da lista (de um locatário)">✅ Declaração de quitação</button>` : ""}
      ${pode.admin() ? `<button class="btn" data-act="rec-num">Numeração</button>` : ""}</div>
    ${pessoas.length > 1 ? `<div class="filters"><div class="chips">${[["", "Todos"]].concat(pessoas.map(([n]) => [n, n])).map(([k, t]) => `<button class="chip${pessoa === k ? " on" : ""}" data-act="rec-pessoa" data-v="${esc(k)}">${esc(t)}${k ? `<span class="c">${pessoas.find(p => p[0] === k)[1]}</span>` : ""}</button>`).join("")}</div></div>` : ""}
    ${gradeHTML(id)}
    <p class="hint">${buscando ? "Os recibos aparecem separados por imóvel. Clique num nome acima para ver só os dele." : tipo === "locador" ? "O recibo do locador é numerado quando o repasse é registrado. Estornar o repasse cancela o número." : "O recibo do locatário é numerado quando o pagamento é registrado em Pagto aluguel › Receber. Estornar o recebimento cancela o número."}</p></div>`;
  const n = $("[data-rec-num]", pg); n.addEventListener("change", () => { S.f.recBusca = n.value.replace(/\D/g, ""); render(); });
  const t = $("[data-rec-txt]", pg); t.addEventListener("change", () => { S.f.recBuscaT = t.value.trim(); S.f.recPessoa = ""; S.f.recBusca = ""; render(); });
  t.addEventListener("search", () => { if (!t.value) { S.f.recBuscaT = ""; S.f.recPessoa = ""; render(); } });
}
ACT["rec-quitacao"] = () => {
  const g = G.rec_locatario, ls = (g && g.filtradas) || REC;
  const nomes = Array.from(new Set(ls.map(c => c.locatario)));
  if (!ls.length) return toast("Nenhum recibo na lista.", true);
  if (nomes.length > 1) return toast("A lista tem mais de um locatário: procure pelo nome e clique nele para ficar só os recibos dele.", true);
  const ends = Array.from(new Set(ls.map(endRec))), x = cttDoRecibo(ls[0]), f = x ? fichaDe(x) : null;
  const ns = nomesLctRecibo(ls[0]);
  const quem = f && f.lct1_nome ? qualifGrupo(f, "lct").replace(/, (residentes?|com sede) na .*$/, "") : ns.map(n => `<b>${esc(n.toUpperCase())}</b>`).join(" e ");
  abrirDocEditavel("Declaração de quitação · " + ns.join(" e "), quitacaoHTML(ls, quem, esc(ends.join("; ")), ns.length > 1 && !(f && /PJ/i.test(f.lct_qtd || ""))), { clientes: ns, papelCliente: "Locatário(a)" });
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
    // v19: recibo do locatário sem o nome do locador e sem o nº do contrato (só a via da imobiliária no A4 mostra)
    de = nomesLctRecibo(c); l4 = via && /imobili/i.test(via) ? `Locador: <b>${esc(locReal)}</b>${ctt ? ` · Contrato nº <b>${esc(ctt)}</b>` : ""}` : "";
    lin("Aluguel", c.valor); aj.filter(x => x.tipo === "acr").forEach(x => lin(ajRot(x) || "Acréscimo", x.valor));
    aj.filter(x => x.tipo === "desc").forEach(x => lin("Desconto: " + ajRot(x), x.valor, true));
    const soma = r2(+c.valor + aj.filter(x => x.tipo === "acr").reduce((a, x) => a + +x.valor, 0) - aj.filter(x => x.tipo === "desc").reduce((a, x) => a + +x.valor, 0));
    if (Math.abs(soma - total) > 0.005) lin(total > soma ? "Diferença (juros/arredondamento)" : "Pago a menor (saldo em aberto)", Math.abs(total - soma), total < soma);
    assin = esc(TIMBRE.razao.split(" — ")[0]);
  }
  const des = Array.isArray(de) ? de : [de];
  while (itens.length < REC_LINHAS - Math.max(0, des.length - 1) + (l4 ? 0 : 1)) itens.push(["", ""]);
  const parc = parcelaDe(c);
  return `<div class="recibo">
    <div class="rc-top"><svg class="rc-logo" aria-hidden="true"><use href="#logo-casa"/></svg><div class="rc-emp"><small>${esc(TIMBRE.razao)}</small><b>${esc(TIMBRE.nome)}</b></div>
      <div class="rc-tit">RECIBO ${tipo === "locador" ? "DO LOCADOR" : "DE ALUGUEL"}${via ? `<small>${esc(via)}</small>` : ""}</div><div class="rc-num">Nº <b>${num || "—"}</b></div><div class="rc-val">${brl(total)}</div></div>
    <div class="rc-l rc-de"><span>Recebemos de:</span><span>${des.map(n => `<b>${esc(n)}</b>`).join("<br>")}</span></div>
    <div class="rc-l">A quantia de: <b>${brl(total)}</b> (${esc(extensoReais(total).toLowerCase() || "zero real")})</div>
    <div class="rc-l">Referente: aluguel de <b>${esc(mesTxt(c.competencia))}</b> · imóvel <b>${esc(im.endereco || "")}</b></div>
    ${l4 ? `<div class="rc-l">${l4}</div>` : ""}
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
  { k: "alugueis", t: "Pagto aluguel (locatários)", ver: "alugueis", dica: "aluguéis de todos os meses", zerar: "movimento",
    xls: async () => { const ls = await fetchAll("cobrancas", b => b.order("competencia").order("id")); await xlsCols(`alugueis-${hoje()}.xlsx`, "Alugueis", COLS_COB, ls); } },
  { k: "favorecidos", t: "Pgto locador (favorecidos)", ver: "depositos", dica: "quem recebe o depósito, forma, conta e locadores ligados", imp: "dep-importar", zerar: "favorecidos",
    pre: async () => { DEP.favs = await q(sb.from("depositos_fav").select("*")); },
    xls: async () => { const fs = await q(sb.from("depositos_fav").select("*").order("dia").order("nome")); await baixarXLSX(`favorecidos-${hoje()}.xlsx`, { Favorecidos: fs.map(f => ({ Favorecido: f.nome, Dia: f.dia || "", Forma: FORMAS[f.forma] || f.forma || "", "Conta / PIX": f.conta_bancaria || "", Locadores: (f.locadores || []).join(" · "), Ativo: f.ativo ? "sim" : "não", Obs: f.obs || "" })) }); } },
  { k: "inadimplencia", t: "Cobrança · inadimplência", ver: "atrasados", dica: "aluguéis vencidos e não pagos",
    xls: async () => { const ls = await fetchAll("cobrancas", b => b.is("data_pagamento", null).is("devedor_id", null).eq("carencia", false).lt("vencimento", hoje()).order("vencimento").order("id")); await xlsCols(`inadimplencia-${hoje()}.xlsx`, "Inadimplencia", COLS_COB, ls); } },
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
  { k: "imoveis", t: "Imóveis (mapa do aluguel)", ver: "imoveis", dica: "recomeçar o mapa: zerar apaga imóveis, aluguéis, Caixa, devedores e histórico (os contratos ficam); importar: arquivo de importação do mapa (.json)", imp: "imv-reimportar", zerar: "mapa",
    xls: async () => xlsCols(`imoveis-${hoje()}.xlsx`, "Imoveis", COLS_IMV, S.imoveis) },
  { k: "site", t: "Planilha do site (códigos, à venda, interessados)", ver: "imoveis", dica: "importar: site-conferencia.json (pasta 4 do pacote): códigos do site nos imóveis de locação, lista de imóveis à venda e interessados", imp: "site-importar",
    xls: async () => { const ivs = await fetchAll("imoveis_venda", b => b.order("endereco")).catch(() => []); await baixarXLSX(`imoveis-a-venda-${hoje()}.xlsx`, { "Imóveis à venda": ivs.map(x => ({ Código: x.codigo_site, Situação: (ST_IV[x.status] || [x.status])[0], Endereço: x.endereco, Bairro: x.bairro, Tipo: x.tipo, Valor: x.valor, Vendedor: x.vendedor, Características: carTxt(x.ficha, x.tipo).join(" · "), Obs: x.obs })) }); } },
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
  contratos: "todas as fichas de contratos (os imóveis, aluguéis e o Caixa ficam)", mapa: "o mapa do aluguel: todos os imóveis, os aluguéis de todos os meses, o Caixa, os devedores, o histórico do mapa, os depósitos e as notas. Os contratos, locadores, caução, vendas e tarefas ficam (os contratos são religados aos imóveis quando você importar o mapa de novo)", movimento: "TUDO do movimento: imóveis, contratos, aluguéis, Caixa, devedores, histórico do mapa e notas (ficam usuários, contas, plano de contas, locadores, grupos, favorecidos, contas caução e vendas)" };
ACT["dado-xls"] = async el => { const d = DADOS.find(x => x.k === el.dataset.k); el.disabled = true; try { await d.xls(); } catch (e) { falha(e); } el.disabled = false; };
ACT["dado-imp"] = async el => {
  if (!pode.admin()) return;
  const d = DADOS.find(x => x.k === el.dataset.k);
  if (!(await confirmar("Importar · " + d.t, `Importar uma planilha em <b>${esc(d.t)}</b>? Os dados do sistema podem ser criados ou alterados. Faça um backup antes.`, "Sim, escolher o arquivo"))) return;
  try { if (d.pre) await d.pre(); ACT[d.imp](el); } catch (e) { falha(e); }
};
// v14: importar o mapa do aluguel de novo (arquivo .json gerado a partir da planilha), depois de zerar
ACT["imv-reimportar"] = async () => {
  await carregarBase();
  if (S.imoveis.length) return modal({ titulo: "Importar o mapa do aluguel", semOk: true, corpo: `<div class="box warn">Ainda há <b>${S.imoveis.length}</b> imóveis no sistema. Para recomeçar o mapa: baixe um backup, clique em <b>Zerar</b> nesta mesma linha (Imóveis) e depois em <b>Importar</b>.</div>` });
  let arq = null;
  modal({ titulo: "Importar o mapa do aluguel", ok: "Importar", corpo: `<p>Escolha o arquivo de importação do mapa (<b>.json</b>, gerado a partir da planilha do Mapa do Aluguel; fica na pasta 4 do pacote, nunca no GitHub).</p>
      <input type="file" name="arq" accept=".json"><div data-res class="hint" style="margin-top:8px"></div>
      <p class="hint">Entram os imóveis, o histórico do mapa e os reajustes. Contratos que já estão no sistema <b>não</b> são substituídos (as alterações feitas aqui ficam); só entram contratos novos. No fim, cada contrato é religado ao seu imóvel.</p>`,
    aoAbrir: (f, d) => f.arq.addEventListener("change", async () => {
      const res = $("[data-res]", d); arq = null;
      try { const o = JSON.parse(await f.arq.files[0].text()); if (o.formato !== "financeiro-imobiliaria" || !o.tabelas || !Array.isArray(o.tabelas.imoveis)) throw new Error("Este arquivo não é uma importação do mapa.");
        arq = o; res.innerHTML = ["imoveis", "mapa_mensal", "reajustes", "contratos"].filter(t => (o.tabelas[t] || []).length).map(t => `${t}: <b>${o.tabelas[t].length}</b>`).join(" · ");
      } catch (e) { res.innerHTML = `<span class="neg">${esc(erroMsg(e))}</span>`; }
    }),
    salvar: async () => {
      if (!arq) throw new Error("Escolha o arquivo.");
      const T = arq.tabelas, ja = new Set((await fetchAll("contratos", b => b.order("codigo"), "codigo")).map(c => c.codigo));
      const novos = (T.contratos || []).filter(c => !ja.has(c.codigo)).map(c => Object.assign({}, c, { imovel_id: null }));
      const lotes = [["imoveis", T.imoveis], ["contratos", novos], ["reajustes", T.reajustes || []], ["mapa_mensal", T.mapa_mensal || []]];
      for (const [t, ls] of lotes) for (let i = 0; i < ls.length; i += 500) { toast(`${t}: ${Math.min(i + 500, ls.length)} de ${ls.length}…`); await rpc("restaurar_tabela", { p_tabela: t, p_linhas: ls.slice(i, i + 500) }); }
      const n = await rpc("religar_contratos");
      await carregarBase(); toast(`Mapa importado: ${T.imoveis.length} imóveis, ${novos.length} contratos novos, ${n} contratos religados.`); render();
    } });
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
  { k: "acoes", t: "Ações", nf: true, fixo: true, html: c => `<span class="acts"><button class="btn sm" data-act="ir-mes" data-m="${c.competencia}" data-imv="${c.imovel_id}">Abrir no Pagto aluguel</button><button class="btn sm" data-act="cob-termo" data-src="inad" data-id="${c.imovel_id}">📄 Termos</button></span>` }
];
// "Abrir mês": vai para o Pagto aluguel daquele mês, já filtrado no imóvel
ACT["ir-mes"] = el => {
  S.mes = el.dataset.m; ssSet("mes", S.mes); S.f.cob = "todos";
  S.f.cobBusca = el.dataset.imv ? (S.imovelPor[el.dataset.imv] || {}).endereco || "" : "";
  location.hash = "#alugueis";
};
function desenharAtrasados(pg) {
  pg = pg || $("#page");
  const per = S.f.inadPer || "mes";
  const bq = norm(S.f.inadBusca || "").trim(), bate = (...xs) => !bq || norm(xs.join(" ")).includes(bq);
  const cobsMes = INAD.flatMap(x => x.cobs).filter(c => c.competencia === S.mes && bate((S.imovelPor[c.imovel_id] || {}).endereco, rotuloImv((S.imovelPor[c.imovel_id] || {}).endereco || ""), c.locatario, c.locador));
  const INADf = INAD.filter(x => bate(x.imovel, rotuloImv(x.imovel || ""), x.locatario, x.locador));
  const lista = per === "mes" ? cobsMes : INADf;
  const total = per === "mes" ? cobsMes.reduce((a, c) => a + devido(c), 0) : INAD.reduce((a, x) => a + x.total, 0);
  const faixa = { "até 30 dias": 0, "31 a 60": 0, "61 a 90": 0, "mais de 90": 0 };
  INAD.forEach(x => { faixa[x.dias <= 30 ? "até 30 dias" : x.dias <= 60 ? "31 a 60" : x.dias <= 90 ? "61 a 90" : "mais de 90"] += x.total; });
  const g = per === "mes"
    ? grade("inadmes", COLS_INAD_MES, cobsMes, { sort: { k: "vencimento", dir: "asc" }, vazio: `Nenhum aluguel de ${mesTxt(S.mes)} em atraso. 🎉`, rodape: fl => `${fl.length} aluguéis · ${brl(fl.reduce((a, c) => a + devido(c), 0))}` })
    : grade("inad", COLS_INAD, INADf, { sort: { k: "dias", dir: "desc" }, vazio: "Nenhum aluguel em atraso. 🎉", rodape: fl => `${fl.length} imóveis · total ${brl(fl.reduce((a, x) => a + x.total, 0))}` });
  g.redesenhar = () => desenharAtrasados();
  pg.innerHTML = `<div class="grid">${cobrancaAbas("atrasados")}
    <div class="kpis">${kpi(per === "mes" ? "Em atraso de " + mesTxt(S.mes) : "Total em atraso", `<span class="neg">${brl(total)}</span>`, per === "mes" ? `${cobsMes.length} aluguéis` : `${INAD.reduce((a, x) => a + x.cobs.length, 0)} aluguéis · ${INAD.length} imóveis`, true)}
      ${Object.entries(faixa).map(([k, v]) => kpi(k, brl(v), "todos os meses")).join("")}</div>
    <div class="filters"><input type="search" placeholder="Buscar imóvel, locatário, locador…" value="${esc(S.f.inadBusca || "")}" data-busca="inadBusca"><div class="fgrupo"><span>Mostrar</span>${[["mes", "Mês selecionado (" + mesCurto(S.mes) + ")"], ["todos", "Todos os meses (por imóvel)"]].map(([k, t]) => `<button class="chip${per === k ? " on" : ""}" data-act="chip" data-k="inadPer" data-v="${k}">${t}</button>`).join("")}</div>
      <span class="hint">Aluguéis vencidos e não pagos. Para dar baixa, abra no Pagto aluguel.</span><span class="spacer"></span>${gradeBarra(per === "mes" ? "inadmes" : "inad")}
      <button class="btn" data-act="cob-termos-menu">📄 Termos ▾</button><button class="btn" data-act="inad-imp">🖨 Lista de inadimplentes</button></div>
    ${gradeHTML(per === "mes" ? "inadmes" : "inad")}
  </div>`;
  ligarBusca(pg);
}
ACT["xls-inad"] = () => (S.f.inadPer || "mes") === "mes" ? exportarGrade("inadmes", `inadimplencia-${S.mes.slice(0, 7)}.xlsx`, "Inadimplencia") : exportarGrade("inad", `inadimplencia-${hoje()}.xlsx`, "Inadimplencia");
ACT["dev-imp"] = () => {
  const fl = (G.devedores && G.devedores.filtradas) || [], sit = d => (SIT_DEV[d.situacao] || [d.situacao])[0];
  const linhas = fl.map((d, i) => `<tr><td>${i + 1}</td><td>${esc(d.devedor)}</td><td>${esc(d.endereco || "")}</td><td>${d.data_saida ? dt(d.data_saida) : ""}</td><td>${esc(sit(d))}</td>
    <td class="num">${n2(d.valor_total)}</td><td class="num">${n2(d.valor_pago)}</td><td class="num"><b>${n2(saldoDev(d))}</b></td></tr>`).join("");
  const s = k => fl.reduce((a, d) => a + (k ? +d[k] || 0 : saldoDev(d)), 0);
  const fNome = { todos: "todos", aberto: "em aberto e acordos", "EM ABERTO": "em aberto", ACORDO: "acordos em andamento", QUITADO: "quitados", PERDIDO: "saldo perdido" }[S.f.dev || "todos"] || "";
  abrirRelatorio("Devedores", `<div class="rel-tit"><b>Devedores · ${esc(fNome)}</b><span>posição em ${dt(hoje())}</span></div>
    <table class="rel-t"><thead><tr><th>#</th><th>Devedor</th><th>Imóvel</th><th>Saída</th><th>Situação</th><th class="num">Dívida</th><th class="num">Pago</th><th class="num">Saldo</th></tr></thead>
    <tbody>${linhas || `<tr><td colspan="8">Nenhum devedor.</td></tr>`}</tbody><tfoot><tr><td colspan="5"><b>Total (${fl.length})</b></td><td class="num"><b>${n2(s("valor_total"))}</b></td><td class="num"><b>${n2(s("valor_pago"))}</b></td><td class="num"><b>${n2(s())}</b></td></tr></tfoot></table>`, { paisagem: true });
};
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

const TERMOS_COB = {
  notificacao: "Notificação extrajudicial de cobrança",
  acordo: "Instrumento de acordo / confissão de dívida",
  despejo: "Petição: ação de despejo por falta de pagamento"
};
const TERMOS_COB_IC = [{ ic: "📨", t: "Notificação extrajudicial", d: "cobra o débito com prazo para pagar", k: "notificacao" }, { ic: "🤝", t: "Acordo / confissão de dívida", d: "parcelamento com entrada e parcelas", k: "acordo" }, { ic: "⚖️", t: "Petição de despejo", d: "ação de despejo por falta de pagamento", k: "despejo" }];
ACT["cob-termo"] = async el => {
  if (!el.dataset.tipo) return menuTermos(el, "Termos de cobrança", TERMOS_COB_IC.map(x => ({ ic: x.ic, t: x.t, d: x.d, fn: () => { fecharDlg(); setTimeout(() => ACT["cob-termo"]({ dataset: { src: el.dataset.src, id: el.dataset.id, tipo: x.k } }), 30); } })));
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
        const cli = tipo === "notificacao" ? (ctt && nomesGrupo(ficha, "lct").length ? nomesGrupo(ficha, "lct").concat(nomesGrupo(ficha, "fdr")) : [nomeDev]) : [];
        setTimeout(() => abrirDocEditavel(TERMOS_COB[tipo] + " · " + nomeDev, TERMO_COB_HTML[tipo](dados), { semTimbre: tipo === "despejo", clientes: cli, papelCliente: "Notificado(a) · ciente" }), 0);
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
   NOTAS FISCAIS do mês (v18): uma nota por TOMADOR — junta todos os imóveis dele
   Tomador = proprietário (locador) ou o favorecido indicado no cadastro do imóvel
   ===================================================================== */
let NF = [];
const soDig = v => String(v || "").replace(/\D/g, "");
// quem recebe a nota de um imóvel: [{nome, doc, end, parte}]
function tomadoresImv(im) {
  const outros = nfOutros(im);
  if (outros.length) return outros.map(x => ({ nome: x.nome, doc: x.cpf, end: "", parte: 1 / outros.length, outro: true }));
  const l = locPor(im.locador) || {}, f = l.ficha || {};
  const end = [f.lcd_end1_rua, f.lcd_end1_bairro, f.lcd_end1_cidade].filter(Boolean).join(", ") || l.endereco || "";
  return [{ nome: f.lcd1_nome || tiraPrefixo(im.locador), doc: f.lcd1_cpf || l.cpf_cnpj || "", end, parte: 1 }];
}
const descNF = (n, mes) => `${n > 1 ? "Comissões recebidas" : "Comissão recebida"} no mês de ${MESES[+mes.slice(5, 7) - 1]} de ${mes.slice(0, 4)}`;
const COLS_NF = [
  { k: "origem", t: "Origem", v: x => x.origem === "venda" ? "Venda" : "Aluguel", html: x => `<span class="tag ${x.origem === "venda" ? "warn" : "info"}">${x.origem === "venda" ? "Venda" : "Aluguel"}</span>`, w: 80 },
  { k: "tomador", t: "Tomador (nome na nota)", cls: "trunc", html: x => `<b>${esc(x.tomador || "")}</b>${x.outro ? `<span class="sub">favorecido indicado no imóvel</span>` : ""}` },
  { k: "doc", t: "CPF / CNPJ", cls: "mono", html: x => x.doc ? esc(x.doc) : `<span class="tag bad">falta</span>` },
  { k: "ref", t: "Imóveis / venda", cls: "trunc", v: x => x.ref, html: x => x.partes ? `${x.partes.length > 1 ? `<b>${x.partes.length} imóveis</b> · ` : ""}${esc(x.partes.map(p => rotuloImv(p.im.endereco)).join(" · "))}` : esc(x.ref) },
  { k: "base", t: "Aluguéis / venda", tipo: "num" },
  { k: "valor", t: "Valor da nota", tipo: "num", dica: "Aluguel: soma das taxas de administração recebidas no mês · Venda: comissão" },
  { k: "receb", t: "Recebido", v: x => x.recebido ? "sim" : "não", html: x => x.pend ? `<span class="tag warn">${x.pend} sem pagamento</span>` : x.recebido ? `<span class="tag ok">recebido</span>` : `<span class="tag ${x.previsto ? "idle" : "warn"}">${x.previsto ? "previsão" : "não"}</span>` },
  { k: "sit", t: "Nota", v: x => x.nf && x.nf.numero ? "emitida" : "a emitir", html: x => x.nf && x.nf.numero ? `<span class="tag ok">nº ${esc(x.nf.numero)}${x.nf.emitida_em ? " · " + dt(x.nf.emitida_em) : ""}</span>` : `<span class="tag ${x.previsto ? "idle" : "bad"}">${x.previsto ? "prevista" : "a emitir"}</span>` }
];
PAGES.notas = async pg => {
  const fim = fimMes(S.mes);
  const [cobs, notas, vendas, itens] = await Promise.all([
    fetchAll("cobrancas", b => b.eq("competencia", S.mes).eq("carencia", false).order("id"), "id,imovel_id,competencia,vencimento,locador,locatario,valor,taxa_valor,taxa_adm_pct,ajustes,acrescimos,descontos,valor_pago,data_pagamento"),
    q(sb.from("notas_fiscais").select("*").eq("competencia", S.mes)).catch(() => []),
    pode.ver("vendas") ? q(sb.from("vendas").select("id,codigo,data,endereco,valor,comissao,vendedores,vend_qualif")).catch(() => []) : [],
    pode.ver("vendas") ? q(sb.from("venda_itens").select("*").eq("tipo", "comissao").or(`and(pago_em.gte.${S.mes},pago_em.lte.${fim}),and(pago_em.is.null,vencimento.gte.${S.mes},vencimento.lte.${fim})`)).catch(() => []) : []
  ]);
  NF = []; const grupos = {}, irCobs = cobs.filter(c => (S.imovelPor[c.imovel_id] || {}).declarar_ir === "Sim"), docPorNome = {};
  // mesmo tomador com e sem CPF/CNPJ em imóveis diferentes: junta pelo nome
  irCobs.forEach(c => tomadoresImv(S.imovelPor[c.imovel_id]).forEach(t => { if (soDig(t.doc)) docPorNome[norm(t.nome)] = t.doc; }));
  irCobs.forEach(c => {
    const im = S.imovelPor[c.imovel_id], taxa = c.taxa_valor != null ? +c.taxa_valor : calcCob(c).taxa;
    tomadoresImv(im).forEach(t => {
      if (!soDig(t.doc) && docPorNome[norm(t.nome)]) t.doc = docPorNome[norm(t.nome)];
      const key = soDig(t.doc) || "n:" + norm(t.nome);
      const g = grupos[key] = grupos[key] || { id: "g:" + key, origem: "aluguel", tomador: t.nome, doc: t.doc, end: t.end, outro: t.outro, partes: [], base: 0, valor: 0, pend: 0 };
      const nf = notas.find(n => n.cobranca_id === c.id && (soDig(n.tomador_doc) === soDig(t.doc) || norm(n.tomador) === norm(t.nome)));
      g.partes.push({ c, im, valor: r2(taxa * t.parte), base: r2(+c.valor * t.parte), pago: !!c.data_pagamento, nf });
    });
  });
  // v19: por padrão a nota leva a comissão de todos os aluguéis do mês (pagos ou não);
  // com "não constar aluguéis não pagos" ligado, só os pagos entram
  const soPagos = !!S.f.nfSoPagos;
  Object.values(grupos).forEach(g => {
    g.partes.forEach(p => (p.entra = p.pago || !soPagos));
    const pg2 = g.partes.filter(p => p.entra); g.pend = g.partes.filter(p => !p.pago).length;
    g.valor = r2(pg2.reduce((a, p) => a + p.valor, 0)); g.base = r2(g.partes.reduce((a, p) => a + p.base, 0)); g.recebido = pg2.length > 0;
    const ns = pg2.map(p => p.nf).filter(n => n && n.numero); g.nf = pg2.length && ns.length === pg2.length ? ns[0] : null; g.previsto = !pg2.length;
    g.ref = g.partes.map(p => p.im.endereco).join(" · "); g.desc = descNF(pg2.length || g.partes.length, S.mes); NF.push(g);
  });
  const vPor = Object.fromEntries(vendas.map(v => [v.id, v])), nfDe = (campo, id) => notas.find(n => n[campo] === id);
  itens.forEach(i => { const v = vPor[i.venda_id] || {}; NF.push({ id: "vi" + i.id, origem: "venda", venda_item_id: i.id, venda_id: i.venda_id, ref: `${v.codigo || ""} · ${v.endereco || ""} (${i.descricao})`, tomador: v.vendedores || "", doc: "",
    base: +v.valor || 0, valor: +i.valor, recebido: i.pago_em, previsto: !i.pago_em, nf: nfDe("venda_item_id", i.id), desc: `comissão de intermediação da venda do imóvel ${v.endereco || ""}` }); });
  vendas.filter(v => v.data && v.data >= S.mes && v.data <= fim && +v.comissao > 0 && !itens.some(i => i.venda_id === v.id)).forEach(v => NF.push({ id: "v" + v.id, origem: "venda", venda_id: v.id, ref: `${v.codigo} · ${v.endereco || ""} (comissão)`,
    tomador: v.vendedores || "", doc: "", base: +v.valor || 0, valor: +v.comissao, recebido: null, previsto: true, nf: notas.find(n => n.venda_id === v.id && !n.venda_item_id), desc: `comissão de intermediação da venda do imóvel ${v.endereco || ""}` }));
  setRd(pg, () => desenharNotas());
  desenharNotas(pg);
};
function desenharNotas(pg) {
  pg = pg || $("#page");
  const f = S.f.nf || "todas", busca = S.f.nfBusca || "";
  const teste = { todas: () => true, aemitir: x => !(x.nf && x.nf.numero) && !x.previsto, emitidas: x => !!(x.nf && x.nf.numero), aluguel: x => x.origem === "aluguel", venda: x => x.origem === "venda", naopago: x => x.pend > 0 };
  let lista = NF.filter(teste[f] || teste.todas);
  if (busca) { const b = norm(busca); lista = lista.filter(x => norm([x.tomador, x.doc, x.ref, (x.partes || []).map(p => p.c.locatario).join(" ")].join(" ")).includes(b)); }
  const vl = x => +((x.nf && x.origem === "venda" && x.nf.valor) || x.valor) || 0;
  const tot = t => brl(NF.filter(teste[t]).reduce((a, x) => a + vl(x), 0));
  const g = grade("notas2", COLS_NF, lista, { attr: x => `data-act="nf-ed" data-id="${esc(x.id)}" style="cursor:pointer"`, sort: { k: "tomador", dir: "asc" }, divisor: "origem", vazio: `Nenhuma nota em ${mesTxt(S.mes)}. Marque “Declara IR = Sim” no cadastro do imóvel.`,
    rodape: fl => `${fl.length} nota(s) · ${brl(fl.reduce((a, x) => a + vl(x), 0))}` });
  g.redesenhar = () => desenharNotas();
  pg.innerHTML = `<div class="grid">
    <div class="kpis">${kpi("A emitir", `<span class="${NF.filter(teste.aemitir).length ? "neg" : ""}">${NF.filter(teste.aemitir).length}</span>`, tot("aemitir"), true)}${kpi("Emitidas", String(NF.filter(teste.emitidas).length), tot("emitidas"))}
      ${kpi("Aluguéis (tomadores)", String(NF.filter(teste.aluguel).length), tot("aluguel"))}${kpi("Vendas (comissão)", String(NF.filter(teste.venda).length), tot("venda"))}</div>
    <div class="filters"><div class="fgrupo"><span>Mostrar</span>${[["todas", "Todas"], ["aemitir", "A emitir"], ["emitidas", "Emitidas"], ["aluguel", "Aluguéis"], ["venda", "Vendas"], ["naopago", "Com aluguel não pago"]].map(([k, t]) => `<button class="chip${f === k ? " on" : ""}${k === "naopago" ? " st-INTV" : ""}" data-act="chip" data-k="nf" data-v="${k}">${t}<span class="c">${NF.filter(teste[k]).length}</span></button>`).join("")}</div>
      <input type="search" placeholder="Buscar tomador, CPF/CNPJ, imóvel, locatário…" value="${esc(busca)}" data-busca="nfBusca">
      <label class="chk" title="Desligado: a nota leva a comissão de todos os aluguéis do mês, mesmo dos que ainda não pagaram"><input type="checkbox" data-nf-sopagos ${S.f.nfSoPagos ? "checked" : ""}> não constar comissão de aluguéis não pagos neste mês</label>
      <span class="spacer"></span>${gradeBarra("notas2")}<button class="btn" data-act="nf-imp">🖨 Lista para emitir</button><button class="btn" data-act="dimob">📄 DIMOB do ano</button></div>
    ${gradeHTML("notas2")}
    <p class="hint">Uma linha por <b>tomador</b>: todos os imóveis dele com <b>Declara IR = Sim</b> viram uma nota só, com a soma das taxas de administração do mês${S.f.nfSoPagos ? " (só dos aluguéis já pagos)" : " (inclusive dos aluguéis ainda não pagos — veja o filtro “Com aluguel não pago”)"}. O tomador é o proprietário ou o favorecido indicado no cadastro do imóvel. Clique na linha para copiar os dados para o emissor e registrar o número da nota.</p></div>`;
  ligarBusca(pg);
  const sp = $("[data-nf-sopagos]", pg); if (sp) sp.addEventListener("change", () => { S.f.nfSoPagos = sp.checked; render(); });
}
ACT["nf-imp"] = () => {
  const g = G.notas2, fl = (g && g.filtradas) || NF;
  abrirRelatorio("Notas fiscais", `<div class="rel-tit"><b>Notas fiscais a emitir · ${esc(mesTxt(S.mes))}</b><span>emitido em ${dt(hoje())}</span></div>
    <table class="rel-t"><thead><tr><th>#</th><th>Tomador</th><th>CPF/CNPJ</th><th>Imóveis / venda</th><th>Descrição</th><th class="num">Valor</th><th>Nº da nota</th></tr></thead>
    <tbody>${fl.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.tomador)}</td><td>${esc(x.doc)}</td><td>${x.partes ? x.partes.map(p => `${esc(rotuloImv(p.im.endereco))} <small>(${n2(p.valor)}${p.pago ? "" : p.entra ? " · não pago" : " · fora: não pago"})</small>`).join("<br>") : esc(x.ref)}</td><td>${esc(x.desc || "")}</td><td class="num">${n2(x.valor)}</td><td>${esc((x.nf || {}).numero || "")}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="5"><b>Total</b></td><td class="num"><b>${n2(fl.reduce((a, x) => a + (+x.valor || 0), 0))}</b></td><td></td></tr></tfoot></table>`, { paisagem: true });
};
const btnCopiar = (rot, v) => `<div class="cp-l"><span class="cp-r">${esc(rot)}</span><span class="cp-v">${esc(v || "—")}</span>${v ? `<button type="button" class="btn sm" data-copiar="${esc(v)}">Copiar</button>` : ""}</div>`;
ACT["nf-ed"] = el => {
  const x = NF.find(y => y.id === el.dataset.id); if (!x) return;
  const ed = pode.ed("notas"), n = x.nf || {}, valorTxt = n2(x.valor);
  const partesHTML = x.partes ? `<table class="compacta"><thead><tr><th>Imóvel</th><th>Locatário</th><th class="num">Aluguel</th><th class="num">Taxa</th><th>Pagamento</th></tr></thead><tbody>${x.partes.map(p => `<tr><td>${tagImv(p.im.endereco)}</td><td>${tagPes(separaNomes(p.c.locatario), "etq-lct", "", 2)}</td><td class="num">${n2(p.base)}</td><td class="num">${n2(p.valor)}</td><td>${p.pago ? `<span class="tag ok">pago ${dt(p.c.data_pagamento)}</span>` : p.entra ? `<span class="tag warn">não pago — entra na nota</span>` : `<span class="tag idle">não pago — fora desta nota</span>`}</td></tr>`).join("")}</tbody></table>` : `<div class="box">${esc(x.ref)}</div>`;
  const tudo = [`Tomador: ${x.tomador}`, `CPF/CNPJ: ${x.doc}`, x.end ? `Endereço: ${x.end}` : "", `Valor: ${valorTxt}`, `Descrição: ${x.desc || ""}`].filter(Boolean).join("\n");
  modal({ titulo: "Nota fiscal · " + x.tomador, xl: true, semOk: !ed, ok: "Registrar nota",
    corpo: `<div class="nf-2col"><div><h3>Dados para o emissor</h3>${btnCopiar("Tomador", x.tomador)}${btnCopiar("CPF / CNPJ", soDig(x.doc) ? x.doc : "")}${btnCopiar("Endereço", x.end)}${btnCopiar("Valor do serviço", valorTxt)}${btnCopiar("Descrição do serviço", x.desc)}
        <button type="button" class="btn" data-copiar="${esc(tudo)}" style="margin-top:6px">📋 Copiar tudo</button>${!soDig(x.doc) ? `<div class="box bad" style="margin-top:8px">Falta o CPF/CNPJ do tomador. Complete em Cadastros › Locadores (ficha) ou no favorecido do imóvel.</div>` : ""}</div>
      <div><h3>Registrar a nota emitida</h3><div class="row"><label class="fl"><span>Nº da nota</span><input name="numero" value="${esc(n.numero || "")}" ${ed ? "" : "disabled"}></label><label class="fl"><span>Emitida em</span><input type="date" name="data" value="${n.emitida_em || hoje()}" ${ed ? "" : "disabled"}></label></div>
        ${x.origem === "venda" ? `<label class="fl"><span>Valor da nota</span><input name="valor" inputmode="numeric" value="${moedaFmt(n.valor != null && n.id ? n.valor : x.valor)}"></label>` : ""}
        <label class="fl"><span>Observações</span><textarea name="obs" rows="2" ${ed ? "" : "disabled"}>${esc(n.obs || "")}</textarea></label></div></div>
      <h3>${x.partes ? `Imóveis desta nota (${x.partes.length})` : "Venda"}</h3>${partesHTML}`,
    extra: x.nf && x.nf.id && ed ? `<button type="button" class="btn danger" data-del>Desfazer registro</button>` : "",
    aoAbrir: (f, d) => { if (f.valor) mascaraMoeda(f.valor);
      $$("[data-copiar]", d).forEach(b => b.addEventListener("click", async () => { try { await navigator.clipboard.writeText(b.dataset.copiar); const t = b.textContent; b.textContent = "✔ Copiado"; setTimeout(() => (b.textContent = t), 1200); } catch (e) { toast("Não consegui copiar: selecione e use Ctrl+C.", true); } }));
      const b = $("[data-del]", d); if (b) b.addEventListener("click", async () => { d.close(); try {
        if (x.partes) { for (const p of x.partes) if (p.nf && p.nf.id) await q(sb.from("notas_fiscais").delete().eq("id", p.nf.id)); } else await q(sb.from("notas_fiscais").delete().eq("id", x.nf.id));
        toast("Registro desfeito."); render(); } catch (e) { falha(e); } }); },
    salvar: async f => {
      const numero = f.numero.value.trim(); if (!numero) throw new Error("Informe o número da nota emitida.");
      const emitida_em = f.data.value || hoje(), obs = f.obs.value.trim();
      if (x.partes) {
        const pagas = x.partes.filter(p => p.entra); if (!pagas.length) throw new Error("Nenhum aluguel deste tomador entra na nota (todos sem pagamento e a opção “não constar aluguéis não pagos” está ligada).");
        for (const p of pagas) { const u = { competencia: S.mes, origem: "aluguel", cobranca_id: p.c.id, tomador: x.tomador, tomador_doc: x.doc, valor: p.valor, numero, emitida_em, obs, descricao: p.im.endereco };
          if (p.nf && p.nf.id) await q(sb.from("notas_fiscais").update(u).eq("id", p.nf.id)); else await q(sb.from("notas_fiscais").insert(u)); }
      } else {
        const u = { competencia: S.mes, origem: "venda", venda_item_id: x.venda_item_id || null, venda_id: x.venda_id || null, tomador: x.tomador, tomador_doc: x.doc, valor: parseMoney(f.valor.value) || 0, numero, emitida_em, obs, descricao: x.ref };
        if (x.nf && x.nf.id) await q(sb.from("notas_fiscais").update(u).eq("id", x.nf.id)); else await q(sb.from("notas_fiscais").insert(u));
      }
      toast("Nota registrada."); render();
    } });
};

/* ---------- v18: DIMOB do ano (Ficha 02 · Locação) ----------
   Uma linha por locador × locatário × imóvel, com aluguel e comissão de cada mês (mês do pagamento).
   Gera a planilha de conferência e o arquivo de texto no leiaute do programa Dimob. */
const semAcento = t => String(t || "").replace(/\bn[º°]\s*/gi, "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 ,.\-/º°]/g, " ").replace(/[º°]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const MUN_RFB = { "MONTE MOR": "6737" };
const dimCampo = (v, n, num) => num ? String(v).replace(/\D/g, "").padStart(n, "0").slice(-n) : semAcento(v).padEnd(n, " ").slice(0, n);
const dimValor = v => String(Math.round((+v || 0) * 100)).padStart(14, "0");
async function montarDimob(ano, todos) {
  const ini = ano + "-01-01", fim = ano + "-12-31";
  const [cobs, ctts] = await Promise.all([
    fetchAll("cobrancas", b => b.gte("data_pagamento", ini).lte("data_pagamento", fim).order("data_pagamento"), "id,imovel_id,competencia,locatario,valor,taxa_valor,taxa_adm_pct,ajustes,acrescimos,descontos,valor_pago,data_pagamento"),
    fetchAll("contratos", b => b.order("codigo"), "codigo,imovel_id,locatario,inicio,data_contrato,termino,data_encerramento,situacao,endereco,ficha")
  ]);
  const L = {};
  cobs.forEach(c => {
    const im = S.imovelPor[c.imovel_id]; if (!im || im.carteira === "proprio" || im.carteira === "socio") return;
    if (!todos && im.declarar_ir !== "Sim") return;
    const nl = norm(c.locatario || "");
    const ct = ctts.filter(x => x.imovel_id === im.id && x.situacao !== "CANCELADO").find(x => nl && norm(x.locatario || "").includes(nl.split(" - ")[0])) || ctts.find(x => x.codigo === im.contrato_codigo) || null;
    const fc = ct ? fichaDe(ct) : {}, fi = im.ficha || {}, mes = +c.data_pagamento.slice(5, 7) - 1, taxa = c.taxa_valor != null ? +c.taxa_valor : calcCob(c).taxa;
    tomadoresImv(im).forEach(t => {
      const k = [im.id, ct ? ct.codigo : nl, soDig(t.doc) || norm(t.nome)].join("|");
      const cid = semAcento(fc.end_cidade || fi.end_cidade || TIMBRE.cidade).replace(/\/.*$/, "").replace(/\s+SP$/, "").trim();
      const x = L[k] = L[k] || { im, ct, lcd: t.nome, lcdDoc: t.doc, lct: fc.lct1_nome || separaNomes(c.locatario)[0] || "", lctDoc: fc.lct1_cpf || "",
        num: ct ? soDig(ct.codigo).slice(-6) : "", data: ct ? (ct.data_contrato || ct.inicio || "") : "", end: fc.end_rua || fi.end_rua || im.endereco, cep: fc.end_cep || fi.end_cep || "",
        cidade: cid, mun: MUN_RFB[cid] || "", rural: /rural|s[ií]tio|ch[aá]cara|fazenda/i.test(im.tipo || ""), alug: Array(12).fill(0), com: Array(12).fill(0) };
      x.alug[mes] = r2(x.alug[mes] + +c.valor * t.parte); x.com[mes] = r2(x.com[mes] + taxa * t.parte);
    });
  });
  const ls = Object.values(L).sort((a, b) => COLL.compare(a.lcd, b.lcd) || COLL.compare(a.lct, b.lct));
  ls.forEach(x => { x.err = []; const d1 = soDig(x.lcdDoc).length, d2 = soDig(x.lctDoc).length;
    if (d1 !== 11 && d1 !== 14) x.err.push("CPF/CNPJ do locador"); if (d2 !== 11 && d2 !== 14) x.err.push("CPF/CNPJ do locatário");
    if (!x.data) x.err.push("data do contrato"); if (soDig(x.cep).length !== 8) x.err.push("CEP"); if (!x.mun) x.err.push("código do município (" + (x.cidade || "?") + ")"); });
  return ls;
}
function dimobTXT(ano, ls, cpfResp) {
  const cnpj = soDig(TIMBRE.cnpj), nome = TIMBRE.razao.split(" — ")[0], endE = TIMBRE.rodape[0].split(" – ")[0];
  const lin = [];
  lin.push("DIMOB" + " ".repeat(7) + ano + " ".repeat(5) + cnpj + "0000" + dimCampo(nome, 60) + "SP" + " ".repeat(273));
  lin.push("R01" + cnpj + ano + "0" + "0".repeat(10) + "0" + "0".repeat(8) + "00" + dimCampo(nome, 60) + dimCampo(cpfResp, 11, true) + dimCampo(endE, 120) + "SP" + "6737" + dimCampo(TIMBRE.cidade, 20) + " ".repeat(10));
  ls.forEach((x, k) => {
    let r = "R02" + cnpj + ano + String(k + 1).padStart(7, "0") + soDig(x.lcdDoc).padEnd(14, " ").slice(0, 14) + dimCampo(x.lcd, 60) + soDig(x.lctDoc).padEnd(14, " ").slice(0, 14) + dimCampo(x.lct, 60)
      + dimCampo(x.num || "0", 6, true) + (x.data ? x.data.slice(8, 10) + x.data.slice(5, 7) + x.data.slice(0, 4) : "00000000");
    for (let m = 0; m < 12; m++) r += dimValor(x.alug[m]) + dimValor(x.com[m]) + dimValor(0);
    r += (x.rural ? "R" : "U") + dimCampo(x.end, 60) + dimCampo(x.cep, 8, true) + dimCampo(x.mun, 4, true) + dimCampo(x.cidade, 20) + "SP" + " ".repeat(10);
    lin.push(r);
  });
  lin.push("T9" + cnpj + ano + String(lin.length - 1).padStart(8, "0") + " ".repeat(76));
  return lin.join("\r\n") + "\r\n";
}
ACT["dimob"] = async () => {
  const anoPad = String(+hoje().slice(0, 4) - 1);
  const cfg = await q(sb.from("config").select("valor").eq("chave", "dimob_cpf_resp").maybeSingle()).catch(() => null);
  let LS = [];
  modal({ titulo: "DIMOB · locações do ano", xl: true, semOk: true,
    corpo: `<div class="row"><label class="fl"><span>Ano-calendário</span><input type="number" name="ano" value="${anoPad}" min="2020" max="2100"></label>
      <label class="fl"><span>CPF do responsável perante a Receita</span><input name="cpf" value="${esc((cfg && cfg.valor) || "")}" placeholder="000.000.000-00"></label>
      <label class="chk" style="align-self:end"><input type="checkbox" name="todos"> incluir também imóveis com “Declara IR = Não”</label>
      <label class="fl"><span>&nbsp;</span><button type="button" class="btn pri" data-dim-ok>Montar</button></label></div>
      <div data-dim-res><p class="hint">Uma linha por locador × locatário × imóvel. Valores pelo mês do <b>pagamento</b> do aluguel: rendimento bruto = aluguel; comissão = taxa de administração. O locador é o proprietário ou o favorecido indicado no cadastro do imóvel (o mesmo das notas fiscais).</p></div>`,
    aoAbrir: (f, d) => {
      if (typeof mascaraDoc === "function") mascaraDoc(f.cpf);
      $("[data-dim-ok]", d).addEventListener("click", async () => {
        const res = $("[data-dim-res]", d); res.innerHTML = `<p class="hint">Montando…</p>`;
        try {
          LS = await montarDimob(f.ano.value, f.todos.checked);
          const nErr = LS.filter(x => x.err.length).length, tA = LS.reduce((a, x) => a + x.alug.reduce((s, v) => s + v, 0), 0), tC = LS.reduce((a, x) => a + x.com.reduce((s, v) => s + v, 0), 0);
          res.innerHTML = `<div class="kpis" style="margin:8px 0">${kpi("Locações", String(LS.length), "linhas da Ficha 02", true)}${kpi("Com pendência", `<span class="${nErr ? "neg" : ""}">${nErr}</span>`, "corrija antes de importar")}${kpi("Aluguéis", brl(tA), "rendimento bruto")}${kpi("Comissões", brl(tC), "taxa de administração")}</div>
            <div class="row" style="margin-bottom:8px"><button type="button" class="btn" data-dim-xls>⬇ Planilha de conferência (Excel)</button><button type="button" class="btn pri" data-dim-txt>⬇ Arquivo para o programa Dimob (.txt)</button></div>
            <div class="tw" style="max-height:46vh"><table class="compacta"><thead><tr><th>Locador</th><th>CPF/CNPJ</th><th>Locatário</th><th>CPF/CNPJ</th><th>Contrato</th><th>Imóvel</th><th class="num">Aluguéis</th><th class="num">Comissões</th><th>Pendências</th></tr></thead><tbody>
            ${LS.map(x => `<tr${x.err.length ? ' class="neg-l"' : ""}><td>${tagPes([x.lcd], "etq-lcd", x.lcd)}</td><td class="mono nw">${esc(x.lcdDoc)}</td><td>${tagPes([x.lct], "etq-lct", x.lct)}</td><td class="mono nw">${esc(x.lctDoc)}</td><td>${x.ct ? tagCtt(x.ct.codigo) : ""}${x.data ? `<br><small>${dt(x.data)}</small>` : ""}</td><td>${tagImv(x.im.endereco)}</td><td class="num">${n2(x.alug.reduce((a, v) => a + v, 0))}</td><td class="num">${n2(x.com.reduce((a, v) => a + v, 0))}</td><td>${x.err.length ? x.err.map(e => `<span class="tag bad">${esc(e)}</span>`).join(" ") : `<span class="tag ok">ok</span>`}</td></tr>`).join("") || `<tr><td colspan="9" class="muted">Nenhum aluguel pago neste ano.</td></tr>`}</tbody></table></div>`;
          $("[data-dim-xls]", res).addEventListener("click", () => baixarXLSX(`dimob-${f.ano.value}-conferencia.xlsx`, { Locacoes: LS.map(x => Object.assign({ "CPF/CNPJ locador": x.lcdDoc, "Locador": x.lcd, "CPF/CNPJ locatário": x.lctDoc, "Locatário": x.lct, "Nº contrato": x.num, "Data contrato": x.data ? dt(x.data) : "",
            "Tipo": x.rural ? "Rural" : "Urbano", "Endereço": x.end, "UF": "SP", "Município": x.cidade, "CEP": x.cep },
            Object.fromEntries(MES3.flatMap((m, i) => [[m + " aluguel", x.alug[i]], [m + " comissão", x.com[i]]])), { "Total aluguel": r2(x.alug.reduce((a, v) => a + v, 0)), "Total comissão": r2(x.com.reduce((a, v) => a + v, 0)), "Pendências": x.err.join(", ") })) }));
          $("[data-dim-txt]", res).addEventListener("click", async () => {
            const cpf = soDig(f.cpf.value); if (cpf.length !== 11) return toast("Informe o CPF do responsável (11 dígitos).", true);
            if (LS.some(x => x.err.length) && !confirm("Há locações com pendências. Gerar o arquivo mesmo assim?")) return;
            try { await q(sb.from("config").upsert({ chave: "dimob_cpf_resp", valor: f.cpf.value.trim() })); } catch (e) { /* só administrador grava */ }
            baixarArquivo(`DIMOB-${f.ano.value}-${soDig(TIMBRE.cnpj)}.txt`, dimobTXT(f.ano.value, LS, cpf), "text/plain;charset=us-ascii");
          });
        } catch (e) { res.innerHTML = `<div class="box bad">${esc(e.message || e)}</div>`; }
      });
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
// v16: escolher clicando numa lista (com filtro para diminuir a lista)
function escolherNaLista(titulo, itens, dica) {
  let esc0 = null;
  return new Promise(res => modal({ titulo, xl: true, semOk: true,
    corpo: `${dica ? `<p class="hint">${dica}</p>` : ""}<input type="search" class="pk-busca" placeholder="Filtrar a lista (nome, endereço, contrato)…" autocomplete="off"><div class="pk-lista esc-lista"></div>`,
    aoFechar: () => { $("#dlg").classList.remove("esc-dlg"); res(esc0); },
    aoAbrir: (f, d) => { d.classList.add("esc-dlg");
      const b = $(".pk-busca", d), l = $(".esc-lista", d);
      const des = () => { const q2 = norm(b.value.trim()), vs = itens.filter(x => !q2 || norm(x.busca || "").includes(q2)).slice(0, 300);
        l.innerHTML = vs.length ? vs.map(x => `<div class="esc-it" role="button" tabindex="0" data-k="${itens.indexOf(x)}">${x.html}</div>`).join("") : `<p class="hint">Nada encontrado.</p>`;
        $$("[data-k]", l).forEach(bt => bt.addEventListener("click", ev => { if (ev.target.closest("a[data-pasta]")) return; ev.preventDefault(); ev.stopPropagation(); esc0 = itens[+bt.dataset.k]; d.close(); }, true)); };
      b.addEventListener("input", des); b.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); const x = $("[data-k]", l); if (x) x.click(); } }); des(); b.focus();
    } }));
}
// escolher um contrato (para os termos abertos pelo menu, sem contrato definido)
async function escolherContrato(titulo, filtro) {
  if (!CTT.length) CTT = await fetchAll("contratos", b => b.order("codigo", { ascending: false }));
  const ls = CTT.filter(c => c.situacao !== "CANCELADO" && (!filtro || filtro(c)));
  const it = ls.map(c => { const im = imvDoCtt(c);
    return { v: c, busca: [c.codigo, c.locatario, c.endereco, im && im.endereco].join(" "), html: `<span class="mono esc-cod">${esc(c.codigo)}</span><span class="tag ${SIT_CTT[c.situacao] || "idle"}">${esc(sitTxt(c.situacao))}</span>${im ? tagImv(im.endereco) : c.endereco ? `<span class="etq etq-imv">🏠 ${esc(rotuloImv(c.endereco))}</span>` : ""}${tagPes(nomesCtt(c, "lct").length ? nomesCtt(c, "lct") : separaNomes(c.locatario), "etq-lct", "", 2)}` }; });
  const r = await escolherNaLista(titulo, it, "Clique no contrato. Use o filtro para diminuir a lista.");
  return r ? r.v : null;
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
    opts = Object.assign({}, opts, { clientes: lct.filter(Boolean), papelCliente: pl ? "Locatário" : "Locatário(a)" });
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
  const it = INAD.map(i => ({ v: ["inad", i.id], busca: [i.locatario, i.imovel, i.locador].join(" "), html: `<span class="tag bad">inadimplente</span>${tagImv(i.imovel)}${tagPes(separaNomes(i.locatario), "etq-lct", "", 2)}<small class="muted">${brl(i.total || 0)}</small>` }))
    .concat(devs.map(d => ({ v: ["dev", d.id], busca: [d.devedor, d.endereco].join(" "), html: `<span class="tag warn">devedor</span>${tagImv(d.endereco)}${tagPes(separaNomes(d.devedor), "etq-lct", "", 2)}<small class="muted">${esc((SIT_DEV[d.situacao] || [d.situacao])[0])}</small>` })));
  if (!it.length) return toast("Nenhum inadimplente ou devedor em aberto.", true);
  const r = await escolherNaLista(x.t + " · para quem?", it, "Clique na pessoa. Use o filtro para diminuir a lista.");
  if (!r) return;
  const [src, id] = r.v; if (src === "dev") DEV = await fetchAll("devedores", b => b.order("id"));
  setTimeout(() => ACT["cob-termo"]({ dataset: { src, id, tipo: x.k } }), 0);
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

/* =====================================================================
   v14: termos em PDF A4, no mesmo desenho dos apps antigos
   (cabeçalho com logo, marca d'água, texto justificado em Helvetica 11,
   bloco centralizado na folha, rodapé vermelho no pé da página,
   assinatura da imobiliária, espaço para o cliente e modo "escaneado")
   ===================================================================== */
const carregarScript = src => new Promise((ok, erro) => {
  const ja = document.querySelector(`script[data-v14="${src}"]`);
  if (ja) { if (ja.dataset.ok) ok(); else { ja.addEventListener("load", () => ok()); ja.addEventListener("error", () => erro(new Error("Não carregou " + src))); } return; }
  const s = document.createElement("script"); s.src = src; s.dataset.v14 = src;
  s.addEventListener("load", () => { s.dataset.ok = "1"; ok(); }); s.addEventListener("error", () => erro(new Error("Não foi possível carregar " + src)));
  document.head.appendChild(s);
});
let PDFLIB_P = null, PDFJS_P = null, TERMO_IMGS = null;
const usarPdfLib = () => PDFLIB_P || (PDFLIB_P = carregarScript("termos/vendor/pdf-lib.min.js").then(() => window.PDFLib).catch(e => { PDFLIB_P = null; throw e; }));
const usarPdfJs = () => PDFJS_P || (PDFJS_P = carregarScript("termos/vendor/pdf.min.js").then(() => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "termos/vendor/pdf.worker.min.js"; return window.pdfjsLib; }).catch(e => { PDFJS_P = null; throw e; }));
const bytesUrl = async url => { const r = await fetch(url, { cache: "force-cache" }); if (!r.ok) throw new Error("Imagem não encontrada: " + url); return new Uint8Array(await r.arrayBuffer()); };
const imgsTermo = () => TERMO_IMGS || (TERMO_IMGS = Promise.all([bytesUrl("img/logo.png"), bytesUrl("img/assinatura-imob.png")]).catch(e => { TERMO_IMGS = null; throw e; }));
const IMOB_NOME = () => TIMBRE.razao.split(" — ")[0];
const ehImob = txt => norm(txt).includes(norm(IMOB_NOME()).slice(0, 18));

// ---- 1. HTML editado -> blocos ----
function linhasDe(el) {
  const ls = [[]], nova = () => { if (ls[ls.length - 1].length) ls.push([]); };
  const anda = (n, b, sm) => {
    if (n.nodeType === 3) { const t = n.nodeValue.replace(/[\s ]+/g, " "); if (t) ls[ls.length - 1].push({ t, b, sm }); return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName, fw = n.style ? n.style.fontWeight : "";
    if (tag === "BR") { ls.push([]); return; }
    const bb = b || tag === "B" || tag === "STRONG" || fw === "bold" || +fw >= 600, ss = sm || tag === "SMALL";
    const bloco = /^(DIV|P|LI|H\d)$/.test(tag);
    if (bloco) nova();
    n.childNodes.forEach(c => anda(c, bb, ss));
    if (bloco) nova();
  };
  el.childNodes.forEach(c => anda(c, false, false));
  // tira espaços do começo e do fim de cada linha e linhas vazias
  return ls.map(l => { const x = l.map(r => Object.assign({}, r)); if (x.length) { x[0].t = x[0].t.replace(/^ +/, ""); x[x.length - 1].t = x[x.length - 1].t.replace(/ +$/, ""); } return x.filter(r => r.t); }).filter(l => l.length);
}
const textoDe = l => l.map(r => r.t).join("");
function blocosDoDoc(raiz) {
  const B = [];
  const alinDe = (el, padrao) => { const ta = (el.style && el.style.textAlign) || ""; return el.classList.contains("doc-data") || el.classList.contains("doc-tot") || ta === "right" ? "dir" : ta === "center" ? "cen" : padrao; };
  const visita = el => {
    if (el.nodeType === 3) { const t = el.nodeValue.replace(/[\s ]+/g, " ").trim(); if (t) B.push({ tipo: "p", linhas: [[{ t, b: false }]], alin: "just" }); return; }
    if (el.nodeType !== 1) return;
    const tag = el.tagName, cl = el.classList;
    if (tag === "H1" || tag === "H2") return B.push({ tipo: "tit", linhas: linhasDe(el) });
    if (/^H[3-6]$/.test(tag)) return B.push({ tipo: "sec", linhas: linhasDe(el) });
    if (tag === "TABLE") {
      const rows = $$("tr", el).map(tr => ({ cab: !!tr.closest("thead"), tot: !!tr.closest("tfoot") || tr.classList.contains("tot"),
        cel: $$("th,td", tr).map(td => ({ linhas: linhasDe(td), num: td.classList.contains("num"), span: +td.getAttribute("colspan") || 1, b: td.tagName === "TH" })) })).filter(r => r.cel.length);
      if (rows.length) B.push({ tipo: "tab", rows, estreita: cl.contains("doc-tots") });
      return;
    }
    if (cl.contains("doc-ass")) {
      const ps = $$(":scope > div", el).map(d => linhasDe(d)).map(ls => ls.length ? ls : [[{ t: "", b: true }]]);
      if (ps.length) B.push({ tipo: "ass", pessoas: ps });
      return;
    }
    if (tag === "UL" || tag === "OL") { $$(":scope > li", el).forEach((li, i) => { const ls = linhasDe(li); if (ls.length) { ls[0].unshift({ t: tag === "OL" ? `${i + 1}. ` : "• ", b: false }); B.push({ tipo: "p", linhas: ls, alin: "esq" }); } }); return; }
    if (tag === "DIV" && !el.textContent.trim()) { const h = parseFloat(el.style.height) || 0; if (h) B.push({ tipo: "esp", h: h * 0.75 }); return; }
    // div que só embrulha outros blocos (acontece ao editar): entra nele
    if (tag === "DIV" && !cl.contains("doc-receb") && $$(":scope > p, :scope > h2, :scope > h3, :scope > table, :scope > div", el).length) return el.childNodes.forEach(visita);
    const ls = linhasDe(el); if (!ls.length) return;
    B.push({ tipo: "p", linhas: ls, alin: alinDe(el, cl.contains("doc-enderecamento") ? "esq" : "just"), data: cl.contains("doc-data"), caixa: cl.contains("doc-receb"), recuo: cl.contains("doc-rec") });
  };
  raiz.childNodes.forEach(visita);
  return B;
}

// ---- 2. blocos -> PDF ----
async function termoPDF(blocos, op) {
  op = Object.assign({ timbre: true, assImob: true, assCliente: true }, op || {});
  const { PDFDocument, StandardFonts, rgb } = await usarPdfLib();
  const [logoB, assB] = await imgsTermo();
  const pdf = await PDFDocument.create();
  pdf.setTitle(op.titulo || "Documento"); pdf.setCreator("FICA ImobOne");
  const FR = await pdf.embedFont(StandardFonts.Helvetica), FB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(logoB), assImg = await pdf.embedPng(assB);
  const L = 595.28, A = 841.89, M = 60, LM = L - 2 * M, TAM = 11, EL = 17, RODAPE = 58;
  const PRETO = rgb(0.13, 0.13, 0.13), VERM = rgb(0.55, 0.09, 0.14), AZUL = rgb(0.102, 0.176, 0.42), CINZA = rgb(0.4, 0.45, 0.55), LINHA = rgb(0.6, 0.6, 0.6);
  // só caracteres que a Helvetica do PDF consegue escrever
  const okCh = new Map();
  const limpa = s => Array.from(String(s).replace(/[‐-‒]/g, "-").replace(/…/g, "...").replace(/[ \t]/g, " ")).map(ch => {
    if (!okCh.has(ch)) { try { FR.encodeText(ch); okCh.set(ch, true); } catch (e) { okCh.set(ch, false); } }
    return okCh.get(ch) ? ch : ch === "≈" ? "~" : "";
  }).join("");
  const W = (t, b, sz) => (b ? FB : FR).widthOfTextAtSize(limpa(t), sz);
  // palavras com pedaços em negrito
  const palavras = linha => { const ps = []; let atual = [];
    linha.forEach(r => { const partes = limpa(r.t).split(" "); partes.forEach((p, i) => { if (i > 0) { if (atual.length) ps.push(atual); atual = []; } if (p) atual.push({ t: p, b: r.b }); }); });
    if (atual.length) ps.push(atual); return ps; };
  const largP = (p, sz) => p.reduce((a, f) => a + W(f.t, f.b, sz), 0);
  const quebra = (linhas, sz, larg) => { const out = [];
    linhas.forEach(l => { const ws = palavras(l), esp = W(" ", false, sz); let cur = [], w = 0;
      ws.forEach(p => { const lp = largP(p, sz), e = cur.length ? esp : 0; if (cur.length && w + e + lp > larg) { out.push({ ws: cur, fim: false }); cur = [p]; w = lp; } else { cur.push(p); w += e + lp; } });
      out.push({ ws: cur, fim: true }); });
    return out; };
  const escreve = (pg, ws, x, y, sz, larg, alin, fim, cor) => {
    const esp = W(" ", false, sz), tot = ws.reduce((a, p) => a + largP(p, sz), 0) + esp * Math.max(0, ws.length - 1);
    let gap = esp, x0 = x;
    if (alin === "just" && !fim && ws.length > 1) gap = (larg - ws.reduce((a, p) => a + largP(p, sz), 0)) / (ws.length - 1);
    else if (alin === "dir") x0 = x + larg - tot; else if (alin === "cen") x0 = x + (larg - tot) / 2;
    ws.forEach(p => { p.forEach(f => { pg.drawText(f.t, { x: x0, y, size: sz, font: f.b ? FB : FR, color: cor || PRETO }); x0 += W(f.t, f.b, sz); }); x0 += gap; });
  };
  const espacar = t => t.split(" ").map(w => Array.from(w).join(" ")).join("    ");

  // itens com altura fixa; cada um sabe se desenhar a partir do topo (yTopo)
  const itens = [], add = (h, fn, junto) => itens.push({ h, fn, junto: !!junto }), esp = (h, junto) => itens.push({ h, fn: () => {}, junto: !!junto, esp: true });
  let temAssImob = false;
  blocos.forEach((b, bi) => {
    const prox = blocos[bi + 1];
    if (b.tipo === "esp") return esp(b.h);
    if (b.tipo === "tit") {
      b.linhas.forEach((l, i) => {
        if (i === 0) { const t = espacar(textoDe(l).toUpperCase()); let sz = 15; while (W(t, true, sz) > LM && sz > 9) sz -= 0.5;
          add(sz + 12, (pg, y) => pg.drawText(limpa(t), { x: (L - W(t, true, sz)) / 2, y: y - sz, size: sz, font: FB, color: PRETO }), true); }
        else { const t = textoDe(l), sb = l.some(r => r.sm) ? 10.5 : 12; add(16, (pg, y) => pg.drawText(limpa(t), { x: (L - W(t, true, sb)) / 2, y: y - 13, size: sb, font: FB, color: PRETO }), true); }
      });
      return esp(26, true);
    }
    if (b.tipo === "sec") { esp(8, true); quebra(b.linhas.map(l => l.map(r => Object.assign({}, r, { b: true }))), TAM, LM).forEach(ln => add(EL, (pg, y) => escreve(pg, ln.ws, M, y - 12, TAM, LM, "esq", true), true)); return esp(4); }
    if (b.tipo === "p") {
      if (b.data) esp(14);
      const sz = b.caixa ? 9.5 : TAM, el = b.caixa ? 14 : EL;
      const ls = quebra(b.linhas, sz, LM - (b.caixa ? 16 : 0));
      const prende = b.data && prox && prox.tipo === "ass"; // a data vai junto com as assinaturas
      ls.forEach((ln, i) => add(el, (pg, y) => escreve(pg, ln.ws, M + (b.caixa ? 8 : 0), y - (el - 5), sz, LM - (b.caixa ? 16 : 0), b.alin, ln.fim, PRETO), prende || (i < ls.length - 1 && i < 1)));
      if (b.caixa) { const h = ls.length * el; itens[itens.length - ls.length].moldura = h; }
      return esp(prox && prox.tipo === "p" ? 9 : 12, b.data && prox && prox.tipo === "ass");
    }
    if (b.tipo === "tab") {
      const sz = 9.5, pad = 4, ncol = Math.max(...b.rows.map(r => r.cel.reduce((a, c) => a + c.span, 0)));
      const largT = b.estreita ? LM * 0.62 : LM, x0 = M + LM - largT;
      const nat = Array(ncol).fill(20);
      b.rows.forEach(r => { let k = 0; r.cel.forEach(c => { if (c.span === 1) nat[k] = Math.max(nat[k], Math.max(...c.linhas.map(l => W(textoDe(l), c.b || r.cab || r.tot, sz)), 0) + 2 * pad); k += c.span; }); });
      const soma = nat.reduce((a, x) => a + x, 0);
      let larg = nat.map(x => x * largT / soma);
      if (soma < largT) { const extra = largT - soma; larg = nat.map((x, i) => x + (i === 0 ? extra : 0)); }
      b.rows.forEach(r => {
        let k = 0; const cs = r.cel.map(c => { const w = larg.slice(k, k + c.span).reduce((a, x) => a + x, 0), x = x0 + larg.slice(0, k).reduce((a, x2) => a + x2, 0); k += c.span;
          return { x, w, ls: quebra(c.linhas.map(l => l.map(rr => Object.assign({}, rr, { b: rr.b || c.b || r.cab || r.tot }))), sz, w - 2 * pad), num: c.num }; });
        const h = Math.max(1, ...cs.map(c => c.ls.length)) * 12.5 + 6;
        add(h, (pg, y) => {
          if (r.cab) pg.drawLine({ start: { x: x0, y }, end: { x: x0 + largT, y }, thickness: 0.9, color: PRETO });
          cs.forEach(c => c.ls.forEach((ln, i) => escreve(pg, ln.ws, c.x + pad, y - 12 - i * 12.5, sz, c.w - 2 * pad, c.num ? "dir" : "esq", true)));
          pg.drawLine({ start: { x: x0, y: y - h }, end: { x: x0 + largT, y: y - h }, thickness: r.cab || r.tot ? 0.9 : 0.4, color: r.cab || r.tot ? PRETO : LINHA });
          if (r.tot) pg.drawLine({ start: { x: x0, y }, end: { x: x0 + largT, y }, thickness: 0.9, color: PRETO });
        });
      });
      return esp(12);
    }
    if (b.tipo === "ass") {
      let ps = b.pessoas.map(ls => ({ ls, imob: ehImob(textoDe(ls[0] || [])) }));
      if (op.assCliente && (op.clientes || []).length && bi === blocos.findIndex(x => x.tipo === "ass")) {
        const ja = new Set(ps.map(p => norm(textoDe(p.ls[0] || []))));
        op.clientes.filter(n => n && !ja.has(norm(n))).forEach(n => ps.push({ ls: [[{ t: n, b: true }]].concat(op.papelCliente ? [[{ t: op.papelCliente, sm: true }]] : []), imob: false }));
      }
      if (!op.assCliente) ps = ps.filter(p => p.imob);
      if (!ps.length) return;
      const LL = 220, xEsq = M, xDir = M + LM - LL;
      const imob = ps.filter(p => p.imob), outros = ps.filter(p => !p.imob);
      // linhas de assinatura: imobiliária à direita, os demais à esquerda (como nos apps antigos);
      // muitos assinantes: duas colunas, na ordem
      const pares = [];
      if (imob.length === 1 && outros.length <= 4) { pares.push([outros[0] || null, imob[0]]); outros.slice(1).forEach(p => pares.push([p, null])); }
      else for (let i = 0; i < ps.length; i += 2) pares.push([ps[i], ps[i + 1] || null]);
      pares.forEach((par, pi) => {
        const comImg = op.assImob && par.some(p => p && p.imob);
        if (comImg) temAssImob = true;
        const acima = comImg ? (pi === 0 ? 118 : 110) : (pi === 0 ? 62 : 46);
        const nl = Math.max(...par.map(p => p ? (p.imob ? 2 : p.ls.length) : 0));
        add(acima + 6 + nl * 13, (pg, y) => {
          const yl = y - acima;
          par.forEach((p, lado) => {
            if (!p) return;
            const x = lado ? xDir : xEsq;
            if (p.imob && op.assImob) { const wI = 150, hI = wI * (assImg.height / assImg.width); pg.drawImage(assImg, { x: x + LL - wI - 35, y: yl - 45, width: wI, height: hI }); }
            pg.drawLine({ start: { x, y: yl }, end: { x: x + LL, y: yl }, thickness: 1, color: PRETO });
            if (p.imob) {
              const t1 = IMOB_NOME() + ".", t2 = "CRECI 4419-J";
              if (lado) { pg.drawText(limpa(t1), { x: x + LL - W(t1, true, 11), y: yl - 16, size: 11, font: FB, color: PRETO }); pg.drawText(t2, { x: x + LL - W(t2, true, 10), y: yl - 30, size: 10, font: FB, color: PRETO }); }
              else { pg.drawText(limpa(t1), { x: x + (LL - W(t1, true, 10)) / 2, y: yl - 16, size: 10, font: FB, color: PRETO }); pg.drawText(t2, { x: x + (LL - W(t2, true, 9)) / 2, y: yl - 29, size: 9, font: FB, color: PRETO }); }
            } else p.ls.forEach((l, i) => { const sm = i > 0 || l.every(r => r.sm), t = i === 0 ? textoDe(l).toUpperCase() : textoDe(l), sz = sm ? 8.5 : 10;
              let tt = t; while (W(tt, !sm, sz) > LL + 30 && tt.length > 4) tt = tt.slice(0, -2);
              pg.drawText(limpa(tt), { x: x + (LL - W(tt, !sm, sz)) / 2, y: yl - 15 - i * 12, size: sz, font: sm ? FR : FB, color: PRETO }); });
          });
        }, pi < pares.length - 1);
        itens[itens.length - 1].ass = true;
      });
      return esp(10);
    }
  });

  // ---- 3. paginação ----
  const topo = op.timbre ? A - M - 46 - 14 - 22 : A - 64, base = op.timbre ? RODAPE + 16 : 56, util = topo - base;
  const paginas = [[]]; let usado = 0;
  itens.forEach((it, i) => {
    if (it.esp && usado + it.h > util) return; // espaço em branco no fim da página: some
    // assinaturas não ficam sozinhas no topo de uma página nem são cortadas
    if (usado + it.h > util && paginas[paginas.length - 1].length) {
      const pg = paginas[paginas.length - 1];
      // leva junto a linha anterior "presa" (título, primeira linha do parágrafo)
      const levar = []; while (pg.length && pg[pg.length - 1].junto) levar.unshift(pg.pop());
      if (!pg.length || levar.reduce((a, x) => a + x.h, 0) + it.h > util) { pg.push(...levar); levar.length = 0; } // não dá para levar tudo: quebra aqui mesmo
      paginas.push(levar); usado = levar.reduce((a, x) => a + x.h, 0);
    }
    paginas[paginas.length - 1].push(it); usado += it.h;
  });
  // tira espaços sobrando no fim de cada página
  const alturaPg = p => p.reduce((a, x) => a + x.h, 0);
  paginas.forEach((p, n) => {
    const pg = pdf.addPage([L, A]);
    if (op.timbre) {
      const mw = 320, mh = mw * (logo.height / logo.width);
      pg.drawImage(logo, { x: (L - mw) / 2, y: (A - mh) / 2, width: mw, height: mh, opacity: 0.07 });
      const yC = A - M, lh = 46, lw = lh * (logo.width / logo.height);
      pg.drawImage(logo, { x: M, y: yC - lh, width: lw, height: lh });
      pg.drawText(limpa(TIMBRE.razao), { x: M + lw + 16, y: yC - 12, size: 9, font: FB, color: VERM });
      pg.drawText(limpa(TIMBRE.nome), { x: M + lw + 16, y: yC - 34, size: 18, font: FB, color: AZUL });
      const yF = yC - lh - 14;
      pg.drawLine({ start: { x: M, y: yF }, end: { x: L - M, y: yF }, thickness: 2.5, color: VERM });
      pg.drawLine({ start: { x: M, y: RODAPE - 10 }, end: { x: L - M, y: RODAPE - 10 }, thickness: 2.5, color: VERM });
      TIMBRE.rodape.forEach((t, i) => { const tt = limpa(t); pg.drawText(tt, { x: (L - FR.widthOfTextAtSize(tt, 7.5)) / 2, y: RODAPE - 24 - i * 11, size: 7.5, font: FR, color: CINZA }); });
    }
    if (paginas.length > 1) { const t = `Página ${n + 1} de ${paginas.length}`; pg.drawText(t, { x: L - M - FR.widthOfTextAtSize(t, 8), y: op.timbre ? RODAPE - 4 + 0 : 30, size: 8, font: FR, color: CINZA }); }
    // uma página só: o bloco fica no meio da folha (um pouco acima do centro), como nos apps antigos
    let y = topo;
    if (paginas.length === 1) { const h = alturaPg(p); y = Math.min(topo, base + util * 0.6 + h / 2); if (y - h < base) y = topo; }
    p.forEach(it => { it.fn(pg, y); if (it.moldura) pg.drawRectangle({ x: M, y: y - it.moldura - 2, width: LM, height: it.moldura + 4, borderColor: LINHA, borderWidth: 0.8, borderDashArray: [3, 2] }); y -= it.h; });
  });
  pdf._temAssImob = temAssImob;
  return pdf;
}
// "escaneado": cada página vira uma imagem (não dá para selecionar ou editar o texto)
async function achatarTermo(pdf) {
  const { PDFDocument } = await usarPdfLib(), pdfjs = await usarPdfJs();
  const doc = await pdfjs.getDocument({ data: await pdf.save(), isEvalSupported: false, standardFontDataUrl: "termos/vendor/standard_fonts/" }).promise, novo = await PDFDocument.create();
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i), vp = pg.getViewport({ scale: 2.5 }), cv = document.createElement("canvas");
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: cx, viewport: vp }).promise;
    const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.9)), img = await novo.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const { width, height } = pg.getViewport({ scale: 1 }); novo.addPage([width, height]).drawImage(img, { x: 0, y: 0, width, height });
  }
  return novo;
}
// páginas do PDF como imagens (para a prévia e para imprimir)
async function paginasImg(bytes, escala) {
  const pdfjs = await usarPdfJs(), doc = await pdfjs.getDocument({ data: bytes.slice(0), isEvalSupported: false, standardFontDataUrl: "termos/vendor/standard_fonts/" }).promise, out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i), vp = pg.getViewport({ scale: escala || 1.5 }), cv = document.createElement("canvas");
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: cx, viewport: vp }).promise; out.push(cv);
  }
  return out;
}
function imprimirPaginas(canvases) {
  const area = $("#print-area");
  area.innerHTML = canvases.map(cv => `<img class="pg-a4" src="${cv.toDataURL("image/png")}" alt="">`).join("");
  let pg = $("#print-page"); if (!pg) { pg = document.createElement("style"); pg.id = "print-page"; document.head.appendChild(pg); }
  pg.textContent = `@media print{@page{size:A4 portrait;margin:0}}`;
  document.body.classList.add("imprimindo");
  const fim = () => { document.body.classList.remove("imprimindo"); area.innerHTML = ""; window.removeEventListener("afterprint", fim); };
  window.addEventListener("afterprint", fim);
  const imgs = $$("img", area); Promise.all(imgs.map(i => i.complete ? 1 : new Promise(r => { i.onload = r; i.onerror = r; }))).then(() => setTimeout(() => window.print(), 60));
}
const nomeArqPDF = t => String(t || "documento").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w .-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 90) + ".pdf";

// janela do documento: texto editável + opções + prévia A4 + baixar / imprimir
function abrirDocEditavel(titulo, corpo, opts) {
  opts = opts || {};
  const tmp = document.createElement("div"); tmp.innerHTML = corpo;
  const temImob = $$(".doc-ass > div", tmp).some(x => ehImob(x.innerHTML.split(/<br\s*\/?>/i)[0].replace(/<[^>]+>/g, " ")));
  const chk = (k, t, on, dica) => `<label class="chk" title="${esc(dica || "")}"><input type="checkbox" data-op="${k}" ${on ? "checked" : ""}> ${t}</label>`;
  modal({ titulo, xl: true, semOk: true,
    extra: `<div class="doc-ops">${chk("timbre", "Papel timbrado", !opts.semTimbre)}${temImob ? chk("assImob", "Assinatura da imobiliária", opts.assImob !== false, "Coloca a assinatura da imobiliária sobre a linha") : ""}
      ${chk("assCliente", "Assinatura do cliente", opts.assCliente != null ? opts.assCliente : !(opts.clientes || []).length || $$(".doc-ass > div", tmp).some(x => !ehImob(x.textContent)), "Linha com o nome de cada pessoa citada que deve assinar")}${chk("scan", "Como escaneado", !!opts.scan, "O PDF sai como imagem, igual a um papel escaneado")}</div>
      <button type="button" class="btn" data-prev>👁 Ver a folha</button><button type="button" class="btn" data-baixar>⬇ Baixar PDF</button><button type="button" class="btn pri" data-imp>🖨 Imprimir</button>`,
    corpo: `<p class="hint" data-dica>✏️ Clique no texto para corrigir ou completar. Use <b>Ver a folha</b> para conferir a página A4 antes de imprimir (as alterações não ficam salvas no sistema).</p>
      <div class="rel-prev" data-ed><div class="doc-ed" contenteditable="true" spellcheck="true">${corpo}</div></div><div class="pdf-prev" data-pv hidden></div>`,
    aoAbrir: (f, d) => {
      const op = () => Object.fromEntries($$("[data-op]", d).map(x => [x.dataset.op, x.checked]));
      const gerar = async () => { const o = op(); let pdf = await termoPDF(blocosDoDoc($(".doc-ed", d)), Object.assign({ titulo, clientes: opts.clientes || [], papelCliente: opts.papelCliente || "" }, o, { assImob: o.assImob !== false })); if (o.scan) pdf = await achatarTermo(pdf); return pdf.save(); };
      const ocupado = async (btn, fn) => { const t = btn.textContent; btn.disabled = true; btn.textContent = "⏳ " + t.replace(/^\S+\s/, ""); try { await fn(); } catch (e) { falha(e); } finally { btn.disabled = false; btn.textContent = t; } };
      const pv = $("[data-pv]", d), ed = $("[data-ed]", d), bp = $("[data-prev]", d);
      const mostrarPrev = async () => { const cvs = await paginasImg(await gerar(), 1.35); pv.replaceChildren(...cvs.map(c => { c.className = "pdf-pg"; return c; })); pv.hidden = false; ed.hidden = true; bp.textContent = "✏️ Voltar ao texto"; };
      bp.addEventListener("click", () => ocupado(bp, async () => { if (!pv.hidden) { pv.hidden = true; ed.hidden = false; bp.textContent = "👁 Ver a folha"; return; } await mostrarPrev(); }));
      $$("[data-op]", d).forEach(x => x.addEventListener("change", () => { if (!pv.hidden) ocupado(bp, mostrarPrev).then(() => (bp.textContent = "✏️ Voltar ao texto")); }));
      const feito = () => { if (opts.aoImprimir) { opts.aoImprimir(); opts.aoImprimir = null; } };
      const bb = $("[data-baixar]", d), bi = $("[data-imp]", d);
      bb.addEventListener("click", () => ocupado(bb, async () => { const b = await gerar(), url = URL.createObjectURL(new Blob([b], { type: "application/pdf" })), a = document.createElement("a");
        a.href = url; a.download = nomeArqPDF(titulo); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); feito(); }));
      bi.addEventListener("click", () => ocupado(bi, async () => { imprimirPaginas(await paginasImg(await gerar(), 2.6)); feito(); }));
    } });
}

const TABELAS_BKP = ["imoveis_venda", "interessados", "config", "contas", "categorias", "grupos_locador", "locadores", "fornecedores", "imoveis", "contratos", "reajustes", "devedores", "cobrancas", "lancamentos", "mapa_mensal", "depositos_fav", "depositos_mes", "cauc_contas", "cauc_mov", "vendas", "venda_itens", "notas_fiscais", "tarefas", "tutoriais", "cadastros_recebidos"];
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
  for (const t of TABELAS_BKP) { prog(`Lendo ${t}…`); out[t] = await fetchAll(t, b => b.order(ORDEM_PK[t] || "id").order(t === "mapa_mensal" ? "imovel_id" : (ORDEM_PK[t] || "id"))).catch(e => { if (t === "cadastros_recebidos") return []; throw e; }); }
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
    modal({ titulo: "Arquivo protegido", corpo: `<label class="fl"><span>Senha do backup</span><input type="password" name="s" required></label>`, ok: "Abrir", salvar: async f => { v = f.s.value; }, aoFechar: () => res(v) });
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

// v15: etiquetas nas tabelas do sistema todo
[COLS_COB, COLS_INAD, COLS_IMV, COLS_DEV, COLS_CAUC, COLS_REC_LCT, COLS_REC_LCD, COLS_INAD_MES, COLS_LANC].forEach(etiquetarCols);
/* =====================================================================
   v16: IMÓVEIS À VENDA, INTERESSADOS, COBRANÇA E RECIBOS DE VENDAS
   ===================================================================== */
const ST_IV = { DISP: ["Disponível", "ok"], INAT: ["Inativo", "bad"], VEND: ["Vendido", "info"] };
let IV = [];
const ivRot = x => (x.ficha || {}).etiqueta || rotuloImv(x.endereco);
const COLS_IV = [
  { k: "status", t: "Situação", f: x => (ST_IV[x.status] || [x.status])[0], html: x => `<span class="tag ${(ST_IV[x.status] || ["", "idle"])[1]}">${esc((ST_IV[x.status] || [x.status])[0])}</span>` },
  { k: "codigo_site", t: "Site", cls: "mono", w: 70, html: x => /^\d+$/.test(String(x.codigo_site || "").trim()) ? linkSite(x.codigo_site) : esc(x.codigo_site || "") },
  { k: "venda", t: "Contrato", v: x => (VEN.find(v => v.id === x.venda_id) || {}).codigo || "", html: x => { const v = VEN.find(z => z.id === x.venda_id); return v ? `<button type="button" class="lnk-ctt mono" data-act="ir-ven" data-id="${v.id}">${esc(v.codigo)}</button>` : ""; } },
  { k: "endereco", t: "Endereço", w: 240, cls: "tags", html: x => `<span class="etq etq-imv" title="${esc(x.endereco)}">🏠 ${esc(ivRot(x))}</span>` },
  { k: "bairro", t: "Bairro / referência", cls: "trunc" },
  { k: "tipo", t: "Tipo" },
  { k: "valor", t: "Valor", tipo: "num" },
  { k: "vendedor", t: "Vendedor (proprietário)", cls: "tags", html: x => x.vendedor ? tagPes([x.vendedor], "etq-lcd") : "" },
  { k: "car", t: "Características", cls: "trunc", v: x => carTxt(x.ficha, x.tipo).join(" · ") },
  { k: "obs", t: "Obs.", cls: "trunc", oculta: true }
];
PAGES.imoveis_venda = async pg => {
  [IV, VEN] = await Promise.all([fetchAll("imoveis_venda", b => b.order("endereco")), q(sb.from("vendas").select("*").order("codigo", { ascending: false }))]);
  setRd(pg, () => desenharIV()); desenharIV(pg);
};
function desenharIV(pg) {
  pg = pg || $("#page");
  const f = S.f.iv || "DISP", busca = S.f.ivBusca || "";
  let ls = IV.filter(x => f === "todos" || x.status === f);
  if (busca) { const b = norm(busca); ls = ls.filter(x => norm([x.endereco, x.bairro, x.vendedor, x.codigo_site, x.obs].join(" ")).includes(b)); }
  const g = grade("imoveis_venda", COLS_IV, ls, { attr: x => `data-act="iv-ed" data-id="${x.id}" style="cursor:pointer"`, sort: { k: "endereco", dir: "asc" }, rodape: fl => `${fl.length} imóveis · ${brl(fl.reduce((a, x) => a + (+x.valor || 0), 0))}` });
  g.redesenhar = () => desenharIV();
  const n = k => k === "todos" ? IV.length : IV.filter(x => x.status === k).length;
  pg.innerHTML = `<div class="grid"><div class="filters">
    <div class="chips">${[["DISP", "Disponíveis", "st-LVR"], ["VEND", "Vendidos", "st-ALG"], ["INAT", "Inativos", "st-INTV"], ["todos", "Todos", ""]].map(([k, t, c]) => `<button class="chip ${c}${f === k ? " on" : ""}" data-act="chip" data-k="iv" data-v="${k}">${t}<span class="c">${n(k)}</span></button>`).join("")}</div>
    <input type="search" placeholder="Buscar endereço, bairro, vendedor, código…" value="${esc(busca)}" data-busca="ivBusca"><span class="spacer"></span>${gradeBarra("imoveis_venda")}
    ${pode.ed("vendas") ? `<button class="btn pri" data-act="iv-ed">+ Imóvel à venda</button>` : ""}</div>${gradeHTML("imoveis_venda")}
    <p class="hint"><b>Disponível</b>: à venda. <b>Inativo</b>: retirado (vendido por terceiros ou outro motivo). <b>Vendido</b>: venda feita pela imobiliária (ligada ao contrato de venda).</p></div>`;
  ligarBusca(pg);
}
ACT["ir-ven"] = async el => { fecharDlg(); if (!VEN.some(v => v.id === el.dataset.id)) await PAGES.vendas(document.createElement("div")); setTimeout(() => ACT["ven-ed"]({ dataset: { id: el.dataset.id } }), 30); };
ACT["iv-ed"] = el => {
  const x = IV.find(y => y.id === el.dataset.id) || { status: "DISP", tipo: "Casa", ficha: {} };
  const ed = pode.ed("vendas"), dis = ed ? "" : "disabled", fi = x.ficha || {}, v = VEN.find(z => z.id === x.venda_id);
  const car = carTxt(fi, x.tipo);
  modal({ titulo: x.id ? "Imóvel à venda · " + ivRot(x) : "Novo imóvel à venda", xl: true, semOk: !ed,
    corpo: `${x.id ? `<div class="ctt-res" style="margin-bottom:10px">
        <div class="res-l"><span class="res-t">Imóvel</span><div class="res-v"><span class="etq etq-imv">🏠 ${esc(ivRot(x))}</span> <span class="tag ${(ST_IV[x.status] || ["", "idle"])[1]}">${esc((ST_IV[x.status] || [x.status])[0])}</span> <small class="muted">${esc(x.tipo)}</small>${/^\d+$/.test(String(x.codigo_site || "").trim()) ? " · " + linkSite(x.codigo_site, "ver no site") : ""}</div></div>
        <div class="res-l"><span class="res-t">Vendedor</span><div class="res-v">${x.vendedor ? tagPes([x.vendedor], "etq-lcd") : "—"} ${fi.tel_vendedor ? `<small class="muted">${esc(fi.tel_vendedor)}</small>` : ""}</div></div>
        <div class="res-l"><span class="res-t">Valor</span><div class="res-v"><b>${x.valor != null ? brl(x.valor) : "—"}</b></div></div>
        <div class="res-l"><span class="res-t">Características</span><div class="res-v">${car.length ? car.map(t => `<span class="etq etq-p">${esc(t)}</span>`).join("") : `<span class="muted">não informadas</span>`}</div></div>
        <div class="res-l"><span class="res-t">Contrato</span><div class="res-v">${v ? `<button type="button" class="lnk-ctt mono" data-act="ir-ven" data-id="${v.id}">${esc(v.codigo)}</button> <small class="muted">${dt(v.data)}</small>` : `<span class="muted">sem contrato de venda</span>`}</div></div></div>` : ""}
      <fieldset class="ficha-b"><legend>Cadastro</legend><div class="imv-g">
        <label class="fl"><span>Situação</span><select name="status" ${dis}>${Object.entries(ST_IV).map(([k, t]) => opt(k, t[0], x.status === k)).join("")}</select></label>
        <label class="fl"><span>Tipo</span><select name="tipo" ${dis}>${tiposImovel(x.tipo).concat(["Terreno", "Chácara", "Sítio"]).filter((t, i, a) => a.indexOf(t) === i).map(t => opt(t, t, x.tipo === t)).join("")}</select></label>
        <label class="fl"><span>Código no site</span><input name="codigo_site" value="${esc(x.codigo_site || "")}" inputmode="numeric" ${dis}></label>
        <label class="fl"><span>Valor</span><input name="valor" inputmode="numeric" value="${x.valor != null ? moedaFmt(x.valor) : ""}" ${dis}></label>
        <label class="fl s3"><span>Endereço</span><input name="endereco" value="${esc(x.endereco || "")}" required ${dis}></label>
        <label class="fl s2"><span>Bairro / referência</span><input name="bairro" value="${esc(x.bairro || "")}" ${dis}></label>
        <label class="fl s3"><span>Vendedor (proprietário)</span><input name="vendedor" value="${esc(x.vendedor || "")}" ${dis}></label>
        <label class="fl s2"><span>Telefone do vendedor</span><input name="tel_vendedor" value="${esc(fi.tel_vendedor || "")}" ${dis}></label>
        <label class="fl s5"><span>Observações</span><textarea name="obs" rows="2" ${dis}>${esc(x.obs || "")}</textarea></label></div></fieldset>
      ${caracteristicasHTML({ tipo: x.tipo, endereco: x.endereco, ficha: fi })}`,
    extra: (x.id && ed && x.status === "DISP" && !x.venda_id ? `<button type="button" class="btn" data-fazer-venda>📄 Fazer contrato de venda</button>` : "") + (x.id && pode.admin() ? `<button type="button" class="btn danger" data-del>Excluir</button>` : ""),
    aoAbrir: (fm, d) => {
      mascaraMoeda(fm.valor);
      const b = $("[data-del]", d); if (b) b.addEventListener("click", async () => { d.close(); if (!(await confirmar("Excluir", "Excluir este imóvel da lista de vendas? Prefira marcar como Inativo.", "Excluir"))) return; try { await q(sb.from("imoveis_venda").delete().eq("id", x.id)); render(); } catch (e) { falha(e); } });
      const fv = $("[data-fazer-venda]", d); if (fv) fv.addEventListener("click", async () => {
        d.close(); if (!(await confirmar("Contrato de venda", `Criar a venda (próximo código) com este imóvel, o valor e o vendedor? Depois é só completar compradores e pagamento na ficha da venda.`, "Criar a venda"))) return;
        try {
          if (!VEN.length) VEN = await q(sb.from("vendas").select("*").order("codigo", { ascending: false }));
          const cod = proximaVenda(), fx = x.ficha || {};
          const nv = await q(sb.from("vendas").insert({ codigo: cod, data: hoje(), endereco: x.endereco, valor: x.valor, vendedores: x.vendedor || "", comissao_inclusa: true,
            ficha: { imv_rua: x.endereco, imv_bairro: x.bairro || "", vnd1_nome: x.vendedor || "", vnd1_tel: fx.tel_vendedor || "", imv_area_terreno: fx.terreno || "", imv_area_construida: fx.construcao || "" } }).select().single());
          await q(sb.from("imoveis_venda").update({ venda_id: nv.id, status: "VEND" }).eq("id", x.id));
          VEN.unshift(nv); toast("Venda " + cod + " criada."); location.hash = "#vendas"; setTimeout(() => ACT["ven-ed"]({ dataset: { id: nv.id } }), 900);
        } catch (e) { falha(e); }
      });
    },
    salvar: async fm => {
      const fi2 = Object.assign({}, x.ficha || {}); $$("[data-car]", $("#dlg")).forEach(i => (fi2[i.dataset.car] = i.value.trim())); fi2.tel_vendedor = fm.tel_vendedor.value.trim();
      const u = { status: fm.status.value, tipo: fm.tipo.value, codigo_site: fm.codigo_site.value.trim(), valor: parseMoney(fm.valor.value), endereco: fm.endereco.value.trim(), bairro: fm.bairro.value.trim(), vendedor: fm.vendedor.value.trim(), obs: fm.obs.value.trim(), ficha: fi2 };
      if (!u.endereco) throw new Error("Informe o endereço.");
      if (x.id) await q(sb.from("imoveis_venda").update(u).eq("id", x.id)); else await q(sb.from("imoveis_venda").insert(u));
      toast("Salvo."); render();
    } });
};

// ---- interessados (locação e vendas) ----
let INT = [];
const COLS_INT = [
  { k: "nome", t: "Nome", cls: "trunc", fixo: true },
  { k: "contato", t: "Contato", cls: "trunc" },
  { k: "procura", t: "O que procura", cls: "trunc", w: 360 },
  { k: "ativo", t: "Situação", f: x => x.ativo ? "Procurando" : "Encerrado", html: x => x.ativo ? `<span class="tag ok">procurando</span>` : `<span class="tag idle">encerrado</span>` },
  { k: "ultimo_contato", t: "Último contato", tipo: "data" },
  { k: "obs", t: "Obs.", cls: "trunc" }
];
const pgInteressados = tipo => async pg => {
  INT = await fetchAll("interessados", b => b.eq("tipo", tipo).order("ultimo_contato", { ascending: false, nullsFirst: false }));
  setRd(pg, () => desenharInt(null, tipo)); desenharInt(pg, tipo);
};
PAGES.interessados_loc = pgInteressados("locacao");
PAGES.interessados_ven = pgInteressados("venda");
function desenharInt(pg, tipo) {
  pg = pg || $("#page");
  const f = S.f.intF || "ativos", busca = S.f.intBusca || "";
  let ls = INT.filter(x => f === "todos" || (f === "ativos" ? x.ativo : !x.ativo));
  if (busca) { const b = norm(busca); ls = ls.filter(x => norm([x.nome, x.contato, x.procura, x.obs].join(" ")).includes(b)); }
  const id = "int_" + tipo, g = grade(id, COLS_INT, ls, { attr: x => `data-act="int-ed" data-id="${x.id}" data-tipo="${tipo}" style="cursor:pointer"`, sort: { k: "ultimo_contato", dir: "desc" }, rodape: fl => `${fl.length} interessados` });
  g.redesenhar = () => desenharInt(null, tipo);
  const ed = pode.ed(tipo === "venda" ? "vendas" : "imoveis");
  pg.innerHTML = `<div class="grid"><div class="filters"><div class="chips">${[["ativos", "Procurando"], ["inativos", "Encerrados"], ["todos", "Todos"]].map(([k, t]) => `<button class="chip${f === k ? " on" : ""}" data-act="chip" data-k="intF" data-v="${k}">${t}</button>`).join("")}</div>
    <input type="search" placeholder="Buscar nome, contato, o que procura…" value="${esc(busca)}" data-busca="intBusca"><span class="spacer"></span>${gradeBarra(id)}${ed ? `<button class="btn pri" data-act="int-ed" data-tipo="${tipo}">+ Interessado</button>` : ""}</div>
    ${gradeHTML(id)}<p class="hint">Anote quem procura imóvel ${tipo === "venda" ? "para comprar" : "para alugar"} e o que procura. Quando aparecer um imóvel que encaixa, procure aqui pelo bairro, número de quartos ou valor.</p></div>`;
  ligarBusca(pg);
}
ACT["int-ed"] = el => {
  const tipo = el.dataset.tipo || "locacao", x = INT.find(y => y.id === el.dataset.id) || { tipo, ativo: true, ultimo_contato: hoje() };
  const ed = pode.ed(tipo === "venda" ? "vendas" : "imoveis"), dis = ed ? "" : "disabled";
  modal({ titulo: x.id ? "Interessado · " + x.nome : "Novo interessado (" + (tipo === "venda" ? "compra" : "locação") + ")", largo: true, semOk: !ed,
    corpo: `<div class="row"><label class="fl"><span>Nome</span><input name="nome" value="${esc(x.nome || "")}" required ${dis}></label><label class="fl"><span>Contato (telefone, e-mail, @)</span><input name="contato" value="${esc(x.contato || "")}" ${dis}></label></div>
      <label class="fl"><span>O que procura</span><textarea name="procura" rows="3" placeholder="ex.: casa com 2 quartos, região central, até R$ 1.500" ${dis}>${esc(x.procura || "")}</textarea></label>
      <div class="row"><label class="fl"><span>Último contato</span><input type="date" name="ult" value="${x.ultimo_contato || ""}" ${dis}></label><label class="chk" style="align-self:end"><input type="checkbox" name="ativo" ${x.ativo ? "checked" : ""} ${dis}> ainda procurando</label></div>
      <label class="fl"><span>Observações</span><textarea name="obs" rows="2" ${dis}>${esc(x.obs || "")}</textarea></label>`,
    extra: x.id && pode.admin() ? `<button type="button" class="btn danger" data-del>Excluir</button>` : "",
    aoAbrir: (f, d) => { const b = $("[data-del]", d); if (b) b.addEventListener("click", async () => { d.close(); try { await q(sb.from("interessados").delete().eq("id", x.id)); render(); } catch (e) { falha(e); } }); },
    salvar: async f => { const u = { tipo, nome: f.nome.value.trim(), contato: f.contato.value.trim(), procura: f.procura.value.trim(), ultimo_contato: f.ult.value || null, ativo: f.ativo.checked, obs: f.obs.value.trim() };
      if (!u.nome) throw new Error("Informe o nome."); if (x.id) await q(sb.from("interessados").update(u).eq("id", x.id)); else await q(sb.from("interessados").insert(u)); toast("Salvo."); render(); } });
};

// ---- cobrança de vendas (parcelas e custas em aberto) e recibos de vendas ----
async function carregarVendasItens() {
  const [vs, its] = await Promise.all([q(sb.from("vendas").select("*").order("codigo", { ascending: false })), q(sb.from("venda_itens").select("*").order("vencimento", { nullsFirst: false })).catch(() => [])]);
  VEN = vs; VIT = {}; its.forEach(i => (VIT[i.venda_id] = VIT[i.venda_id] || []).push(i));
  return its;
}
const tipoViTxt = i => i.tipo === "preco" ? "Parcela ao vendedor" : i.tipo === "comissao" ? "Comissão" : "Custa a reembolsar";
const vendaTag = v => v ? `<span class="ctt-ref"><button type="button" class="lnk-ctt mono" data-act="ir-ven" data-id="${v.id}">${esc(v.codigo)}</button></span>` : "";
let COBV = [];
const COLS_COBV = [
  { k: "vencimento", t: "Venc.", tipo: "data", html: x => `${dt(x.vencimento)}${x.vencimento && x.vencimento < hoje() ? ` <span class="tag bad">${diasEntre(x.vencimento, hoje())} dias</span>` : ""}` },
  { k: "venda", t: "Venda", v: x => (x._v || {}).codigo || "", html: x => vendaTag(x._v) },
  { k: "imovel", t: "Imóvel", cls: "tags", v: x => (x._v || {}).endereco || "", html: x => (x._v || {}).endereco ? `<span class="etq etq-imv">🏠 ${esc(rotuloImv(x._v.endereco))}</span>` : "" },
  { k: "quem", t: "Quem paga", cls: "tags", v: x => x.tipo === "custo" ? (x._v || {}).vendedores : (x._v || {}).compradores, html: x => tagPes(nomesLista(x.tipo === "custo" ? (x._v || {}).vendedores : x.tipo === "comissao" ? (x._v || {}).vendedores : (x._v || {}).compradores), x.tipo === "preco" ? "etq-lct" : "etq-lcd", "", 2) },
  { k: "tipo", t: "Tipo", f: tipoViTxt },
  { k: "descricao", t: "Descrição", cls: "trunc" },
  { k: "valor", t: "Valor", tipo: "num" }
];
PAGES.cob_ven = async pg => {
  const its = await carregarVendasItens();
  COBV = its.filter(i => (!i.pago_em && i.tipo !== "custo") || (i.tipo === "custo" && i.pago_em && !i.reembolso_em)).map(i => Object.assign({ _v: VEN.find(v => v.id === i.venda_id) }, i, i.tipo === "custo" ? { vencimento: i.vencimento || i.pago_em } : {}));
  setRd(pg, () => desenharCobV()); desenharCobV(pg);
};
function desenharCobV(pg) {
  pg = pg || $("#page");
  const f = S.f.cobv || "atras", busca = S.f.cobvBusca || "";
  let ls = COBV.filter(x => f === "todos" || (f === "atras" ? x.vencimento && x.vencimento < hoje() : !(x.vencimento && x.vencimento < hoje())));
  if (busca) { const b = norm(busca); ls = ls.filter(x => norm([(x._v || {}).codigo, (x._v || {}).endereco, (x._v || {}).vendedores, (x._v || {}).compradores, x.descricao].join(" ")).includes(b)); }
  const g = grade("cob_ven", COLS_COBV, ls, { attr: x => `data-act="ir-ven" data-id="${x.venda_id}" style="cursor:pointer"`, sort: { k: "vencimento", dir: "asc" }, rodape: fl => `${fl.length} itens · ${brl(fl.reduce((a, x) => a + (+x.valor || 0), 0))}` });
  g.redesenhar = () => desenharCobV();
  const n = k => COBV.filter(x => k === "todos" || (k === "atras" ? x.vencimento && x.vencimento < hoje() : !(x.vencimento && x.vencimento < hoje()))).length;
  pg.innerHTML = `<div class="grid">${cobrancaAbas("cob_ven")}<div class="filters"><div class="chips">${[["atras", "Atrasados", "st-INTV"], ["avencer", "A vencer", "st-OCP"], ["todos", "Todos", ""]].map(([k, t, c]) => `<button class="chip ${c}${f === k ? " on" : ""}" data-act="chip" data-k="cobv" data-v="${k}">${t}<span class="c">${n(k)}</span></button>`).join("")}</div>
    <input type="search" placeholder="Buscar venda, imóvel, nomes…" value="${esc(busca)}" data-busca="cobvBusca"><span class="spacer"></span>${gradeBarra("cob_ven")}<button class="btn" data-act="cobv-imp">🖨 Imprimir lista</button></div>
    ${gradeHTML("cob_ven")}<p class="hint">Parcelas do preço e da comissão ainda não recebidas e custas pagas pela imobiliária ainda não reembolsadas. Clique na linha para abrir a venda.</p></div>`;
  ligarBusca(pg);
}
ACT["cobv-imp"] = () => {
  const fl = (G.cob_ven && G.cob_ven.filtradas) || [];
  abrirRelatorio("Cobrança de vendas", `<div class="rel-tit"><b>Cobrança de vendas</b><span>posição em ${dt(hoje())}</span></div><table class="rel-t"><thead><tr><th>#</th><th>Venc.</th><th>Venda</th><th>Imóvel</th><th>Tipo</th><th>Descrição</th><th class="num">Valor</th></tr></thead>
    <tbody>${fl.map((x, i) => `<tr><td>${i + 1}</td><td>${dt(x.vencimento)}</td><td>${esc((x._v || {}).codigo || "")}</td><td>${esc((x._v || {}).endereco || "")}</td><td>${esc(tipoViTxt(x))}</td><td>${esc(x.descricao || "")}</td><td class="num">${n2(x.valor)}</td></tr>`).join("") || `<tr><td colspan="7">Nada em aberto.</td></tr>`}</tbody>
    <tfoot><tr><td colspan="6"><b>Total</b></td><td class="num"><b>${n2(fl.reduce((a, x) => a + (+x.valor || 0), 0))}</b></td></tr></tfoot></table>`, { paisagem: true });
};
let RECV = [];
const COLS_RECV = [
  { k: "pago_em", t: "Pago em", tipo: "data" },
  { k: "venda", t: "Venda", v: x => (x._v || {}).codigo || "", html: x => vendaTag(x._v) },
  { k: "imovel", t: "Imóvel", cls: "tags", v: x => (x._v || {}).endereco || "", html: x => (x._v || {}).endereco ? `<span class="etq etq-imv">🏠 ${esc(rotuloImv(x._v.endereco))}</span>` : "" },
  { k: "tipo", t: "Recibo", f: x => x.tipo === "comissao" ? "Comissão (imobiliária recebe)" : "Parcela (vendedor recebe)" },
  { k: "descricao", t: "Descrição", cls: "trunc" },
  { k: "valor", t: "Valor", tipo: "num" },
  { k: "imp", t: "", nf: true, w: 80, html: x => `<button class="btn sm" data-act="recv-ver" data-id="${x.id}">🧾 Recibo</button>` }
];
PAGES.recibos_ven = async pg => {
  const its = await carregarVendasItens();
  RECV = its.filter(i => i.pago_em && i.tipo !== "custo").map(i => Object.assign({ _v: VEN.find(v => v.id === i.venda_id) }, i));
  const busca = S.f.recvBusca || "";
  let ls = RECV; if (busca) { const b = norm(busca); ls = ls.filter(x => norm([(x._v || {}).codigo, (x._v || {}).endereco, (x._v || {}).vendedores, (x._v || {}).compradores, x.descricao].join(" ")).includes(b)); }
  const g = grade("recibos_ven", COLS_RECV, ls, { sort: { k: "pago_em", dir: "desc" }, attr: x => `data-act="recv-ver" data-id="${x.id}" style="cursor:pointer"`, rodape: fl => `${fl.length} recibos · ${brl(fl.reduce((a, x) => a + (+x.valor || 0), 0))}` });
  g.redesenhar = () => render();
  pg.innerHTML = `<div class="grid"><div class="filters"><input type="search" placeholder="Buscar venda, imóvel, nomes…" value="${esc(busca)}" data-busca="recvBusca"><span class="spacer"></span>${gradeBarra("recibos_ven")}</div>${gradeHTML("recibos_ven")}
    <p class="hint">Recibos das parcelas pagas das vendas: <b>parcela</b> (o vendedor dá ao comprador) e <b>comissão</b> (a imobiliária dá ao vendedor).</p></div>`;
  ligarBusca(pg);
};
ACT["recv-ver"] = el => { const i = RECV.find(x => x.id === el.dataset.id); if (!i || !i._v) return; termoVenda(i._v, i.tipo === "comissao" ? "recibo_com" : "recibo", i); };

/* ---------- v16: contrato de venda (Word), no mesmo formato do contrato de locação ---------- */
const ORDINAL_CL = ["PRIMEIRA", "SEGUNDA", "TERCEIRA", "QUARTA", "QUINTA", "SEXTA", "SÉTIMA", "OITAVA", "NONA", "DÉCIMA", "DÉCIMA PRIMEIRA", "DÉCIMA SEGUNDA", "DÉCIMA TERCEIRA", "DÉCIMA QUARTA", "DÉCIMA QUINTA", "DÉCIMA SEXTA", "DÉCIMA SÉTIMA"];
const ROMANO = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII"];
// confere a ficha da venda: o que impede (erro) e o que convém completar (aviso)
function conferirVenda(v) {
  const f = v.ficha || {}, err = [], av = [];
  const pessoa = (g, rot) => {
    const ns = nomesParte(f, g); if (!ns.length) { err.push(`${rot}: falta o nome (aba ${rot}).`); return; }
    const pj = /PJ/i.test(f[g + "_qtd"] || "");
    [g + "1"].concat(!pj && f[g + "2_nome"] ? [g + "2"] : []).forEach(p => {
      const n = f[p + "_nome"];
      if (!f[p + "_cpf"]) err.push(`${rot}: falta o CPF/CNPJ de ${n}.`);
      if (!pj || p.endsWith("1")) { if (!f[p + "_rg"] && !pj) av.push(`${rot}: falta o RG de ${n}.`); if (!f[p + "_est_civil"] && !pj) av.push(`${rot}: falta o estado civil de ${n}.`); if (!f[p + "_prof"] && !pj) av.push(`${rot}: falta a profissão de ${n}.`); }
      const cpf = String(f[p + "_cpf"] || "").replace(/\D/g, ""); if (cpf && cpf.length !== 11 && cpf.length !== 14) err.push(`${rot}: CPF/CNPJ de ${n} com número de dígitos errado (${f[p + "_cpf"]}).`);
    });
    if (!f[g + "_end1_rua"]) av.push(`${rot}: falta o endereço de residência.`);
    if (/casad/i.test(f[g + "1_est_civil"] || "") && !f[g + "2_nome"] && !pj) av.push(`${rot}: ${f[g + "1_nome"]} é casado(a), mas o cônjuge não está na ficha (ele precisa concordar com a venda).`);
    if (f[g + "2_nome"] && /sim/i.test(f[g + "_casados"] || "") && !f[g + "_regime"]) av.push(`${rot}: casados entre si, mas falta o regime de bens.`);
  };
  pessoa("vnd", "Vendedores"); pessoa("cmp", "Compradores");
  if (!(f.imv_rua || v.endereco)) err.push("Imóvel: falta o endereço (aba Imóvel).");
  if (!(f.imv_matricula || v.matricula)) av.push("Imóvel: falta a matrícula do Cartório de Registro de Imóveis.");
  if (!(f.imv_insc || v.insc_cad)) av.push("Imóvel: falta a inscrição cadastral na Prefeitura.");
  if (!(f.imv_desc || v.imovel_desc)) av.push("Imóvel: falta a descrição (lote, quadra, área, medidas, benfeitorias) — o contrato usa o endereço.");
  if (!(+v.valor > 0)) err.push("Venda: falta o valor total.");
  const ps = (VIT[v.id] || []).filter(i => i.tipo === "preco"), soma = r2(ps.reduce((a, i) => a + +i.valor, 0)), vend = valorVendedor(v);
  if (!ps.length && !v.forma) err.push("Pagamento: lance as parcelas do vendedor (Venda e parcelas) ou escreva a forma de pagamento.");
  if (ps.length && Math.abs(soma - vend) > 0.01) av.push(`Pagamento: as parcelas do vendedor somam ${brl(soma)}, mas o vendedor deve receber ${brl(vend)}${inclusa(v) ? " (valor − comissão incluída)" : ""}.`);
  ps.filter(i => !i.vencimento).forEach(i => av.push(`Pagamento: a parcela “${i.descricao}” está sem data.`));
  return { err, av };
}
function txtRuns(html) { // "<b>x</b> y" → [{t, b}]
  const out = []; let b = false;
  let u = false;
  String(html).replace(/<br\s*\/?>/g, " ").split(/(<\/?[bu]>)/).forEach(p => { if (p === "<b>") b = true; else if (p === "</b>") b = false; else if (p === "<u>") u = true; else if (p === "</u>") u = false; else if (p) out.push({ t: p.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"), b, u }); });
  return out;
}
const xmlEsc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function wRun(r, extra) { return `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${r.b ? "<w:b/><w:bCs/>" : ""}${r.u && !/<w:u /.test(extra || "") ? '<w:u w:val="single"/>' : ""}${extra || ""}</w:rPr><w:t xml:space="preserve">${xmlEsc(r.t).replace(/\t/g, '</w:t><w:tab/><w:t xml:space="preserve">')}</w:t></w:r>`; }
function wPar(html, o) {
  o = o || {};
  const jc = o.jc || "both", sp = o.after != null ? o.after : 160;
  const borda = o.borda ? `<w:pBdr><w:top w:val="single" w:sz="4" w:space="1" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="4" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="1" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="4" w:color="auto"/></w:pBdr>` : "";
  return `<w:p><w:pPr>${borda}${o.quebra ? "<w:pageBreakBefore/>" : ""}<w:spacing w:before="${o.before || 0}" w:after="${sp}"${o.line ? ` w:line="${o.line}" w:lineRule="${o.exato ? "exact" : "auto"}"` : ""}/>${o.keep ? "<w:keepNext/><w:keepLines/>" : ""}${o.ind ? `<w:ind w:left="${o.ind}"${o.hang ? ` w:hanging="${o.hang}"` : ""}/>` : ""}${o.recuo ? `<w:ind w:firstLine="709"/>` : ""}<w:jc w:val="${jc}"/>${o.sz ? `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/></w:rPr>` : ""}</w:pPr>${txtRuns(html).map(r => wRun(r, (o.under ? '<w:u w:val="single"/>' : "") + (o.sz ? `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>` : ""))).join("")}</w:p>`;
}
function textoContratoVenda(v) {
  const f = v.ficha || {}, vend = nomesParte(f, "vnd"), comp = nomesParte(f, "cmp");
  const plV = vend.length > 1 && !/PJ/i.test(f.vnd_qtd || ""), plC = comp.length > 1 && !/PJ/i.test(f.cmp_qtd || "");
  const imvEnd = [f.imv_rua || v.endereco, f.imv_bairro, f.imv_cidade || TIMBRE.cidade + "/SP"].filter(Boolean).join(" – ");
  const mat = f.imv_matricula || v.matricula, insc = f.imv_insc || v.insc_cad, desc = f.imv_desc || v.imovel_desc;
  const ext = n => `${brl(n)} (${extensoReais(+n).toLowerCase()})`;
  const ps = (VIT[v.id] || []).filter(i => i.tipo === "preco").sort((a, b) => String(a.vencimento || "").localeCompare(String(b.vencimento || "")));
  let n = 0, s = 0; const cl = () => `<b>CLÁUSULA ${ORDINAL_CL[n++]}</b> – `, sec = t => ({ sec: `${ROMANO[s++]} – ${t}` });
  const B = [];
  B.push({ tit: "INSTRUMENTO PARTICULAR DE COMPROMISSO DE VENDA E COMPRA IRREVOGÁVEL E IRRETRATÁVEL" });
  B.push({ p: `Pelo presente instrumento particular, de um lado, como ${plV ? "outorgantes promitentes vendedores" : "outorgante promitente vendedor(a)"}, de ora em diante ${plV ? "designados" : "designado(a)"} simplesmente <b>“OUTORGANTE${plV ? "S" : ""}”</b>: ${qualifGrupo(f, "vnd")}; e, de outro lado, como ${plC ? "outorgados promissários compradores" : "outorgado(a) promissário(a) comprador(a)"}, de ora em diante ${plC ? "designados" : "designado(a)"} simplesmente <b>“OUTORGADO${plC ? "S" : ""}”</b>: ${qualifGrupo(f, "cmp")}; ajustam entre si o seguinte, mediante as cláusulas e condições que reciprocamente outorgam e aceitam, a saber:` });
  const og = plV ? "os OUTORGANTES" : "o(a) OUTORGANTE", od = plC ? "os OUTORGADOS" : "o(a) OUTORGADO(A)", OG = plV ? "Os OUTORGANTES" : "O(A) OUTORGANTE", OD = plC ? "Os OUTORGADOS" : "O(A) OUTORGADO(A)";
  B.push(sec("DA ORIGEM DO TÍTULO DE PROPRIEDADE"));
  B.push({ p: `${cl()}${OG} ${plV ? "são proprietários" : "é proprietário(a)"} do imóvel situado na <b>${imvEnd}</b>${mat ? `, objeto da matrícula nº <b>${mat}</b> do Cartório de Registro de Imóveis de ${TIMBRE.cidade}/SP` : ""}${insc ? `, cadastrado na Prefeitura Municipal sob nº ${insc}` : ""}${desc ? ", a seguir descrito:" : "."}` });
  if (desc) B.push({ p: `“${desc}”`, recuo: true });
  B.push(sec("DOS ÔNUS"));
  B.push({ p: `${cl()}${OG} ${plV ? "declaram" : "declara"} expressamente, e sob as penas da lei, não existir contra si ou contra o imóvel qualquer ação que possa, direta ou indiretamente, afetar a validade da compra e venda aqui compromissada.` });
  B.push(sec("DO COMPROMISSO DE VENDA E COMPRA"));
  B.push({ p: `${cl()}Por este e na melhor forma de direito, ${og} se ${plV ? "obrigam" : "obriga"} a vender ${plC ? "aos OUTORGADOS" : "ao(à) OUTORGADO(A)"}, e ${plC ? "estes" : "este(a)"} a comprar, pelo preço, forma e condições estabelecidas neste contrato, o imóvel descrito na CLÁUSULA PRIMEIRA.` });
  B.push(sec("DO PREÇO E DA FORMA DE PAGAMENTO"));
  B.push({ p: `${cl()}O preço total da compra e venda ora prometida é de <b>${ext(v.valor)}</b>, que será pago por ${od} a${plV ? "os OUTORGANTES" : "o(à) OUTORGANTE"} da seguinte forma:` });
  if (ps.length) ps.forEach((i, k) => B.push({ p: `${String.fromCharCode(97 + k)}) <b>${ext(i.valor)}</b>${/sinal|entrada/i.test(i.descricao || "") ? " a título de sinal e princípio de pagamento" : ""}${i.vencimento ? (i.vencimento <= hoje() && /sinal|entrada|integral/i.test(i.descricao || "") ? ", na assinatura deste instrumento" : `, com vencimento em ${dt(i.vencimento)}`) : ""}${i.forma ? `, por ${i.forma.toLowerCase()}` : ""}${i.obs ? ` (${i.obs})` : ""};`, ind: 709 }));
  else B.push({ p: esc(v.forma || ""), ind: 709 });
  if (inclusa(v) && +v.comissao > 0) B.push({ p: `<b>Parágrafo primeiro:</b> Do preço total, a importância de ${ext(v.comissao)} corresponde à comissão de intermediação devida à ${esc(IMOB_NOME())}, CNPJ nº ${esc(TIMBRE.cnpj)}, CRECI 4419-J, que ${og} ${plV ? "autorizam" : "autoriza"} seja paga diretamente à intermediadora.`, recuo: true });
  B.push({ p: `<b>Parágrafo ${inclusa(v) && +v.comissao > 0 ? "segundo" : "primeiro"}:</b> O inadimplemento, ainda que parcial, de quaisquer dos pagamentos acima, nas datas pactuadas, acarretará o vencimento antecipado das demais parcelas, além da incidência de juros legais de 1% (um por cento) ao mês, da multa prevista neste contrato e de correção monetária com base na tabela prática do Tribunal de Justiça do Estado de São Paulo.`, recuo: true });
  B.push(sec("DA ESCRITURA PÚBLICA DE VENDA E COMPRA"));
  B.push({ p: `${cl()}A escritura definitiva de venda e compra será outorgada ${plC ? "aos OUTORGADOS" : "ao(à) OUTORGADO(A)"} ${f.imv_escritura ? `até o dia ${esc(f.imv_escritura)}` : "após a quitação integral do preço"}, arcando ${od} com o imposto de transmissão (ITBI) e com os custos da escritura e do registro.` });
  B.push(sec("DA POSSE"));
  B.push({ p: `${cl()}${OD} ${f.imv_posse ? esc(f.imv_posse) : `${plC ? "entrarão" : "entrará"} na posse precária do imóvel na data da assinatura deste instrumento, sendo a posse definitiva transmitida na data da quitação total do preço`}, podendo a partir de então fazer no imóvel os melhoramentos e benfeitorias que entender${plC ? "em" : ""} necessários.` });
  B.push(sec("DOS TRIBUTOS INCIDENTES SOBRE O IMÓVEL"));
  B.push({ p: `${cl()}Os tributos que incidirem sobre o imóvel após a assinatura deste instrumento serão suportados por ${od}; os tributos originados anteriormente à assinatura serão suportados exclusivamente por ${og}, ainda que lançados ou exigidos posteriormente.` });
  B.push(sec("DA IRREVOGABILIDADE"));
  B.push({ p: `${cl()}O presente instrumento é firmado em caráter irrevogável e irretratável, não cabendo direito de arrependimento ou desistência, obrigando as partes, seus herdeiros e sucessores, salvo o inadimplemento do preço nas condições aqui pactuadas.` });
  B.push(sec("DAS DECLARAÇÕES"));
  B.push({ p: `${cl()}${OG} ${plV ? "declaram" : "declara"}, sob as penas da lei, que: a) sobre o bem objeto deste contrato não pesam ônus, gravames ou alienações; b) não existe embaraço, fato ou circunstância que impeça ou comprometa a livre, total e eficaz alienação do bem; c) não ${plV ? "omitiram" : "omitiu"} intencionalmente fato ou circunstância que, se conhecido, seria motivo para a não realização do negócio; d) não ${plV ? "estão sujeitos" : "está sujeito(a)"} à apresentação da CND do INSS, por não ${plV ? "serem contribuintes obrigatórios" : "ser contribuinte obrigatório(a)"} do referido órgão.` });
  B.push(sec("DA CLÁUSULA PENAL"));
  B.push({ p: `${cl()}O descumprimento de quaisquer das obrigações ora pactuadas sujeitará a parte infratora ao pagamento de multa compensatória equivalente a 10% (dez por cento) do valor total do preço à parte prejudicada, que poderá optar pela rescisão do contrato ou por sua execução, sem prejuízo de perdas e danos.` });
  B.push(sec("DISPOSIÇÕES FINAIS"));
  B.push({ p: `${cl()}Toda e qualquer alteração ou obrigação não mencionada expressamente neste instrumento fica sujeita a prévio acordo entre as partes, por meio de termo aditivo, que passará a fazer parte integrante deste ajuste.` });
  B.push({ p: `${cl()}A tolerância a eventual violação deste contrato não implicará novação, transigência ou alteração contratual.` });
  B.push({ p: `${cl()}Para dirimir quaisquer questões decorrentes deste contrato, fica eleito o foro da situação do imóvel, a Comarca de ${TIMBRE.cidade}/SP, com renúncia a qualquer outro, por mais privilegiado que seja.` });
  B.push({ p: `E, por estarem justas e contratadas, as partes assinam o presente instrumento em 2 (duas) vias de igual teor e forma, na presença das testemunhas abaixo.` });
  B.push({ p: `${TIMBRE.cidade}/SP, ${dataExt(v.data || hoje())}.`, jc: "right", before: 240 });
  const assin = (rot, ns) => { B.push({ p: `<b>${rot}:</b>`, before: 360, jc: "left" }); ns.forEach(nm => { B.push({ p: "_______________________________________________", jc: "center", before: 600, after: 0 }); B.push({ p: `<b>${esc(nm)}</b>`, jc: "center", after: 120 }); }); };
  assin(plV ? "OUTORGANTES VENDEDORES" : "OUTORGANTE VENDEDOR(A)", vend);
  assin(plC ? "OUTORGADOS COMPRADORES" : "OUTORGADO(A) COMPRADOR(A)", comp);
  assin("TESTEMUNHAS", [`${f.test1_nome || "Linyston Luiz Cavallaro"} – CPF ${f.test1_cpf || "406.955.348-74"}`, `${f.test2_nome || "Eliana Aparecida Filietaz"} – CPF ${f.test2_cpf || "102.046.358-96"}`]);
  return B;
}
async function gerarContratoVenda(v) {
  const { err, av } = conferirVenda(v);
  if (err.length || av.length) {
    const seguir = await new Promise(res => { let ok = false; modal({ titulo: "Contrato de venda · conferir a ficha " + v.codigo, largo: true, ok: err.length ? "Fechar" : "Gerar mesmo assim",
      corpo: `${err.length ? `<div class="box bad"><b>Precisa corrigir antes de gerar:</b><ul>${err.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}${av.length ? `<div class="box warn"><b>Convém completar (dá para gerar e completar no Word):</b><ul>${av.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}<p class="hint">Corrija na ficha da venda (abas Venda e parcelas, Imóvel, Vendedores e Compradores).</p>`,
      aoFechar: () => res(ok), salvar: async () => { ok = !err.length; } }); });
    if (!seguir) return;
  }
  await carregarScript("termos/vendor/jszip.min.js");
  const r = await fetch("termos/contrato_padrao.docx"); if (!r.ok) throw new Error("Modelo do contrato não encontrado (termos/contrato_padrao.docx).");
  const zip = await window.JSZip.loadAsync(await r.arrayBuffer());
  const doc = await zip.file("word/document.xml").async("string");
  const ini = doc.indexOf("<w:body>") + 8, sect = doc.lastIndexOf("<w:sectPr");
  const corpo = textoContratoVenda(v).map(b => b.tit ? wPar(`<b>${b.tit}</b>`, { jc: "center", borda: true, after: 240, sz: 24 }) : b.sec ? wPar(`<b>${b.sec}</b>`, { jc: "left", before: 120, after: 120 }) : wPar(b.p, b)).join("");
  zip.file("word/document.xml", doc.slice(0, ini) + corpo + doc.slice(sect));
  const rod = zip.file("word/footer1.xml");
  if (rod) { let fx = await rod.async("string"), k = 0; const txt = `Esta folha é integrante do Instrumento Particular de Compromisso de Venda e Compra ${v.codigo} do imóvel situado na ${(v.ficha || {}).imv_rua || v.endereco}`;
    fx = fx.replace(/<w:t([^>]*)>[^<]*<\/w:t>/g, (m, a) => k++ === 0 ? `<w:t xml:space="preserve">${xmlEsc(txt)}</w:t>` : `<w:t${a}></w:t>`); zip.file("word/footer1.xml", fx); }
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = nomeArqPDF(`${v.codigo} Contrato de venda ${nomesParte(v.ficha || {}, "vnd")[0] || ""}`).replace(/\.pdf$/, ".docx"); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast("Contrato de venda gerado (Word). Confira e complete no Word antes de imprimir.");
}

/* ---------- v17: contrato de intermediação e administração (locador, com todos os imóveis dele) ---------- */
const TESTEMUNHAS_INT = [["LINYSTON LUIZ CAVALLARO", "35.116.648-8", "406.955.348-74"], ["ANDRÉ CESAR FILIETAZ", "29.257.356-X", "380.827.298-80"]];
// dado de cadastro "de verdade": tem pelo menos 2 números e não é xxx / ??? / 000
const dadoValido = v => { const t = String(v || "").trim(); return t.length >= 3 && (t.match(/\d/g) || []).length >= 2 && !/x{2,}|\?|^0+[.\-/0]*$|n[aã]o (tem|possui|consta)|sem /i.test(t); };
function imoveisDoLocador(loc) {
  const n = norm(loc.nome);
  return S.imoveis.filter(i => norm(i.locador) === n && i.status !== "INTV").sort((a, b) => COLL.compare(a.endereco, b.endereco));
}
function dadosImvInt(i) {
  const c = i.contrato_codigo ? CTT.find(x => x.codigo === i.contrato_codigo) : null, fc = c ? fichaDe(c) : {}, fi = i.ficha || {};
  const pega = k => [fc[k], fi[k]].find(dadoValido) || "";
  const rua = fc.end_rua || fi.end_rua || i.endereco, bairro = fc.end_bairro || fi.end_bairro || "", cidade = fc.end_cidade || fi.end_cidade || TIMBRE.cidade + "/SP";
  return { end: [rua, bairro, cidade].filter(Boolean).join(" – "), cep: pega("end_cep"), mat: pega("matricula"), insc: pega("insc_cad"), taxa: +i.taxa_adm || 0 };
}
function conferirIntermediacao(loc, imvs) {
  const f = loc.ficha || {}, err = [], av = [];
  if (!f.lcd1_nome) err.push("Locador: falta o nome do proprietário 1 (Cadastros › Locadores › ficha).");
  if (!imvs.length) err.push("Este locador não tem imóveis (ativos) no cadastro.");
  ["lcd1", "lcd2"].forEach(p => { if (!f[p + "_nome"]) return; const n = f[p + "_nome"];
    if (!f[p + "_cpf"]) err.push(`Locador: falta o CPF/CNPJ de ${n}.`);
    if (!/PJ/i.test(f.lcd_qtd || "")) { if (!f[p + "_rg"]) av.push(`Locador: falta o RG de ${n}.`); if (!f[p + "_est_civil"]) av.push(`Locador: falta o estado civil de ${n}.`); if (!f[p + "_prof"]) av.push(`Locador: falta a profissão de ${n}.`); } });
  if (!f.lcd_end1_rua) av.push("Locador: falta o endereço de residência.");
  imvs.forEach(i => { const d = dadosImvInt(i), falta = [!d.mat && "matrícula", !d.insc && "inscrição cadastral"].filter(Boolean);
    if (falta.length) av.push(`${rotuloImv(i.endereco)}: sem ${falta.join(" e ")} válida — sai só o endereço${d.cep ? " e o CEP" : ""}.`); });
  const tx = [...new Set(imvs.map(i => +i.taxa_adm || 0))];
  if (tx.length > 1) av.push(`Os imóveis têm taxas de administração diferentes (${tx.map(t => n2(t) + "%").join(", ")}): o contrato cita a taxa de cada imóvel.`);
  return { err, av };
}
const pctExt = p => { const i = Math.round(p); return Math.abs(p - i) < 0.001 ? `${i}% (${porExtenso(i)} por cento)` : `${n2(p)}%`; };
// v18: mesma diagramação do modelo (linhas em branco entre os blocos, CONTRATANTE/CONTRATADA sempre em negrito, letras "a-")
const negritoPartes = t => String(t).split(/(<b>.*?<\/b>)/).map(x => x.startsWith("<b>") ? x : x.replace(/\b(CONTRATANTES?|CONTRATADA|AS PARTES)\b/g, "<b>$1</b>")).join("");
function textoIntermediacao(loc, imvs) {
  const f = loc.ficha || {}, ns = nomesGrupo(f, "lcd"), pl = ns.length > 1, B = [];
  const CT = "CONTRATANTE" + (pl ? "S" : ""), o = pl ? "Os" : "O", eh = pl ? "são legítimos possuidores" : "é legítimo possuidor";
  const ds = imvs.map(dadosImvInt), txs = [...new Set(ds.map(d => d.taxa))], vr = imvs.length > 1;
  const br = () => B.push({ p: "" }), P = (t, x) => B.push(Object.assign({ p: negritoPartes(t) }, x || {}));
  br(); B.push({ tit: "INSTRUMENTO PARTICULAR DE CONTRATO DE INTERMEDIAÇÃO E ADMINISTRAÇÃO IMOBILIÁRIA" }); br(); br(); br();
  P(`<b><u>${CT}:</u></b> ${qualifGrupo(f, "lcd").replace(/^([^,]+)/, m => /<b>/.test(m) ? m : `<b>${m}</b>`)}.`); br();
  P(`<b><u>CONTRATADA:</u></b> <b>${esc(TIMBRE.razao.split(" — ")[0])}</b>, Creci 4419-J, inscrita no CNPJ sob nº ${esc(TIMBRE.cnpj)}, com sede à ${esc(TIMBRE.rodape[0].replace(/\s*–\s*CEP.*$/, ""))}.`); br();
  P(`<b>OBJETO:</b> ${vr ? "Os seguintes imóveis:" : "O seguinte imóvel:"}`, { line: 360 }); B.push({ p: "", ind: 426 });
  ds.forEach((d, k) => {
    B.push({ p: `${k + 1})\t<b>ENDEREÇO:</b> ${esc(d.end)}.`, ind: 786, hang: 360, line: 276 });
    [["CEP", d.cep], ["MATRÍCULA", d.mat], ["INSC. CAD.", d.insc]].concat(txs.length > 1 ? [["TAXA DE ADMINISTRAÇÃO", pctExt(d.taxa)]] : []).forEach(([t, v]) => { if (v) B.push({ p: `<b>${t}:</b> ${esc(v)}.`, ind: 786, line: 276 }); });
    B.push({ p: "", ind: 426 });
  });
  const dos = vr ? "dos imóveis" : "do imóvel", nos = vr ? "nos imóveis" : "no imóvel", ao = pl ? "aos" : "ao", do_ = pl ? "dos" : "do";
  const L = (k, t, ind) => B.push({ p: negritoPartes(`${String.fromCharCode(97 + k)}-\t${t}`), ind: ind || 1080, hang: 360 });
  P(`Por este Instrumento Particular de Contrato de Intermediação e Administração Imobiliária AS PARTES supramencionadas resolvem de comum acordo e de livre e espontânea vontade, firmar o presente Instrumento, cujo objeto se encontra declinado no preâmbulo e a reger-se pelas seguintes cláusulas e condições.`); br();
  P(`<b>CLÁUSULA 1ª)</b> ${o} ${CT} ${eh} ${vr ? "dos imóveis situados nos endereços" : "do imóvel situado no endereço"} do preâmbulo, tendo interesse em alugá-l${vr ? "os" : "o"} para Fins Residenciais e/ou Comerciais, cujos valores da locação serão estabelecidos na época em que ${vr ? "os mesmos forem locados" : "o mesmo for locado"}, razão pela qual ${pl ? "pretendem" : "pretende"} se utilizar dos serviços da CONTRATADA para promover a seleção dos pretendentes à${vr ? "s suas locações" : " sua locação"}, e sua subsequente administração.`); br();
  P(`<b>CLÁUSULA 2ª)</b> Para essa finalidade, se compromete a CONTRATADA a efetuar o levantamento das informações cadastrais dos eventuais pretendentes, de modo a poder selecionar dentre estes, aqueles que vierem a ser considerados como os mais indicados.`); br();
  P(`<b>Parágrafo Único:</b> A indicação dos pretendentes pela CONTRATADA não obriga a aceitação por parte ${do_} ${CT}, que poderá${pl ? "ão" : ""} a seus exclusivos critérios recusá-los e indicar outros, desde que mediante expressa autorização e sob sua inteira responsabilidade.`); br();
  P(`<b>CLÁUSULA 3ª)</b> ${o} ${CT} ${pl ? "autorizam" : "autoriza"} a CONTRATADA celebrar e assinar contratos de locação, aceitar ou rejeitar fiadores, prorrogar, rescindir ou modificar os mesmos, arbitrar e receber aluguéis, dar quitação, requerer, promover, alegar, acompanhar processos, contratar advogados, substabelecendo a eles os poderes aqui outorgados, podendo representá-l${pl ? "os" : "o"} perante a Sabesp, CPFL, Administradoras do Condomínio, em todas as Repartições Públicas, Federais, Estaduais, Municipais ou Autarquias, e tudo o mais que aos contratos sejam devidos.`); br();
  P(`<b>CLÁUSULA 4ª)</b> Pela administração das locações, será devido à CONTRATADA o percentual ${txs.length > 1 ? "indicado no preâmbulo para cada imóvel" : "de " + pctExt(txs[0] || 10)}, sobre o valor de cada aluguel mensal, nele incluídos os encargos no caso de eventual mora do(a) locatário(a), deduzido do valor a ser repassado ${ao} ${CT}.`); br();
  P(`<b>Parágrafo Primeiro:</b> Os aluguéis recebidos pela CONTRATADA, deduzida a remuneração estabelecida no “caput”, serão repassados ${ao} ${CT} no prazo máximo de 05 (cinco) dias úteis.`); br();
  P(`<b>Parágrafo Segundo:</b> Caso haja adiantamento por liberalidade do aluguel e encargos ${ao} ${CT}, ainda que não recebidos do(a) locatário(a), os valores recebidos posteriormente serão revertidos à CONTRATADA com os acréscimos eventualmente recebidos.`); br(); br();
  P(`<b>CLÁUSULA 5ª)</b> Além do já estabelecido nas cláusulas anteriores, obriga-se a <b>CONTRATADA:</b>`); br();
  [`Verificar o estado ${dos}, antes e após o término da locação;`, `Divulgar, pelos meios usuais e a seu critério, a oferta da locação;`, `Cobrar os aluguéis e os respectivos encargos convencionados, deles deduzindo os honorários devidos;`,
    `Providenciar os reparos que se fizerem necessários para a conservação ${dos} na vigência da locação, mediante autorização ${do_} ${CT}, às expensas deste${pl ? "s" : ""};`,
    `Tomar as medidas judiciais que se fizerem necessárias, para cobrar os aluguéis impagos, ou promover o despejo do inquilino. Fica estabelecido que, as ações, que venham objetivar a desocupação ${dos}, seja ela pelo término do prazo contratual ou para uso próprio, bem como as revisionais de aluguel terão as custas processuais e os honorários advocatícios suportados exclusivamente pel${pl ? "os" : "o"} ${CT}, e as ações por falta de pagamento terão as custas processuais e os honorários advocatícios suportados pela CONTRATADA.`]
    .forEach((t, k, a) => { L(k, t); if (k < a.length - 1) B.push({ p: "", ind: 1080 }); }); br();
  P(`<b>CLÁUSULA 6ª)</b> Em contrapartida obriga${pl ? "m-se os" : "-se o"} <b>${CT}:</b>`); br();
  [`Não interferir na relação jurídica existente entre CONTRATADA e o inquilino e/ou Fiadores, sem prévia ciência da CONTRATADA;`, `Não receber sob qualquer hipótese, na vigência desse contrato, diretamente do inquilino e/ou fiador, valores referentes a locação ou as chaves ${dos};`,
    `Conceder à CONTRATADA a exclusividade para a intermediação da venda ${vr ? "dos imóveis objetos" : "do imóvel objeto"} deste, caso venha${pl ? "m" : ""} futuramente a decidir pela sua alienação;`]
    .forEach((t, k, a) => { L(k, t, 1065); if (k < a.length - 1) B.push({ p: "", ind: 1065 }); }); br();
  P(`<b>CLÁUSULA 7ª)</b> A CONTRATADA fica isenta de qualquer responsabilidade por fatos alheios a administração da locação, como arrombamentos, ocupação indevida, cessão irregular da locação e eventuais danos a ele causados em razão desses fatos, comprometendo-se, porém, a tomar as medidas judiciais ou extrajudiciais que estiverem ao seu alcance, mediante autorização expressa ${do_} ${CT}, ao${pl ? "s" : ""} qua${pl ? "is" : "l"} caberá arcar com o ônus processual e honorários advocatícios.`); br();
  P(`<b>CLÁUSULA 8ª)</b> Fica reservado à CONTRATADA o direito de rescindir o presente Instrumento, sem motivo justificado, desde que mediante expresso aviso com antecedência mínima de 30 (trinta) dias, uma vez prestadas as contas devidas na sua vigência e entregue ${ao} ${CT} toda a documentação em seu poder.`); br();
  P(`<b>CLÁUSULA 9ª)</b> ${pl ? "Aos" : "Ao"} ${CT} por sua vez, caberá o mesmo direito, após ressarcimento de eventuais despesas pendentes ou antecipações efetuadas, além do pagamento de indenização correspondente a 01 (um) aluguel vigente na época, caso o inquilino que esteja residindo permaneça ${nos}.`); br();
  P(`<b>CLÁUSULA 10ª)</b> ${o} ${CT} ${pl ? "declaram" : "declara"} ter conhecimento do Imposto de Renda incidente sobre a receita de locação, para seu recolhimento.`); br();
  P(`<b>CLÁUSULA 11ª)</b> Fica eleito o Foro da comarca de ${esc(TIMBRE.cidade)}, para a solução das questões decorrentes do presente instrumento, renunciando as partes a qualquer outro, por mais privilegiado que lhes possa ser.`); br();
  P(`E por estarem, assim, justas e contratadas, AS PARTES assinam o presente contrato em 2 (duas) vias, de igual teor e forma, na presença das testemunhas abaixo, para que surta seus legais e jurídicos efeitos, obrigando-se por si, seus herdeiros e/ou sucessores, ao fiel cumprimento de todas as suas cláusulas e condições.`); br(); br();
  // data e assinaturas ficam juntas (mesma página)
  B.push({ p: `${esc(TIMBRE.cidade)}, ${dataExt(hoje())}.`, jc: "right", keep: true }); B.push({ p: "", keep: true });
  // v19: linha de assinatura, RG: e CPF: em negrito; 1 linha em branco extra depois do contratante e da contratada; nenhuma depois das testemunhas
  const rotN = t => esc(t).replace(/^(RG|CPF|CNPJ|CRECI):/, "<b>$1:</b>");
  const cel = (rot, nome, linhas, fim) => nome ? [rot ? `<b>${rot}:</b>` : "", "", "", "<b>_________________________________</b>", `<b>${esc(nome)}</b>`].concat(linhas.filter(Boolean).map(rotN)).concat(Array(fim == null ? 1 : fim).fill("")) : [""];
  const cts = ["lcd1", "lcd2"].filter((p, k) => f[p + "_nome"] && !(k && /PJ/i.test(f.lcd_qtd || ""))).map((p, k) => cel(k ? "" : CT, f[p + "_nome"].toUpperCase(), [f[p + "_rg"] && "RG: " + f[p + "_rg"], f[p + "_cpf"] && (String(f[p + "_cpf"]).replace(/\D/g, "").length > 11 ? "CNPJ: " : "CPF: ") + f[p + "_cpf"]], 2));
  B.push({ tab: [[cts[0], cts[1] || cel()], [cel("CONTRATADA", TIMBRE.razao.split(" — ")[0], ["CNPJ: " + TIMBRE.cnpj, "CRECI: 4419-J"], 2), cel()],
    TESTEMUNHAS_INT.map(([n, rg, cpf], k) => cel(k ? "" : "TESTEMUNHAS", n, ["RG: " + rg, "CPF: " + cpf], 0))] });
  return B;
}
async function gerarIntermediacao(loc) {
  if (!CTT.length) CTT = await fetchAll("contratos", b => b.order("codigo", { ascending: false }));
  const imvs = imoveisDoLocador(loc), { err, av } = conferirIntermediacao(loc, imvs);
  if (err.length || av.length) {
    const seguir = await new Promise(res => { let ok = false; modal({ titulo: "Contrato de intermediação · conferir " + tiraPrefixo(loc.nome), largo: true, ok: err.length ? "Fechar" : "Gerar mesmo assim",
      corpo: `${err.length ? `<div class="box bad"><b>Precisa corrigir antes de gerar:</b><ul>${err.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}${av.length ? `<div class="box warn"><b>Convém conferir (dá para gerar e completar no Word):</b><ul>${av.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}<p class="hint">Os dados do proprietário vêm de Cadastros › Locadores (ficha). Matrícula, inscrição e CEP vêm do contrato do imóvel ou da aba Imóvel da ficha do imóvel.</p>`,
      aoFechar: () => res(ok), salvar: async () => { ok = !err.length; } }); });
    if (!seguir) return;
  }
  await carregarScript("termos/vendor/jszip.min.js");
  const r = await fetch("termos/contrato_intermediacao.docx"); if (!r.ok) throw new Error("Modelo não encontrado (termos/contrato_intermediacao.docx).");
  const zip = await window.JSZip.loadAsync(await r.arrayBuffer());
  const doc = await zip.file("word/document.xml").async("string");
  const ini = doc.indexOf("<w:body>") + 8, sect = doc.lastIndexOf("<w:sectPr"), o = { sz: 20, line: 276 };
  const wTab = rows => `<w:tbl><w:tblPr><w:tblW w:w="9072" w:type="dxa"/><w:tblLook w:val="0000"/></w:tblPr><w:tblGrid><w:gridCol w:w="4536"/><w:gridCol w:w="4536"/></w:tblGrid>${rows.map((r, ri) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map(c => `<w:tc><w:tcPr><w:tcW w:w="4536" w:type="dxa"/></w:tcPr>${c.map(t => wPar(t, { jc: "left", after: 60, sz: 20, keep: ri < rows.length - 1 })).join("")}</w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`;
  // v19: título em 12; todas as linhas com 3 pt depois (antes 0)
  const corpo = textoIntermediacao(loc, imvs).map(b => b.tab ? wTab(b.tab) : b.tit ? wPar(`<b>${b.tit}</b>`, { jc: "center", after: 60, sz: 24, under: true }) : wPar(b.p, Object.assign({ sz: 20 }, b, { after: 60 }))).join("") + wPar("", { after: 0, sz: 2, line: 20, exato: true });
  zip.file("word/document.xml", doc.slice(0, ini) + corpo + doc.slice(sect));
  const rod = zip.file("word/footer1.xml");
  if (rod) { let fx = await rod.async("string"), k = 0; const txt = `Esta folha é integrante do Contrato de Intermediação/Administração Imobiliária de ${(nomesGrupo(loc.ficha || {}, "lcd")[0] || tiraPrefixo(loc.nome))} (${imvs.length} ${imvs.length === 1 ? "imóvel" : "imóveis"}).`;
    fx = fx.replace(/<w:t([^>]*)>([^<]*)<\/w:t>/g, (m, a, t) => k++ === 0 ? `<w:t xml:space="preserve">${xmlEsc(txt)}</w:t>` : /^\d+$/.test(t) ? m : `<w:t${a}></w:t>`); zip.file("word/footer1.xml", fx); }
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = nomeArqPDF(`Contrato de intermediação ${tiraPrefixo(loc.nome)}`).replace(/\.pdf$/, ".docx"); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast("Contrato de intermediação gerado (Word). Confira no Word antes de imprimir.");
}
async function escolherLocadorInt() {
  const ls = (S.locadores || []).filter(l => l.ativo).map(l => ({ l, n: imoveisDoLocador(l).length })).filter(x => x.n).sort((a, b) => COLL.compare(a.l.nome, b.l.nome));
  const it = ls.map(({ l, n }) => ({ v: l, busca: [l.nome, (l.ficha || {}).lcd1_nome, (l.ficha || {}).lcd2_nome].join(" "), html: `${tagLoc(l.nome)}<small class="muted">${n} ${n === 1 ? "imóvel" : "imóveis"}${(l.ficha || {}).lcd1_cpf ? "" : " · ficha sem CPF"}</small>` }));
  const r = await escolherNaLista("Contrato de intermediação · qual locador?", it, "O contrato sai com todos os imóveis do locador (menos os inativos).");
  return r ? r.v : null;
}

/* ---------- v19: cadastros recebidos pelo formulário do cliente ---------- */
let CADR = [];
const SIT_CAD = { "NOVO": "bad", "EM ANÁLISE": "warn", "APROVADO": "ok", "RECUSADO": "idle", "VIROU CONTRATO": "info", "ARQUIVADO": "idle" };
const TIPO_CAD = { completo: "Locatário e fiador", somente_locatario: "Só locatário", somente_fiador: "Só fiador" };
const COLS_CAD = [
  { k: "recebido_em", t: "Recebido", tipo: "data", v: x => String(x.recebido_em).slice(0, 10), html: x => `${dt(String(x.recebido_em).slice(0, 10))}<span class="sub">${new Date(x.recebido_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>` },
  { k: "situacao", t: "Situação", html: x => `<span class="tag ${SIT_CAD[x.situacao] || "idle"}">${esc(x.situacao)}</span>` },
  { k: "nome", t: "Nome", html: x => `${tagPes([x.nome], x.tipo === "somente_fiador" ? "etq-fdr" : "etq-lct", x.nome)}` },
  { k: "tipo", t: "Formulário", v: x => TIPO_CAD[x.tipo] || x.tipo },
  { k: "imovel_txt", t: "Imóvel pretendido", cls: "trunc" },
  { k: "telefone", t: "Telefone", cls: "mono" },
  { k: "arquivos", t: "Arquivos", tipo: "num", int: true, v: x => (x.arquivos || []).length },
  { k: "contrato_codigo", t: "Contrato", html: x => x.contrato_codigo ? tagCtt(x.contrato_codigo) : "" }
];
PAGES.cadastros = async pg => {
  CADR = await fetchAll("cadastros_recebidos", b => b.order("recebido_em", { ascending: false })).catch(e => { console.warn(e); return null; });
  setRd(pg, () => desenharCadastros());
  desenharCadastros(pg);
};
function desenharCadastros(pg) {
  pg = pg || $("#page");
  if (CADR == null) { pg.innerHTML = `<div class="card empty"><p>Os cadastros recebidos ainda não estão ligados.</p><p class="hint">Rode o SQL da versão 19 no Supabase (supabase_setup.sql) e siga a pasta <b>7-formulario-cliente</b> do pacote.</p></div>`; return; }
  const f = S.f.cad || "abertos", busca = S.f.cadBusca || "";
  const teste = { abertos: x => ["NOVO", "EM ANÁLISE", "APROVADO"].includes(x.situacao), NOVO: x => x.situacao === "NOVO", todos: () => true, fechados: x => ["RECUSADO", "VIROU CONTRATO", "ARQUIVADO"].includes(x.situacao) };
  let lista = CADR.filter(teste[f] || teste.abertos);
  if (busca) { const b = norm(busca); lista = lista.filter(x => norm([x.nome, x.cpf, x.telefone, x.email, x.imovel_txt, x.contrato_codigo].join(" ")).includes(b)); }
  const g = grade("cadastros", COLS_CAD, lista, { attr: x => `data-act="cad-ed" data-id="${x.id}" style="cursor:pointer"`, sort: { k: "recebido_em", dir: "desc" }, vazio: "Nenhum cadastro recebido." });
  g.redesenhar = () => desenharCadastros();
  pg.innerHTML = `<div class="grid"><div class="filters"><div class="chips">${[["abertos", "Em andamento"], ["NOVO", "Novos"], ["fechados", "Concluídos"], ["todos", "Todos"]].map(([k, t]) => `<button class="chip${f === k ? " on" : ""}${k === "NOVO" ? " st-INTV" : ""}" data-act="chip" data-k="cad" data-v="${k}">${t}<span class="c">${CADR.filter(teste[k]).length}</span></button>`).join("")}</div>
    <input type="search" placeholder="Buscar nome, CPF, telefone, imóvel…" value="${esc(busca)}" data-busca="cadBusca"><span class="spacer"></span>${gradeBarra("cadastros")}</div>
    ${gradeHTML("cadastros")}
    <p class="hint">Chegam pelo botão <b>Enviar para a imobiliária</b> do formulário do cliente. Os documentos ficam na pasta do Google Drive de cada cadastro (botão 📁 na ficha). Configuração: Configurações › Formulário do cliente.</p></div>`;
  ligarBusca(pg);
}
ACT["cad-ed"] = el => {
  const x = CADR.find(y => y.id === el.dataset.id); if (!x) return;
  const ed = pode.ed("contratos"), d0 = x.dados || {}, tx = d0.textos || {};
  const campo = (rot, v) => v ? `<div class="cp-l"><span class="cp-r">${esc(rot)}</span><span class="cp-v">${esc(v)}</span></div>` : "";
  const pessoas = [["loc1", "Locatário 1"], ["loc2", "Locatário 2"], ["fiador1", "Fiador 1"], ["fiador2", "Fiador 2"]].filter(([p]) => tx[p + "_nome"]).map(([p, t]) => `<div class="cad-p"><h3>${t}</h3>${campo("Nome", tx[p + "_nome"])}${campo("CPF", tx[p + "_cpf"])}${campo("RG", tx[p + "_rg"])}${campo("Telefone", tx[p + "_tel"])}${campo("E-mail", tx[p + "_email"])}${campo("Profissão", tx[p + "_profissao"])}${campo("Renda", tx[p + "_renda"])}</div>`).join("");
  modal({ titulo: "Cadastro recebido · " + x.nome, xl: true, semOk: !ed, ok: "Salvar",
    corpo: `<div class="info-cob"><div><small>Recebido</small><b>${dt(String(x.recebido_em).slice(0, 10))} ${new Date(x.recebido_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</b></div><div><small>Formulário</small><b>${esc(TIPO_CAD[x.tipo] || x.tipo)}</b></div><div><small>Imóvel pretendido</small><b>${esc(x.imovel_txt || "—")}</b></div>
        ${x.pasta_url ? `<div><small>Documentos</small><a class="btn sm pri" href="${esc(x.pasta_url)}" target="_blank" rel="noopener">📁 Abrir pasta no Drive</a></div>` : ""}</div>
      <div class="cad-g">${pessoas || `<p class="hint">Sem dados de pessoas no envio.</p>`}</div>
      ${(x.arquivos || []).length ? `<h3>Arquivos (${x.arquivos.length})</h3><ul class="cad-arq">${x.arquivos.map(a => `<li>${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.nome || a.rotulo || "arquivo")}</a>` : esc(a.nome || "")} <small class="muted">${esc(a.rotulo || "")}</small></li>`).join("")}</ul>` : ""}
      <div class="row"><label class="fl"><span>Situação</span><select name="situacao" ${ed ? "" : "disabled"}>${Object.keys(SIT_CAD).map(k => opt(k, k, x.situacao === k)).join("")}</select></label>
        <label class="fl"><span>Contrato gerado</span><input name="contrato" value="${esc(x.contrato_codigo || "")}" placeholder="ex.: L.26.080" ${ed ? "" : "disabled"}></label></div>
      <label class="fl"><span>Observações internas</span><textarea name="obs" rows="2" ${ed ? "" : "disabled"}>${esc(x.obs || "")}</textarea></label>
      <p class="hint">Para fazer o contrato: <b>Contratos › Gerar contrato</b> e, no gerador, <b>Importar PDF</b> com o PDF que está na pasta do Drive (os dados já vêm preenchidos).</p>`,
    extra: `${pode.admin() ? `<button type="button" class="btn danger" data-del>Excluir</button>` : ""}${ed ? `<button type="button" class="btn" data-act="ctt-gerar">📝 Gerar contrato</button>` : ""}`,
    aoAbrir: (f, d) => { const b = $("[data-del]", d); if (b) b.addEventListener("click", async () => { d.close(); if (!(await confirmar("Excluir cadastro", `Excluir o cadastro de <b>${esc(x.nome)}</b> da lista? (a pasta no Drive continua lá)`, "Excluir"))) return; try { await q(sb.from("cadastros_recebidos").delete().eq("id", x.id)); toast("Excluído."); render(); } catch (e) { falha(e); } }); },
    salvar: async f => { await q(sb.from("cadastros_recebidos").update({ situacao: f.situacao.value, contrato_codigo: f.contrato.value.trim(), obs: f.obs.value.trim() }).eq("id", x.id)); toast("Salvo."); atualizarContadores(); render(); } });
};

/* ---------- v16: planilha antiga do site — códigos de locação, imóveis à venda e interessados ---------- */
ACT["site-importar"] = () => {
  let D = null;
  modal({ titulo: "Planilha do site · códigos, imóveis à venda e interessados", xl: true, ok: "Gravar o que está marcado",
    corpo: `<p>Escolha o arquivo <b>site-conferencia.json</b> (pasta 4 do pacote, nunca no GitHub). Ele traz a sua planilha de anúncios já conferida com os imóveis de locação.</p><input type="file" data-arq accept=".json"><div data-res></div>`,
    aoAbrir: (f, d) => $("[data-arq]", d).addEventListener("change", async e => {
      const res = $("[data-res]", d);
      try {
        D = JSON.parse(await e.target.files[0].text()); if (D.formato !== "site-conferencia") throw new Error("Arquivo não é a conferência da planilha do site.");
        const [ivs, ints] = await Promise.all([fetchAll("imoveis_venda", b => b.order("id"), "codigo_site,endereco").catch(() => []), fetchAll("interessados", b => b.order("id"), "nome").catch(() => [])]);
        const L = D.locacao.map((x, k) => { const im = x.imovel_id && S.imovelPor[x.imovel_id]; const at = im ? String(im.codigo_site || "").trim() : "";
          return Object.assign({ k, im, cat: !im ? "duv" : !at ? "novo" : at === x.codigo ? "igual" : "dif", atual: at }, x); });
        const n = c => L.filter(x => x.cat === c).length;
        const car = x => ["quartos", "wc", "suites", "garagem"].filter(k => x[k]).map(k => `${x[k]} ${({ quartos: "qto", wc: "wc", suites: "suíte", garagem: "vaga" })[k]}`).join(" · ");
        const V = D.venda.map((x, k) => Object.assign({ k, ja: ivs.some(y => (x.codigo_site && y.codigo_site === x.codigo_site) || norm(y.endereco) === norm(x.endereco)) }, x));
        const I = D.interessados.map((x, k) => Object.assign({ k, ja: ints.some(y => norm(y.nome) === norm(x.nome)) }, x));
        res.innerHTML = `<div class="kpis" style="margin:10px 0">${kpi("Códigos novos", String(n("novo")), "imóvel ainda sem código", true)}${kpi("Diferentes", String(n("dif")), "você escolhe")}${kpi("Iguais", String(n("igual")), "nada a fazer")}${kpi("Dúvida", String(n("duv")), "escolha o imóvel")}${kpi("Imóveis à venda", String(V.filter(x => !x.ja).length), "novos na lista")}${kpi("Interessados", String(I.filter(x => !x.ja).length), "novos")}</div>
          <label class="chk"><input type="checkbox" data-car checked> completar também quartos, WCs, suítes e garagem dos imóveis de locação (só os que estiverem vazios)</label>
          <div class="seg" style="margin:8px 0">${[["novo", "Códigos novos"], ["dif", "Diferentes"], ["duv", "Dúvida"], ["igual", "Iguais"], ["ven", "Imóveis à venda"], ["int", "Interessados"]].map(([k, t], j) => `<button type="button" data-sv="${k}" class="${j ? "" : "on"}">${t}</button>`).join("")}</div>
          <div class="tw cp-t" style="max-height:48vh"><table class="compacta"><tbody>
          ${L.filter(x => x.cat !== "duv").map(x => `<tr class="sv-${x.cat}"><td class="mono">${esc(x.codigo)}</td><td>${tagImv(x.im.endereco)}<br><small class="muted">lista: ${esc(x.lista)} · ${esc(x.prop || "")} · ${esc(car(x))}</small></td>
            <td>${x.cat === "igual" ? `<span class="tag ok">igual</span>` : x.cat === "novo" ? `<label class="chk"><input type="checkbox" data-sl="${x.k}" checked> gravar o código</label>` : `<span class="tag warn">hoje: ${esc(x.atual)}</span><br><label class="chk"><input type="radio" name="sd${x.k}" checked> manter</label><label class="chk"><input type="radio" name="sd${x.k}" data-sl="${x.k}"> usar ${esc(x.codigo)}</label>`}</td></tr>`).join("")}
          ${L.filter(x => x.cat === "duv").map(x => `<tr class="sv-duv"><td class="mono">${esc(x.codigo)}</td><td><b>${esc(x.lista)}</b> <small class="muted">${esc(x.prop || "")} · ${esc(x.motivo || "")}</small></td>
            <td><select data-sdv="${x.k}">${opt("", "— não gravar —", true)}${(x.candidatos || []).map(id => S.imovelPor[id] ? opt(id, S.imovelPor[id].endereco, false) : "").join("")}<optgroup label="Outro imóvel">${S.imoveis.map(i => opt(i.id, i.endereco, false)).join("")}</optgroup></select></td></tr>`).join("")}
          ${V.map(x => `<tr class="sv-ven"><td class="mono">${esc(x.codigo_site || "")}</td><td><b>${esc(x.endereco)}</b> <small class="muted">${esc(x.bairro || "")} · ${esc(x.tipo)} · ${x.valor ? brl(x.valor) : esc(x.valor_txt || "")} · ${esc(x.vendedor || "")}</small><br><small class="muted">${esc(x.obs || "")}</small></td>
            <td>${x.ja ? `<span class="tag ok">já está</span>` : `<span class="tag ${x.status === "DISP" ? "ok" : "bad"}">${x.status === "DISP" ? "disponível" : "inativo"}</span> <label class="chk"><input type="checkbox" data-sv-i="${x.k}" checked> incluir</label>`}</td></tr>`).join("")}
          ${I.map(x => `<tr class="sv-int"><td>${x.tipo === "venda" ? "compra" : "locação"}</td><td><b>${esc(x.nome)}</b> <small class="muted">${esc(x.contato || "")}</small><br>${esc(x.procura)}</td>
            <td>${x.ja ? `<span class="tag ok">já está</span>` : `<label class="chk"><input type="checkbox" data-si="${x.k}" checked> incluir</label>`}</td></tr>`).join("")}
          </tbody></table></div>`;
        D._L = L;
        const filtra = k => $$(".cp-t tbody tr", res).forEach(tr => (tr.hidden = !tr.classList.contains("sv-" + k)));
        $$("[data-sv]", res).forEach(b => b.addEventListener("click", () => { $$("[data-sv]", res).forEach(x => x.classList.toggle("on", x === b)); filtra(b.dataset.sv); })); filtra("novo");
      } catch (x) { res.innerHTML = `<div class="box bad">${esc(erroMsg(x))}</div>`; }
    }),
    salvar: async () => {
      if (!D) throw new Error("Escolha o arquivo.");
      const d = $("#dlg"), carOk = $("[data-car]", d) && $("[data-car]", d).checked, grav = [];
      $$("[data-sl]", d).forEach(x => { if (x.checked) { const it = D.locacao[+x.dataset.sl]; grav.push([it.imovel_id, it]); } });
      $$("[data-sdv]", d).forEach(x => { if (x.value) grav.push([x.value, D.locacao[+x.dataset.sdv]]); });
      let nc = 0, nv = 0, ni = 0;
      for (const [id, it] of grav) {
        const im = S.imovelPor[id]; if (!im) continue;
        const fi = Object.assign({}, im.ficha || {});
        if (carOk) ["quartos", "wc", "suites", "garagem"].forEach(k => { if (it[k] && !fi[k]) fi[k] = it[k]; });
        await q(sb.from("imoveis").update({ codigo_site: it.codigo, ficha: fi }).eq("id", id)); nc++;
      }
      // características também nos casados "iguais" (sem mudar o código)
      if (carOk) for (const it of D._L.filter(x => x.cat === "igual")) {
        const fi = Object.assign({}, it.im.ficha || {}); let mud = false;
        ["quartos", "wc", "suites", "garagem"].forEach(k => { if (it[k] && !fi[k]) { fi[k] = it[k]; mud = true; } });
        if (mud) await q(sb.from("imoveis").update({ ficha: fi }).eq("id", it.im.id));
      }
      const vs = $$("[data-sv-i]", d).filter(x => x.checked).map(x => { const v = D.venda[+x.dataset.svI]; return { codigo_site: v.codigo_site || "", endereco: v.endereco, bairro: v.bairro || "", tipo: v.tipo || "Casa", status: v.status, valor: v.valor, vendedor: v.vendedor || "", ficha: v.ficha || {}, obs: [v.obs, v.valor_txt ? "Valor na lista: " + v.valor_txt : ""].filter(Boolean).join(" ") }; });
      for (let i = 0; i < vs.length; i += 200) { await q(sb.from("imoveis_venda").insert(vs.slice(i, i + 200))); } nv = vs.length;
      const is = $$("[data-si]", d).filter(x => x.checked).map(x => { const v = D.interessados[+x.dataset.si]; return { tipo: v.tipo, nome: v.nome, contato: v.contato || "", procura: v.procura || "", ativo: v.ativo !== false, ultimo_contato: v.ultimo_contato || null }; });
      if (is.length) await q(sb.from("interessados").insert(is)); ni = is.length;
      await recarregarImoveis(); toast(`Gravado: ${nc} código(s) de locação, ${nv} imóvel(is) à venda, ${ni} interessado(s).`); render();
    } });
};

/* ---------- v16: aba Termos (todos os termos num lugar só) ---------- */
PAGES.termos = async pg => {
  const grupo = (tit, itens) => `<h2 class="cfg-t">${tit}</h2><div class="tm-cards">${itens.map(x => `<button type="button" class="tm-card" data-act="termo-pg" data-k="${x.k}"><span class="tm-ic">${x.ic}</span><span><b>${esc(x.t)}</b><small>${esc(x.d)}</small></span></button>`).join("")}</div>`;
  pg.innerHTML = `<div class="grid"><p class="hint">Escolha o termo e depois clique no contrato, locatário, devedor ou venda (a lista mostra só quem se encaixa).</p>
    ${pode.ver("contratos") || pode.ver("imoveis") ? grupo("Locação", (pode.editar() ? [{ ic: "📝", k: "doc:gerador", t: "Contrato de locação (Word)", d: "gerador de contratos: novo ou de um contrato existente" }, { ic: "🤝", k: "doc:intermediacao", t: "Contrato de intermediação (Word)", d: "com o locador, para todos os imóveis dele" }] : []).concat(TERMOS_CTT.map(x => Object.assign({}, x, { k: "ctt:" + x.k })))) : ""}
    ${pode.ver("atrasados") || pode.ver("devedores") ? grupo("Cobrança", TERMOS_COB_IC.map(x => Object.assign({}, x, { k: "cob:" + x.k }))) : ""}
    ${pode.ver("vendas") ? grupo("Vendas", TERMOS_VEN.map(x => Object.assign({}, x, { k: "ven:" + x.k }))) : ""}</div>`;
};
const FILTRO_TERMO = { entrega: c => c.situacao === "ATIVO", moradia: c => c.situacao === "ATIVO", caucao: c => garDe(c) === "caucao" && c.situacao !== "RASCUNHO", quitacao: c => ["ATIVO", "ENCERRADO", "DÉBITO EM ABERTO"].includes(c.situacao) };
ACT["termo-pg"] = async el => {
  const [g, k] = el.dataset.k.split(":");
  if (g === "doc" && k === "intermediacao") { const l = await escolherLocadorInt(); if (l) gerarIntermediacao(l).catch(falha); return; }
  if (g === "doc" && k === "gerador") {
    if (!CTT.length) CTT = await fetchAll("contratos", b => b.order("codigo", { ascending: false }));
    const it = [{ v: "novo", busca: "novo contrato", html: `<span class="esc-cod">➕</span><b>Novo contrato</b><small class="muted">próximo número: ${esc(proximoCodigo())}</small>` }]
      .concat(CTT.filter(c => c.situacao !== "CANCELADO").map(c => { const im = imvDoCtt(c); return { v: c, busca: [c.codigo, c.locatario, c.endereco, im && im.endereco].join(" "), html: `<span class="mono esc-cod">${esc(c.codigo)}</span><span class="tag ${SIT_CTT[c.situacao] || "idle"}">${esc(sitTxt(c.situacao))}</span>${im ? tagImv(im.endereco) : ""}${tagPes(nomesCtt(c, "lct").length ? nomesCtt(c, "lct") : separaNomes(c.locatario), "etq-lct", "", 2)}` }; }));
    const r = await escolherNaLista("Contrato de locação (Word) · novo ou de qual contrato?", it, "Clique em “Novo contrato” ou no contrato que quer gerar de novo."); if (!r) return;
    return r.v === "novo" ? ACT["ctt-gerar"]() : abrirTermo("gerador", r.v.codigo);
  }
  if (g === "ctt") { const c = await escolherContrato(TERMOS_CTT.find(x => x.k === k).t + " · escolha o contrato", FILTRO_TERMO[k]); if (c) abrirTermoNativo(k, c.codigo); return; }
  if (g === "cob") {
    await carregarInad();
    const devs = pode.ver("devedores") ? await q(sb.from("devedores").select("id,devedor,endereco,situacao").in("situacao", ["EM ABERTO", "ACORDO"])).catch(() => []) : [];
    const it = INAD.map(i => ({ v: ["inad", i.id], busca: [i.locatario, i.imovel, i.locador].join(" "), html: `<span class="tag bad">inadimplente</span>${tagImv(i.imovel)}${tagPes(separaNomes(i.locatario), "etq-lct", "", 2)}<small class="muted">${brl(i.total || 0)}</small>` }))
      .concat(devs.map(d => ({ v: ["dev", d.id], busca: [d.devedor, d.endereco].join(" "), html: `<span class="tag warn">devedor</span>${tagImv(d.endereco)}${tagPes(separaNomes(d.devedor), "etq-lct", "", 2)}` })));
    if (!it.length) return toast("Nenhum inadimplente ou devedor em aberto.", true);
    const r = await escolherNaLista(TERMOS_COB_IC.find(x => x.k === k).t + " · para quem?", it); if (!r) return;
    if (r.v[0] === "dev") DEV = await fetchAll("devedores", b => b.order("id"));
    return setTimeout(() => ACT["cob-termo"]({ dataset: { src: r.v[0], id: r.v[1], tipo: k } }), 0);
  }
  if (g === "ven") {
    const v = await escolherVenda(TERMOS_VEN.find(x => x.k === k).t + " · qual venda?"); if (!v) return;
    const its = await q(sb.from("venda_itens").select("*")).catch(() => []); VIT = {}; its.forEach(i => (VIT[i.venda_id] = VIT[i.venda_id] || []).push(i));
    setTimeout(() => ACT["ven-termo"]({ dataset: { id: v.id, tipo: k } }), 0);
  }
};
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
