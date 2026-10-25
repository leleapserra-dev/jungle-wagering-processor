import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AppConfig) private readonly config: AppConfig) {}

  canActivate(_context: ExecutionContext): boolean {
    if (!this.config.authEnabled) {
      return true;
    }
    return false;
  }
}

export interface ProviderIdentity {
  providerId: string;
}

export abstract class ProviderIdentityPort {
  abstract resolve(context: unknown): ProviderIdentity | null;
}

@Injectable()
export class NoopProviderIdentityPort extends ProviderIdentityPort {
  resolve(_context: unknown): ProviderIdentity | null {
    return null;
  }
}
