/**
 * Extension point for an external Identity Provider (OIDC).
 * Not implemented in this challenge (see ARCHITECTURE.md § Auth).
 * Wire Keycloak/Zitadel by providing a real IdentityPort + AuthGuard.
 */
export interface IdentityPrincipal {
  subject: string;
  providerId?: string;
  roles: string[];
}

export abstract class IdentityPort {
  abstract verifyAccessToken(token: string): Promise<IdentityPrincipal>;
}

export class NoopIdentityPort extends IdentityPort {
  override async verifyAccessToken(_token: string): Promise<IdentityPrincipal> {
    return { subject: 'anonymous', roles: ['provider'] };
  }
}
