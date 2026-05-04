import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import { dracula } from '@uiw/codemirror-theme-dracula';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';
import { basicSetup } from 'codemirror';

// DOM Elements
const editorContainer = document.getElementById('editor-container');
const terminalContainer = document.getElementById('terminal-container');
const playBtn = document.getElementById('playbtn');
const stopBtn = document.getElementById('stopbtn');
const clearBtn = document.getElementById('clearbtn');
const shareBtn = document.getElementById('sharebtn');
const saveBtn = document.getElementById('savebtn');
const themebtn = document.getElementById('themebtn');
const sunIcon = document.getElementById('sun-icon');
const moonIcon = document.getElementById('moon-icon');
const toast = document.getElementById('toast');
const startupOverlay = document.getElementById('startup-overlay');
const btnFull = document.getElementById('btn-full');
const btnBase = document.getElementById('btn-base');
const plotAreaContainer = document.getElementById('plot-area-container');
const plotArea = document.getElementById('plot-area');
const clearPlotBtn = document.getElementById('clear-plot-btn');
const templateSelect = document.getElementById('template-select');
const uploadBtn = document.getElementById('upload-btn');
const fileInput = document.getElementById('file-input');
const formatBtn = document.getElementById('formatbtn');
const saveLocalBtn = document.getElementById('save-local-btn');
const loadLocalSelect = document.getElementById('load-local-select');

// State
let worker = null;
let isRunning = false;
let terminal = null;
let fitAddon = null;
let inputFlag = null;
let inputBuffer = null;
let isWaitingForInput = false;
let currentInputLine = "";
let isDark = true;

// Theme Compartment
const themeCompartment = new Compartment();

const lightTheme = EditorView.theme({
  "&": { backgroundColor: "#ffffff", color: "#212529" },
  ".cm-content": { caretColor: "#212529" },
  ".cm-gutters": { backgroundColor: "#f8f9fa", color: "#6c757d", borderRight: "1px solid #dee2e6" }
});

// Initialize Editor
const startState = EditorState.create({
  doc: "# Welcome to PyCompiler\n# Start writing your Python code here!\n\nprint('Hello, World!')\n",
  extensions: [
    basicSetup,
    python(),
    themeCompartment.of(dracula),
    EditorView.theme({
      "&": { height: "100%" },
      ".cm-scroller": { overflow: "auto" }
    })
  ]
});

const editor = new EditorView({
  state: startState,
  parent: editorContainer
});

// Terminal Themes
const terminalDark = {
  background: '#1b1b1e',
  foreground: '#f8f8f2',
  cursor: '#f8f8f2',
  selectionBackground: '#3b3b40',
  black: '#1b1b1e',
  red: '#dc3545',
  green: '#198754',
  yellow: '#ffc107',
  blue: '#0d6efd',
  magenta: '#d63384',
  cyan: '#0dcaf0',
  white: '#f8f8f2'
};

const terminalLight = {
  background: '#ffffff',
  foreground: '#212529',
  cursor: '#212529',
  selectionBackground: '#e9ecef',
  black: '#212529',
  red: '#dc3545',
  green: '#198754',
  yellow: '#ffc107',
  blue: '#0d6efd',
  magenta: '#d63384',
  cyan: '#0dcaf0',
  white: '#ffffff'
};

// Initialize Terminal
terminal = new Terminal({
  theme: terminalDark,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontSize: 14,
  cursorBlink: true,
  disableStdin: false
});
fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);
terminal.open(terminalContainer);
fitAddon.fit();

window.addEventListener('resize', () => {
  fitAddon.fit();
});

// Theme Toggle
themebtn.addEventListener('click', () => {
  isDark = !isDark;
  if (isDark) {
    document.body.classList.remove('light-theme');
    sunIcon.classList.remove('hidden');
    moonIcon.classList.add('hidden');
    editor.dispatch({ effects: themeCompartment.reconfigure(dracula) });
    terminal.options.theme = terminalDark;
  } else {
    document.body.classList.add('light-theme');
    sunIcon.classList.add('hidden');
    moonIcon.classList.remove('hidden');
    editor.dispatch({ effects: themeCompartment.reconfigure(lightTheme) });
    terminal.options.theme = terminalLight;
  }
});

