// Served as a raw HTML response so these pages skip root.jsx (App Bridge
// script + Polaris), which only makes sense inside the Shopify admin.
export function publicPage(title, bodyHtml) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #1a1a1a; }
  h1 { font-size: 28px; } h2 { font-size: 20px; margin-top: 32px; }
  code { background: #f4f4f4; padding: 1px 5px; border-radius: 3px; font-size: 0.9em; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
