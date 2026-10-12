# Campanhas com carrossel de mídia

Modelo cadastrado na Meta: `ofertas_produtos_carrossel`, idioma `pt_BR`, categoria `MARKETING`.
O estado inicial retornado foi `PENDING`; o envio depende da aprovação da Meta.
O modelo contém três cartões com imagem, descrição e os botões de URL e resposta rápida.

O corpo principal aceita o nome como primeiro parâmetro. No formulário, `{{nome}}` é
substituído pelo nome de cada destinatário. Cada cartão recebe nome, preço e descrição
curta. A descrição completa, já preenchida, deve caber em 160 caracteres.
O botão de detalhes usa `https://providafarma.com/produto/{{1}}`; o formulário recebe
o endereço completo e o backend envia apenas a parte variável prevista no modelo.
Produtos carregados pelo ID recebem a URL a partir do campo `slug` do banco de produtos.

## Uso

1. Aguardar a aprovação e selecionar o modelo na lista de templates das campanhas.
2. Preencher o texto principal e todos os três cartões.
3. Buscar o produto por nome, ID, descrição curta ou slug. A lista mostra foto,
   nome e preço enquanto você digita. Selecionar um resultado prepara a imagem
   e preenche os dados do cartão. Também é possível enviar uma imagem manualmente.
4. Conferir descrição, preço, URL, prévia e destinatários antes de iniciar a campanha.

O botão "Quero Esse!" envia um payload identificando o cartão e o produto.
O webhook registra essa identificação na mensagem recebida. Não há resposta automática.
O histórico de mensagens exibe os cartões enviados.

## Envio direto na conversa

No atendimento, abra **Enviar template**, escolha o carrossel aprovado e preencha
os cartões pelo mesmo editor de produtos utilizado nas campanhas. O nome do contato
é preenchido no texto principal. O envio acontece somente ao confirmar **Enviar template**.
Os endpoints de preparação de imagens são vinculados à conversa e exigem que ela
esteja atribuída ao usuário, incluindo atendentes. O backend verifica a aprovação do
template, a propriedade das imagens e os parâmetros de cada cartão antes do envio.

## Armazenamento e implantação

Não há migração de banco. Os componentes do carrossel usam o JSON existente de campanhas.
As imagens JPEG ficam em `storage/carousel/<organization-id>/<media-id>.jpg`.
O carrossel prepara uma tela branca de 1200 × 630 pixels com a imagem inteira
centralizada em uma área de até 1080 × 480, preservando a proporção e margens.
Essa margem reduz o corte feito pelo WhatsApp em diferentes dispositivos.
As imagens preparadas recebem um arquivo `.format`; o worker adapta imagens
antigas antes dos próximos envios, e preserva o enquadramento ao renovar uploads.
Esse diretório precisa de armazenamento persistente e backup; em múltiplas instâncias,
deve ser compartilhado. O arquivo só é servido após autenticação e dentro da organização.
O worker reutiliza imagens recentes e renova uploads antigos antes de enviar campanhas
agendadas. Imagens e exemplos são enviados à Meta; isso não envia mensagens a clientes.

A definição submetida e a resposta de cadastro ficam em `storage/carousel/`, ignorado
pelo Git. O template anterior `catalogo_produtos` continua sendo do tipo MPM.
