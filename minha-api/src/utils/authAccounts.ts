import type { AuthPayload } from '../middleware/auth';

type AccountIdentity = {
  oab?: string | null;
  email?: string | null;
};

const normalizeOab = (value?: string | null): string | undefined => {
  const normalized = value?.trim().toUpperCase();
  return normalized || undefined;
};

const normalizeEmail = (value?: string | null): string | undefined => {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
};

export const normalizeAuthOab = normalizeOab;
export const normalizeAuthEmail = normalizeEmail;

export function isConfiguredAdminOab(oab?: string | null): boolean {
  const adminOab = normalizeOab(process.env.ADMIN_OAB);
  const currentOab = normalizeOab(oab);
  return !!adminOab && !!currentOab && adminOab === currentOab;
}

export function isReservedAdminCredential(identity: AccountIdentity): boolean {
  const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
  const currentEmail = normalizeEmail(identity.email);

  return isConfiguredAdminOab(identity.oab) || (!!adminEmail && !!currentEmail && adminEmail === currentEmail);
}

export function resolveAccountRole(identity: AccountIdentity): AuthPayload['role'] {
  return isConfiguredAdminOab(identity.oab) ? 'ADMIN' : 'USER';
}
