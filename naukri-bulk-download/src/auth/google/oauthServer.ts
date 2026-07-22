import http from 'node:http';
import { URL } from 'node:url';

export async function waitForOAuthCallback(
  redirectUri: string,
  timeoutMs = 300_000,
): Promise<string> {
  const expected = new URL(redirectUri);
  const port = Number(expected.port) || 3000;
  const pathname = expected.pathname;

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

      if (reqUrl.pathname !== pathname) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = reqUrl.searchParams.get('code');
      const error = reqUrl.searchParams.get('error');

      if (error) {
        res.writeHead(400);
        res.end(`OAuth error: ${error}`);
        server.close();
        reject(new Error(`Google OAuth error: ${error}`));
        return;
      }

      if (!code) {
        res.writeHead(400);
        res.end('Missing authorization code');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<html><body><h2>Google authorization complete.</h2><p>You can close this window.</p></body></html>',
      );
      server.close();
      resolve(code);
    });

    server.listen(port, '127.0.0.1', () => {
      // ready
    });

    server.on('error', reject);
    setTimeout(() => {
      server.close();
      reject(new Error(`OAuth callback timeout (${timeoutMs}ms)`));
    }, timeoutMs);
  });
}
