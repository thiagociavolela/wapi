# Diagn?stico de carga da central

A captura do htop mostra CPU saturada no MySQL. Ela n?o identifica sozinha a consulta respons?vel. As threads do mysqld compartilham mem?ria; n?o some o RES de cada linha.

## Altera??es

- Listagem em p?ginas de 10, com contagem geral apenas nas requisi??es iniciais/atualiza??es, n?o nas p?ginas adicionais.
- Eventos em tempo real agrupados em intervalos de 500 ms, sem sobrepor atualiza??es autom?ticas. Eventos recebidos durante uma atualiza??o aguardam a pr?xima.
- Recibos de entrega/leitura n?o recarregam a lista; recarregam mensagens somente se o recibo corresponde a uma mensagem carregada na conversa aberta.
- Consultas da lista incluem somente os filtros ativos.
- A migra??o 012 adiciona ?ndices para ordena??o da lista e ?ltima mensagem recebida. Nenhum dado de conversa ? removido.

## Publica??o e medi??o

Publique backend, arquivos p?blicos e migra??es juntos. O script existente `npm run build` compila e aplica migra??es ao banco configurado; `npm run db:migrate` tamb?m pode aplicar as migra??es. Reinicie o servi?o pelo mecanismo usado no servidor e recarregue as telas dos atendentes. A cria??o dos ?ndices pode consumir recursos temporariamente; execute em um per?odo de menor movimento.

Durante a lentid?o, execute no banco do servidor:

```sql
SHOW FULL PROCESSLIST;
SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_running', 'Threads_connected', 'Slow_queries');
SHOW INDEX FROM conversations;
SHOW INDEX FROM messages;
```

Anote CPU, quantidade de atendentes conectados e volume de eventos antes/depois sob carga semelhante. Use EXPLAIN na consulta efetivamente observada para verificar o ?ndice escolhido. N?o execute EXPLAIN ANALYZE de consultas pesadas no servidor saturado: ele executa a consulta.

A captura de tela n?o permite confirmar ganho nem atribuir toda a carga ? listagem. Campanhas, webhooks e outros servi?os tamb?m podem disputar o mesmo banco.

Refer?ncia sobre ?ndices compostos: https://dev.mysql.com/doc/refman/8.0/en/multiple-column-indexes.html
