## Purpose

Convert standard Markdown output from AI providers to Telegram-compatible HTML so that messages rendered in Telegram display proper formatting (bold headers, italic text, code blocks, links) instead of raw markdown syntax. Includes a fallback to plain text if HTML parsing fails.

## Requirements

### Requirement: Markdown-to-Telegram-HTML converter
The system SHALL provide a `markdownToTelegramHtml(md: string): string` function in `src/connectors/telegram/markdown-html.ts` that converts standard Markdown to Telegram HTML format.

Supported conversions:
- `# Header` through `###### Header` → `<b>Header</b>`
- `**bold**` and `__bold__` → `<b>bold</b>`
- `*italic*` and `_italic_` → `<i>italic</i>`
- `~~strikethrough~~` → `<s>strikethrough</s>`
- `` `inline code` `` → `<code>inline code</code>`
- Fenced code blocks (` ```lang\n...\n``` `) → `<pre>...</pre>`
- `[text](url)` → `<a href="url">text</a>`

#### Scenario: Headers converted to bold
- **WHEN** input contains `## Market Summary`
- **THEN** output SHALL contain `<b>Market Summary</b>`

#### Scenario: Bold and italic preserved
- **WHEN** input contains `**important** and *emphasis*`
- **THEN** output SHALL contain `<b>important</b> and <i>emphasis</i>`

#### Scenario: Code blocks preserved
- **WHEN** input contains a fenced code block with content `const x = 1`
- **THEN** output SHALL contain `<pre>const x = 1</pre>` with HTML entities escaped inside

#### Scenario: Links converted
- **WHEN** input contains `[Google](https://google.com)`
- **THEN** output SHALL contain `<a href="https://google.com">Google</a>`

### Requirement: HTML entity escaping
The converter SHALL escape `<`, `>`, and `&` in non-code text to `&lt;`, `&gt;`, and `&amp;` before applying formatting transformations. Code blocks and inline code SHALL also have their content escaped to prevent HTML injection.

#### Scenario: Angle brackets escaped
- **WHEN** input contains `price < 100 && price > 50`
- **THEN** output SHALL contain `price &lt; 100 &amp;&amp; price &gt; 50`

#### Scenario: Code content escaped
- **WHEN** input contains `` `<div>hello</div>` ``
- **THEN** output SHALL contain `<code>&lt;div&gt;hello&lt;/div&gt;</code>`

### Requirement: TelegramConnector uses HTML parse mode
`TelegramConnector.send()` SHALL convert message text through `markdownToTelegramHtml()` and send with `parse_mode: 'HTML'`. If the Telegram API rejects the HTML (parse error), the system SHALL fall back to sending as plain text without `parse_mode`.

#### Scenario: Formatted message sent
- **WHEN** `send({ text: '## Title\n**bold**' })` is called
- **THEN** `bot.api.sendMessage` SHALL be called with `parse_mode: 'HTML'` and converted HTML content

#### Scenario: HTML parse failure fallback
- **WHEN** Telegram API rejects the HTML content
- **THEN** the system SHALL retry `sendMessage` without `parse_mode` (plain text)

### Requirement: TelegramPlugin uses HTML parse mode
All outbound message methods in `TelegramPlugin` SHALL use the converter:
- `sendReply(chatId, text)` — converts text to HTML, sends with `parse_mode: 'HTML'`
- `sendReplyWithPlaceholder(chatId, text, media, placeholderId)` — converts text, edits placeholder with HTML, sends remaining chunks with HTML
- Both methods SHALL fall back to plain text on parse errors

#### Scenario: Direct chat reply formatted
- **WHEN** the AI responds with markdown in a Telegram chat
- **THEN** the reply SHALL be sent with `parse_mode: 'HTML'` and proper formatting

#### Scenario: Placeholder edit with HTML
- **WHEN** `sendReplyWithPlaceholder` edits the `...` placeholder message
- **THEN** `editMessageText` SHALL include `parse_mode: 'HTML'`

### Requirement: Chunking compatibility
The `splitMessage()` function SHALL work correctly with HTML-formatted text. The system SHALL convert markdown to HTML before chunking, so that HTML tags are not split across chunks.

#### Scenario: Long HTML message chunked
- **WHEN** a converted HTML message exceeds 4096 characters
- **THEN** the system SHALL split at newlines or spaces (not inside HTML tags) and send each chunk with `parse_mode: 'HTML'`
