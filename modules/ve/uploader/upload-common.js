(function initVeUploadCommon(global) {
  'use strict';

  const extensions = Object.freeze([
    'ppt', 'pptx', 'doc', 'docx', 'pdf', 'txt', 'xls', 'xlsx',
    'jpg', 'jpeg', 'png', 'bmp', 'gif',
    'mp3', 'mp4', 'avi', 'wmv', 'mov', 'rmvb', 'flv', 'f4v',
    'rar', 'zip'
  ]);
  const extensionSet = new Set(extensions);
  const fileHashes = new WeakMap();
  const zippedFiles = new WeakMap();
  const crcTable = Uint32Array.from({length:256},(_,index) => {
    let value = index;
    for (let bit=0;bit<8;bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  function zipFile(file) {
    if (!zippedFiles.has(file)) zippedFiles.set(file, createZip(file).catch(error => {
      zippedFiles.delete(file); throw error;
    }));
    return zippedFiles.get(file);
  }
  async function createZip(file) {
    if (file.size > 0xffffffff) throw new Error('暂不支持压缩超过 4 GB 的单个文件。');
    const name = String(file.name || 'file').replace(/\\/g,'/').split('/').pop();
    const encodedName = new TextEncoder().encode(name);
    if (encodedName.length > 65535) throw new Error('文件名过长，无法压缩。');
    let crc = 0xffffffff;
    const input = file.stream().pipeThrough(new TransformStream({transform(chunk,controller) {
      for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
      controller.enqueue(chunk);
    }}));
    const compressed = await new Response(input.pipeThrough(new CompressionStream('deflate-raw'))).blob();
    if (compressed.size > 0xffffffff) throw new Error('压缩结果过大。');
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = new Uint8Array(30 + encodedName.length), central = new Uint8Array(46 + encodedName.length), end = new Uint8Array(22);
    const lv = new DataView(local.buffer), cv = new DataView(central.buffer), ev = new DataView(end.buffer);
    lv.setUint32(0,0x04034b50,true); lv.setUint16(4,20,true); lv.setUint16(6,0x800,true); lv.setUint16(8,8,true);
    // Fixed timestamps make the same file produce the same ZIP and SHA.
    lv.setUint16(12,0x21,true); lv.setUint32(14,crc,true); lv.setUint32(18,compressed.size,true); lv.setUint32(22,file.size,true); lv.setUint16(26,encodedName.length,true); local.set(encodedName,30);
    cv.setUint32(0,0x02014b50,true); cv.setUint16(4,20,true); cv.setUint16(6,20,true); cv.setUint16(8,0x800,true); cv.setUint16(10,8,true);
    cv.setUint16(14,0x21,true); cv.setUint32(16,crc,true); cv.setUint32(20,compressed.size,true); cv.setUint32(24,file.size,true); cv.setUint16(28,encodedName.length,true); central.set(encodedName,46);
    ev.setUint32(0,0x06054b50,true); ev.setUint16(8,1,true); ev.setUint16(10,1,true); ev.setUint32(12,central.length,true); ev.setUint32(16,local.length+compressed.size,true);
    return new File([local,compressed,central,end],`${name.replace(/\.[^.]+$/,'') || name}.zip`,{type:'application/zip',lastModified:0});
  }

  function fileHash(file) {
    if (!fileHashes.has(file)) {
      const pending = file.arrayBuffer()
        .then((buffer) => global.crypto.subtle.digest('SHA-256', buffer))
        .then((digest) => Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''))
        .catch((error) => {
          fileHashes.delete(file);
          throw error;
        });
      fileHashes.set(file, pending);
    }
    return fileHashes.get(file);
  }

  function fileExtension(file) {
    const name = String(file?.name || '').replace(/\\/g, '/').split('/').pop() || '';
    const index = name.lastIndexOf('.');
    return index > 0 && index < name.length - 1 ? name.slice(index + 1).toLowerCase() : '';
  }

  function confirmUnsupportedFiles(files) {
    const unsupported = Array.from(files || []).filter((file) => !extensionSet.has(fileExtension(file)));
    if (!unsupported.length) return true;
    const shownNames = unsupported.slice(0, 12).map((file) => `• ${String(file?.name || '(未命名文件)')}`);
    if (unsupported.length > shownNames.length) shownNames.push(`• 以及另外 ${unsupported.length - shownNames.length} 个文件`);
    return global.confirm([
      '以下文件的后缀不在智慧课程平台支持范围内：', '', ...shownNames, '',
      `支持的后缀：${extensions.join('、')}`, '',
      '平台可能拒绝或无法正常使用这些文件，是否仍继续上传？'
    ].join('\n'));
  }

  function uploadUrl(roleName, jsessionid = '') {
    const base = 'http://123.121.147.7:88/ve/back/rp/common/';
    if (!/教师|老师|助教/.test(String(roleName || ''))) return `${base}homeworkUpload.shtml?noteId=1`;
    return `${base}rpUpload.shtml${jsessionid ? `;jsessionid=${encodeURIComponent(jsessionid)}` : ''}`;
  }

  function fileListItem(item) {
    const visitName = String(item?.visitName || '').trim();
    if (!visitName) return null;
    const name = String(item?.fileName || '').trim();
    const index = name.lastIndexOf('.');
    const hasExtension = index > 0 && index < name.length - 1;
    const fileNameNoExt = hasExtension ? name.slice(0, index) : name;
    const fileExtName = hasExtension ? name.slice(index + 1) : '';
    return {
      fileNameNoExt: encodeURIComponent(fileNameNoExt),
      fileExtName,
      fileSize: String(Math.max(0, Number(item?.fileSize || 0) || 0)),
      visitName,
      pid: '',
      ftype: 'insert'
    };
  }

  function downloadUrl(visitName) {
    const path = String(visitName || '').trim().replace(/^W:\\Root\\?/i, '').replace(/\\/g, '/').replace(/^\/+/, '');
    return path ? `http://123.121.147.7:8081/${path}` : '';
  }

  function clipboardFiles(data) {
    if (global.BjtuClipboardFiles) return global.BjtuClipboardFiles.clipboardFiles(data);
    const files = Array.from(data?.files || []);
    if (files.length) return files;
    return Array.from(data?.items || [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile()).filter(Boolean);
  }

  async function readClipboardFiles() {
    if (!global.BjtuClipboardFiles?.read) throw new Error('剪贴板读取组件未加载。');
    return global.BjtuClipboardFiles.read();
  }

  global.BjtuVeUploadCommon = Object.freeze({
    extensions,
    accept: extensions.map((extension) => `.${extension}`).join(','),
    fileExtension,
    fileHash,
    zipFile,
    confirmUnsupportedFiles,
    uploadUrl,
    fileListItem,
    downloadUrl,
    clipboardFiles,
    readClipboardFiles
  });
})(globalThis);
