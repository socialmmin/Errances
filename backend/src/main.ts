import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionI18nFilter } from './common/i18n/http-exception-i18n.filter';

// ErranceVoyages_Tourism_2026 — backend entrypoint.
// Modeled off hala-audit/backend/src/index.ts for wiring shape (CORS,
// health check, port binding) — implementation is NestJS-native, not reused.
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.enableCors({
    origin: process.env.ALLOWED_ORIGIN?.split(',') ?? true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // French error messages when the client sends Accept-Language: fr.
  app.useGlobalFilters(new HttpExceptionI18nFilter());

  app.setGlobalPrefix('api');

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`ErranceVoyages_Tourism_2026 backend listening on port ${port}`);
}
bootstrap();
