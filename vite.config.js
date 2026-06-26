import { defineConfig, loadEnv } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function ttsProxyPlugin() {
  return {
    name: 'tts-proxy',
    configureServer(server) {
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
        const body = JSON.parse(Buffer.concat(chunks).toString());

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
              voice: body.voice || 'nova',
              speed: body.speed ?? 1,
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
