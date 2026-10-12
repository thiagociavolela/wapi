export interface CarouselTemplateEdits { body: string; cardBodies: string[]; urlLabel: string; replyLabel: string }

function checkVariables(text: string, expected: string[], limit: number) {
  const found = [...text.matchAll(/\{\{([^{}]+)\}\}/g)].map(match => match[1]!);
  if (text.length > limit || JSON.stringify([...new Set(found)].sort()) !== JSON.stringify(expected))
    throw new Error(`Preserve as variáveis ${expected.map(value => `{{${value}}}`).join(', ')} e o limite de ${limit} caracteres.`);
}

export function editCarouselDefinition(components: Record<string, any>[], edits: CarouselTemplateEdits) {
  const result = structuredClone(components);
  const body = result.find(item => item.type === 'BODY');
  const carousel = result.find(item => item.type === 'CAROUSEL');
  if (!body || !Array.isArray(carousel?.cards) || carousel.cards.length !== edits.cardBodies.length)
    throw new Error('A quantidade de cartões deve permanecer igual ao modelo atual.');
  checkVariables(edits.body, ['1'], 1024);
  body.text = edits.body;
  for (const [index, card] of carousel.cards.entries()) {
    checkVariables(edits.cardBodies[index]!, ['1', '2', '3'], 160);
    const cardBody = card.components.find((item: any) => item.type === 'BODY');
    const buttons = card.components.find((item: any) => item.type === 'BUTTONS')?.buttons;
    if (!cardBody || !buttons?.some((item: any) => item.type === 'URL') || !buttons?.some((item: any) => item.type === 'QUICK_REPLY')) throw new Error('Estrutura de carrossel incompatível.');
    cardBody.text = edits.cardBodies[index];
    for (const button of buttons) {
      if (button.type === 'URL') button.text = edits.urlLabel;
      if (button.type === 'QUICK_REPLY') button.text = edits.replyLabel;
    }
  }
  return result;
}
