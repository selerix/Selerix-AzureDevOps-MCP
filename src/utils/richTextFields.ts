/**
 * Azure DevOps stores a fixed set of work item fields as HTML even though the WIT REST API
 * accepts and returns their value as a plain string (a work item response reports this per field
 * via `multilineFieldsFormat`, e.g. `{ "Microsoft.VSTS.TCM.Steps": "html" }`).
 *
 * When a value written to one of these fields does NOT already look like HTML (no recognizable
 * tags), Azure DevOps runs it through its own HTML-encode pass server-side before storing it -
 * turning a literal `>` into the entity `&gt;`. For `Microsoft.VSTS.TCM.Steps` specifically, that
 * HTML-encoded text is itself a text node inside the field's outer step-list XML
 * (`<steps><step><parameterizedString>...</parameterizedString></step></steps>`), so the `&` from
 * the newly-added `&gt;` then ALSO needs XML-escaping to keep that outer document well-formed -
 * producing `&amp;gt;` in the value a subsequent getWorkItemById returns. This is confirmed
 * server-side behavior, not a bug in this server or in azure-devops-node-api: the HTTP request
 * body is built with a plain `JSON.stringify` with no escaping of any kind, so pre-escaping a
 * value before calling createWorkItem/updateWorkItem cannot avoid it either - XML-escaping `>` as
 * `&gt;` before sending is indistinguishable, once XML-parsed, from sending the literal `>`
 * character, and both get the same server-side HTML-encode treatment.
 *
 * The one input shape that reliably survives untouched is text that already looks like real HTML
 * (e.g. wrapped in `<div><p>...</p></div>`, with any literal `>`/`&` inside it pre-encoded as
 * `&gt;`/`&amp;`) - Azure DevOps recognizes it as already-HTML and passes it through byte-for-byte.
 * Use wrapPlainTextAsHtml to build that shape from plain text, and escapeXmlText on top of it when
 * the target field (like Microsoft.VSTS.TCM.Steps) itself wraps the HTML in another layer of XML.
 */
export const HTML_FORMAT_WORK_ITEM_FIELDS = [
  'System.Description',
  'Microsoft.VSTS.Common.AcceptanceCriteria',
  'Microsoft.VSTS.TCM.ReproSteps',
  'Microsoft.VSTS.TCM.Steps',
  'Microsoft.VSTS.TCM.SystemInfo'
] as const;

const HTML_TAG_PATTERN = /<\/?[a-z][a-z0-9]*[\s/>]/i;

/**
 * True if `value` already contains a recognizable HTML tag, i.e. Azure DevOps will treat it as
 * already-HTML and store it unchanged rather than running it through its own HTML-encode pass.
 */
export function looksLikeHtml(value: string): boolean {
  return HTML_TAG_PATTERN.test(value);
}

/**
 * Escapes text for safe use as an XML text node - e.g. inside a <parameterizedString> element of
 * a Microsoft.VSTS.TCM.Steps document. Needed as a second pass on top of wrapPlainTextAsHtml's
 * output when embedding HTML content inside an XML-wrapped field like TCM.Steps: the HTML tags
 * and entities in that output are themselves just text as far as the outer XML document is
 * concerned, and have to be escaped again to keep the outer document well-formed.
 */
export function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Wraps plain text as the `<div><p>...</p></div>` HTML Azure DevOps expects for its HTML-format
 * fields, HTML-encoding reserved characters first so they survive as literal text once rendered.
 * Each blank-line-separated block of `text` becomes its own `<p>`; single newlines within a block
 * become `<br>`.
 */
export function wrapPlainTextAsHtml(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n');
  const encoded = escapeXmlText(normalized);

  const paragraphs = encoded
    .split(/\n{2,}/)
    .map(block => `<p>${block.replace(/\n/g, '<br>')}</p>`)
    .join('');

  return `<div>${paragraphs}</div>`;
}
