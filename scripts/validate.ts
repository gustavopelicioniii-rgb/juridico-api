#!/usr/bin/env node
/**
 * Script de Validação Local
 *
 * Executa validações antes do commit:
 * - TypeScript check
 * - ESLint
 * - Tests (opcional, configurável)
 *
 * Uso:
 *   node scripts/validate.js
 *   node scripts/validate.js --skip-tests
 *   node scripts/validate.js --staged
 */

const { execSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const skipTests = args.includes('--skip-tests');
const skipLint = args.includes('--skip-lint');
const skipTypecheck = args.includes('--skip-typecheck');
const stagedOnly = args.includes('--staged');
const verbose = args.includes('--verbose');

const ROOT_DIR = path.resolve(__dirname, '..');
const MINHA_API_DIR = path.join(ROOT_DIR, 'minha-api');
const DASHBOARD_DIR = path.join(ROOT_DIR, 'dashboard');

function log(message, type = 'info') {
  const colors = {
    info: '\x1b[36m',
    success: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    reset: '\x1b[0m',
  };
  console.log(`${colors[type] || ''}${message}${colors.reset}`);
}

function run(command, cwd = ROOT_DIR, options = {}) {
  try {
    if (verbose) {
      log(`Running: ${command}`, 'info');
    }
    execSync(command, {
      cwd,
      stdio: verbose ? 'inherit' : 'pipe',
      encoding: 'utf-8',
      ...options,
    });
    return true;
  } catch (error) {
    if (!options.silent) {
      log(`Error running: ${command}`, 'error');
      if (error.stdout) console.log(error.stdout);
      if (error.stderr) console.log(error.stderr);
    }
    return false;
  }
}

function getStagedFiles() {
  try {
    const output = execSync('git diff --cached --name-only', { encoding: 'utf-8' });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

async function main() {
  log('═══════════════════════════════════════════════════════');
  log('          VALIDACAO PRÉ-COMMIT');
  log('═══════════════════════════════════════════════════════\n');

  const startTime = Date.now();
  let hasErrors = false;

  // Get staged files if needed
  let stagedFiles = [];
  if (stagedOnly) {
    stagedFiles = getStagedFiles();
    log(`Arquivos staged: ${stagedFiles.length}`);
    log(stagedFiles.join(', ') + '\n');
  }

  // 1. TypeScript check
  if (!skipTypecheck) {
    log('1. Verificando TypeScript...', 'info');

    const tsSuccess = run('npx tsc --noEmit', MINHA_API_DIR);
    if (!tsSuccess) {
      log('   TypeScript falhou no backend', 'error');
      hasErrors = true;
    } else {
      log('   TypeScript OK (backend)', 'success');
    }

    const tsFrontendSuccess = run('npx tsc --noEmit', DASHBOARD_DIR);
    if (!tsFrontendSuccess) {
      log('   TypeScript falhou no frontend', 'error');
      hasErrors = true;
    } else {
      log('   TypeScript OK (frontend)', 'success');
    }
  }

  // 2. ESLint
  if (!skipLint) {
    log('\n2. Executando ESLint...', 'info');

    const lintSuccess = run('npx eslint src --ext .ts,.tsx', MINHA_API_DIR);
    if (!lintSuccess) {
      log('   ESLint falhou no backend', 'error');
      hasErrors = true;
    } else {
      log('   ESLint OK (backend)', 'success');
    }

    const lintFrontendSuccess = run('npx eslint src --ext .ts,.tsx', DASHBOARD_DIR);
    if (!lintFrontendSuccess) {
      log('   ESLint falhou no frontend', 'error');
      hasErrors = true;
    } else {
      log('   ESLint OK (frontend)', 'success');
    }
  }

  // 3. Tests (optional)
  if (!skipTests) {
    log('\n3. Executando Tests...', 'info');

    // Run only relevant tests based on staged files
    let testCommand = 'npm test';
    if (stagedOnly && stagedFiles.length > 0) {
      // Find which packages have staged changes
      const backendFiles = stagedFiles.filter(f => f.startsWith('minha-api/'));
      const frontendFiles = stagedFiles.filter(f => f.startsWith('dashboard/'));

      if (backendFiles.length > 0) {
        const testSuccess = run('npm test', MINHA_API_DIR);
        if (!testSuccess) {
          log('   Tests falharam no backend', 'error');
          hasErrors = true;
        } else {
          log('   Tests OK (backend)', 'success');
        }
      }
    } else {
      const testSuccess = run('npm test', MINHA_API_DIR);
      if (!testSuccess) {
        log('   Tests falharam', 'error');
        hasErrors = true;
      } else {
        log('   Tests OK', 'success');
      }
    }
  }

  // Summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  log('\n═══════════════════════════════════════════════════════');
  log(`          RESULTADO: ${hasErrors ? 'FALHOU ❌' : 'SUCESSO ✅'}`, hasErrors ? 'error' : 'success');
  log(`          Tempo: ${duration}s`);
  log('═══════════════════════════════════════════════════════');

  if (hasErrors) {
    log('\nCorrija os erros acima antes de fazer commit.', 'warn');
    process.exit(1);
  } else {
    log('\nTodas as validacoes passaram!', 'success');
    process.exit(0);
  }
}

main().catch(error => {
  log(`Erro fatal: ${error.message}`, 'error');
  process.exit(1);
});
