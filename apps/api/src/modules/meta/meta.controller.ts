import { Controller, Get } from '@nestjs/common';
import { DEFAULT_TERMINOLOGY } from '@smartcode/shared';
import { AppConfig } from '../../core/config/app-config.service';
import { Public } from '../../core/auth/decorators';

/** Public, non-sensitive information the web app needs before sign-in (`GET /api/v1/meta`). */
@Controller('meta')
@Public()
export class MetaController {
  constructor(private readonly config: AppConfig) {}

  @Get()
  meta() {
    return {
      product: 'SmartCode Enterprise',
      apiVersion: 'v1',
      environment: this.config.appEnv,
      brandAssetBaseUrl: this.config.brandAssetBaseUrl,
      terminology: DEFAULT_TERMINOLOGY,
    };
  }
}
