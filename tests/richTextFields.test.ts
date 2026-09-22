import {
  HTML_FORMAT_WORK_ITEM_FIELDS,
  looksLikeHtml,
  escapeXmlText,
  wrapPlainTextAsHtml
} from '../src/utils/richTextFields';

describe('HTML_FORMAT_WORK_ITEM_FIELDS', () => {
  it('includes the fields known to trigger Azure DevOps server-side HTML auto-encoding', () => {
    expect(HTML_FORMAT_WORK_ITEM_FIELDS).toContain('Microsoft.VSTS.TCM.Steps');
    expect(HTML_FORMAT_WORK_ITEM_FIELDS).toContain('System.Description');
  });
});

describe('looksLikeHtml', () => {
  it('returns false for plain text with no tags', () => {
    expect(looksLikeHtml('Go to Case Setup > Benefit Plans')).toBe(false);
  });

  it('returns true for text containing a recognizable HTML tag', () => {
    expect(looksLikeHtml('<div><p>Go to Case Setup &gt; Benefit Plans</p></div>')).toBe(true);
  });

  it('returns true for a self-closing tag with no attributes (e.g. <br/>)', () => {
    expect(looksLikeHtml('line one<br/>line two')).toBe(true);
  });

  it('returns true for a self-closing tag with attributes (e.g. <img src="x"/>)', () => {
    expect(looksLikeHtml('<img src="x"/>')).toBe(true);
  });
});

describe('escapeXmlText', () => {
  it('escapes &, <, and > in that order without double-escaping', () => {
    expect(escapeXmlText('<div>a & b > c</div>')).toBe('&lt;div&gt;a &amp; b &gt; c&lt;/div&gt;');
  });
});

describe('wrapPlainTextAsHtml', () => {
  it('wraps a single line of plain text in <div><p>', () => {
    expect(wrapPlainTextAsHtml('Go to Case Setup > Benefit Plans')).toBe(
      '<div><p>Go to Case Setup &gt; Benefit Plans</p></div>'
    );
  });

  it('turns blank-line-separated blocks into separate <p> elements', () => {
    expect(wrapPlainTextAsHtml('first step\n\nsecond step')).toBe(
      '<div><p>first step</p><p>second step</p></div>'
    );
  });

  it('turns single newlines within a block into <br>', () => {
    expect(wrapPlainTextAsHtml('line one\nline two')).toBe(
      '<div><p>line one<br>line two</p></div>'
    );
  });

  it('normalizes CRLF line endings before splitting into paragraphs', () => {
    expect(wrapPlainTextAsHtml('first step\r\n\r\nsecond step')).toBe(
      '<div><p>first step</p><p>second step</p></div>'
    );
  });

  it('normalizes CRLF line endings before converting to <br>', () => {
    expect(wrapPlainTextAsHtml('line one\r\nline two')).toBe(
      '<div><p>line one<br>line two</p></div>'
    );
  });

  it('normalizes lone CR (old Mac) line endings', () => {
    expect(wrapPlainTextAsHtml('first step\r\rsecond step')).toBe(
      '<div><p>first step</p><p>second step</p></div>'
    );
  });

  it('matches the exact stored form confirmed to round-trip unchanged in Azure DevOps', () => {
    // Verified live against dev.azure.com/selerix/Engineering (work item 19567, since closed):
    // creating a Shared Steps item with this exact parameterizedString text - built by
    // escapeXmlText(wrapPlainTextAsHtml(...)) - came back byte-for-byte identical from
    // getWorkItemById, unlike a bare/single-escaped plain-text value for the same field.
    const stepText = 'Go to Case Setup > Benefit Plans';
    const parameterizedStringContent = escapeXmlText(wrapPlainTextAsHtml(stepText));

    expect(parameterizedStringContent).toBe(
      '&lt;div&gt;&lt;p&gt;Go to Case Setup &amp;gt; Benefit Plans&lt;/p&gt;&lt;/div&gt;'
    );
  });
});
