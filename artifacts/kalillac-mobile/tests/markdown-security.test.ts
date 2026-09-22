import { describe, expect, it } from '@jest/globals';

declare const __dirname: string;
declare const require: {
  (moduleName: string): any;
  resolve(moduleName: string, options?: { paths?: string[] }): string;
};

const fs = require('fs') as {
  existsSync(filePath: string): boolean;
  readFileSync(filePath: string, encoding: 'utf8'): string;
  readdirSync(
    directory: string,
    options: { withFileTypes: true },
  ): Array<{ name: string; isDirectory(): boolean }>;
};
const path = require('path') as {
  dirname(filePath: string): string;
  join(...parts: string[]): string;
  resolve(...parts: string[]): string;
};

type MarkdownToken = {
  type: string;
  content: string;
  children?: MarkdownToken[] | null;
  attrs?: Array<[string, string]> | null;
};

const chatSource = fs.readFileSync(
  path.resolve(__dirname, '../app/(app)/chat/[id].tsx'),
  'utf8',
);

const rendererPackageJson = require.resolve(
  '@ronradtke/react-native-markdown-display/package.json',
);
const rendererRoot = path.dirname(rendererPackageJson);
const createMarkdownIt = require(
  path.join(rendererRoot, 'dist/lib/view/createMarkdownIt.js'),
).createMarkdownIt as () => {
  parse(source: string, env: Record<string, never>): MarkdownToken[];
};

function parseMarkdown(source: string): MarkdownToken[] {
  return createMarkdownIt().parse(source, {});
}

function flattenInlineTokens(tokens: MarkdownToken[]): MarkdownToken[] {
  return tokens.flatMap((token) => [
    token,
    ...(token.children ? flattenInlineTokens(token.children) : []),
  ]);
}

function findPackageRoot(entryPath: string): string {
  let directory = path.dirname(entryPath);
  while (directory !== path.dirname(directory)) {
    if (fs.existsSync(path.join(directory, 'package.json'))) {
      return directory;
    }
    directory = path.dirname(directory);
  }
  throw new Error(`Could not find package root for ${entryPath}`);
}

function readJavaScriptFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return readJavaScriptFiles(entryPath);
    return /\.(?:cjs|js|mjs)$/.test(entry.name)
      ? [fs.readFileSync(entryPath, 'utf8')]
      : [];
  });
}

describe('Kalillac Markdown security boundary', () => {
  it('replaces remote image rendering with the existing blocked placeholder', () => {
    const tokens = flattenInlineTokens(
      parseMarkdown('![remote image](https://example.com/image.png)'),
    );

    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'image',
          content: 'remote image',
        }),
      ]),
    );
    expect(chatSource).toMatch(
      /image:\s*\(\)\s*=>\s*<ThemedText[^>]*>\[Remote Image Blocked\]<\/ThemedText>/,
    );
    expect(chatSource).toContain('rules={markdownRules}');
    expect(chatSource).not.toMatch(/<Image\b/);
  });

  it('does not render or execute raw HTML from Markdown', () => {
    const tokens = parseMarkdown(
      '<script>alert("unexpected")</script>\n\n<div>raw HTML</div>',
    );

    expect(tokens.some((token) => /html_(?:block|inline)/.test(token.type))).toBe(
      false,
    );
    expect(
      flattenInlineTokens(tokens).some(
        (token) => token.type === 'text' && token.content.includes('<script>'),
      ),
    ).toBe(true);
    expect(chatSource).toMatch(/html_block:\s*\(\)\s*=>\s*<><\/>/);
    expect(chatSource).toMatch(/html_inline:\s*\(\)\s*=>\s*<><\/>/);
  });

  it('keeps HTTPS links behind the existing confirmation flow', () => {
    const linkHandler = chatSource.slice(chatSource.indexOf('onLinkPress='));

    expect(linkHandler).toMatch(
      /if\s*\(\/\^https:\\\/\\\/\/i\.test\(url\)\)/,
    );
    expect(linkHandler).toContain("Alert.alert('Example source'");
    expect(linkHandler).toContain("{ text: 'Open website'");
    expect(linkHandler).toContain('Linking.openURL(url)');
    expect(linkHandler).toContain('return false;');
    expect(linkHandler.indexOf('Alert.alert')).toBeLessThan(
      linkHandler.indexOf('Linking.openURL(url)'),
    );
  });

  it('does not open unsafe or non-approved schemes automatically', () => {
    const tokens = flattenInlineTokens(
      parseMarkdown(
        '[javascript](javascript:alert(1)) [data](data:text/html,blocked) [http](http://example.com)',
      ),
    );
    const links = tokens.filter((token) => token.type === 'link_open');

    expect(links.map((token) => token.attrs)).toEqual([
      [['href', 'http://example.com']],
    ]);
    expect(chatSource).toMatch(
      /onLinkPress=\{[\s\S]*?if\s*\(\/\^https:\\\/\\\/\/i\.test\(url\)\)[\s\S]*?return false;[\s\S]*?\}/,
    );
  });

  it('continues to parse the supported Markdown structures used by chat', () => {
    const tokens = parseMarkdown(
      [
        '# Heading',
        '',
        '**bold** and *italic*',
        '',
        '- first',
        '- second',
        '',
        '`inline code`',
        '',
        '```ts',
        'const answer = 42;',
        '```',
        '',
        '| Name | Value |',
        '| --- | --- |',
        '| answer | 42 |',
        '',
        '[ordinary link](https://example.com)',
      ].join('\n'),
    );
    const inlineTokens = flattenInlineTokens(tokens);
    const tokenTypes = new Set(tokens.map((token) => token.type));

    expect([...tokenTypes]).toEqual(
      expect.arrayContaining([
        'heading_open',
        'bullet_list_open',
        'fence',
        'table_open',
      ]),
    );
    expect(inlineTokens.map((token) => token.type)).toEqual(
      expect.arrayContaining([
        'strong_open',
        'em_open',
        'code_inline',
        'link_open',
      ]),
    );
    expect(
      inlineTokens.find((token) => token.type === 'link_open')?.attrs,
    ).toContainEqual(['href', 'https://example.com']);
  });

  it('keeps the maintained renderer native bundle path free of Node-core imports', () => {
    const nodeCoreImport =
      /\b(?:require|import)\s*(?:\(\s*)?['"](?:node:)?(?:assert|buffer|child_process|cluster|console|constants|crypto|dgram|diagnostics_channel|dns|domain|events|fs|http|http2|https|module|net|os|path|perf_hooks|process|punycode|querystring|readline|repl|stream|string_decoder|sys|timers|tls|trace_events|tty|url|util|v8|vm|wasi|worker_threads|zlib)(?:['"]|\s+from)/;
    const rendererJavaScript = readJavaScriptFiles(
      path.join(rendererRoot, 'dist'),
    ).join('\n');
    const markdownItEntry = require.resolve('markdown-it', {
      paths: [rendererRoot],
    });
    const markdownItJavaScript = readJavaScriptFiles(
      findPackageRoot(markdownItEntry),
    ).join('\n');

    expect(rendererJavaScript).not.toMatch(nodeCoreImport);
    expect(markdownItJavaScript).not.toMatch(nodeCoreImport);
    expect(chatSource).toContain(
      "from '@ronradtke/react-native-markdown-display'",
    );
    expect(chatSource).not.toContain(
      "from 'react-native-markdown-display'",
    );
  });
});