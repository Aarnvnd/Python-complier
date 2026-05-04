importScripts("https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js");

let pyodide;
let inputBuffer = null;
let inputFlag = null;

async function initPyodide(loadModules) {
    try {
        postMessage({ type: 'status', msg: 'Loading Pyodide core...' });
        pyodide = await loadPyodide();
        
        if (loadModules) {
            postMessage({ type: 'status', msg: 'Loading extended modules...' });
            const modules = ["numpy", "pandas", "matplotlib", "scipy", "sympy", "pillow", "regex"];
            for (let i = 0; i < modules.length; i++) {
                postMessage({ type: 'status', msg: `Loading ${modules[i]} (${i+1}/${modules.length})...` });
                try {
                    await pyodide.loadPackage(modules[i]);
                } catch(e) {
                    console.warn(`Failed to load ${modules[i]}`, e);
                }
            }
        }

        // Setup custom stdout/stderr and matplotlib
        pyodide.runPython(`
import sys
import js

class _Out:
    def __init__(self, is_err): self.is_err = is_err
    def write(self, s):
        if s: js.postMessage(js.Object.fromEntries([("type", "stdout"), ("text", s), ("isErr", self.is_err)]))
    def flush(self): pass

sys.stdout = _Out(False)
sys.stderr = _Out(True)

def _input(prompt=""):
    if prompt:
        js.postMessage(js.Object.fromEntries([("type", "stdout"), ("text", prompt), ("isErr", False)]))
    
    # Send input request to main thread
    js.postMessage(js.Object.fromEntries([("type", "input_request")]))
    
    # Wait for main thread to fill the buffer and set the flag
    js.wait_for_input()
    return js.read_input_buffer()

import builtins
builtins.input = _input

try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    def _show_inline(*a, **kw):
        import io, base64
        buf = io.BytesIO()
        plt.savefig(buf, format='png', bbox_inches='tight')
        buf.seek(0)
        b64 = base64.b64encode(buf.read()).decode()
        js.postMessage(js.Object.fromEntries([("type", "plot"), ("data", b64)]))
        plt.clf()
    plt.show = _show_inline
except ImportError:
    pass # matplotlib not loaded
`);

        postMessage({ type: 'ready' });
    } catch (err) {
        postMessage({ type: 'error', msg: err.toString() });
    }
}

// Functions exposed to Python for reading input
self.wait_for_input = function() {
    if (!inputFlag) {
        throw new Error("SharedArrayBuffer not supported in this environment. Cannot use input().");
    }
    // Wait until flag is set to 1
    Atomics.wait(inputFlag, 0, 0);
};

self.read_input_buffer = function() {
    if (!inputBuffer) return "";
    let len = inputBuffer.indexOf(0);
    if (len === -1) len = inputBuffer.length;
    const str = new TextDecoder().decode(inputBuffer.slice(0, len));
    // Reset flag for next time
    Atomics.store(inputFlag, 0, 0);
    return str;
};

self.onmessage = async function(e) {
    const data = e.data;
    
    if (data.type === 'init') {
        // Setup shared memory for input if supported
        if (typeof SharedArrayBuffer !== 'undefined') {
            const sabFlag = new SharedArrayBuffer(4);
            const sabBuf = new SharedArrayBuffer(1024);
            inputFlag = new Int32Array(sabFlag);
            inputBuffer = new Uint8Array(sabBuf);
            postMessage({ type: 'shared_buffers', flag: sabFlag, buf: sabBuf });
        } else {
            console.warn("SharedArrayBuffer is not available. input() will fail.");
        }
        await initPyodide(data.loadModules);
    } 
    else if (data.type === 'run') {
        if (!pyodide) {
            postMessage({ type: 'error', msg: 'Pyodide is not initialized yet.' });
            return;
        }
        try {
            await pyodide.runPythonAsync(data.code);
            postMessage({ type: 'done' });
        } catch (err) {
            postMessage({ type: 'stdout', text: err.toString(), isErr: true });
            postMessage({ type: 'done' });
        }
    }
};
