export type AuthenticatedPrincipal = {
  issuer: string;
  subject: string;
  email: string;
  username?: string;
};
