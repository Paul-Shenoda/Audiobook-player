import { defineConfig, loadEnv } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function ttsProxyPlugin() {
  return {
    name: 'tts-proxy',
    configureServer(server) {
      const MAX_TEXT_LENGTH = 4096;
      const ALLOWED_VOICES = new Set([
        'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer',
      ]);

      server.middlewares.use('/api/tts', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        const env = loadEnv(server.config.mode, server.config.root, '');
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }

        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          res.statusCode = 400;
          res.end('Invalid JSON');
          return;
        }

        if (typeof body.text !== 'string' || !body.text.trim()) {
          res.statusCode = 400;
          res.end('Missing or empty text field');
          return;
        }

        if (body.text.length > MAX_TEXT_LENGTH) {
          res.statusCode = 400;
          res.end(`Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`);
          return;
        }

        const voice = body.voice || 'nova';
        if (!ALLOWED_VOICES.has(voice)) {
          res.statusCode = 400;
          res.end(`Invalid voice: ${voice}`);
          return;
        }

        const speed = Number(body.speed ?? 1);
        if (!Number.isFinite(speed) || speed < 0.25 || speed > 4.0) {
          res.statusCode = 400;
          res.end('Speed must be between 0.25 and 4.0');
          return;
        }

        const apiKey =
          req.headers.authorization?.replace(/^Bearer\s+/i, '') ||
          env.OPENAI_API_KEY;

        if (!apiKey) {
          res.statusCode = 401;
          res.end('Missing OpenAI API key');
          return;
        }

        try {
          const response = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'tts-1',
              input: body.text,
              voice,
              speed,
            }),
          });

          if (!response.ok) {
            const detail = await response.text();
            res.statusCode = response.status;
            res.end(detail);
            return;
          }

          const audioBuffer = Buffer.from(await response.arrayBuffer());
          res.setHeader('Content-Type', 'audio/mpeg');
          res.end(audioBuffer);
        } catch (err) {
          res.statusCode = 500;
          res.end(err instanceof Error ? err.message : 'TTS proxy error');
        }
      });
    },
  };
}

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
  },
  resolve: {
    alias: {
      jsmediatags: path.resolve(
        __dirname,
        'node_modules/jsmediatags/dist/jsmediatags.min.js',
      ),
    },
  },
  optimizeDeps: {
    include: ['epubjs', 'jsmediatags', 'idb'],
  },
  plugins: [ttsProxyPlugin()],
});
