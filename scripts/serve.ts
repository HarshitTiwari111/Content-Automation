/**
 * Chhota local server — sirf isliye ki script ka ek browser URL ho.
 *
 *   npm run serve     →  http://localhost:3000
 *
 * Kuch naya logic nahi hai. Yeh wahi commands chalata hai jo terminal me
 * chalti hain, aur unka output browser me dikha deta hai.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setDefaultResultOrder } from 'node:dns';

setDefaultResultOrder('ipv4first');

const PORT = Number(process.env.PORT ?? 3000);

/** Terminal wali command chalata hai aur poora output wapas karta hai. */
function runCommand(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', ...args], {
      cwd: process.cwd(),
      shell: true,
    });

    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('close', (code) => {
      resolve(`${output}\n[exit code: ${code}]`);
    });
    child.on('error', (error) => {
      resolve(`Command chal nahi payi: ${error.message}`);
    });
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const HOME = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Phase 5 — Search Campaign Automation</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto;
           padding: 0 16px; line-height: 1.6; }
    a.btn { display: inline-block; padding: 10px 16px; margin: 6px 8px 6px 0;
            border: 1px solid #ccc; border-radius: 6px; text-decoration: none; color: inherit; }
    a.btn:hover { background: #f2f2f2; }
    code { background: #f2f2f2; padding: 2px 5px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Phase 5 — Search Campaign Automation</h1>
  <p>Server chal raha hai. Neeche wale link wahi kaam karte hain jo terminal commands karti hain.</p>

  <p>
    <a class="btn" href="/dry">Dry run (kuch create nahi hoga)</a>
    <a class="btn" href="/check">Google Ads connection check</a>
    <a class="btn" href="/preview">Keywords + ad copy preview</a>
  </p>

  <p>Chalne me 20–40 second lag sakte hain — page tab tak khaali dikhega.</p>
  <hr>
  <p><small>Live campaign yahan se nahi banti. Uske liye terminal me
  <code>npm run create -- --live</code> chalana padta hai.</small></p>
</body>
</html>`;

const server = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0] ?? '/';

  // Dashboard alag URL se call kare to browser block na kare.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HOME);
    return;
  }

  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, port: PORT }));
    return;
  }

  const commands: Record<string, string[]> = {
    '/dry': ['src/run.ts', '--dry'],
    '/check': ['scripts/check-ads.ts'],
    '/preview': ['scripts/preview.ts'],
  };

  const args = commands[url];
  if (!args) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found. Kholo: http://localhost:' + PORT + '/');
    return;
  }

  void runCommand(args).then((output) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>Output</title>` +
        `<body style="font-family:system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 16px">` +
        `<p><a href="/">&larr; wapas</a></p>` +
        `<pre style="background:#f6f6f6;padding:16px;border-radius:8px;overflow:auto;white-space:pre-wrap">` +
        escapeHtml(output) +
        `</pre></body>`,
    );
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  Server chal raha hai 👉  http://localhost:' + PORT);
  console.log('');
  console.log('  Band karne ke liye: Ctrl + C');
  console.log('');
});
