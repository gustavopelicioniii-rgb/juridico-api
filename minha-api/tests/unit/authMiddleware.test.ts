import Advogado from '../../src/models/Advogado';
import { ensureActiveAuthSubject } from '../../src/middleware/auth';

jest.mock('../../src/config/redis', () => ({
  __esModule: true,
  cache: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

jest.mock('../../src/models/Advogado', () => ({
  __esModule: true,
  default: {
    findByPk: jest.fn(),
  },
}));

describe('auth middleware subject validation', () => {
  const findByPk = Advogado.findByPk as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects inactive backing users', async () => {
    findByPk.mockResolvedValue({ id: 'adv-user', ativo: false });

    await expect(ensureActiveAuthSubject({
      userId: 'adv-user',
      advogadoId: 'adv-user',
      role: 'USER',
    })).rejects.toThrow('AUTH_SUBJECT_INACTIVE');
  });

  it('allows system tokens without an advogado lookup', async () => {
    await expect(ensureActiveAuthSubject({
      userId: 'system',
      role: 'SYSTEM',
    })).resolves.toBeUndefined();

    expect(findByPk).not.toHaveBeenCalled();
  });
});
