// FICA ImobOne · service worker (v32)
// Serve SÓ para receber arquivos pelo "Compartilhar" do celular Android (ex.: comprovante do app do banco).
// Não guarda as páginas do sistema em cache: o sistema sempre abre a versão mais nova do GitHub.
// O arquivo fica guardado só neste aparelho até ser ligado a um pagamento (aí vai para o Google Drive).
const CACHE = "imob-compartilhado";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin || !u.pathname.endsWith("/compartilhar")) return; // todo o resto: normal, sem cache
  const volta = new URL("./?compartilhado=1#comprovantes", self.registration.scope).href;
  if (e.request.method !== "POST") { e.respondWith(Response.redirect(volta, 303)); return; }
  e.respondWith((async () => {
    try {
      const fd = await e.request.formData(), t = Date.now();
      const arqs = fd.getAll("arquivo").filter(f => f && typeof f !== "string" && f.size);
      const c = await caches.open(CACHE);
      for (let i = 0; i < arqs.length; i++) {
        const f = arqs[i];
        await c.put(new Request(new URL(`./compartilhado/${t}-${i}`, self.registration.scope).href), new Response(f, { headers: {
          "Content-Type": f.type || "application/octet-stream", "X-Nome": encodeURIComponent(f.name || "comprovante"), "X-Quando": String(t + i) } }));
      }
    } catch (err) { /* abre o sistema do mesmo jeito */ }
    return Response.redirect(volta, 303);
  })());
});
