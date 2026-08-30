# API transacional do site

Esta API recebe solicitações do backend do site, registra a mensagem no histórico da central e envia um template aprovado imediatamente ou na data programada.

## Autenticação

Gere uma chave com pelo menos 32 bytes e configure o mesmo valor somente no backend do site e no `.env` da central:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```env
INTEGRATION_API_KEY=cole_a_chave_gerada
```

Nunca exponha essa chave no HTML ou JavaScript público do site.

## Criar mensagem

```http
POST /api/integrations/messages
Authorization: Bearer {INTEGRATION_API_KEY}
Idempotency-Key: pedido-recebido-12345
Content-Type: application/json
```

Envio imediato:

```json
{
  "to": "5511999999999",
  "contactName": "João",
  "template": "pedido_recebido",
  "language": "pt_BR",
  "parameters": ["João", "nº 12345"],
  "externalId": "12345",
  "metadata": {
    "source": "site",
    "event": "order.created",
    "orderId": "12345"
  }
}
```

Para agendar, acrescente `sendAt` em ISO 8601 com o fuso:

```json
{
  "to": "5511999999999",
  "template": "pedido_confirmado",
  "language": "pt_BR",
  "parameters": ["João", "compra", "nº 12345", "2 frascos de Pró Lipo Green", "5 de setembro de 2026"],
  "sendAt": "2026-09-01T09:30:00-03:00",
  "externalId": "12345-confirmado",
  "metadata": { "source": "site", "orderId": "12345" }
}
```

Resposta `202 Accepted`:

```json
{
  "id": "id-do-job",
  "status": "scheduled",
  "messageId": "id-da-mensagem",
  "conversationId": "id-da-conversa",
  "scheduledFor": "2026-09-01T12:30:00.000Z",
  "duplicate": false
}
```

O template precisa estar aprovado na WABA e a quantidade de `parameters` deve corresponder às variáveis do corpo. O gateway consulta e mantém em cache a lista de templates aprovados.

## Idempotência

O `Idempotency-Key` é obrigatório e deve representar unicamente o evento comercial. Repetir a mesma requisição com a mesma chave não envia outra mensagem: a API devolve o registro existente com `duplicate: true`.

Sugestões:

```text
pedido-recebido:{orderId}
pedido-confirmado:{orderId}
pedido-despachado:{orderId}
```

## Consultar estado

```http
GET /api/integrations/messages/{id}
Authorization: Bearer {INTEGRATION_API_KEY}
```

O retorno inclui o estado do job, `wamid`, tentativas e os horários de envio, entrega e leitura.

## Cancelar agendamento

```http
DELETE /api/integrations/messages/{id}
Authorization: Bearer {INTEGRATION_API_KEY}
```

Somente jobs ainda pendentes podem ser cancelados.

## Exemplo Node.js no site

```js
export async function notificarPedidoRecebido(pedido) {
  const response = await fetch(`${process.env.CHAT_API_URL}/api/integrations/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CHAT_INTEGRATION_KEY}`,
      "Idempotency-Key": `pedido-recebido-${pedido.id}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      to: pedido.telefone,
      contactName: pedido.cliente,
      template: "pedido_recebido",
      language: "pt_BR",
      parameters: [pedido.cliente, `nº ${pedido.id}`],
      externalId: String(pedido.id),
      metadata: { source: "site", event: "order.created", orderId: pedido.id }
    })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Falha ao solicitar mensagem");
  return result;
}
```

O worker tenta o envio até três vezes. Uma falha temporária é reagendada; depois da terceira falha, o job e a mensagem ficam como `failed` no histórico.
