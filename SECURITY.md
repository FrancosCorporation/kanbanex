# Segurança

## Relatar uma vulnerabilidade

Não publique detalhes de uma falha ainda explorável em uma issue pública. Contate a equipe
responsável pelo repositório com os passos para reproduzir, o impacto observado e uma forma segura
de retorno.

## Controles atuais

- `JWT_SECRET` é obrigatório e tem mínimo de 32 bytes. O valor fixo alternativo existe apenas em
  `NODE_ENV=test`.
- REST e WebSocket validam tokens HS256 e limitam o acesso a quadros do dono autenticado.
- O relay exige token no primeiro `join`, valida o quadro, limita payload/conexões e fecha sessões
  sem autenticação ou inativas.
- Limites de login/cadastro são locais ao processo. Em múltiplas instâncias, use um armazenamento
  compartilhado e configure proxies confiáveis conforme a topologia real.
- O SQLite local, seus arquivos auxiliares, segredos e arquivos `.env` são ignorados pelo Git e
  excluídos da imagem Docker.
- Yjs e convites continuam sem integração de produção. O modelo atual não compartilha quadros entre
  contas diferentes.
