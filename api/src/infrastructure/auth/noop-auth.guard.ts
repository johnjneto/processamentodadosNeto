import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { IdentityPort } from './identity.port';

/**
 * No-op AuthGuard — accepts all requests.
 * Replace with Jwt/OIDC guard when IdentityPort is wired to Keycloak/Zitadel.
 * Health endpoints should remain public (excluded via @Public or route placement).
 */
@Injectable()
export class NoopAuthGuard implements CanActivate {
  constructor(private readonly identity: IdentityPort) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: unknown;
    }>();
    const header = req.headers['authorization'];
    if (header?.startsWith('Bearer ')) {
      const token = header.slice('Bearer '.length);
      req.user = await this.identity.verifyAccessToken(token);
    } else {
      req.user = await this.identity.verifyAccessToken('');
    }
    return true;
  }
}
