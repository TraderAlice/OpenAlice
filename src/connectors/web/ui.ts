/**
 * Web UI HTML template — single-file chat interface.
 *
 * Inlined as a template literal so it works with both tsx (dev) and tsup (prod)
 * without needing to resolve static file paths.
 */

export const WEB_UI_HTML = /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Open Alice</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.0/marked.min.js"><\/script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"><\/script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --border: #30363d;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --accent-dim: #1f6feb33;
      --user-bubble: #1f6feb;
      --assistant-bubble: #161b22;
      --notification-bg: #2d1f00;
      --notification-border: #d29922;
      --green: #3fb950;
      --red: #f85149;
    }

    html, body {
      height: 100%;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif;
      font-size: 15px;
      line-height: 1.6;
    }

    #app {
      display: flex;
      flex-direction: column;
      height: 100%;
      max-width: 900px;
      margin: 0 auto;
    }

    /* Header */
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-secondary);
      flex-shrink: 0;
    }
    header h1 {
      font-size: 18px;
      font-weight: 600;
      color: var(--text);
    }
    header .status {
      font-size: 12px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    header .status .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--green);
    }
    header .status .dot.disconnected {
      background: var(--red);
    }

    /* Messages container */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    #messages::-webkit-scrollbar { width: 6px; }
    #messages::-webkit-scrollbar-track { background: transparent; }
    #messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

    /* Message bubbles */
    .msg {
      max-width: 85%;
      padding: 10px 16px;
      border-radius: 12px;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .msg.user {
      align-self: flex-end;
      background: var(--user-bubble);
      border-bottom-right-radius: 4px;
    }
    .msg.assistant {
      align-self: flex-start;
      background: var(--assistant-bubble);
      border: 1px solid var(--border);
      border-bottom-left-radius: 4px;
    }
    .msg.notification {
      align-self: center;
      background: var(--notification-bg);
      border: 1px solid var(--notification-border);
      border-radius: 8px;
      font-size: 13px;
      max-width: 90%;
    }
    .msg.notification::before {
      content: "\\1F514 ";
    }

    /* Thinking indicator */
    .msg.thinking {
      align-self: flex-start;
      background: var(--assistant-bubble);
      border: 1px solid var(--border);
      border-bottom-left-radius: 4px;
      color: var(--text-muted);
    }
    .thinking-dots span {
      animation: blink 1.4s infinite;
      font-size: 20px;
      line-height: 1;
    }
    .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
    .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes blink {
      0%, 20% { opacity: 0.2; }
      50% { opacity: 1; }
      80%, 100% { opacity: 0.2; }
    }

    /* Markdown content styling */
    .msg.assistant .content p { margin: 0.5em 0; }
    .msg.assistant .content p:first-child { margin-top: 0; }
    .msg.assistant .content p:last-child { margin-bottom: 0; }
    .msg.assistant .content pre {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      overflow-x: auto;
      margin: 8px 0;
      font-size: 13px;
    }
    .msg.assistant .content code {
      font-family: "SF Mono", "Fira Code", "Cascadia Code", Menlo, Consolas, monospace;
      font-size: 13px;
    }
    .msg.assistant .content :not(pre) > code {
      background: var(--bg-tertiary);
      padding: 2px 6px;
      border-radius: 4px;
    }
    .msg.assistant .content ul, .msg.assistant .content ol {
      padding-left: 1.5em;
      margin: 0.5em 0;
    }
    .msg.assistant .content blockquote {
      border-left: 3px solid var(--accent);
      padding-left: 12px;
      color: var(--text-muted);
      margin: 0.5em 0;
    }
    .msg.assistant .content table {
      border-collapse: collapse;
      margin: 8px 0;
      width: 100%;
    }
    .msg.assistant .content th, .msg.assistant .content td {
      border: 1px solid var(--border);
      padding: 6px 12px;
      text-align: left;
    }
    .msg.assistant .content th {
      background: var(--bg-tertiary);
    }
    .msg.assistant .content img {
      max-width: 100%;
      border-radius: 8px;
      margin: 8px 0;
    }
    .msg.assistant .content a {
      color: var(--accent);
      text-decoration: none;
    }
    .msg.assistant .content a:hover {
      text-decoration: underline;
    }

    /* Timestamp */
    .msg-time {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 4px;
      opacity: 0;
      transition: opacity 0.2s;
    }
    .msg-wrapper:hover .msg-time { opacity: 1; }

    .msg-wrapper {
      display: flex;
      flex-direction: column;
    }
    .msg-wrapper.user { align-items: flex-end; }
    .msg-wrapper.assistant { align-items: flex-start; }
    .msg-wrapper.notification { align-items: center; }

    /* Input area */
    #input-area {
      display: flex;
      gap: 10px;
      padding: 16px 20px;
      border-top: 1px solid var(--border);
      background: var(--bg-secondary);
      flex-shrink: 0;
    }
    #input {
      flex: 1;
      background: var(--bg);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 14px;
      font-family: inherit;
      font-size: 15px;
      line-height: 1.5;
      resize: none;
      outline: none;
      max-height: 200px;
      transition: border-color 0.2s;
    }
    #input:focus { border-color: var(--accent); }
    #input::placeholder { color: var(--text-muted); }
    #send {
      align-self: flex-end;
      background: var(--user-bubble);
      color: white;
      border: none;
      border-radius: 10px;
      padding: 10px 20px;
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.2s;
      flex-shrink: 0;
    }
    #send:hover { opacity: 0.85; }
    #send:disabled { opacity: 0.4; cursor: not-allowed; }

    /* Empty state */
    #empty-state {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      font-size: 16px;
    }

    /* Responsive */
    @media (max-width: 600px) {
      #app { max-width: 100%; }
      .msg { max-width: 92%; }
      #messages { padding: 12px; }
      #input-area { padding: 12px; }
    }
  </style>
