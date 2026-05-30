# Tribunais com login, certificado ou captcha

Este documento define o que fazer quando a API não consegue puxar processos diretamente pela consulta pública.

## Status retornados pela API

### `requires-auth`

Significa que o tribunal exige:

- login e senha;
- certificado digital;
- convênio;
- ou sessão autenticada.

### `captcha`

Significa que o portal público exige resolução manual ou fluxo autorizado de captcha.

### `blocked` / `source_unavailable`

Significa que a fonte pública está bloqueando automação ou indisponível.

## O que precisa existir para puxar os processos

Você precisa de pelo menos uma destas estratégias:

1. **credencial do advogado/cliente**
   - login/senha;
   - certificado A1 ou A3;
   - sessão autenticada com consentimento.

2. **fonte oficial/parceiro**
   - API oficial;
   - MNI;
   - convênio;
   - parceiro comercial com cobertura daquele tribunal.

3. **operação assistida**
   - um operador humano acessa o portal;
   - resolve captcha/login;
   - libera a coleta;
   - a API continua o fluxo após a autenticação.

## Fluxo operacional recomendado

### Caso `requires-auth`

1. identificar qual tribunal retornou a restrição;
2. obter consentimento do advogado/cliente;
3. definir o método de autenticação:
   - senha;
   - certificado;
   - sessão autorizada;
4. armazenar/usar a credencial de forma segura;
5. repetir a coleta;
6. registrar auditoria de quem autorizou e quando.

### Caso `captcha`

1. abrir o portal oficial;
2. resolver o captcha manualmente ou por fluxo autorizado;
3. manter a sessão válida;
4. repetir a coleta imediatamente;
5. se o captcha for recorrente, tratar como cobertura parcial ou operação assistida.

### Caso `blocked` / `source_unavailable`

1. tentar outra fonte oficial;
2. tentar busca por número CNJ;
3. usar DataJud quando cobrir o tribunal/caso;
4. se não houver alternativa, marcar o tribunal como cobertura restrita.

## Regras de produto

### Pode prometer

- cobertura ampla com DataJud;
- cobertura parcial por tribunal;
- tratamento explícito de restrições por status.

### Não pode prometer

- cobertura total por scraping público;
- bypass estável de captcha;
- uso de credenciais sem consentimento;
- coleta em tribunal protegido sem operação definida.

## Exemplo prático

Se `TJMG` responder `requires-auth`, isso não significa bug da API.

Significa que:

- a API conseguiu classificar corretamente a restrição;
- a consulta pública daquele caminho exige autenticação adicional;
- o próximo passo é credencial/sessão autorizada ou outro canal oficial.
