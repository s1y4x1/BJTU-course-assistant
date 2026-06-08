(async function setupCourseHeaderQr() {
  try {
    const { headerQrEnabled } = await chrome.storage.local.get(['headerQrEnabled']);
    if (headerQrEnabled === false) return;
  } catch {
    // allow on error (non-extension context)
  }
  const HEADER_QR_TOOLTIP_ID = '__bjtu_header_qr_tooltip__';
  let headerTooltip = document.getElementById(HEADER_QR_TOOLTIP_ID);
  if (!headerTooltip) {
    headerTooltip = document.createElement('div');
    headerTooltip.id = HEADER_QR_TOOLTIP_ID;
    headerTooltip.style.cssText = 'position:fixed;z-index:99999;padding:10px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.18);display:none;flex-direction:column;align-items:center;gap:6px;pointer-events:none;';
    headerTooltip.innerHTML = '<div style="font-size:11px;color:#94a3b8;text-align:center;">扫描二维码查看课程列表</div><div class="__qr_img_wrap" style="position:relative;width:160px;height:160px;"><div class="__qr_spinner" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;"><div style="width:36px;height:36px;border:4px solid #e0e0e0;border-top-color:#1565c0;border-radius:50%;animation:__qr_spin .8s linear infinite;"></div></div><img style="display:none;width:160px;height:160px;image-rendering:pixelated;"></div><div class="__bjtu_header_qr_status" style="font-size:11px;color:#94a3b8;text-align:center;"></div>';
    document.body.appendChild(headerTooltip);
  }

  const headerQrImg = headerTooltip.querySelector('img');
  const headerQrStatus = headerTooltip.querySelector('.__bjtu_header_qr_status');
  const headerQrSpinner = headerTooltip.querySelector('.__qr_spinner');
  window.__headerQrUrl = window.__headerQrUrl || '';
  let headerQrHideTimer = null;

  try {
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.platformEnabled) {
        window.__headerQrUrl = '';
        window.__sectionQrCache = {};
      }
    });
  } catch {}

  const qrStyle = document.createElement('style');
  qrStyle.textContent = '@keyframes __qr_spin{to{transform:rotate(360deg)}}';
  document.head.appendChild(qrStyle);

  const showQrLoading = () => {
    if (headerQrSpinner) headerQrSpinner.style.display = 'flex';
    if (headerQrImg) headerQrImg.style.display = 'none';
  };
  const hideQrLoading = () => {
    if (headerQrSpinner) headerQrSpinner.style.display = 'none';
    if (headerQrImg) headerQrImg.style.display = 'block';
  };

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

  // ─── HTML generators ───

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

  const buildQrHomeworkItemHtml = (hw, type, courseId, platform = 've') => {
    const title = escapeHtml(hw.title || hw.workTitle || hw.courseNoteTitle || '作业');
    const deadline = escapeHtml(hw.end_time || hw.endTime || hw?.end || '无');
    const cls = type === 'overdue' ? 'hw-overdue' : type === 'done' ? 'hw-done' : 'hw-pending';

    // Score extraction per-platform
    let finalObtained = '', finalFull = '';
    if (platform === 'ykt') {
      if (hw.score != null && hw.score !== '') {
        finalObtained = String(hw.score);
        finalFull = hw.total_score != null ? String(hw.total_score) : '';
      } else {
        const problemResults = Array.isArray(hw.problem_results) ? hw.problem_results : [];
        const sumGot = problemResults.reduce((s, pr) => s + (Number(pr?.problem_result?.score) || 0), 0);
        const sumFull = problemResults.reduce((s, pr) => s + (Number(pr?.score) || 0), 0);
        if (sumGot > 0 || sumFull > 0) {
          finalObtained = String(sumGot);
          finalFull = sumFull > 0 ? String(sumFull) : '';
        }
      }
    } else {
      const upId = hw.id ?? hw.upId ?? hw.upid ?? hw.UPID ?? hw.up_id ?? hw.noteId ?? '';
      const snId = hw.snId ?? hw.snid ?? hw.SNID ?? hw.noteSnId ?? hw.note_sn_id ?? hw.sn ?? '';
      const scoreKey = upId && snId ? `${String(upId).trim()}|${String(snId).trim()}` : '';
      const cachedScore = scoreKey ? window.homeworkScoreCacheByKey?.[scoreKey] : undefined;
      const rawObtained = hw.lastScore ?? hw.obtainedScore ?? hw.oldScore ?? hw.finalScore ?? '';
      const rawFull = hw.fullScore ?? hw.maxScore ?? hw.totalScore ?? hw.score ?? '';
      finalObtained = cachedScore !== undefined && cachedScore !== null ? String(cachedScore) : (rawObtained || '');
      finalFull = rawFull || '';
    }

    const scoreText = finalObtained ? `${finalObtained}${finalFull ? '/' + finalFull : ''}` : '';
    const scoreHtml = type === 'done' && scoreText
      ? `<span style="font-weight:bold;color:#e91e63;margin-left:5px;">[${escapeHtml(scoreText)}]</span>`
      : '';

    const rawContent = String(hw.content || hw.content_clean || hw.workContent || '').trim();
    const detailId = `qr-hw-detail-${courseId}-${String(hw.id || hw.noteId || hw.courseNoteId || hw.upId || '').replace(/[^a-zA-Z0-9_-]/g, '') || Math.random().toString(36).slice(2, 8)}`;
    const contentHtml = rawContent
      ? `<div class="hw-detail-content" id="${detailId}" style="display:none;margin-top:4px;padding:6px 8px;background:#fafafa;border-radius:4px;font-size:12px;color:#555;word-break:break-all;max-height:200px;overflow-y:auto;">${normalizeHomeworkContent(rawContent)}</div>`
      : '';
    const attachmentHtml = getQrAttachmentHtml(hw);

    return `<div class="hw-item ${cls}" data-toggle-detail="${detailId}">
      <div class="hw-title">${title}${scoreHtml} <span data-detail-toggle style="font-weight:normal;font-size:11px;color:#999;">[点击查看详情]</span></div>
      <div class="hw-deadline">截止: <strong>${deadline}</strong></div>
      ${contentHtml}
      ${attachmentHtml ? `<div style="margin-top:4px;">${attachmentHtml}</div>` : ''}
    </div>`;
  };

  const buildQrCourseListHtml = () => {
    const veCourseList = window.currentVeCourseList || [];
    const yktStandalone = (window.yktStandaloneCourses || []).map((sc, i) => ({ sc, platform: 'ykt', index: i }));
    const mrzyStandalone = (window.mrzyStandaloneCourses || []).map((sc, i) => ({ sc, platform: 'mrzy', index: i }));
    const jlgjStandalone = (window.jlgjStandaloneCourses || []).map((sc, i) => ({ sc, platform: 'jlgj', index: i }));
    const standaloneMeta = [...yktStandalone, ...mrzyStandalone, ...jlgjStandalone];
    const getStandaloneCourseId = (sc, platform, index = 0) => {
      if (platform === 'ykt') return `ykt-${String(sc?.classroom_id || index)}`;
      if (platform === 'mrzy') return `mrzy-${String(sc?.classNum || index)}`;
      if (platform === 'jlgj') return `jlgj-${String(sc?.groupId || index)}`;
      return `${platform}-${String(index)}`;
    };
    const makeStandaloneCourse = (sc, platform, index = 0, explicitId = '') => ({
      id: explicitId || getStandaloneCourseId(sc, platform, index),
      name: sc.course_name || sc.name || sc.divClass || `${platform}课程`,
      divClass: sc.divClass || '',
      classNum: sc.classNum || '',
      teacher_name: sc.teacher_name || sc.teacherName || '',
      teacherName: sc.teacherName || sc.teacher_name || '',
      _standalone: true,
      _platform: platform,
      _homeworkList: Array.isArray(sc.homeworks) ? sc.homeworks : [],
      loadingMeta: !!sc.loadingMeta,
      ...(sc.classroom_id ? { classroom_id: sc.classroom_id } : {}),
      ...(sc.groupId ? { groupId: sc.groupId } : {})
    });

    const cards = document.querySelectorAll('#courseListDiv .file-item[id^="course-"]') || [];
    const veMap = {};
    veCourseList.forEach((c) => { const cid = String(c.id || c.cId || c.courseId || c.course_id || ''); if (cid) veMap[cid] = c; });
    const standaloneMap = {};
    standaloneMeta.forEach(({ sc, platform, index }) => {
      const cid = getStandaloneCourseId(sc, platform, index);
      standaloneMap[cid] = { sc, platform, cid, index };
    });

    let allCourses = [];
    cards.forEach((card) => {
      const cardCourseId = card?.dataset?.courseId || (card.id && card.id.replace(/^course-/, '')) || '';
      if (!cardCourseId) return;
      if (veMap[cardCourseId]) { allCourses.push(veMap[cardCourseId]); delete veMap[cardCourseId]; return; }
      if (standaloneMap[cardCourseId]) {
        const { sc, platform, index } = standaloneMap[cardCourseId];
        allCourses.push(makeStandaloneCourse(sc, platform, index, cardCourseId));
        delete standaloneMap[cardCourseId];
        return;
      }
    });

    if (!allCourses.length) {
      allCourses = [
        ...veCourseList.map((c) => c),
        ...standaloneMeta.map(({ sc, platform, index }) => makeStandaloneCourse(sc, platform, index))
      ];
    } else {
      Object.values(veMap).forEach((c) => allCourses.push(c));
      Object.values(standaloneMap).forEach(({ sc, platform, cid, index }) => {
        allCourses.push(makeStandaloneCourse(sc, platform, index, cid));
      });
    }

    if (!allCourses.length) return '';

    // ─── Sort per RULES.md ───
    const computeDeadlineMs = (hw) => {
      const t = hw.end_time || hw.endTime || hw?.end || '';
      const ts = new Date(t).getTime();
      return isNaN(ts) ? Infinity : ts;
    };
    const classifyItems = (items, isDoneFn, isOverdueFn) => {
      const pending = [], overdue = [], done = [];
      items.forEach((hw) => { if (isDoneFn(hw)) done.push(hw); else if (isOverdueFn(hw)) overdue.push(hw); else pending.push(hw); });
      return { pending, overdue, done };
    };
    const isYktOverdue = (hw) => !isYktHomeworkDone(hw) && isDeadlinePassed(hw?.end);
    const isMrzyOverdue = (hw) => !isMrzyHomeworkDone(hw) && isDeadlinePassed(hw?.end);
    const isJlgjOverdue = (hw) => !isJlgjHomeworkDone(hw) && isDeadlinePassed(hw?.end);

    allCourses.forEach((course) => {
      const courseKey = String(course.id || course.cId || course.courseId || course.course_id || '');
      const isS = course._standalone;
      const platform = course._platform || 've';
      const hwList = isS ? (course._homeworkList || []) : (window.courseHomeworkData?.[courseKey]?.list || []);

      let allNative, allYkt, allMrzy, allJlgj;
      if (isS) {
        const empty = { items: [], doneFn: () => false, overdueFn: () => false };
        allNative = allMrzy = allJlgj = empty;
        if (platform === 'ykt') allYkt = { items: hwList, doneFn: isYktHomeworkDone, overdueFn: isYktOverdue };
        else if (platform === 'mrzy') allMrzy = { items: hwList, doneFn: isMrzyHomeworkDone, overdueFn: isMrzyOverdue };
        else allJlgj = { items: hwList, doneFn: isJlgjHomeworkDone, overdueFn: isJlgjOverdue };
      } else {
        allNative = { items: hwList, doneFn: isNativeHomeworkDone, overdueFn: isNativeHomeworkOverdue };
        allYkt = isPlatformEnabled('ykt') ? { items: window.yktMatchedHomeworkByCourseId?.[courseKey] || [], doneFn: isYktHomeworkDone, overdueFn: isYktOverdue } : { items: [], doneFn: () => false, overdueFn: () => false };
        allMrzy = isPlatformEnabled('mrzy') ? { items: window.mrzyMatchedHomeworkByCourseId?.[courseKey] || [], doneFn: isMrzyHomeworkDone, overdueFn: isMrzyOverdue } : { items: [], doneFn: () => false, overdueFn: () => false };
        allJlgj = isPlatformEnabled('jlgj') ? { items: window.jlgjMatchedHomeworkByCourseId?.[courseKey] || [], doneFn: isJlgjHomeworkDone, overdueFn: isJlgjOverdue } : { items: [], doneFn: () => false, overdueFn: () => false };
      }

      const cl = (cfg) => classifyItems(cfg.items, cfg.doneFn, cfg.overdueFn);
      const allPending = [...cl(allNative).pending, ...cl(allYkt).pending, ...cl(allMrzy).pending, ...cl(allJlgj).pending];
      const allOverdue = [...cl(allNative).overdue, ...cl(allYkt).overdue, ...cl(allMrzy).overdue, ...cl(allJlgj).overdue];
      const allDone = [...cl(allNative).done, ...cl(allYkt).done, ...cl(allMrzy).done, ...cl(allJlgj).done];

      let primaryGroup = 3;
      if (allPending.length > 0) primaryGroup = 0;
      else if (allOverdue.length > 0) primaryGroup = 1;
      else if (allDone.length > 0) primaryGroup = 2;

      const earliestDeadline = allPending.length > 0 ? Math.min(...allPending.map(computeDeadlineMs)) : Infinity;
      const hasReplay = !isS && (window.videoReplayCacheByCourseId?.[courseKey]?.list?.length > 0);
      const hasCourseware = !isS && (window.coursewareCacheByCourseId?.[courseKey]?.items?.length > 0);
      course._qrSort = { primaryGroup, earliestDeadline, hasReplay, hasCourseware };
    });

    allCourses.sort((a, b) => {
      const sa = a._qrSort, sb = b._qrSort;
      if (sa.primaryGroup !== sb.primaryGroup) return sa.primaryGroup - sb.primaryGroup;
      if (sa.primaryGroup === 0 && sa.earliestDeadline !== sb.earliestDeadline) return sa.earliestDeadline - sb.earliestDeadline;
      if (sa.hasReplay !== sb.hasReplay) return (sb.hasReplay ? 1 : 0) - (sa.hasReplay ? 1 : 0);
      if (sa.hasCourseware !== sb.hasCourseware) return (sb.hasCourseware ? 1 : 0) - (sa.hasCourseware ? 1 : 0);
      return 0;
    });

    // ─── Build cards ───
    let cardsHtml = '';
    allCourses.forEach((course) => {
      const courseId = course.id || course.cId || course.courseId || course.course_id;
      const courseName = course.course_name || course.name || course.divClass || course.NAME || course.courseName || '未知课程';
      const teacherName = course.teacher_name || course.teacherName || '';
      const courseKey = String(courseId || '');
      const isS = course._standalone;
      const platform = course._platform || 've';

      const coursePlatformUrl = isS
        ? (platform === 'ykt' ? yktCourseLink(course.classroom_id || '') :
           platform === 'mrzy' ? `${MRZY_WEB_BASE}/` :
           platform === 'jlgj' ? `${JLGJ_WEB_BASE}` : '#')
        : `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=toCoursePlatform&courseToPage=10460&courseId=${encodeURIComponent(course.course_num || course.courseNum || course.courseNo || course.course_id || courseId || '')}&cId=${encodeURIComponent(courseKey)}&xknId=${encodeURIComponent(course.fz_id || course.fzId || course.xkhId || course.xkh_id || '')}&xkhId=${encodeURIComponent(course.fz_id || course.fzId || course.xkhId || course.xkh_id || '')}`;

      let displayTeacherName = escapeHtml(teacherName || '教师');
      let otherTeachersHtml = '';
      if (!isS) {
        const teacherMeta = window.veTeacherMetaByCourseId?.[courseKey];
        const teachers = teacherMeta?.teachers || [];
        const mainTeacher = teachers.find((t) => t.userType === '1') || teachers[0] || null;
        displayTeacherName = escapeHtml(mainTeacher?.userName || teacherName || '教师');
        otherTeachersHtml = teachers.filter((t) => t !== mainTeacher).map((t) => `<div>${escapeHtml(t.userName || '-')} (${escapeHtml(t.userType === '1' ? '任课教师' : '助教')})</div>`).join('');
      }

      // Courseware
      let cwHtml = '', hasCw = false;
      if (!isS) {
        const cwCache = window.coursewareCacheByCourseId?.[courseKey];
        const cwItems = cwCache?.items || [];
        hasCw = cwItems.length > 0;
        cwHtml = cwItems.map((item) => {
          const name = escapeHtml(item.name || '课件');
          const url = item.url || '';
          const urlHtml = url
            ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(cleanRpUrl(url))}</a>`
            : '<span style="color:#999;">链接获取中…</span>';
          return `<div style="padding:6px 8px;border:1px solid #c8e6c9;border-radius:4px;background:#f1f8e9;margin-top:6px;"><div style="font-weight:bold;">${name}</div><div style="margin-top:2px;">${urlHtml}</div></div>`;
        }).join('');
      }

      // Replay
      let rpHtml = '', hasRp = false;
      if (!isS) {
        const rpCache = window.videoReplayCacheByCourseId?.[courseKey];
        const rpList = rpCache?.list || [];
        hasRp = rpList.length > 0;
        rpHtml = rpList.map((item) => {
          const title = escapeHtml(`${item.roomName || ''} ${item.rpName || '未知时间'}`);
          let linkHtml = '';
          if (item.qrResolvedLinkHtml) {
            linkHtml = item.qrResolvedLinkHtml;
          } else if (item.qrResolvedUrl) {
            linkHtml = `<a href="${escapeHtml(item.qrResolvedUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(cleanRpUrl(item.qrResolvedUrl))}</a>`;
          } else {
            linkHtml = '<span style="color:#999;">链接获取中…</span>';
          }
          return `<div style="padding:6px 8px;border:1px solid #ce93d8;border-radius:4px;background:#f3e5f5;margin-top:6px;"><div style="font-weight:bold;color:#4a148c;">${title}</div><div style="margin-top:2px;">${linkHtml}</div></div>`;
        }).join('');
      }

      // Homework
      const hwList = isS ? (course._homeworkList || []) : (window.courseHomeworkData?.[courseKey]?.list || []);
      let nativeCls, yktCls, mrzyCls, jlgjCls;
      if (isS) {
        if (platform === 'ykt') { yktCls = classifyItems(hwList, isYktHomeworkDone, isYktOverdue); nativeCls = mrzyCls = jlgjCls = { pending: [], overdue: [], done: [] }; }
        else if (platform === 'mrzy') { mrzyCls = classifyItems(hwList, isMrzyHomeworkDone, isMrzyOverdue); nativeCls = yktCls = jlgjCls = { pending: [], overdue: [], done: [] }; }
        else { jlgjCls = classifyItems(hwList, isJlgjHomeworkDone, isJlgjOverdue); nativeCls = yktCls = mrzyCls = { pending: [], overdue: [], done: [] }; }
      } else {
        nativeCls = classifyItems(hwList, isNativeHomeworkDone, isNativeHomeworkOverdue);
        const yktItems = isPlatformEnabled('ykt') ? (window.yktMatchedHomeworkByCourseId?.[courseKey] || []) : [];
        const mrzyItems = isPlatformEnabled('mrzy') ? (window.mrzyMatchedHomeworkByCourseId?.[courseKey] || []) : [];
        const jlgjItems = isPlatformEnabled('jlgj') ? (window.jlgjMatchedHomeworkByCourseId?.[courseKey] || []) : [];
        yktCls = classifyItems(yktItems, isYktHomeworkDone, isYktOverdue);
        mrzyCls = classifyItems(mrzyItems, isMrzyHomeworkDone, isMrzyOverdue);
        jlgjCls = classifyItems(jlgjItems, isJlgjHomeworkDone, isJlgjOverdue);
      }
      const allPending = [...nativeCls.pending, ...yktCls.pending, ...mrzyCls.pending, ...jlgjCls.pending];
      const allOverdue = [...nativeCls.overdue, ...yktCls.overdue, ...mrzyCls.overdue, ...jlgjCls.overdue];
      const allDone = [...nativeCls.done, ...yktCls.done, ...mrzyCls.done, ...jlgjCls.done];

      const renderPlatformHomework = (cls, type, itemPlatform) =>
        cls[type].map((hw) => buildQrHomeworkItemHtml(hw, type, courseKey, itemPlatform)).join('');
      const pendingHtml = [
        renderPlatformHomework(nativeCls, 'pending', 've'),
        renderPlatformHomework(yktCls, 'pending', 'ykt'),
        renderPlatformHomework(mrzyCls, 'pending', 'mrzy'),
        renderPlatformHomework(jlgjCls, 'pending', 'jlgj')
      ].join('');
      const overdueHtml = [
        renderPlatformHomework(nativeCls, 'overdue', 've'),
        renderPlatformHomework(yktCls, 'overdue', 'ykt'),
        renderPlatformHomework(mrzyCls, 'overdue', 'mrzy'),
        renderPlatformHomework(jlgjCls, 'overdue', 'jlgj')
      ].join('');
      const doneHtml = [
        renderPlatformHomework(nativeCls, 'done', 've'),
        renderPlatformHomework(yktCls, 'done', 'ykt'),
        renderPlatformHomework(mrzyCls, 'done', 'mrzy'),
        renderPlatformHomework(jlgjCls, 'done', 'jlgj')
      ].join('');

      const cwId = `qr-cw-${courseKey}`;
      const rpId = `qr-rp-${courseKey}`;
      const overdueId = `qr-ov-${courseKey}`;
      const doneId = `qr-dn-${courseKey}`;
      const teacherSection = otherTeachersHtml
        ? `<span class="teacher-toggle">${displayTeacherName} <span class="teacher-arrow">▼</span></span><div class="other-teachers">${otherTeachersHtml}</div>`
        : `<span>${displayTeacherName}</span>`;
      const actionsHtml = (hasCw || hasRp)
        ? `<div class="actions">${hasCw ? `<button class="btn btn-cw" data-target="${cwId}" data-expand="课件下载" data-collapse="收起课件">课件下载</button>` : ''}${hasRp ? `<button class="btn btn-rp" data-target="${rpId}" data-expand="回放下载" data-collapse="收起回放">回放下载</button>` : ''}</div>`
        : '';

      cardsHtml += `
        <div class="card">
          <div class="course-name"><a href="${escapeHtml(coursePlatformUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(courseName)}</a></div>
          <div class="teacher-row">${teacherSection}</div>
          ${actionsHtml}
          ${hasCw ? `<div class="content-area" id="${cwId}">${cwHtml}</div>` : ''}
          ${hasRp ? `<div class="content-area" id="${rpId}">${rpHtml}</div>` : ''}
          <div class="hw-area">
            ${pendingHtml}
            ${allOverdue.length ? `<div class="hw-toggle-row"><button class="hw-toggle" data-target="${overdueId}" data-expand="查看逾期作业 (${allOverdue.length})" data-collapse="收起逾期作业 (${allOverdue.length})">查看逾期作业 (${allOverdue.length})</button></div><div class="hw-group" id="${overdueId}">${overdueHtml}</div>` : ''}
            ${allDone.length ? `<div class="hw-toggle-row"><button class="hw-toggle" data-target="${doneId}" data-expand="查看已交作业 (${allDone.length})" data-collapse="收起已交作业 (${allDone.length})">查看已交作业 (${allDone.length})</button></div><div class="hw-group" id="${doneId}">${doneHtml}</div>` : ''}
          </div>
        </div>`;
    });

    if (!cardsHtml) return '';

    const inlineCss = 'body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;padding:16px;max-width:800px;margin:0 auto;color:#333;background:#f5f5f5}.card{border:1px solid #e0e0e0;border-radius:8px;padding:12px;margin-bottom:12px;background:#fff}.course-name{font-size:16px;font-weight:bold}.course-name a{color:#1565c0;text-decoration:none}.teacher-row{font-size:12px;color:#666;margin:4px 0}.teacher-toggle{cursor:pointer;color:#1565c0;user-select:none}.other-teachers{display:none;margin-top:4px;padding:6px 10px;background:#f0f4ff;border-radius:4px;font-size:12px;color:#555}.actions{display:flex;gap:6px;margin-top:6px}.btn{cursor:pointer;padding:4px 10px;border:none;border-radius:4px;color:#fff;font-size:12px;user-select:none}.btn-cw{background:#1e3a8a}.btn-rp{background:#9C27B0}.content-area{display:none;margin-top:6px;padding-top:6px;border-top:1px dashed #eee;font-size:12px}.hw-area{margin-top:6px;padding-top:6px;border-top:1px dashed #eee;font-size:13px;color:#666}.hw-toggle-row{margin-bottom:4px}.hw-toggle{cursor:pointer;padding:4px 12px;border:1px solid #ccc;border-radius:4px;background:#f9f9f9;font-size:12px;margin-right:4px;user-select:none}.hw-group{display:none;margin-top:4px}.hw-item{padding:6px 8px;border-radius:6px;margin-top:6px;font-size:12px;overflow:hidden}.hw-title{font-weight:bold}.hw-deadline{color:#666;margin-top:2px}.hw-overdue{border:1px solid #ef4444;background:#ffebee}.hw-done{border:1px solid #4caf50;background:#e8f5e9}.hw-pending{border:1px solid #ff9800;background:#fff3e0}.hw-overdue .hw-title{color:#b91c1c}.hw-done .hw-title{color:#2e7d32}.hw-pending .hw-title{color:#e65100}.hw-detail-content{border:1px solid #e0e0e0}a{color:#1565c0;word-break:break-all;font-size:12px}';
    const inlineJs = 'document.addEventListener(\'click\',function(e){var t=e.target;if(t.classList.contains(\'teacher-toggle\')){var n=t.parentNode.querySelector(\'.other-teachers\');if(n){var s=n.style.display!==\'block\';n.style.display=s?\'block\':\'none\';var a=t.querySelector(\'.teacher-arrow\');if(a){a.textContent=s?\'\\u25B2\':\'\\u25BC\'}}return}if(t.classList.contains(\'btn-cw\')||t.classList.contains(\'btn-rp\')){var c=document.getElementById(t.dataset.target);if(c){var s=c.style.display!==\'block\';c.style.display=s?\'block\':\'none\';t.textContent=t.dataset[s?\'collapse\':\'expand\']}return}if(t.classList.contains(\'hw-toggle\')){var c=document.getElementById(t.dataset.target);if(c){var s=c.style.display!==\'block\';c.style.display=s?\'block\':\'none\';t.textContent=t.dataset[s?\'collapse\':\'expand\']}return}var d=t.closest(\'[data-toggle-detail]\');if(d&&!t.closest(\'a\')){var e=document.getElementById(d.dataset.toggleDetail);if(e){var s=e.style.display!==\'block\';e.style.display=s?\'block\':\'none\';var sp=d.querySelector(\'[data-detail-toggle]\');if(sp)sp.textContent=s?\'[点击收起详情]\':\'[点击查看详情]\'}}})';

    const now = new Date();
    const pad2 = (n) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}.${pad2(now.getMonth() + 1)}.${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
    const noticeHtml = `<div style="padding:8px 12px;background:#ffebee;border:1px solid #ef4444;border-radius:6px;color:#b91c1c;font-size:12px;font-weight:bold;text-align:center;margin-bottom:12px;">这是 ${ts} 生成的静态页面，不会实时更新</div>`;

    const currentLoginName = window.currentAccountLoginName || '';
    const accountHit = (typeof loginAccountHistory !== 'undefined' ? loginAccountHistory : []).find((it) => it.loginName === currentLoginName || it.userId === currentLoginName);
    const roleNameStr = accountHit?.roleName || '';
    const userNameStr = accountHit?.userName || currentLoginName || '';
    const titleSuffix = (roleNameStr || userNameStr) ? `\u2014${roleNameStr}${userNameStr}` : '';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>\u8BFE\u7A0B\u5217\u8868${escapeHtml(titleSuffix)}</title>
<style>${inlineCss}</style>
</head>
<body>
${noticeHtml}
${cardsHtml}
<script>${inlineJs}<\/script>
</body>
</html>`;
  };

  // ─── Data loading ───

  const waitForAllData = async (setStatus) => {
    // 1. Wait briefly for initial data to appear (any platform)
    for (let i = 0; i < 20; i++) {
      if (Array.isArray(window.currentVeCourseList) && window.currentVeCourseList.length) break;
      if ((window.yktStandaloneCourses || []).length) break;
      if ((window.mrzyStandaloneCourses || []).length) break;
      if ((window.jlgjStandaloneCourses || []).length) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    setStatus('正在等待数据加载…');
    const startTs = Date.now();
    const MAX_WAIT = 60000;

    const estimateSizeKb = () => {
      try {
        const h = buildQrCourseListHtml();
        if (h && h.length > 200) return (h.length / 1024).toFixed(1);
      } catch {}
      return null;
    };

    let lastKb = null;
    const showProgress = (prefix) => {
      const kb = estimateSizeKb();
      if (kb && kb !== lastKb) {
        lastKb = kb;
        setStatus(`${prefix} ${kb} KB`);
      }
    };

    // 2. Wait for VE course homework + scores to be ready
    const isVeDataReady = () => {
      const courses = window.currentVeCourseList;
      if (!Array.isArray(courses) || !courses.length) return true;
      return courses.every((c) => {
        const cid = c.id || c.cId || c.courseId || c.course_id;
        if (!cid) return true;
        if (!window.courseHomeworkData?.[cid]) return false;
        if (window.homeworkScorePendingByCourse?.[cid]) return false;
        return true;
      });
    };

    while (Date.now() - startTs < MAX_WAIT) {
      if (isVeDataReady()) break;
      showProgress('正在等待数据加载…');
      await new Promise((r) => setTimeout(r, 500));
    }

    const hasLoadingMeta = (list) => (Array.isArray(list) ? list : []).some((course) => {
      if (course?.loadingMeta) return true;
      return (Array.isArray(course?.homeworks) ? course.homeworks : []).some((hw) => !!hw?.loadingMeta);
    });
    const isExternalPlatformReady = (platform) => {
      if (!isPlatformEnabled(platform)) return true;
      if (window.platformLoadedOnce?.[platform] !== true) return false;
      if (platform === 'ykt') {
        const loadingMap = window.yktHomeworkLoadingByCourse || {};
        if (Object.values(loadingMap).some(Boolean)) return false;
        return true;
      }
      if (platform === 'mrzy') return !hasLoadingMeta(window.mrzyStandaloneCourses);
      if (platform === 'jlgj') return !hasLoadingMeta(window.jlgjStandaloneCourses);
      return true;
    };

    // 3. Give all external platforms time to finish loading and populate standalone arrays
    while (Date.now() - startTs < MAX_WAIT) {
      const settled = (
        isExternalPlatformReady('ykt') &&
        isExternalPlatformReady('mrzy') &&
        isExternalPlatformReady('jlgj')
      );
      if (settled) break;
      showProgress('正在等待其他平台…');
      await new Promise((r) => setTimeout(r, 500));
    }

    // 4. Resolve courseware RP links (download URLs for course materials)
    const courses = window.currentVeCourseList;
    const cwNeedsResolve = Array.isArray(courses) && courses.some((c) => {
      const cid = c.id || c.cId || c.courseId || c.course_id;
      if (!cid) return false;
      const cw = window.coursewareCacheByCourseId?.[cid];
      return cw?.items?.some((it) => !it.url && it.rpId);
    });

    if (cwNeedsResolve) {
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
                const postUrl = `${BASE_VE}back/resourceSpace.shtml`;
                const postBody = new URLSearchParams({ method: 'rpinfoDownloadUrl', rpId: String(item.rpId) });
                const referer = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=toCoursePlatform&courseToPage=10480`;
                const { text } = await fetchText(postUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Referer': referer, 'Accept': 'application/json, text/javascript, */*; q=0.01' },
                  body: postBody.toString()
                });
                const data = parseVeJson(text);
                if (data.flag === true || String(data.STATUS) === '0') {
                  const rpUrl = (data.rpUrl || '').trim();
                  if (rpUrl) item.url = rpUrl;
                }
              } catch {}
            })());
          }
        });
      });
      await Promise.allSettled(promises);
      if (typeof buildCoursewareListHtml === 'function') {
        courses.forEach((c) => {
          const cid = c.id || c.cId || c.courseId || c.course_id;
          if (!cid) return;
          const cache = window.coursewareCacheByCourseId?.[cid];
          if (cache?.items?.length) cache.html = buildCoursewareListHtml(cid, cache.items);
        });
      }
      showProgress('正在获取课件链接…');
    }

    // 5. Resolve replay download links
    const rpNeedsResolve = Array.isArray(courses) && courses.some((c) => {
      const cid = c.id || c.cId || c.courseId || c.course_id;
      if (!cid) return false;
      const cache = window.videoReplayCacheByCourseId?.[cid];
      return cache?.list?.some((it) => it.rpId && !it.qrResolvedUrl && !it.qrResolvedLinkHtml);
    });

    if (rpNeedsResolve) {
      const promises = [];
      courses.forEach((c) => {
        const cid = c.id || c.cId || c.courseId || c.course_id;
        if (!cid) return;
        const cache = window.videoReplayCacheByCourseId?.[cid];
        if (!cache?.list?.length || cache.qrLinksResolved) return;
        cache.list.forEach((item) => {
          if (item.rpId && !item.qrResolvedUrl && !item.qrResolvedLinkHtml) {
            promises.push((async () => {
              try {
                const postUrl = `${BASE_VE}back/resourceSpace.shtml`;
                const postBody = new URLSearchParams({ method: 'rpinfoDownloadUrl', rpId: String(item.rpId) });
                const referer = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=toCoursePlatform&courseToPage=10480`;
                const { text } = await fetchText(postUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Referer': referer, 'Accept': 'application/json, text/javascript, */*; q=0.01' },
                  body: postBody.toString()
                });
                const data = parseVeJson(text);
                if (data.flag === true || String(data.STATUS) === '0') {
                  const html = (data.html || '').trim();
                  const rpUrl = (data.rpUrl || '').trim();
                  if (html) item.qrResolvedLinkHtml = html;
                  else if (rpUrl) item.qrResolvedUrl = rpUrl;
                }
              } catch {}
            })());
          }
        });
        cache.qrLinksResolved = true;
      });
      await Promise.allSettled(promises);
      showProgress('正在获取回放链接…');
    }

    return true;
  };

  // ─── Upload & QR ───

  let __qrUploadRunning = false;

  const uploadCourseListAndShowQr = async (triggerEl) => {
    if (__qrUploadRunning) return;
    __qrUploadRunning = true;

    const setStatus = (text) => { if (headerQrStatus) headerQrStatus.textContent = text; };

    setStatus('正在等待加载…');
    const ready = await waitForAllData(setStatus);
    if (!ready) {
      setStatus('暂无课程内容');
      hideQrLoading();
      __qrUploadRunning = false;
      return;
    }

    const htmlContent = buildQrCourseListHtml();
    if (!htmlContent) {
      setStatus('暂无课程内容');
      hideQrLoading();
      __qrUploadRunning = false;
      return;
    }
    const htmlSizeKb = (htmlContent.length / 1024).toFixed(1);

    const jsid = (document.getElementById('jsessionid-input')?.value?.trim() || await getLocal('jsessionid', '')).trim();
    if (!jsid) {
      setStatus('请先登录');
      hideQrLoading();
      __qrUploadRunning = false;
      return;
    }

    setStatus(`HTML ${htmlSizeKb} KB，正在上传…`);

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
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round(e.loaded / e.total * 100);
            setStatus(`HTML ${htmlSizeKb} KB，上传中 ${pct}%`);
          }
        };
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
        hideQrLoading();
      } catch {
        setStatus('二维码生成失败');
        hideQrLoading();
      }
      __qrUploadRunning = false;
      const rect = triggerEl.getBoundingClientRect();
      showHeaderQr(rect.bottom, rect.left);
    } catch (err) {
      setStatus('上传失败: ' + (err.message || ''));
      hideQrLoading();
      __qrUploadRunning = false;
    }
  };

  // ─── Reusable upload helper ───

  const uploadHtmlAndGetUrl = async (htmlContent, onProgress) => {
    const jsid = (document.getElementById('jsessionid-input')?.value?.trim() || await getLocal('jsessionid', '')).trim();
    if (!jsid) return null;
    const file = new File([htmlContent], 'snapshot.html', { type: 'text/html' });
    const fd = new FormData();
    fd.append('file', file);
    const url = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const uploadUrl = `${BASE}/ve/back/rp/common/rpUpload.shtml;jsessionid=${encodeURIComponent(jsid)}`;
      xhr.open('POST', uploadUrl, true);
      xhr.withCredentials = true;
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.setRequestHeader('Upgrade-Insecure-Requests', '1');
      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100));
        };
      }
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
    return url;
  };

  // ─── Section QR setup (file upload / resource space) ───

  const setupSectionQr = (triggerSelector, buildHtmlFn, cacheKey) => {
    const triggerEl = document.querySelector(triggerSelector);
    if (!triggerEl) return;

    const SECTION_TOOLTIP_ID = `__bjtu_section_qr_${triggerSelector.replace(/[^a-zA-Z0-9_-]/g, '_')}__`;
    let sectionTooltip = document.getElementById(SECTION_TOOLTIP_ID);
    if (!sectionTooltip) {
      sectionTooltip = document.createElement('div');
      sectionTooltip.id = SECTION_TOOLTIP_ID;
      sectionTooltip.style.cssText = 'position:fixed;z-index:99999;padding:10px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.18);display:none;flex-direction:column;align-items:center;gap:6px;pointer-events:none;';
      sectionTooltip.innerHTML = '<div style="font-size:11px;color:#94a3b8;text-align:center;">扫描二维码查看列表</div><div style="position:relative;width:160px;height:160px;"><div class="__qr_spinner" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;"><div style="width:36px;height:36px;border:4px solid #e0e0e0;border-top-color:#1565c0;border-radius:50%;animation:__qr_spin .8s linear infinite;"></div></div><img style="display:none;width:160px;height:160px;image-rendering:pixelated;"></div><div class="__section_qr_status" style="font-size:11px;color:#94a3b8;text-align:center;"></div>';
      document.body.appendChild(sectionTooltip);
    }

    const secQrImg = sectionTooltip.querySelector('img');
    const secQrSpinner = sectionTooltip.querySelector('.__qr_spinner');
    const secQrStatus = sectionTooltip.querySelector('.__section_qr_status');
    const cacheUrlKey = `_${cacheKey || triggerSelector.replace(/[^a-zA-Z0-9]/g, '_')}Url`;

    let secQrHideTimer = null;
    let secLoading = false;

    const secShowLoading = () => {
      if (secQrSpinner) secQrSpinner.style.display = 'flex';
      if (secQrImg) secQrImg.style.display = 'none';
    };
    const secHideLoading = () => {
      if (secQrSpinner) secQrSpinner.style.display = 'none';
      if (secQrImg) secQrImg.style.display = 'block';
    };

    const showSectionQr = (top, left) => {
      sectionTooltip.style.display = 'flex';
      let tRect = sectionTooltip.getBoundingClientRect();
      let l = left;
      let t = top + 12;
      if (l + tRect.width > window.innerWidth - 4) l = window.innerWidth - tRect.width - 4;
      if (t + tRect.height > window.innerHeight - 4) t = top - tRect.height - 4;
      if (l < 4) l = 4;
      if (t < 4) t = 4;
      sectionTooltip.style.top = t + 'px';
      sectionTooltip.style.left = l + 'px';
    };

    const showCachedQr = () => {
      const cachedUrl = window.__sectionQrCache[cacheUrlKey];
      if (!cachedUrl) return false;
      try {
        secQrImg.src = buildQrImageUrl(cachedUrl, 160);
        secHideLoading();
        return true;
      } catch { return false; }
    };

    const generateAndShow = async () => {
      if (secLoading) return;
      secLoading = true;

      const htmlContent = buildHtmlFn();
      if (htmlContent === null) {
        // Data unchanged — try cached URL
        if (showCachedQr()) {
          sectionTooltip.style.display = 'flex';
          const rect = triggerEl.getBoundingClientRect();
          showSectionQr(rect.bottom, rect.left);
          secLoading = false;
          return;
        }
        // Cache miss, fall through to regenerate
        secLoading = false;
        return;
      }

      secShowLoading();
      sectionTooltip.style.display = 'flex';
      const rect = triggerEl.getBoundingClientRect();
      showSectionQr(rect.bottom, rect.left);
      if (secQrStatus) secQrStatus.textContent = '正在生成…';

      if (!htmlContent) {
        if (secQrStatus) secQrStatus.textContent = '暂无内容';
        secHideLoading();
        secLoading = false;
        return;
      }

      if (secQrStatus) secQrStatus.textContent = `HTML ${(htmlContent.length / 1024).toFixed(1)} KB，正在上传…`;
      const url = await uploadHtmlAndGetUrl(htmlContent, (pct) => {
        if (secQrStatus) secQrStatus.textContent = `HTML ${(htmlContent.length / 1024).toFixed(1)} KB，上传中 ${pct}%`;
      });
      if (!url) {
        if (secQrStatus) secQrStatus.textContent = '请先登录';
        secHideLoading();
        secLoading = false;
        return;
      }

      try {
        secQrImg.src = buildQrImageUrl(url, 160);
        secHideLoading();
        if (secQrStatus) secQrStatus.textContent = '';
        window.__sectionQrCache[cacheUrlKey] = url;
      } catch {
        if (secQrStatus) secQrStatus.textContent = '二维码生成失败';
      }
      secLoading = false;
    };

    triggerEl.addEventListener('mouseenter', () => {
      if (secQrHideTimer) { clearTimeout(secQrHideTimer); secQrHideTimer = null; }
      generateAndShow();
    });

    triggerEl.addEventListener('mouseleave', (e) => {
      if (secQrHideTimer) { clearTimeout(secQrHideTimer); }
      const toEl = e.relatedTarget;
      if (toEl && (triggerEl.contains(toEl) || (sectionTooltip.style.display !== 'none' && sectionTooltip.contains(toEl)))) return;
      secQrHideTimer = setTimeout(() => { sectionTooltip.style.display = 'none'; }, 80);
    });
  };

  // ─── File upload list HTML builder ───

  const buildUploadListHtml = () => {
    const items = window.savedUploadedFiles || [];
    if (!items.length) return '';
    const rows = items.map((f) => {
      const name = escapeHtml(f.fileName || f.name || '文件');
      const url = String(f.url || '').trim();
      const linkHtml = url
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color:#1565c0;word-break:break-all;">${escapeHtml(cleanRpUrl ? cleanRpUrl(url) : url)}</a>`
        : '<span style="color:#999;">无链接</span>';
      return `<div style="padding:6px 8px;border-bottom:1px solid #eee;"><div style="font-weight:bold;font-size:13px;">${name}</div><div style="font-size:12px;margin-top:2px;">${linkHtml}</div></div>`;
    }).join('');

    const now = new Date();
    const pad2 = (n) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}.${pad2(now.getMonth() + 1)}.${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>文件上传列表</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;padding:16px;max-width:800px;margin:0 auto;color:#333;background:#f5f5f5}a{color:#1565c0;text-decoration:none}h2{font-size:18px;margin:0 0 12px}.notice{padding:8px 12px;background:#ffebee;border:1px solid #ef4444;border-radius:6px;color:#b91c1c;font-size:12px;font-weight:bold;text-align:center;margin-bottom:12px}.list{background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08)}</style>
</head>
<body>
<h2>文件上传列表</h2>
<div class="notice">这是 ${ts} 生成的静态页面，不会实时更新</div>
<div class="list">${rows}</div>
</body>
</html>`;
  };

  // ─── Resource space list HTML builder ───

  const buildResourceSpaceListHtml = () => {
    const items = window.resourceSpaceItems || [];
    if (!items.length) return '';
    const rows = items.map((f) => {
      const name = escapeHtml(f.name || f.fileName || '资源');
      const url = String(f.url || '').trim();
      const sizeStr = f.sizeMb ? ` (${escapeHtml(String(f.sizeMb))})` : '';
      const linkHtml = url
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color:#1565c0;word-break:break-all;">${escapeHtml(url)}</a>`
        : '<span style="color:#999;">无链接</span>';
      return `<div style="padding:6px 8px;border-bottom:1px solid #eee;"><div style="font-weight:bold;font-size:13px;">${name}${sizeStr}</div><div style="font-size:12px;margin-top:2px;">${linkHtml}</div></div>`;
    }).join('');

    const now = new Date();
    const pad2 = (n) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}.${pad2(now.getMonth() + 1)}.${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>资源空间</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;padding:16px;max-width:800px;margin:0 auto;color:#333;background:#f5f5f5}a{color:#1565c0;text-decoration:none}h2{font-size:18px;margin:0 0 12px}.notice{padding:8px 12px;background:#ffebee;border:1px solid #ef4444;border-radius:6px;color:#b91c1c;font-size:12px;font-weight:bold;text-align:center;margin-bottom:12px}.list{background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08)}</style>
</head>
<body>
<h2>资源空间</h2>
<div class="notice">这是 ${ts} 生成的静态页面，不会实时更新</div>
<div class="list">${rows}</div>
</body>
</html>`;
  };

  // ─── Attach section QR tooltips with caching ───

  window.__sectionQrCache = window.__sectionQrCache || {};

  const dataHash = (items) => {
    if (!items || !items.length) return '';
    return String(items.length) + '|' + items.map((f) => f.url || '').join(',');
  };

  setupSectionQr('.upload-section-header h1', () => {
    const items = window.savedUploadedFiles || [];
    const hash = dataHash(items);
    if (hash && window.__sectionQrCache._upload === hash && window.__sectionQrCache._uploadUrl) {
      return null; // use cached URL
    }
    window.__sectionQrCache._upload = hash;
    return buildUploadListHtml();
  }, 'upload');

  setupSectionQr('#resource-space-section .resource-space-title', () => {
    const items = window.resourceSpaceItems || [];
    const hash = dataHash(items);
    if (hash && window.__sectionQrCache._resource === hash && window.__sectionQrCache._resourceUrl) {
      return null;
    }
    window.__sectionQrCache._resource = hash;
    return buildResourceSpaceListHtml();
  }, 'resource');

  window.addEventListener('scroll', () => {
    headerTooltip.style.display = 'none';
    document.querySelectorAll('[id^="__bjtu_section_qr_"]').forEach((el) => { el.style.display = 'none'; });
  }, { passive: true });
  window.addEventListener('resize', () => {
    headerTooltip.style.display = 'none';
    document.querySelectorAll('[id^="__bjtu_section_qr_"]').forEach((el) => { el.style.display = 'none'; });
  }, { passive: true });

  const courseHeaderEl = document.querySelector('h2.course-header span');
  if (!courseHeaderEl) return;

  courseHeaderEl.addEventListener('mouseenter', () => {
    if (headerQrHideTimer) { clearTimeout(headerQrHideTimer); headerQrHideTimer = null; }
    if (!window.__headerQrUrl) {
      if (__qrUploadRunning) {
        headerTooltip.style.display = 'flex';
        const rect = courseHeaderEl.getBoundingClientRect();
        showHeaderQr(rect.bottom, rect.left);
        return;
      }
      showQrLoading();
      headerTooltip.style.display = 'flex';
      const rect = courseHeaderEl.getBoundingClientRect();
      showHeaderQr(rect.bottom, rect.left);
      if (headerQrStatus) headerQrStatus.textContent = '正在等待加载…';
      uploadCourseListAndShowQr(courseHeaderEl);
      return;
    }
    try {
      hideQrLoading();
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
})();
