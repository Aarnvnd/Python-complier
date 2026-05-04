export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // API to save code snippet
    if (url.pathname === '/api/share' && request.method === 'POST') {
      try {
        const code = await request.text();
        if (!code || code.length > 500000) { // basic limit
          return new Response(JSON.stringify({ error: "Code too long or empty" }), { status: 400 });
        }

        // Generate random 6-character ID
        const id = Math.random().toString(36).substring(2, 8);

        if (!env.CODE_STORE) {
          return new Response(JSON.stringify({ error: "KV Namespace CODE_STORE not bound." }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // Save for 30 days
        await env.CODE_STORE.put(id, code, { expirationTtl: 60 * 60 * 24 * 30 });

        return new Response(JSON.stringify({ id }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.toString() }), { status: 500 });
      }
    }

    // API to load code snippet
    if (url.pathname.startsWith('/api/code/') && request.method === 'GET') {
      const id = url.pathname.split('/').pop();
      if (!env.CODE_STORE) {
        return new Response(JSON.stringify({ error: "KV Namespace CODE_STORE not bound." }), { status: 500 });
      }

      const code = await env.CODE_STORE.get(id);
      if (code) {
        return new Response(JSON.stringify({ code }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        return new Response(JSON.stringify({ error: "Code not found" }), { status: 404 });
      }
    }

    // Pass everything else to static assets
    // Cloudflare handles this automatically if [site] or [assets] is configured and env.ASSETS is used
    try {
      if (env.ASSETS) {
        return await env.ASSETS.fetch(request);
      }
      return new Response("Not found", { status: 404 });
    } catch (e) {
      return new Response("Asset not found", { status: 404 });
    }
  }
};
