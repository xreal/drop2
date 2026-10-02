export async function serveStaticHtml(
  env: { ASSETS: Fetcher },
  assetPath: string,
  unavailableMessage: string,
  headers: HeadersInit = {},
): Promise<Response> {
  const assetUrl = new URL(assetPath, 'https://assets.local/');
  const res = await env.ASSETS.fetch(new Request(assetUrl));
  if (!res.ok) return new Response(unavailableMessage, { status: 503 });
  const html = await res.text();
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });
}
