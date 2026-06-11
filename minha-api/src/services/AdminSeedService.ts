import bcrypt from 'bcryptjs';
import Advogado from '../models/Advogado';

export interface EnsureAdminSeedParams {
  oab?: string;
  password?: string;
  nome?: string;
  email?: string;
}

export interface EnsureAdminSeedResult {
  skipped: boolean;
  created?: boolean;
  advogado?: {
    id: string;
    oab: string;
    nome: string;
    email?: string;
  };
}

export async function ensureAdminSeed(params: EnsureAdminSeedParams): Promise<EnsureAdminSeedResult> {
  const oab = params.oab?.trim();
  const password = params.password;

  if (!oab || !password) {
    return { skipped: true };
  }

  const nome = params.nome?.trim() || 'Administrador';
  const email = params.email?.trim() || undefined;

  const existing = await Advogado.findOne({ where: { oab } });
  if (existing) {
    return {
      skipped: false,
      created: false,
      advogado: {
        id: existing.id,
        oab: existing.oab,
        nome: nome,
        email,
      },
    };
  }

  const senhaHash = await bcrypt.hash(password, 12);
  const advogado = await Advogado.create({
    oab,
    nome,
    email,
    ativo: true,
    passwordHash: senhaHash,
  });

  return {
    skipped: false,
    created: true,
    advogado: {
      id: advogado.id,
      oab: advogado.oab,
      nome: advogado.nome,
      email: advogado.email,
    },
  };
}
