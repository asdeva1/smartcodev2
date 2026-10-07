import { type DynamicModule, Global, Module } from '@nestjs/common';
import { AppConfig } from './app-config.service';
import { type Env, parseEnv } from './env.schema';

@Global()
@Module({})
export class ConfigModule {
  /** Validates `source` (defaults to process.env) and exposes it as `AppConfig`. */
  static forRoot(source: NodeJS.ProcessEnv | Env = process.env): DynamicModule {
    const env = parseEnv(source as NodeJS.ProcessEnv);
    return {
      module: ConfigModule,
      providers: [{ provide: AppConfig, useValue: new AppConfig(env) }],
      exports: [AppConfig],
    };
  }
}
