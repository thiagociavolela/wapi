# Filtro Campanhas na central

Conversas criadas pelo disparo de campanha usam o status `campaign`, exibido na aba Campanhas. Permanecem acessíveis também na aba Todas. Novas conta somente conversas no status `new`.

Uma mensagem recebida do cliente muda `campaign` para `new`, incrementa as não lidas e inicia os prazos da política de SLA da organização. Confirmações de envio/entrega/leitura e reações com emoji não promovem a conversa. As respostas em conversas já abertas ou pendentes preservam o status e o atendente.

Um envio bem-sucedido para uma conversa concluída e sem atendente nem mensagens não lidas a move para Campanhas. Um envio para uma conversa nova só a move se todo o histórico for de campanha, sem mensagem do cliente ou outro envio. Assim, um disparo não esconde clientes aguardando atendimento. Essa condição é verificada na atualização no banco para preservar respostas recebidas enquanto o disparo está em andamento.

Administradores e supervisores podem inspecionar o histórico com as permissões existentes. Um atendente pode iniciar atendimento manualmente pela confirmação de abertura; a conversa passa para Em atendimento.

## Publicação

Atualize backend, arquivos públicos e migrações juntos. Execute `npm run build` na pasta do projeto e reinicie o serviço da aplicação. O comando aplica a migração `013_campaign_inbox.sql`, necessária antes de executar o backend atualizado. Recarregue as telas abertas após a publicação.

A migração também separa conversas antigas no status Nova que têm somente mensagens de campanha, nenhuma mensagem não lida e nenhum atendente atribuído. Conversas com histórico de cliente, envios manuais ou de integração permanecem na fila atual para evitar esconder demanda real. Nenhuma mensagem é excluída.

Os testes automatizados usam o banco simulado e cobrem o worker, as consultas, a API e o webhook. A migração e o fluxo completo ainda devem ser conferidos no banco do ambiente de implantação.
