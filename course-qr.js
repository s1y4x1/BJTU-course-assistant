(function setupCourseHeaderQr() {
  const HEADER_QR_TOOLTIP_ID = '__bjtu_header_qr_tooltip__';
  let headerTooltip = document.getElementById(HEADER_QR_TOOLTIP_ID);
  if (!headerTooltip) {
    headerTooltip = document.createElement('div');
    headerTooltip.id = HEADER_QR_TOOLTIP_ID;
    headerTooltip.style.cssText = 'position:fixed;z-index:99999;padding:10px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.18);display:none;flex-direction:column;align-items:center;gap:6px;pointer-events:none;';
    headerTooltip.innerHTML = '<div style="font-size:11px;color:#94a3b8;text-align:center;">扫描二维码查看课程列表</div><img style="display:block;width:160px;height:160px;image-rendering:pixelated;"><div class="__bjtu_header_qr_status" style="font-size:11px;color:#94a3b8;text-align:center;"></div>';
    document.body.appendChild(headerTooltip);
  }

  const headerQrImg = headerTooltip.querySelector('img');
  const headerQrStatus = headerTooltip.querySelector('.__bjtu_header_qr_status');
  window.__headerQrUrl = window.__headerQrUrl || '';
  let headerQrHideTimer = null;

  const showHeaderQr = (top, left) => {
    headerTooltip.style.display = 'flex';
    let tRect = headerTooltip.getBoundingClientRect();
    let l = left;
    let t = top + 12;
    if (l + tRect.width > window.innerWidth - 4) l = window.innerWidth - tRect.width - 4;
    if (t + tRect.height > window.innerHeight - 4) t = top - tRect.height - 4;
    if (l < 4) l = 4;
    if (t < 4) t = 4;
    headerTooltip.style.top = t + 'px';
    headerTooltip.style.left = l + 'px';
  };

  const getQrAttachmentHtml = (hw) => {
    const key = String(hw?.__attachmentKey || '').trim();
    if (!key) return '';
    const cache = window.homeworkNoteAttachmentCacheByKey?.[key] || null;
    const list = Array.isArray(cache?.picList) ? cache.picList : [];
    if (!list.length) return '';
    return list.map((it) => {
      const name = escapeHtml(it.fileNameNoExt || it.fileName || '附件');
      const url = String(it.url || '').trim();
      if (!url) return '';
      return `<div style="padding:4px 6px;border:1px solid #ff9800;border-radius:4px;background:#fff3e0;margin-top:4px;font-size:11px;"><strong>${name}</strong><br><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="font-size:11px;">${escapeHtml(url)}</a></div>`;
    }).filter(Boolean).join('');
  };

  const buildQrHomeworkItemHtml = (hw, type, courseId) => {
    const title = escapeHtml(hw.title || hw.workTitle || hw.courseNoteTitle || '作业');
    const deadline = escapeHtml(hw.end_time || hw.endTime || hw?.end || '无');
    const cls = type === 'overdue' ? 'hw-overdue' : type === 'done' ? 'hw-done' : 'hw-pending';
    const scoreHtml = type === 'done' && (hw.lastScore || hw.obtainedScore)
      ? `<span style="font-weight:bold;color:#e91e63;margin-left:5px;">[${escapeHtml(String(hw.lastScore || hw.obtainedScore || ''))}]</span>`
      : '';
    const rawContent = String(hw.content || hw.content_clean || hw.workContent || '').trim();
    const detailId = `qr-hw-detail-${courseId}-${String(hw.id || hw.noteId || hw.courseNoteId || hw.upId || '').replace(/[^a-zA-Z0-9_-]/g, '') || Math.random().toString(36).slice(2, 8)}`;
    const contentHtml = rawContent
      ? `<div class="hw-detail-content" id="${detailId}" style="display:none;margin-top:4px;padding:6px 8px;background:#fafafa;border-radius:4px;font-size:12px;color:#555;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow-y:auto;">${escapeHtml(rawContent)}</div>`
      : '';
    const attachmentHtml = getQrAttachmentHtml(hw);
    return `<div class="hw-item ${cls}" data-course-id="${escapeHtml(String(courseId))}">
      <div class="hw-title" style="cursor:pointer;" data-toggle-detail="${detailId}">${title}${scoreHtml} <span style="font-weight:normal;font-size:11px;color:#999;">[点击查看详情]</span></div>
      <div class="hw-deadline">截止: <strong>${deadline}</strong></div>
      ${contentHtml}
      ${attachmentHtml ? `<div style="margin-top:4px;">${attachmentHtml}</div>` : ''}
    </div>`;
  };

  const buildQrCourseListHtml = () => {
    const courses = window.currentVeCourseList || [];
    if (!courses.length) return '';

    const classifyItems = (items, isDoneFn, isOverdueFn) => {
      const pending = [], overdue = [], done = [];
      items.forEach((hw) => {
        if (isDoneFn(hw)) done.push(hw);
        else if (isOverdueFn(hw)) overdue.push(hw);
        else pending.push(hw);
      });
      return { pending, overdue, done };
    };

    const isYktOverdue = (hw) => !isYktHomeworkDone(hw) && isDeadlinePassed(hw?.end);
    const isMrzyOverdue = (hw) => !isMrzyHomeworkDone(hw) && isDeadlinePassed(hw?.end);
    const isJlgjOverdue = (hw) => !isJlgjHomeworkDone(hw) && isDeadlinePassed(hw?.end);

    let cardsHtml = '';
    courses.forEach((course) => {
      const courseId = course.id || course.cId || course.courseId || course.course_id;
      const courseName = course.name || course.NAME || course.courseName || '未知课程';
      const teacherName = course.teacher_name || course.teacherName || '';
      const courseNumRaw = course.course_num || course.courseNum || course.courseNo || course.course_id || courseId;
      const fzId = course.fz_id || course.fzId || course.xkhId || course.xkh_id || '';
      const courseKey = String(courseId || '');
      const coursePlatformUrl = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=toCoursePlatform&courseToPage=10460&courseId=${encodeURIComponent(courseNumRaw || '')}&cId=${encodeURIComponent(courseKey)}&xknId=${encodeURIComponent(fzId || '')}&xkhId=${encodeURIComponent(fzId || '')}`;

      const teacherMeta = window.veTeacherMetaByCourseId?.[courseKey];
      const teachers = teacherMeta?.teachers || [];
      const mainTeacher = teachers.find((t) => t.userType === '1') || teachers[0] || null;
      const displayTeacherName = escapeHtml(mainTeacher?.userName || teacherName || '教师');
      const otherTeachersHtml = teachers
        .filter((t) => t !== mainTeacher)
        .map((t) => `<div>${escapeHtml(t.userName || '-')} (${escapeHtml(t.userType === '1' ? '任课教师' : '助教')})</div>`)
        .join('');

      const cwCache = window.coursewareCacheByCourseId?.[courseKey];
      const cwItems = cwCache?.items || [];
      const cwHtml = cwItems.length
        ? cwItems.map((item) => {
            const name = escapeHtml(item.name || '课件');
            const url = item.url || '';
            const urlHtml = url
              ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(cleanRpUrl(url))}</a>`
              : '<span style="color:#999;">链接获取中…</span>';
            return `<div style="padding:6px 8px;border:1px solid #c8e6c9;border-radius:4px;background:#f1f8e9;margin-top:6px;"><div style="font-weight:bold;">${name}</div><div style="margin-top:2px;">${urlHtml}</div></div>`;
          }).join('')
        : '<span style="color:#999;">暂无课件资源</span>';

      const rpCache = window.videoReplayCacheByCourseId?.[courseKey];
      const rpList = rpCache?.list || [];
      let rpHtml;
      if (rpList.length) {
        rpHtml = rpList.map((item, i) => {
          const title = escapeHtml(`${item.roomName || ''} ${item.rpName || '未知时间'}`);
          let linkHtml = '';
          if (item.qrResolvedUrl) {
            linkHtml = `<a href="${escapeHtml(item.qrResolvedUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(cleanRpUrl(item.qrResolvedUrl))}</a>`;
          } else {
            const container = document.getElementById(`video-link-${courseKey}-${i}`);
            if (container && container.innerHTML) {
              linkHtml = container.innerHTML;
            } else {
              const eId = String(courseKey).replace(/["\\]/g, '');
              const shadowArea = document.querySelector(`.replay-shadow-area[data-course-id="${eId}"]`);
              if (shadowArea) {
                const sc = shadowArea.querySelector(`#video-link-${courseKey}-${i}`);
                if (sc && sc.innerHTML) linkHtml = sc.innerHTML;
              }
            }
            if (!linkHtml || linkHtml.includes('获取中') || linkHtml.includes('spinner')) {
              linkHtml = '<span style="color:#999;">链接获取中…</span>';
            }
          }
          return `<div style="padding:6px 8px;border:1px solid #ce93d8;border-radius:4px;background:#f3e5f5;margin-top:6px;"><div style="font-weight:bold;color:#4a148c;">${title}</div><div style="margin-top:2px;">${linkHtml}</div></div>`;
        }).join('');
      } else {
        rpHtml = '<span style="color:#999;">暂无回放资源</span>';
      }

      const hwList = window.courseHomeworkData?.[courseKey]?.list || [];
      const nativeCls = classifyItems(hwList, isNativeHomeworkDone, isNativeHomeworkOverdue);
      const yktItems = isPlatformEnabled('ykt') ? (window.yktMatchedHomeworkByCourseId?.[courseKey] || []) : [];
      const mrzyItems = isPlatformEnabled('mrzy') ? (window.mrzyMatchedHomeworkByCourseId?.[courseKey] || []) : [];
      const jlgjItems = isPlatformEnabled('jlgj') ? (window.jlgjMatchedHomeworkByCourseId?.[courseKey] || []) : [];
      const yktCls = classifyItems(yktItems, isYktHomeworkDone, isYktOverdue);
      const mrzyCls = classifyItems(mrzyItems, isMrzyHomeworkDone, isMrzyOverdue);
      const jlgjCls = classifyItems(jlgjItems, isJlgjHomeworkDone, isJlgjOverdue);

      const allPending = [...nativeCls.pending, ...yktCls.pending, ...mrzyCls.pending, ...jlgjCls.pending];
      const allOverdue = [...nativeCls.overdue, ...yktCls.overdue, ...mrzyCls.overdue, ...jlgjCls.overdue];
      const allDone = [...nativeCls.done, ...yktCls.done, ...mrzyCls.done, ...jlgjCls.done];

      const pendingHtml = allPending.map((hw) => buildQrHomeworkItemHtml(hw, 'pending', courseKey)).join('');
      const overdueHtml = allOverdue.map((hw) => buildQrHomeworkItemHtml(hw, 'overdue', courseKey)).join('');
      const doneHtml = allDone.map((hw) => buildQrHomeworkItemHtml(hw, 'done', courseKey)).join('');

      const cwId = `qr-cw-${courseKey}`;
      const rpId = `qr-rp-${courseKey}`;
      const overdueId = `qr-ov-${courseKey}`;
      const doneId = `qr-dn-${courseKey}`;

      const teacherSection = otherTeachersHtml
        ? `<span class="teacher-toggle">${displayTeacherName} ▼</span><div class="other-teachers">${otherTeachersHtml}</div>`
        : `<span>${displayTeacherName}</span>`;

      cardsHtml += `
        <div class="card">
          <div class="course-name"><a href="${escapeHtml(coursePlatformUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(courseName)}</a></div>
          <div class="teacher-row">${teacherSection}</div>
          <div class="actions">
            <button class="btn btn-cw" data-target="${cwId}" data-expand="课件下载" data-collapse="收起课件">课件下载</button>
            <button class="btn btn-rp" data-target="${rpId}" data-expand="回放下载" data-collapse="收起回放">回放下载</button>
          </div>
          <div class="content-area" id="${cwId}">${cwHtml}</div>
          <div class="content-area" id="${rpId}">${rpHtml}</div>
          <div class="hw-area">
            ${pendingHtml}
            ${allOverdue.length ? `<div class="hw-toggle-row"><button class="hw-toggle" data-target="${overdueId}" data-expand="查看逾期作业 (${allOverdue.length})" data-collapse="收起逾期作业 (${allOverdue.length})">查看逾期作业 (${allOverdue.length})</button></div><div class="hw-group" id="${overdueId}">${overdueHtml}</div>` : ''}
            ${allDone.length ? `<div class="hw-toggle-row"><button class="hw-toggle" data-target="${doneId}" data-expand="查看已交作业 (${allDone.length})" data-collapse="收起已交作业 (${allDone.length})">查看已交作业 (${allDone.length})</button></div><div class="hw-group" id="${doneId}">${doneHtml}</div>` : ''}
          </div>
        </div>`;
    });

    if (!cardsHtml) return '';

    const inlineCss = 'body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;padding:16px;max-width:800px;margin:0 auto;color:#333;background:#f5f5f5}.card{border:1px solid #e0e0e0;border-radius:8px;padding:12px;margin-bottom:12px;background:#fff}.course-name{font-size:16px;font-weight:bold}.course-name a{color:#1565c0;text-decoration:none}.teacher-row{font-size:12px;color:#666;margin:4px 0}.teacher-toggle{cursor:pointer;color:#1565c0;user-select:none}.other-teachers{display:none;margin-top:4px;padding:6px 10px;background:#f0f4ff;border-radius:4px;font-size:12px;color:#555}.actions{display:flex;gap:6px;margin-top:6px}.btn{cursor:pointer;padding:4px 10px;border:none;border-radius:4px;color:#fff;font-size:12px;user-select:none}.btn-cw{background:#1e3a8a}.btn-rp{background:#9C27B0}.content-area{display:none;margin-top:6px;padding-top:6px;border-top:1px dashed #eee;font-size:12px}.hw-area{margin-top:6px;padding-top:6px;border-top:1px dashed #eee;font-size:13px;color:#666}.hw-toggle-row{margin-bottom:4px}.hw-toggle{cursor:pointer;padding:4px 12px;border:1px solid #ccc;border-radius:4px;background:#f9f9f9;font-size:12px;margin-right:4px;user-select:none}.hw-group{display:none;margin-top:4px}.hw-item{padding:6px 8px;border-radius:6px;margin-top:6px;font-size:12px;overflow:hidden}.hw-title{font-weight:bold}.hw-deadline{color:#666;margin-top:2px}.hw-overdue{border:1px solid #ef4444;background:#ffebee}.hw-done{border:1px solid #4caf50;background:#e8f5e9}.hw-pending{border:1px solid #ff9800;background:#fff3e0}.hw-overdue .hw-title{color:#b91c1c}.hw-done .hw-title{color:#2e7d32}.hw-pending .hw-title{color:#e65100}.hw-detail-content{border:1px solid #e0e0e0}a{color:#1565c0;word-break:break-all;font-size:12px}';
    const inlineJs = 'document.addEventListener(\'click\',function(e){var t=e.target;if(t.classList.contains(\'teacher-toggle\')){var n=t.parentNode.querySelector(\'.other-teachers\');if(n){var s=n.style.display!==\'block\';n.style.display=s?\'block\':\'none\';t.textContent=t.textContent.replace(/[\\u25BC\\u25B2]/g,\'\')+(s?\' \\u25BC\':\' \\u25B2\')}return}if(t.classList.contains(\'btn-cw\')||t.classList.contains(\'btn-rp\')){var c=document.getElementById(t.dataset.target);if(c){var s=c.style.display!==\'block\';c.style.display=s?\'block\':\'none\';t.textContent=t.dataset[s?\'collapse\':\'expand\']}return}if(t.classList.contains(\'hw-toggle\')){var c=document.getElementById(t.dataset.target);if(c){var s=c.style.display!==\'block\';c.style.display=s?\'block\':\'none\';t.textContent=t.dataset[s?\'collapse\':\'expand\']}return}var d=t.dataset.toggleDetail;if(d){var e=document.getElementById(d);if(e){var s=e.style.display!==\'block\';e.style.display=s?\'block\':\'none\';var sp=t.querySelector(\'span\');if(sp)sp.textContent=s?\'[点击收起详情]\':\'[点击查看详情]\'}}})';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>课程列表</title>
<style>${inlineCss}</style>
</head>
<body>
${cardsHtml}
<script>${inlineJs}<\/script>
</body>
</html>`;
  };

  const waitForAllData = async (setStatus) => {
    const waitForCourseList = async () => {
      if (Array.isArray(window.currentVeCourseList) && window.currentVeCourseList.length) return true;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (Array.isArray(window.currentVeCourseList) && window.currentVeCourseList.length) return true;
      }
      return false;
    };

    if (!await waitForCourseList()) return false;

    setStatus('正在等待加载…');

    const courses = window.currentVeCourseList;
    const startTs = Date.now();
    const MAX_WAIT = 35000;

    const waitForCaches = () => {
      return courses.every((c) => {
        const cid = c.id || c.cId || c.courseId || c.course_id;
        if (!cid) return true;
        const cw = window.coursewareCacheByCourseId?.[cid];
        const rp = window.videoReplayCacheByCourseId?.[cid];
        return (!cw || cw.loaded === true) && (!rp || rp.loaded === true);
      });
    };

    while (Date.now() - startTs < MAX_WAIT) {
      if (waitForCaches()) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    const resolveCoursewareRpLinks = async () => {
      const promises = [];
      courses.forEach((c) => {
        const cid = c.id || c.cId || c.courseId || c.course_id;
        if (!cid) return;
        const cache = window.coursewareCacheByCourseId?.[cid];
        if (!cache?.items?.length) return;
        cache.items.forEach((item) => {
          if (!item.url && item.rpId) {
            promises.push((async () => {
              try {
                const result = await fetchCoursewareRpUrl(item.rpId);
                if (result?.url) item.url = result.url;
              } catch {}
            })());
          }
        });
      });
      await Promise.allSettled(promises);
    };

    const resolveReplayLinks = async () => {
      const promises = [];
      courses.forEach((c) => {
        const cid = c.id || c.cId || c.courseId || c.course_id;
        if (!cid) return;
        const cache = window.videoReplayCacheByCourseId?.[cid];
        if (!cache?.list?.length || cache.qrLinksResolved) return;
        const courseNum = String(c.course_num || c.courseNum || c.courseNo || c.course_id || cid || '').trim();
        const fzId = String(c.fz_id || c.fzId || c.xkhId || c.xkh_id || '').trim();
        cache.list.forEach((item, i) => {
          if (item.rpId && !item.qrResolvedUrl) {
            promises.push((async () => {
              try {
                const result = await fetchCoursewareRpUrl(item.rpId);
                if (result?.url) {
                  item.qrResolvedUrl = result.url;
                }
              } catch {}
            })());
          }
        });
        cache.qrLinksResolved = true;
      });
      await Promise.allSettled(promises);
    };

    await resolveCoursewareRpLinks();
    await resolveReplayLinks();

    const waitForAttachments = async () => {
      const keys = Object.keys(window.homeworkNoteAttachmentCacheByKey || {});
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const allDone = keys.every((k) => {
          const entry = window.homeworkNoteAttachmentCacheByKey[k];
          return entry && entry.loading === false && entry.loaded === true;
        });
        if (allDone) return;
        await new Promise((r) => setTimeout(r, 300));
      }
    };
    await waitForAttachments();

    return true;
  };

  const uploadCourseListAndShowQr = async (triggerEl) => {
    const setStatus = (text) => { if (headerQrStatus) headerQrStatus.textContent = text; };

    setStatus('正在等待加载…');
    const ready = await waitForAllData(setStatus);
    if (!ready) {
      setStatus('暂无课程内容');
      return;
    }

    const htmlContent = buildQrCourseListHtml();
    if (!htmlContent) {
      setStatus('暂无课程内容');
      return;
    }

    const jsid = (document.getElementById('jsessionid-input')?.value?.trim() || await getLocal('jsessionid', '')).trim();
    if (!jsid) {
      setStatus('请先登录');
      return;
    }

    setStatus('正在上传…');

    const file = new File([htmlContent], 'course-list.html', { type: 'text/html' });
    const fd = new FormData();
    fd.append('file', file);

    try {
      const url = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const uploadUrl = `${BASE}/ve/back/rp/common/rpUpload.shtml;jsessionid=${encodeURIComponent(jsid)}`;
        xhr.open('POST', uploadUrl, true);
        xhr.withCredentials = true;
        xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        xhr.setRequestHeader('Upgrade-Insecure-Requests', '1');
        xhr.onload = () => {
          if (xhr.status !== 200) { reject(new Error('上传失败 HTTP ' + xhr.status)); return; }
          try {
            const data = JSON.parse(xhr.responseText || '{}');
            if (!data.visitName) { reject(new Error('上传返回数据异常')); return; }
            resolve(convertVisitNameToUrl(data.visitName));
          } catch (e) { reject(new Error('解析响应失败')); }
        };
        xhr.onerror = () => reject(new Error('网络错误'));
        xhr.send(fd);
      });

      window.__headerQrUrl = url;
      setStatus('正在生成二维码…');
      await new Promise((r) => setTimeout(r, 50));
      try {
        headerQrImg.src = buildQrImageUrl(url, 160);
        setStatus('');
      } catch {
        setStatus('二维码生成失败');
      }
      const rect = triggerEl.getBoundingClientRect();
      showHeaderQr(rect.bottom, rect.left);
    } catch (err) {
      setStatus('上传失败: ' + (err.message || ''));
    }
  };

  const courseHeaderEl = document.querySelector('h2.course-header span');
  if (!courseHeaderEl) return;

  courseHeaderEl.addEventListener('mouseenter', () => {
    if (headerQrHideTimer) { clearTimeout(headerQrHideTimer); headerQrHideTimer = null; }
    if (!window.__headerQrUrl) {
      headerTooltip.style.display = 'flex';
      const rect = courseHeaderEl.getBoundingClientRect();
      showHeaderQr(rect.bottom, rect.left);
      headerQrImg.src = '';
      if (headerQrStatus) headerQrStatus.textContent = '正在等待加载…';
      uploadCourseListAndShowQr(courseHeaderEl);
      return;
    }
    try {
      headerQrImg.src = buildQrImageUrl(window.__headerQrUrl, 160);
    } catch { return; }
    if (headerQrStatus) headerQrStatus.textContent = '';
    const rect = courseHeaderEl.getBoundingClientRect();
    showHeaderQr(rect.bottom, rect.left);
  });

  courseHeaderEl.addEventListener('mouseleave', (e) => {
    if (headerQrHideTimer) { clearTimeout(headerQrHideTimer); }
    const toEl = e.relatedTarget;
    if (toEl && (courseHeaderEl.contains(toEl) || (headerTooltip.style.display !== 'none' && headerTooltip.contains(toEl)))) return;
    headerQrHideTimer = setTimeout(() => { headerTooltip.style.display = 'none'; }, 80);
  });

  window.addEventListener('scroll', () => { headerTooltip.style.display = 'none'; }, { passive: true });
  window.addEventListener('resize', () => { headerTooltip.style.display = 'none'; }, { passive: true });
})();
