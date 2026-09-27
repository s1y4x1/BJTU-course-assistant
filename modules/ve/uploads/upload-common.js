(function initVeUploadCommon(global) {
  'use strict';

  const extensions = Object.freeze([
    'ppt', 'pptx', 'doc', 'docx', 'pdf', 'txt', 'xls', 'xlsx',
    'jpg', 'jpeg', 'png', 'bmp', 'gif',
    'mp3', 'mp4', 'avi', 'wmv', 'mov', 'rmvb', 'flv', 'f4v',
    'rar', 'zip'
  ]);
  const extensionSet = new Set(extensions);

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

  global.BjtuVeUploadCommon = Object.freeze({
    extensions,
    accept: extensions.map((extension) => `.${extension}`).join(','),
    fileExtension,
    confirmUnsupportedFiles,
    uploadUrl,
    fileListItem,
    downloadUrl
  });
})(globalThis);
