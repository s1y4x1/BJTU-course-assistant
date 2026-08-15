(function initBjtuCaptchaOffscreen() {
  'use strict';

  let workerPromise = null;
  let recognitionQueue = Promise.resolve();

  const MIS_WASM_FILENAME = 'ort-wasm-simd.wasm';
  const MIS_CHARSET = [' ', '9', '5', '-', '7', '0', '2', '6', '1', '3', 'x', '8', '=', '4', '+'];
  const MIS_HEIGHT = 64;
  let misSessionPromise = null;

  async function readMisAsset(key) {
    if (!globalThis.BjtuMisAssets?.getMisAsset) {
      throw new Error('MIS 资源管理器未加载');
    }
    const record = await globalThis.BjtuMisAssets.getMisAsset(key);
    if (!record?.blob) {
      throw new Error(`MIS 验证码识别资源未安装：${key}`);
    }
    return record.blob;
  }

  function loadMisImageElement(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('验证码图片加载失败'));
      image.src = String(url || '');
    });
  }

  async function getMisSession() {
    if (!misSessionPromise) {
      misSessionPromise = (async () => {
        if (!globalThis.ort?.InferenceSession) throw new Error('ONNX Runtime 未加载');
        const [modelBlob, wasmBlob] = await Promise.all([
          readMisAsset('omis.onnx'),
          readMisAsset(MIS_WASM_FILENAME)
        ]);
        ort.env.wasm.wasmPaths = {
          [MIS_WASM_FILENAME]: URL.createObjectURL(wasmBlob)
        };
        ort.env.wasm.numThreads = 1;
        return ort.InferenceSession.create(new Uint8Array(await modelBlob.arrayBuffer()));
      })().catch((error) => {
        misSessionPromise = null;
        throw error;
      });
    }
    return misSessionPromise;
  }

  function evaluateMisExpression(expr) {
    const normalized = String(expr || '')
      .replace(/x/g, '*')
      .replace(/×/g, '*')
      .replace(/[^0-9+\-*]/g, '');
    if (!/^\d+([-+*]\d+)+$/.test(normalized)) return null;
    const tokens = normalized.match(/\d+|[+\-*]/g) || [];
    const numbers = [];
    const operators = [];
    const applyOperator = () => {
      const right = numbers.pop();
      const left = numbers.pop();
      const op = operators.pop();
      if (op === '+') numbers.push(left + right);
      else if (op === '-') numbers.push(left - right);
      else numbers.push(left * right);
    };
    const precedence = (op) => (op === '*' ? 2 : 1);
    tokens.forEach((token) => {
      if (/^\d+$/.test(token)) {
        numbers.push(parseInt(token, 10));
      } else {
        while (operators.length && precedence(operators[operators.length - 1]) >= precedence(token)) {
          applyOperator();
        }
        operators.push(token);
      }
    });
    while (operators.length) applyOperator();
    return numbers.length === 1 ? numbers[0] : null;
  }

  async function recognizeMisExpression(imageUrl) {
    const trace = [];
    const stage = (message) => {
      trace.push(message);
      console.log(`[bjtu-mis] ${message}`);
    };
    stage('offscreen：开始识别');
    const session = await getMisSession();
    stage('offscreen：ONNX Runtime 会话已创建');
    const image = await loadMisImageElement(imageUrl);
    stage(`offscreen：图片已加载（${image.width}×${image.height}）`);
    const width = Math.floor(image.width * MIS_HEIGHT / image.height) || 1;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = MIS_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建画布');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, MIS_HEIGHT);
    const pixels = context.getImageData(0, 0, width, MIS_HEIGHT).data;
    const input = new Float32Array(MIS_HEIGHT * width);
    for (let row = 0; row < MIS_HEIGHT; row += 1) {
      for (let col = 0; col < width; col += 1) {
        const base = (row * width + col) * 4;
        const gray = (pixels[base] + pixels[base + 1] + pixels[base + 2]) / 3;
        input[row * width + col] = (gray / 255 - 0.456) / 0.224;
      }
    }
    const tensor = new ort.Tensor('float32', input, [1, 1, MIS_HEIGHT, width]);
    const output = await session.run({ input1: tensor });
    stage(`offscreen：模型推理完成（${width} 列）`);
    const indices = Array.from(output.output.data);
    let previous = 0;
    let recognized = '';
    indices.forEach((value) => {
      if (value === 0 || value === previous) return;
      previous = value;
      const char = MIS_CHARSET[value];
      if (char) recognized += char;
    });
    stage(`offscreen：识别字符串="${recognized}"`);
    const expression = String(recognized || '').split('=')[0].replace('x', '*').replace(' ', '').trim();
    const answer = evaluateMisExpression(expression);
    if (answer === null) {
      return {
        ok: false,
        message: `未能解析算式（识别结果：${recognized || '空'}）`,
        raw: recognized,
        trace
      };
    }
    stage(`offscreen：算式=${expression}，结果=${answer}`);
    return { ok: true, expression, answer, raw: recognized, trace };
  }

  async function recognizePasscode(imageUrl, modelVersion) {
    const result = await (await getWorker(modelVersion)).recognize(String(imageUrl || ''));
    const recognized = String(result?.data?.text || '').trim();
    const passcode = recognized.replace(/\D/g, '');
    return passcode.length === 4
      ? { ok: true, passcode }
      : {
          ok: false,
          message: recognized
            ? `未能识别出 4 位数字（识别结果：${recognized}）`
            : '未能识别出 4 位数字（识别结果为空）'
        };
  }

  async function getWorker(modelVersion) {
    if (workerPromise) return workerPromise;
    workerPromise = (async () => {
      if (!globalThis.Tesseract?.createWorker) throw new Error('Tesseract 未加载');
      const version = String(modelVersion || '').trim();
      if (!version) throw new Error('验证码识别模型版本为空');
      const options = {
        logger: () => {},
        workerPath: chrome.runtime.getURL('modules/captcha/worker.js'),
        corePath: chrome.runtime.getURL('modules/captcha/vendor/tesseract-core-simd.wasm.js'),
        langPath: chrome.runtime.getURL(`__captcha_model__/${encodeURIComponent(version)}`),
        cacheMethod: 'none',
        workerBlobURL: false
      };
      const worker = await globalThis.Tesseract.createWorker('eng', 1, options);
      await worker.setParameters?.({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: '7'
      });
      return worker;
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
    return workerPromise;
  }

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'VE_CAPTCHA_OFFSCREEN_PING') {
      sendResponse({ ok: true, ready: true });
      return false;
    }
    if (message?.type !== 'VE_CAPTCHA_RECOGNIZE_LOCAL'
        && message?.type !== 'MIS_CAPTCHA_RECOGNIZE_LOCAL') return false;
    const task = recognitionQueue.catch(() => {}).then(
      () => (message.type === 'VE_CAPTCHA_RECOGNIZE_LOCAL'
        ? recognizePasscode(String(message.imageUrl || ''), message.modelVersion)
        : recognizeMisExpression(String(message.imageUrl || '')))
    );
    recognitionQueue = task.then(() => undefined, () => undefined);
    task.then(sendResponse).catch((error) => {
      const messageText = String(error?.message || error || '本地验证码识别失败');
      console.error('[bjtu] local captcha recognition failed:', error);
      sendResponse({ ok: false, message: messageText });
    });
    return true;
  });
})();
