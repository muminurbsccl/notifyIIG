const TEMPLATE_VARIABLE = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function render(
  template: string,
  variables: Record<string, string>,
  escapeValues: boolean,
): string {
  return template.replace(TEMPLATE_VARIABLE, (_match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(variables, name)) {
      throw new Error(`Unknown template variable: ${name}`);
    }
    return escapeValues ? escapeHtml(variables[name]) : variables[name];
  });
}

export function renderTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return render(template, variables, true);
}

export function renderPlainTextTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return render(template.replace(/<[^>]*>/g, ""), variables, false).replace(
    /<[^>]*>/g,
    "",
  );
}
