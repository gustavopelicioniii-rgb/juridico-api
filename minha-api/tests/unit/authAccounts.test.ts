import {
  isReservedAdminCredential,
  resolveAccountRole,
} from '../../src/utils/authAccounts';

describe('auth account helpers', () => {
  const originalAdminOab = process.env.ADMIN_OAB;
  const originalAdminEmail = process.env.ADMIN_EMAIL;

  beforeEach(() => {
    process.env.ADMIN_OAB = 'SP12345';
    process.env.ADMIN_EMAIL = 'admin@example.com';
  });

  afterAll(() => {
    process.env.ADMIN_OAB = originalAdminOab;
    process.env.ADMIN_EMAIL = originalAdminEmail;
  });

  it('deriva ADMIN apenas pelo OAB configurado', () => {
    expect(resolveAccountRole({ oab: 'SP12345', email: 'user@example.com' })).toBe('ADMIN');
    expect(resolveAccountRole({ oab: 'SP99999', email: 'admin@example.com' })).toBe('USER');
  });

  it('reserva OAB e email administrativos contra cadastro público', () => {
    expect(isReservedAdminCredential({ oab: 'SP12345', email: 'user@example.com' })).toBe(true);
    expect(isReservedAdminCredential({ oab: 'SP99999', email: 'admin@example.com' })).toBe(true);
    expect(isReservedAdminCredential({ oab: 'SP99999', email: 'user@example.com' })).toBe(false);
  });
});
