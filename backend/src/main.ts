import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionI18nFilter } from './common/i18n/http-exception-i18n.filter';

// ErranceVoyages_Tourism_2026 — backend entrypoint.
// Modeled off hala-audit/backend/src/index.ts for wiring shape (CORS,
// health check, port binding) — implementation is NestJS-native, not reused.
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  // This backend only ever serves JSON (and a couple of redirects, e.g. the WhatsApp chat-link
  // route) -- no HTML pages of its own -- so a CSP tuned for script/style sources isn't
  // meaningful here and risks breaking the webhook/redirect routes for no real benefit. Keep the
  // headers that matter for an API (HSTS, X-Content-Type-Options, frame protections, Referrer-
  // Policy) and skip CSP.
  app.use(helmet({ contentSecurityPolicy: false }));
  // Express's default JSON body limit (~100kb) is smaller than a base64-encoded PDF-page
  // thumbnail, so saving a package's itinerary preview image threw "request entity too large".
  // These parsers run before Nest's own (rawBody: true above), so they must keep the exact raw
  // bytes themselves: Meta's webhook signatures (WhatsApp + lead ads) are an HMAC of the raw body.
  // Without `verify` here req.rawBody was undefined and EVERY Meta webhook was rejected as
  // unsigned from 30 Sept 2026 -- no customer replies, button taps or delivery receipts arrived.
  const keepRaw = (req: any, _res: any, buf: Buffer) => { req.rawBody = buf; };
  app.use(json({ limit: '15mb', verify: keepRaw }));
  app.use(urlencoded({ limit: '15mb', extended: true, verify: keepRaw }));

  // `origin: true` with `credentials: true` reflects whatever Origin header the browser sent and
  // still allows cookies/auth to go along with it -- if ALLOWED_ORIGIN were ever unset in
  // production, this would accept credentialed cross-site requests from literally any website.
  // Fail closed in production (refuse to start rather than silently allow every origin); local
  // dev alone gets a convenience fallback since it never carries real customer data.
  const allowedOrigins = process.env.ALLOWED_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean);
  if (!allowedOrigins?.length) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Missing required environment variable: ALLOWED_ORIGIN -- refusing to start in production without an explicit CORS allowlist.');
    }
    // eslint-disable-next-line no-console
    console.warn('ALLOWED_ORIGIN not set -- falling back to http://localhost:3000 for local development only.');
  }
  app.enableCors({
    origin: allowedOrigins?.length ? allowedOrigins : ['http://localhost:3000'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );
  // Errances serves French-speaking customers (Paris, La Courneuve) alongside English ones;
  // translates HttpException bodies when the client sends Accept-Language: fr.
  app.useGlobalFilters(new HttpExceptionI18nFilter());

  app.setGlobalPrefix('api');

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`ErranceVoyages_Tourism_2026 backend listening on port ${port}`);
}
bootstrap();
