import htmlSafe from "oidc-provider/lib/helpers/html_safe.js";

const renderError = (ctx, out, error) => {
    ctx.type = 'html';
    ctx.body = `<!DOCTYPE html>
    <head>
      <meta http-equiv="X-UA-Compatible" content="IE=edge">
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
      <link rel="stylesheet" href="/style.css">
    </head>
    <body>
      <div class="login-card">
        <h2>OIDC provider error</h2>
        <pre>${ error }</pre><br>
        <div class="errors">
            ${Object.entries(out).map(([key, value]) => `<pre><strong>${key}</strong>: ${htmlSafe(value)}</pre>`).join('')}
        </div>
      </div>
    </body>
    </html>`;
}

export default renderError