</head>
<body>
  <div id="app">
    <header>
      <h1>Open Alice</h1>
      <div class="status">
        <div class="dot" id="sse-dot"></div>
        <span id="sse-status">connected</span>
      </div>
    </header>
    <div id="messages"></div>
    <div id="input-area">
      <textarea id="input" placeholder="Send a message..." rows="1"><\/textarea>
      <button id="send">Send<\/button>
    </div>
  </div>

  <script>
    // ==================== Config ====================
    const API_BASE = window.location.origin;

    // ==================== Marked setup ====================
    marked.setOptions({
      highlight: (code, lang) => {
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
      },
      breaks: true,
    });

    // ==================== DOM refs ====================
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const sseDot = document.getElementById('sse-dot');
    const sseStatus = document.getElementById('sse-status');

    let isWaiting = false;
    let userScrolledUp = false;

    // ==================== Auto-scroll ====================
    messagesEl.addEventListener('scroll', () => {
      const { scrollTop, scrollHeight, clientHeight } = messagesEl;
      userScrolledUp = scrollHeight - scrollTop - clientHeight > 80;
    });

    function scrollToBottom() {
      if (!userScrolledUp) {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    }

    // ==================== Render helpers ====================
    function renderMessage(role, text, timestamp) {
      const wrapper = document.createElement('div');
      wrapper.className = 'msg-wrapper ' + role;

      const bubble = document.createElement('div');
      bubble.className = 'msg ' + role;

      if (role === 'user') {
        bubble.textContent = text;
      } else if (role === 'notification') {
        bubble.innerHTML = '<div class="content">' + marked.parse(text) + '</div>';
      } else {
        bubble.innerHTML = '<div class="content">' + marked.parse(text) + '</div>';
      }

      wrapper.appendChild(bubble);

      if (timestamp) {
        const timeEl = document.createElement('div');
        timeEl.className = 'msg-time';
        timeEl.textContent = new Date(timestamp).toLocaleString();
        wrapper.appendChild(timeEl);
      }

      messagesEl.appendChild(wrapper);
      scrollToBottom();

      // Highlight code blocks
      wrapper.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
      });

      return wrapper;
    }

    function showThinking() {
      const wrapper = document.createElement('div');
      wrapper.className = 'msg-wrapper assistant';
      wrapper.id = 'thinking';

      const bubble = document.createElement('div');
      bubble.className = 'msg thinking';
      bubble.innerHTML = '<div class="thinking-dots"><span>.</span><span>.</span><span>.</span></div>';

      wrapper.appendChild(bubble);
      messagesEl.appendChild(wrapper);
      scrollToBottom();
    }

    function removeThinking() {
      const el = document.getElementById('thinking');
      if (el) el.remove();
    }

    // ==================== Media rendering ====================
    function renderMedia(media) {
      if (!media || media.length === 0) return;
      for (const m of media) {
        if (m.type === 'image') {
          const wrapper = document.createElement('div');
          wrapper.className = 'msg-wrapper assistant';
          const bubble = document.createElement('div');
          bubble.className = 'msg assistant';
          bubble.innerHTML = '<div class="content"><img src="' + m.url + '" alt="image"></div>';
          wrapper.appendChild(bubble);
          messagesEl.appendChild(wrapper);
        }
      }
      scrollToBottom();
    }

    // ==================== Chat ====================
    async function sendMessage() {
      const text = inputEl.value.trim();
      if (!text || isWaiting) return;

      inputEl.value = '';
      inputEl.style.height = 'auto';
      isWaiting = true;
      sendBtn.disabled = true;

      renderMessage('user', text);
      showThinking();

      try {
        const res = await fetch(API_BASE + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
        });

        removeThinking();

        if (res.status === 409) {
          renderMessage('notification', 'Engine is busy, please try again in a moment.');
        } else if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Unknown error' }));
          renderMessage('notification', 'Error: ' + (err.error || res.statusText));
        } else {
          const data = await res.json();
          renderMedia(data.media);
          if (data.text) {
            renderMessage('assistant', data.text);
          }
        }
      } catch (err) {
        removeThinking();
        renderMessage('notification', 'Network error: ' + err.message);
      } finally {
        isWaiting = false;
        sendBtn.disabled = false;
        inputEl.focus();
      }
    }

    // ==================== Input handling ====================
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Auto-resize textarea
    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
    });

    sendBtn.addEventListener('click', sendMessage);

    // ==================== Load history ====================
    async function loadHistory() {
      try {
        const res = await fetch(API_BASE + '/api/chat/history?limit=100');
        if (!res.ok) return;
        const data = await res.json();

        if (data.messages.length === 0) return;

        for (const msg of data.messages) {
          renderMessage(msg.role, msg.text, msg.timestamp);
        }
      } catch (err) {
        console.warn('Failed to load history:', err);
      }
    }

    // ==================== SSE ====================
    function connectSSE() {
      const es = new EventSource(API_BASE + '/api/chat/events');

      es.onopen = () => {
        sseDot.classList.remove('disconnected');
        sseStatus.textContent = 'connected';
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'message' && data.text) {
            renderMessage('notification', data.text);
          }
        } catch {}
      };

      es.onerror = () => {
        sseDot.classList.add('disconnected');
        sseStatus.textContent = 'reconnecting...';
        // EventSource auto-reconnects
      };
    }

    // ==================== Init ====================
    loadHistory().then(() => {
      connectSSE();
      inputEl.focus();
    });
  <\/script>
</body>
</html>
`
