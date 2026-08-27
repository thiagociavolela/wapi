# Central de atendimento — WhatsApp Cloud API

Projeto independente em Node.js, TypeScript, HTML, CSS e JavaScript para atendimento usando exclusivamente a API oficial da Meta. Não utiliza WhatsApp Web, QR Code, Baileys ou bibliotecas de conexão não oficial.

## O que esta base já entrega

- Webhook de verificação da Meta (`GET /webhooks/meta`).
- Validação HMAC `X-Hub-Signature-256` nos eventos recebidos.
- Persistência idempotente de mensagens e status.
- Envio de texto pela Graph API.
- Controle da janela de atendimento de 24 horas.
- Login individual com senha Argon2id e cookie seguro.
- Organização, usuários, contatos, conversas, mensagens, notas e auditoria no schema.
- Caixa de entrada responsiva em HTML/CSS/JavaScript puro.
- Atribuição, estados de conversa, não lidas e atualização ao vivo por SSE.
- Docker Compose para MySQL local.

## Requisitos

- Node.js 20 ou superior.
- MySQL 8 (ou Docker).
- App Meta com WhatsApp, número e webhook configurados.
- Token permanente de usuário do sistema com as permissões necessárias.

## Executar localmente

```bash
cp .env.example .env
docker compose up -d
npm install
npm run dev
```

No PowerShell, use `Copy-Item .env.example .env` no lugar de `cp`.

O servidor aplica a migration e cria o primeiro administrador usando `ADMIN_EMAIL` e `ADMIN_PASSWORD`. Depois acesse `http://localhost:3000`.

## Configurar a Meta

Preencha no `.env`:

```env
META_GRAPH_VERSION=v23.0
META_PHONE_NUMBER_ID=seu_phone_number_id
META_WABA_ID=seu_waba_id
META_ACCESS_TOKEN=seu_token_permanente
META_APP_SECRET=app_secret_do_aplicativo
META_WEBHOOK_VERIFY_TOKEN=um_segredo_escolhido_por_voce
```

No painel da Meta, configure uma URL HTTPS pública:

```text
https://seu-dominio.com/webhooks/meta
```

Use como token de verificação o mesmo valor de `META_WEBHOOK_VERIFY_TOKEN` e assine o campo `messages` da conta do WhatsApp Business.

Não coloque tokens no frontend e não versiona o arquivo `.env`.

## Comandos

```bash
npm run dev
npm run build
npm test
npm run db:migrate
npm start
```

## Próximos módulos

Esta é a fundação e o primeiro fluxo utilizável. A evolução prevista inclui upload/download seguro de mídias, seletor e sincronização de templates, respostas rápidas, equipes e filas, notas/etiquetas no painel, SLA, storage S3/R2, Redis/BullMQ, automações, relatórios e IA assistiva.

Para múltiplas instâncias do Node, substitua o emissor SSE em memória por Redis Pub/Sub e processe webhooks em uma fila durável antes de responder à Meta.
