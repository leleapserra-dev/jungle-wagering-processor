import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envSchema } from './env';
import { AppConfig } from './app-config';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config: unknown) => {
        const parsed = envSchema.safeParse(config);
        if (!parsed.success) {
          const issues = parsed.error.issues
            .map((issue: { path: (string | number)[]; message: string }) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ');
          throw new Error(`Invalid environment configuration: ${issues}`);
        }
        return parsed.data;
      }
    })
  ],
  providers: [AppConfig],
  exports: [AppConfig]
})
export class ConfigModuleWrapper {}
