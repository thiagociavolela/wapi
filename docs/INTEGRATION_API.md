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

O template precisa estar aprovado na WABA e no idioma solicitado. O gateway consulta e mantém em cache a lista de templates aprovados. `parameters` fornece as variáveis de texto do cabeçalho e do corpo, na ordem do cadastro; variáveis nomeadas recebem `parameter_name` no payload da Meta.

Para separar os tokens dos botões URL, envie `buttonParameters`, na ordem dos botões dinâmicos:

```json
{
  "to": "5511917080051",
  "contactName": "Teste de integracao",
  "template": "entrega_iniciada_motoboy",
  "language": "pt_BR",
  "parameters": ["Teste de integracao"],
  "buttonParameters": ["TOKEN_PUBLICO"],
  "externalId": "IDENTIFICADOR_UNICO",
  "metadata": {
    "event": "order.delivery_started",
    "source": "site",
    "orderId": "TESTE-WHATSAPP-INICIO"
  }
}
```

As quantidades dos dois arrays são validadas separadamente. `metadata` e `contactName` não substituem os parâmetros do template. Sem `buttonParameters`, permanece compatível o formato legado: um único array `parameters` fornece todas as variáveis, incluindo botões, na ordem dos componentes da Meta.

O job persiste o formato separado como `{ "parameters": [...], "buttonParameters": [...] }` na coluna JSON `parameters`; jobs legados continuam usando arrays. O worker reconstrói o formato separado a partir do job e do cadastro aprovado, sem depender dos metadados. A atualização do endpoint e do worker deve ser implantada em conjunto.

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

HTTP 202 confirma apenas entrada na fila. `status: "sent"` confirma que a Meta aceitou o envio e retornou um `wamid`; a entrega é confirmada por `deliveryStatus: "delivered"` ou `"read"`, recebido pelo webhook. `"failed"` indica falha conclusiva.

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


---

# API de integrações da Central

Na tela `/integrations.html`, use **Documentação API · Swagger**. A documentação também está disponível em `/api-docs`, e o contrato OpenAPI 3.0.3 em `/openapi/integrations.json`, para importação no Postman e geração de clientes.

## Autenticação

Configure `INTEGRATION_API_KEY` no `.env` do servidor e reinicie o processo. Forneça essa chave aos desenvolvedores por um canal privado. Mantenha-a no backend da integração e envie `Authorization: Bearer SUA_CHAVE`. No botão **Authorize** do Swagger, informe somente a chave. A documentação não expõe a credencial nem a salva entre recarregamentos.

## Operações disponíveis

| Método | Caminho | Finalidade |
| --- | --- | --- |
| POST | `/api/integrations/messages` | Registrar um envio imediato ou agendado |
| GET | `/api/integrations/messages/{id}` | Consultar o job e o estado de entrega |
| DELETE | `/api/integrations/messages/{id}` | Cancelar um job pendente |

O POST exige `Idempotency-Key` com 8 a 190 caracteres. Use uma chave por evento e mantenha-a nas tentativas da mesma solicitação. O retorno `202` confirma apenas o registro na fila; `200` indica uma solicitação duplicada. Consulte o `id` do job retornado para acompanhar o envio. `externalId` é uma referência comercial e não substitui a idempotência.

`parameters` preenche as variáveis do cabeçalho textual e do corpo, na ordem. `buttonParameters` preenche as partes variáveis dos botões URL. Quando esse campo é omitido, as variáveis dos botões vão ao final de `parameters`. `contactName` não preenche automaticamente o template. `sendAt` usa ISO 8601 com fuso, com limite de 366 dias à frente.

O Swagger permite requisições reais ao ambiente atual após a autorização. Nada é enviado ao abrir a documentação. Use um número de teste e um template aprovado ao executar POST; DELETE cancela um envio real. Os nomes de modelos e valores dos exemplos são ilustrativos.

## Escopo atual

A API usa a organização padrão e a chave global já existente. Não há endpoint externo para listar templates, receber callbacks de entrega ou enviar imagens, catálogo e carrossel. As rotas internas do painel usam autenticação por sessão e estão fora deste contrato.

## Manutenção

O contrato está em `public/openapi/integrations.json`. Atualize-o ao alterar `src/routes/integrations.ts` ou os campos retornados por `src/modules/integrations/service.ts`. Os testes em `src/routes/integrations-docs.test.ts` verificam autenticação, idempotência, exemplos e códigos de resposta usando serviços simulados, sem acessar o banco nem enviar mensagens.

Os arquivos do Swagger são servidos localmente pelo pacote `swagger-ui-dist`, sem CDN. Configuração de interface: `public/js/integration-docs.js`. Referência: [documentação oficial de configuração do Swagger UI](https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/).
