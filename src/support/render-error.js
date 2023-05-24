import htmlSafe from "oidc-provider/lib/helpers/html_safe.js";

const renderError = (ctx, out, error) => {
    console.error(error)
    ctx.type = 'html';
    ctx.body = `<!DOCTYPE html>
    <head>
      <meta http-equiv="X-UA-Compatible" content="IE=edge">
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
      <link rel="stylesheet" href="/style.css">
    </head>
    <body>
      <div class="card card-wide">
        <h2>Error encountered</h2>
        <div class="errors">
            ${Object.entries(out).map(([key, value]) => `<pre><strong>${key}</strong>: ${htmlSafe(value)}</pre>`).join('')}
        </div>
        <br />
        <p>Please try again or contact support.</p>
      </div>
    </body>
    </html>`;
}

export default renderError
