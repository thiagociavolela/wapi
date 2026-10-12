const nameParameters = new Set(['nome', 'name', 'customer_name', 'contact_name', 'first_name']);

export function templateContactName(value: string) {
  const name = value.trim().replace(/\s+/g, ' ');
  if (Array.from(name).length <= 30) return name;
  const words = name.split(' ');
  let result = '';
  for (const word of words) {
    const next = result ? `${result} ${word}` : word;
    if (Array.from(next).length > 30) break;
    result = next;
  }
  return result.replace(/\s+(?:de|do|da|dos|das|e)$/i, '') || Array.from(words[0]!).slice(0, 30).join('');
}

export function isContactNameVariable(variable: string, body: string) {
  return nameParameters.has(variable.toLowerCase()) ||
    (variable === '1' && /^(?:oi|olá|ola|hello|hi)[,!\s]*\{\{1\}\}/i.test(body.trim()));
}

// Also protects retries whose components were saved before normalization existed.
export function normalizeTemplateNameComponents(name: string, components: unknown[]) {
  return components.map(component => {
    if (!component || typeof component !== 'object') return component;
    const item = component as Record<string, any>;
    if (item.type !== 'body' || !Array.isArray(item.parameters)) return component;
    return { ...item, parameters: item.parameters.map((parameter: any, index: number) => {
      if (parameter?.type !== 'text' || typeof parameter.text !== 'string') return parameter;
      const isName = nameParameters.has(String(parameter.parameter_name || '').toLowerCase()) || (name === 'pedido_confirmado' && index === 0);
      return isName ? { ...parameter, text: templateContactName(parameter.text) } : parameter;
    }) };
  });
}
