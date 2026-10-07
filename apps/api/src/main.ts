import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { configureApp } from './app.factory';
import { AppModule } from './app.module';
import { AppConfig } from './core/config/app-config.service';
import { InvalidConfigError } from './core/config/env.schema';

async function bootstrap(): Promise<void> {
  const app = configureApp(await NestFactory.create(AppModule.forRoot(), { bufferLogs: true }));
  const config = app.get(AppConfig);
  await app.listen(config.get('PORT'), '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  // Configuration problems are reported by variable name only (no values).
  console.error(error instanceof InvalidConfigError ? error.message : error);
  process.exit(1);
});
