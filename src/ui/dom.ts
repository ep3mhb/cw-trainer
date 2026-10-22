/** Tiny DOM helpers. No framework — see README for why. */

type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

/** A range slider whose value can also be set from outside. */
export interface SliderField extends HTMLLabelElement {
  setValue: (value: number) => void;
}

/** A labelled range slider that reports its value as it moves. */
export function slider(options: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  format?: (v: number) => string;
  onInput: (value: number) => void;
}): SliderField {
  const format = options.format ?? ((v: number) => `${v}${options.unit ?? ''}`);
  const valueOut = el('b', { text: format(options.value) });
  const input = el('input', {
    type: 'range',
    min: options.min,
    max: options.max,
    step: options.step,
    value: options.value,
    'aria-label': options.label,
  });
  input.addEventListener('input', () => {
    const value = Number(input.value);
    valueOut.textContent = format(value);
    options.onInput(value);
  });
  const field = el(
    'label',
    { class: 'field' },
    el('span', { class: 'label-row' }, el('span', { text: options.label }), valueOut),
    el('span', { class: 'control' }, input),
  ) as SliderField;
  // Used when another control changes the same value; does not fire onInput,
  // because the caller is the one making the change.
  field.setValue = (value: number): void => {
    input.value = String(value);
    valueOut.textContent = format(value);
  };
  return field;
}

export function select<T extends string>(options: {
  label: string;
  value: T;
  choices: { value: T; label: string }[];
  onChange: (value: T) => void;
}): HTMLLabelElement {
  const node = el('select', { 'aria-label': options.label });
  for (const choice of options.choices) {
    node.append(el('option', { value: choice.value, text: choice.label, selected: choice.value === options.value }));
  }
  node.addEventListener('change', () => options.onChange(node.value as T));
  return el(
    'label',
    { class: 'field' },
    el('span', { class: 'label-row' }, el('span', { text: options.label })),
    el('span', { class: 'control' }, node),
  );
}

export function radioGroup<T extends string>(options: {
  legend: string;
  name: string;
  value: T;
  choices: { value: T; label: string }[];
  onChange: (value: T) => void;
}): HTMLFieldSetElement {
  const row = el('div', { class: 'radio-row' });
  for (const choice of options.choices) {
    const input = el('input', {
      type: 'radio',
      name: options.name,
      value: choice.value,
      checked: choice.value === options.value,
    });
    input.addEventListener('change', () => {
      if (input.checked) options.onChange(choice.value);
    });
    row.append(el('label', {}, input, el('span', { text: choice.label })));
  }
  return el('fieldset', {}, el('legend', { text: options.legend }), row);
}

export function badge(label: string, value: string, tone: '' | 'good' | 'warn' | 'bad' = ''): HTMLSpanElement {
  return el('span', { class: `badge ${tone}`.trim() }, `${label} `, el('b', { text: value }));
}

/** Trigger a download of text content without a server. */
export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Read a file the user picked, as text. */
export function pickFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept, class: 'sr-only' });
    document.body.append(input);
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (file === undefined) {
        resolve(null);
        return;
      }
      void file.text().then((text) => resolve({ name: file.name, text }));
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    input.click();
  });
}
