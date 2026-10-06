# Correção de entrega_iniciada_motoboy

## Verificação real e causa

Em 06/10/2026, a consulta autenticada à Graph API da WABA confirmou o template `entrega_iniciada_motoboy`, aprovado em `pt_BR`, com `parameter_format: NAMED`, variável de corpo `nome` e botão URL no índice 0: `https://providafarma.com/rastrear-entrega?t={{1}}`.

O endpoint local descartava `buttonParameters` na validação Zod. O construtor consumia corpo e botão de um único array; o contrato separado informado seria rejeitado neste checkout por quantidade incorreta. O worker também priorizava qualquer array `content.components`, inclusive vazio ou contendo apenas botão, ignorando os parâmetros persistidos do job. Essa condição produz um payload sem o parâmetro de corpo exigido pela Meta.

A consulta GET ao job de produção `a68166f8-27cc-4582-8523-a0c6ec19757b` confirmou `failed`, três tentativas, sem `wamid`, e o erro Meta 132000 informado. Esse job não existe no banco local. Não houve acesso ao conteúdo interno desse job nem ao código implantado; portanto, o ponto exato que produziu seu snapshot incompleto não pôde ser comprovado em produção. O comportamento HTTP 202 informado difere da validação do checkout local anterior à correção.

## Implementação

- Endpoint aceita e valida `buttonParameters` sem mudar o contrato do site.
- Corpo/cabeçalho e botões têm contagem e consumo separados quando o campo está presente.
- Sem o campo, arrays legados continuam consumidos na ordem dos componentes.
- A coluna JSON `integration_message_jobs.parameters` mantém arrays legados ou um objeto com `parameters` e `buttonParameters`; nenhuma migration é necessária.
- Worker reconstrói os componentes com os parâmetros do job e o cadastro aprovado, preservando `parameter_name` para nomes e parâmetros posicionais nos botões. Metadados não fornecem variáveis.
- Disparo imediato consulta somente o novo job; o worker periódico mantém o processamento normal da fila.
- Idempotência continua protegida pela chave existente e pela restrição única no banco.

Endpoint e worker devem ser implantados juntos. Antes da implantação, verificar a lista de templates e configuração da WABA no ambiente de produção.

## Validação

`npm test`: 28 testes aprovados em seis arquivos. Inclui endpoint autenticado, formato inválido e quantidades incompatíveis, persistência separada, reconstrução sem snapshot ou com corpo ausente, arrays legados, ordem de componentes, idempotência e payload HTTP final da Meta com DDI preservado.

`npx tsc -p tsconfig.json --noEmit`: aprovado.

## Único envio controlado

- Data: 06/10/2026, 10:11:03, America/Sao_Paulo.
- Endpoint: instância temporária local apenas com o router de integração corrigido.
- Meta: API real, mesmo cadastro confirmado acima.
- Número: `5511917080051`.
- Nome: `Teste de integracao`.
- Identificação: `TESTE-WHATSAPP-INICIO-b82f9335-8ef4-4bb5-9c8b-fbc22c8cd5c5`.
- Token: valor público exclusivo de teste, 32 bytes aleatórios em hexadecimal, separado do nome e persistido no job. Não corresponde a pedido real.
- Job ID: `cf092975-edff-4f1b-aa06-5fc6864dfdf6`.
- Message ID local: `2d2376e0-2597-4fa3-989d-61d3bbafb242`.
- WAMID: `wamid.HBgNNTUxMTkxNzA4MDA1MRUCABEYEjI2QTlDRUExNkExMzJDOTlDMwA=`.
- Status consultado pelo GET de integração: `sent`, uma tentativa, sem erro.
- `deliveryStatus`: `sent`; `deliveredAt` e `readAt`: nulos. A Meta aceitou o envio; entrega ao aparelho não confirmada. O webhook em produção não atualiza o banco local deste teste.

Foi feito exatamente um POST de teste. Não foram iniciados workers periódicos, campanhas ou agendamentos de clientes. Não foram alterados pedidos, reprocessado o job antigo ou publicados arquivos em produção. Credenciais não foram registradas.

## Implantação

Correção implementada e validada localmente; ainda não publicada. O envio controlado não valida a versão atualmente implantada em `chat.providafarma.com`.