// Terminal Input Handling
terminal.onData(data => {
  if (!isWaitingForInput) return;
  
  if (data === '\r') {
    terminal.write('\r\n');
    isWaitingForInput = false;
    
    if (inputFlag && inputBuffer) {
      const enc = new TextEncoder().encode(currentInputLine);
      inputBuffer.fill(0);
      inputBuffer.set(enc.slice(0, 1023));
      
      Atomics.store(inputFlag, 0, 1);
      Atomics.notify(inputFlag, 0);
    } else {
        terminal.write('\x1b[31mError: SharedArrayBuffer not supported. Input failed.\x1b[0m\r\n');
    }
    currentInputLine = "";
  } 
  else if (data === '\x7f') {
    if (currentInputLine.length > 0) {
      currentInputLine = currentInputLine.slice(0, -1);
      terminal.write('\b \b');
    }
  } 
  else if (data >= String.fromCharCode(0x20) && data <= String.fromCharCode(0x7E)) {
    currentInputLine += data;
    terminal.write(data);
  }
});

// Resizable Divider
const divider = document.getElementById('divider');
const editorWrap = document.getElementById('editor-wrap');
let isDragging = false;

divider.addEventListener('mousedown', () => {
  isDragging = true;
  divider.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const containerWidth = document.getElementById('main').clientWidth;
  const pct = Math.min(Math.max((e.clientX / containerWidth) * 100, 10), 90);
  editorWrap.style.width = `${pct}%`;
  fitAddon.fit();
});

document.addEventListener('mouseup', () => {
  if (!isDragging) return;
  isDragging = false;
  divider.classList.remove('dragging');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  fitAddon.fit();
});

// Worker Management
function createWorker(loadModules) {
  if (worker) {
    worker.terminate();
  }
  
  worker = new Worker(new URL('./pyworker.js', import.meta.url), { type: 'classic' });
  
  worker.onmessage = (e) => {
    const data = e.data;
    
    switch (data.type) {
      case 'status':
        terminal.writeln(`\x1b[36m[${data.msg}]\x1b[0m`);
        break;
      case 'ready':
        playBtn.disabled = false;
        playBtn.classList.remove('disabled');
        terminal.writeln('\x1b[32m[Environment Ready. You can now run code.]\x1b[0m');
        break;
      case 'error':
        terminal.writeln(`\x1b[31m[Error] ${data.msg}\x1b[0m`);
        setRunningState(false);
        break;
      case 'stdout':
        const text = data.text.replace(/\n/g, '\r\n');
        if (data.isErr) {
          terminal.write(`\x1b[31m${text}\x1b[0m`);
        } else {
          terminal.write(text);
        }
        break;
      case 'plot':
        displayPlot(data.data);
        break;
      case 'formatted':
        formatBtn.disabled = false;
        formatBtn.textContent = "Format";
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: data.code } });
        showToast("Code formatted!");
        break;
      case 'format_error':
        formatBtn.disabled = false;
        formatBtn.textContent = "Format";
        showToast("Syntax error: Could not format");
        break;
      case 'shared_buffers':
        inputFlag = new Int32Array(data.flag);
        inputBuffer = new Uint8Array(data.buf);
        break;
      case 'input_request':
        isWaitingForInput = true;
        currentInputLine = "";
        break;
      case 'done':
        setRunningState(false);
        break;
    }
  };
  
  worker.postMessage({ type: 'init', loadModules });
}

function setRunningState(running) {
  isRunning = running;
  if (running) {
    playBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
  } else {
    playBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    isWaitingForInput = false;
  }
}

// Event Listeners
btnFull.addEventListener('click', () => {
  startupOverlay.classList.add('hidden');
  createWorker(true);
});

btnBase.addEventListener('click', () => {
  startupOverlay.classList.add('hidden');
  createWorker(false);
});

playBtn.addEventListener('click', () => {
  if (isRunning || playBtn.disabled) return;
  const code = editor.state.doc.toString();
  if (!code.trim()) return;
  
  terminal.clear();
  setRunningState(true);
  worker.postMessage({ type: 'run', code });
});

stopBtn.addEventListener('click', () => {
  if (!isRunning) return;
  terminal.writeln('\r\n\x1b[33m[Execution forcibly stopped by user. Reloading environment...]\x1b[0m');
  setRunningState(false);
  createWorker(false); 
});

