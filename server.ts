import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express, { Express, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import {
  SERVER_FIRESTORE_DATABASE_ID,
  SERVER_PROJECT_ID,
} from './server/config/firebaseAdmin';
import {
  createEmployeeRouter,
  CreateEmployeeRouterOptions,
} from './server/routes/employeeRoutes';
import {
  createSystemInitRouter,
  SystemConfigStoreAdapter,
} from './server/routes/systemInitRoutes';

dotenv.config();

const SHOWCASE_PDF_FILENAME = 'Montex_Forge_MIS_Product_Showcase_and_Roadmap.pdf';

function resolveShowcasePdfPath(): string | null {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(__dirname, 'public', SHOWCASE_PDF_FILENAME),
    path.join(__dirname, 'dist', SHOWCASE_PDF_FILENAME),
    path.join(__dirname, SHOWCASE_PDF_FILENAME),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function sendShowcasePdf(req: Request, res: Response): void {
  const pdfPath = resolveShowcasePdfPath();
  if (!pdfPath) {
    res.status(404).json({
      success: false,
      code: 'PDF_NOT_FOUND',
      error: `${SHOWCASE_PDF_FILENAME} was not found on the server.`,
    });
    return;
  }

  const stat = fs.statSync(pdfPath);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${SHOWCASE_PDF_FILENAME}"`
  );
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Cache-Control', 'no-cache');

  if (req.method === 'HEAD') {
    res.status(200).end();
    return;
  }

  const stream = fs.createReadStream(pdfPath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.status(500).end();
    }
  });
  stream.pipe(res);
}

export interface CreateExpressAppOptions extends CreateEmployeeRouterOptions {
  systemConfigAdapter?: SystemConfigStoreAdapter;
}

/**
 * Creates the Express application with security headers, CORS validation,
 * 16kb JSON body size limits, `/api/admin/employees`, and `/api/admin/system`.
 */
export function createExpressApp(options: CreateExpressAppOptions = {}): Express {
  const app = express();

  app.disable('x-powered-by');

  // Explicit download endpoints for the 22-page Product Showcase & Roadmap PDF
  app.get(`/${SHOWCASE_PDF_FILENAME}`, sendShowcasePdf);
  app.get('/api/showcase-pdf', sendShowcasePdf);

  // One log line per API call (start and finish with time taken), so a slow or stuck
  // request is visible in the hosting logs. Never logs bodies or tokens.
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'OPTIONS' || req.path === '/health') return next();
    const started = Date.now();
    console.log(`[api] -> ${req.method} ${req.originalUrl}`);
    res.on('finish', () => console.log(`[api] <- ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`));
    res.on('close', () => {
      if (!res.writableFinished) console.log(`[api] xx ${req.method} ${req.originalUrl} closed by the browser after ${Date.now() - started}ms`);
    });
    next();
  });

  // Strict CORS & Security Headers for /api/* routes
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    const allowedOriginsEnv = (process.env.ALLOWED_CORS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (origin) {
      let isLocal = false;
      try {
        const { hostname } = new URL(origin);
        isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
      } catch {
        isLocal = false;
      }
      const isAllowed =
        allowedOriginsEnv.includes(origin) ||
        (isLocal && process.env.NODE_ENV !== 'production');

      if (!isAllowed) {
        res.status(403).json({
          success: false,
          code: 'CORS_ORIGIN_DENIED',
          error: 'Origin is not permitted to access the Montex MIS Admin API.',
        });
        return;
      }

      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }

    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PATCH, OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type'
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  });

  // Enforce strict 16kb JSON payload limit to prevent abuse
  app.use('/api', express.json({ limit: '16kb' }));

  // Handle malformed JSON or oversized payloads cleanly without leaking stack traces
  app.use(
    '/api',
    (err: any, _req: Request, res: Response, next: NextFunction): void => {
      if (err?.type === 'entity.too.large') {
        res.status(413).json({
          success: false,
          code: 'PAYLOAD_TOO_LARGE',
          error: 'Request payload exceeds the 16kb maximum size limit.',
        });
        return;
      }
      if (err instanceof SyntaxError && 'status' in err) {
        res.status(400).json({
          success: false,
          code: 'MALFORMED_JSON',
          error: 'Request body contains malformed JSON.',
        });
        return;
      }
      next(err);
    }
  );

  // Non-sensitive health endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      service: 'montex-mis-admin-api',
      projectId: SERVER_PROJECT_ID,
      firestoreDatabaseId: SERVER_FIRESTORE_DATABASE_ID,
      timestamp: new Date().toISOString(),
    });
  });

  // Trusted Admin Employee Management Routes
  app.use('/api/admin/employees', createEmployeeRouter(options));

  // Trusted Admin Clean-Production System Initialization Routes
  app.use('/api/admin/system', createSystemInitRouter(options));

  // Catch-all for unknown /api/* endpoints
  app.use('/api/*', (_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      code: 'API_ROUTE_NOT_FOUND',
      error: 'The requested API endpoint does not exist.',
    });
  });

  return app;
}

async function startServer() {
  const app = createExpressApp();
  const port = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  // One HTTP server for the app and Vite's live-reload socket, so no second port can clash.
  const httpServer = http.createServer(app);

  // The port opens a moment before the pages are ready; ask the browser to retry meanwhile.
  let pagesReady = false;
  app.use((req, res, next) => {
    if (pagesReady || req.path.startsWith('/api')) return next();
    res.status(503).set('Retry-After', '1').send('<meta http-equiv="refresh" content="1">Montex MIS is starting…');
  });

  // Claim the port before Vite starts. A second copy of the app would otherwise share
  // Vite's cache with the first and the two would keep reloading the browser.
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(
          `\n[Montex MIS Server] Port ${port} is already in use: the app is probably already running ` +
            `in another terminal. Open http://localhost:${port}, or stop the other copy (Ctrl + C) and try again.\n`
        );
        process.exit(1);
      }
      reject(err);
    });
    httpServer.listen(port, '0.0.0.0', () => resolve());
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const distPath = path.join(__dirname, 'dist');
    // On Render only the admin API runs; the website itself is on Firebase Hosting.
    if (fs.existsSync(path.join(distPath, 'index.html'))) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  pagesReady = true;
  console.log(
    `[Montex MIS Server] Listening on http://localhost:${port} (project=${SERVER_PROJECT_ID})`
  );
}

// Only start the HTTP listener when server.ts is executed directly
const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  // One failed request must never take the whole app down for everyone.
  process.on('unhandledRejection', (reason) => {
    console.error('[Montex MIS Server] Unhandled error (server kept running):', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[Montex MIS Server] Uncaught error (server kept running):', err);
  });
  startServer().catch((err) => {
    console.error('[Montex MIS Server] Fatal startup error:', err);
    process.exit(1);
  });
}