clearBtn.addEventListener('click', () => {
  terminal.clear();
});

clearPlotBtn.addEventListener('click', () => {
  plotArea.innerHTML = '';
  plotAreaContainer.classList.add('hidden');
  fitAddon.fit();
});

const templates = {
  "data_science": "import pandas as pd\nimport matplotlib.pyplot as plt\n\n# Create sample data\ndata = {'Name': ['Alice', 'Bob'], 'Age': [25, 30]}\ndf = pd.DataFrame(data)\nprint(df)\n",
  "calculator": "def add(x, y):\n    return x + y\nprint(add(5, 3))",
  "api": "import urllib.request\nimport json\n\nurl = 'https://jsonplaceholder.typicode.com/todos/1'\nresponse = urllib.request.urlopen(url)\ndata = json.loads(response.read())\nprint('Todo Title:', data['title'])"
};

templateSelect.addEventListener('change', (e) => {
  const val = e.target.value;
  if (val && templates[val]) {
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: templates[val] } });
    e.target.value = ""; 
  }
});

uploadBtn.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: text }
  });
  showToast(`Loaded ${file.name}`);
  e.target.value = ''; 
});

formatBtn.addEventListener('click', () => {
  if (!worker) return showToast("Start the environment first!");
  formatBtn.disabled = true;
  formatBtn.textContent = "Formatting...";
  worker.postMessage({ type: 'format', code: editor.state.doc.toString() });
});

function displayPlot(b64) {
  plotAreaContainer.classList.remove('hidden');
  const img = document.createElement('img');
  img.src = "data:image/png;base64," + b64;
  plotArea.appendChild(img);
  fitAddon.fit();
}

saveBtn.addEventListener('click', () => {
  const code = editor.state.doc.toString();
  if (!code.trim()) {
    showToast("Nothing to save!");
    return;
  }
  
  const blob = new Blob([code], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "main.py";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  showToast("Saved as main.py");
});

shareBtn.addEventListener('click', async () => {
  const code = editor.state.doc.toString();
  if (!code.trim()) {
    showToast("Nothing to share!");
    return;
  }
  
  shareBtn.disabled = true;
  shareBtn.innerHTML = 'Sharing...';
  
  try {
    const res = await fetch('/api/share', {
      method: 'POST',
      body: code,
      headers: { 'Content-Type': 'text/plain' }
    });
    
    if (res.ok) {
      const data = await res.json();
      const url = `${window.location.origin}?id=${data.id}`;
      await navigator.clipboard.writeText(url);
      showToast("Link copied to clipboard!");
    } else {
      showToast("Failed to share code.");
    }
  } catch (err) {
    console.error(err);
    showToast("Error sharing code.");
  } finally {
    shareBtn.disabled = false;
    shareBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
      Share
    `;
  }
});

// Load shared code on boot
window.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (id) {
    try {
      const res = await fetch(`/api/code/${id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.code) {
          editor.dispatch({
            changes: { from: 0, to: editor.state.doc.length, insert: data.code }
          });
          showToast("Loaded shared code.");
        }
      }
    } catch(e) {
      console.error(e);
    }
  }
});

function updateSavedProjectsList() {
  loadLocalSelect.innerHTML = '<option value="">Load Saved...</option>';
  const saves = JSON.parse(localStorage.getItem('py_saves') || '{}');
  for (const name in saves) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    loadLocalSelect.appendChild(opt);
  }
}
updateSavedProjectsList();

saveLocalBtn.addEventListener('click', () => {
  const code = editor.state.doc.toString();
  if (!code.trim()) return showToast("Nothing to save!");
  const name = prompt("Enter a name for this project:");
  if (!name || !name.trim()) return;
  
  const saves = JSON.parse(localStorage.getItem('py_saves') || '{}');
  saves[name.trim()] = code;
  localStorage.setItem('py_saves', JSON.stringify(saves));
  updateSavedProjectsList();
  showToast(`Saved project: ${name}`);
});

loadLocalSelect.addEventListener('change', (e) => {
  const name = e.target.value;
  if (!name) return;
  const saves = JSON.parse(localStorage.getItem('py_saves') || '{}');
  if (saves[name]) {
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: saves[name] } });
    showToast(`Loaded ${name}`);
  }
  e.target.value = '';
});

let toastTimeout;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}
