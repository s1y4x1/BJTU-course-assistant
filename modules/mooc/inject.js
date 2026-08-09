(async function () {
    'use strict';

    const DEFAULT_PEER_REVIEW_COUNT = 5;
    const MIN_PEER_REVIEW_COUNT = 1;
    const REVIEW_READY_TIMEOUT_MS = 30000;
    const REVIEW_SUBMIT_DELAY_MS = 1000;
    const SETTINGS_KEYS = [
        'injectMoocHelperEnabled',
        'injectMoocPeerReviewEnabled',
        'moocPeerReviewCount'
    ];

    const initialSettings = await chrome.storage.local.get(SETTINGS_KEYS);
    let helperEnabled = initialSettings.injectMoocHelperEnabled !== false;
    let peerReviewEnabled = initialSettings.injectMoocPeerReviewEnabled === true;
    let peerReviewCount = normalizePeerReviewCount(initialSettings.moocPeerReviewCount);

    if (!new URL(location.href).searchParams.get('tid')) return;

    /* ============================= Utilities ============================= */

    function normalizePeerReviewCount(value) {
        if (value === '' || value === null || value === undefined) return DEFAULT_PEER_REVIEW_COUNT;
        const count = Math.trunc(Number(value));
        return Number.isFinite(count)
            ? Math.max(MIN_PEER_REVIEW_COUNT, count)
            : DEFAULT_PEER_REVIEW_COUNT;
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function waitUntil(predicate, message, timeoutMs = REVIEW_READY_TIMEOUT_MS) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            try {
                if (predicate()) return;
            } catch {
                // The MOOC page replaces the review panel while moving to the next item.
            }
            await sleep(100);
        }
        throw new Error(message);
    }

    function isHidden(element) {
        if (!element?.isConnected) return true;
        return element.style.display === 'none' || getComputedStyle(element).display === 'none';
    }

    async function request(action, payload = {}) {
        const response = await chrome.runtime.sendMessage({ type: 'MOOC_REQUEST', action, payload, pageUrl: location.href });
        if (!response?.ok) throw new Error(response?.message || '中国大学MOOC请求失败');
        return response.data;
    }

    function getTid() {
        const match = location.search.match(/[?&]tid=(\d+)/);
        return match ? match[1] : '';
    }

    function getId() {
        const match = location.hash.match(/[?&]id=(\d+)/);
        return match ? match[1] : '';
    }

    function pageType() {
        const hash = location.hash;
        if (/examObject/i.test(hash)) return 'exam';
        if (/\/quiz/i.test(hash)) return 'quiz';
        if (/\/hw/i.test(hash)) return 'hw';
        return 'course';
    }

    function formatTime(ms) {
        if (!ms) return '无期限';
        const date = new Date(ms);
        const pad = (value) => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function isPeerReviewPage() {
        return document.querySelector('.u-questionItem.u-analysisQuestion.analysisMode') !== null;
    }

    /* ============================= Completion actions ============================= */

    async function completeQuiz(tid, info) {
        log(`📤 正在完成测验… [${info || tid}]`);
        const completed = await request('complete-task', { taskType: 'quiz', tid });
        const response = completed?.response;
        log('✅ 提交成功', 'ok');
        if (response?.result) {
            const score = response.result;
            log(`  得分: ${score.score !== undefined ? score.score : '?'}  /  ${score.totalScore !== undefined ? score.totalScore : '?'}`);
        }
        console.log('[mooc-helper] 提交响应:', response);
        return response;
    }

    async function completeHomework(tid, info) {
        log(`📤 正在完成作业… [${info || tid}]`);
        const completed = await request('complete-task', { taskType: 'hw', tid });
        const response = completed?.response;
        log('✅ 提交成功', 'ok');
        if (response?.result) {
            const score = response.result;
            log(`  得分: ${score.score !== undefined ? score.score : '?'}  /  ${score.totalScore !== undefined ? score.totalScore : '?'}`);
        }
        console.log('[mooc-helper] 提交响应:', response);
        return response;
    }

    function completeExam(tid, info) {
        log('📝 考试 (同测试逻辑)');
        return completeQuiz(tid, info);
    }

    /* ============================= Peer review ============================= */

    function setTextAreaValue(textarea, value) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) setter.call(textarea, value);
        else textarea.value = value;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function fillCurrentPeerReview() {
        const questions = document.querySelectorAll('.u-questionItem.u-analysisQuestion.analysisMode');
        if (!questions.length) throw new Error('当前页面没有可填写的互评内容');

        questions.forEach((question) => {
            question.querySelectorAll('.s').forEach((scoreRow) => {
                const input = scoreRow.lastElementChild?.querySelector('input');
                if (!input) return;
                if (!input.checked) input.click();
                if (!input.checked) {
                    input.checked = true;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
            const textarea = question.querySelector('textarea');
            if (textarea) setTextAreaValue(textarea, '666');
        });
    }

    async function runAutomaticPeerReview(count, onProgress) {
        for (let index = 0; index < count; index += 1) {
            await waitUntil(() => {
                const info = document.querySelector('.u-homework-evaAction .xlinfo');
                return info && isHidden(info) && isPeerReviewPage();
            }, '等待互评页面就绪超时');

            fillCurrentPeerReview();
            await sleep(REVIEW_SUBMIT_DELAY_MS);

            const submitButton = document.querySelector('.u-homework-evaAction .bottombtnwrap .j-submitbtn');
            if (!submitButton) throw new Error('未找到互评提交按钮');
            submitButton.click();

            await waitUntil(() => {
                const info = document.querySelector('.u-homework-evaAction .xlinfo');
                return info && !isHidden(info);
            }, '等待互评提交结果超时');

            onProgress(index + 1, count);
            if (index + 1 >= count) continue;

            const nextButton = document.querySelector('.u-homework-evaAction .xlinfo .j-gotonext');
            if (!nextButton || nextButton.disabled) {
                throw new Error(`已完成 ${index + 1} 次互评，没有更多可互评作业`);
            }
            nextButton.click();
        }
    }

    /* ============================= UI ============================= */

    const style = document.createElement('style');
    style.id = 'bjtu-mooc-helper-style';
    style.textContent = `
        .mh-wrap { position:fixed; top:64px; right:16px; z-index:999999; display:flex; flex-direction:column; gap:8px; max-width:340px; }
        .mh-panel { background:#fff; border:1px solid #e0e0e0; border-radius:8px; padding:12px 16px; box-shadow:0 4px 16px rgba(0,0,0,.12); font:14px/1.5 "Microsoft YaHei",sans-serif; min-width:190px; box-sizing:border-box; overflow:hidden; }
        .mh-btn { display:block; width:100%; max-width:100%; box-sizing:border-box; padding:8px 14px; margin-bottom:6px; border:none; border-radius:4px; cursor:pointer; font-size:13px; font-weight:600; text-align:center; transition:.15s; white-space:normal; overflow-wrap:anywhere; }
        .mh-btn:last-child { margin-bottom:0; }
        .mh-btn:active { transform:scale(.97); }
        .mh-btn:disabled { opacity:.6; cursor:not-allowed; transform:none; }
        .mh-btn-red, .mh-btn-green { background:#00cc7e; color:#fff; }
        .mh-btn-red:hover:not(:disabled), .mh-btn-green:hover:not(:disabled) { background:#00a866; box-shadow:0 2px 8px rgba(0,204,126,.35); }
        .mh-review-row { display:grid; grid-template-columns:auto 72px auto; align-items:center; gap:7px; margin:0 0 7px; color:#475569; font-size:13px; }
        .mh-review-count { width:72px; height:30px; box-sizing:border-box; padding:4px 6px; border:1px solid #cbd5e1; border-radius:4px; font:inherit; }
        .mh-log { max-height:260px; overflow-y:auto; font-size:11px; line-height:1.5; margin-top:6px; border-top:1px solid #eee; padding-top:6px; }
        .mh-log-line { padding:1px 0; color:#555; word-break:break-all; }
        .mh-log-line.ok { color:#00a866; }
        .mh-log-line.err { color:#e4393c; }
        .mh-log-line.info { color:#1890ff; }
        .mh-log-line.warn { color:#d48806; }
    `;

    let container = null;
    let logEl = null;
    let countInput = null;
    let autoReviewRunning = false;
    let lastRenderKey = '';
    let renderTimer = null;

    function removeUI() {
        container?.remove();
        container = null;
        logEl = null;
        countInput = null;
        style.remove();
    }

    function buildUI() {
        if (!style.isConnected) document.head.appendChild(style);
        document.getElementById('bjtu-mooc-helper')?.remove();
        container = document.createElement('div');
        container.id = 'bjtu-mooc-helper';
        container.className = 'mh-wrap';
        const panel = document.createElement('div');
        panel.className = 'mh-panel';
        container.appendChild(panel);
        document.body.appendChild(container);
        logEl = null;
        countInput = null;
        return panel;
    }

    function button(text, onClick, color = 'red') {
        const element = document.createElement('button');
        element.className = `mh-btn mh-btn-${color}`;
        element.textContent = text;
        container.querySelector('.mh-panel').appendChild(element);
        element.addEventListener('click', async () => {
            element.disabled = true;
            element.textContent = '处理中…';
            clearLog();
            try {
                await onClick(element);
                element.textContent = '✅ 已完成';
            } catch (error) {
                log(`❌ ${error.message || error}`, 'err');
                element.textContent = text;
                element.disabled = false;
            }
        });
        return element;
    }

    function clearLog() {
        if (logEl) logEl.innerHTML = '';
    }

    function log(message, className = '') {
        if (!container) return;
        if (!logEl) {
            logEl = document.createElement('div');
            logEl.className = 'mh-log';
            container.querySelector('.mh-panel').appendChild(logEl);
        }
        const line = document.createElement('div');
        line.className = `mh-log-line${className ? ` ${className}` : ''}`;
        line.textContent = message;
        logEl.appendChild(line);
        logEl.scrollTop = logEl.scrollHeight;
        console.log('[mooc-helper]', message);
    }

    function addPeerReviewControls(panel) {
        const row = document.createElement('label');
        row.className = 'mh-review-row';
        row.append('互评次数');
        countInput = document.createElement('input');
        countInput.className = 'mh-review-count';
        countInput.type = 'number';
        countInput.min = String(MIN_PEER_REVIEW_COUNT);
        countInput.step = '1';
        countInput.value = String(peerReviewCount);
        row.append(countInput, '次');
        panel.appendChild(row);

        const saveCount = async () => {
            peerReviewCount = normalizePeerReviewCount(countInput.value);
            countInput.value = String(peerReviewCount);
            await chrome.storage.local.set({ moocPeerReviewCount: peerReviewCount });
        };
        countInput.addEventListener('change', () => void saveCount());

        const startButton = button('自动互评', async (element) => {
            if (autoReviewRunning) throw new Error('自动互评正在进行中');
            await saveCount();
            autoReviewRunning = true;
            countInput.disabled = true;
            try {
                log(`开始自动互评，共 ${peerReviewCount} 次…`, 'info');
                await runAutomaticPeerReview(peerReviewCount, (finished, total) => {
                    element.textContent = `自动互评中（${finished} / ${total}）`;
                    log(`已完成 ${finished} / ${total} 次互评`, finished >= total ? 'ok' : 'info');
                });
                log(`已完成 ${peerReviewCount} 次互评`, 'ok');
            } finally {
                autoReviewRunning = false;
                if (countInput) countInput.disabled = false;
                scheduleRender(false);
            }
        }, 'green');
        startButton.dataset.peerReview = '1';
    }

    /* ============================= Page handler ============================= */

    function renderPage(force = false) {
        if (autoReviewRunning) return;
        const type = pageType();
        const id = getId();
        const tid = getTid();
        const reviewPage = isPeerReviewPage();
        const completionActionAvailable = helperEnabled && (type === 'course' ? !!tid : !!id);
        const peerReviewActionAvailable = peerReviewEnabled && reviewPage;
        const renderKey = [location.pathname, location.search, location.hash, helperEnabled, peerReviewEnabled, reviewPage].join('|');
        if (!force && renderKey === lastRenderKey) return;
        lastRenderKey = renderKey;

        if (!completionActionAvailable && !peerReviewActionAvailable) {
            removeUI();
            return;
        }

        const panel = buildUI();

        if (helperEnabled && type === 'course') {
            button('一键扫描并完成全部', async () => {
                log(`📡 获取课程信息 (tid=${tid})…`);
                const result = await request('course-detail', { tid: parseInt(tid, 10) });
                const term = result.result?.mocTermDto;
                if (!term) throw new Error('获取课程信息失败');
                log(`📚 ${term.courseName || '(未知课程)'}`);

                const chapters = term.chapters || [];
                log(`共 ${chapters.length} 章`);
                const items = [];
                for (const chapter of chapters) {
                    const chapterName = chapter.name || '(未命名章节)';
                    let hasAny = false;
                    for (const homework of (chapter.homeworks || [])) {
                        const task = homework.test;
                        if (!task) continue;
                        const expired = task.deadline && task.deadline < Date.now();
                        log(`  [${chapterName}] 📝 ${task.name || '作业'} | 截止:${formatTime(task.deadline)} | 得分:${task.userScore ?? '?'}/${task.totalScore ?? '?'}${expired ? ' ⏰已截止' : ''}`);
                        if (!expired) {
                            items.push({ type: 'hw', id: task.id, name: task.name, chapter: chapterName });
                            hasAny = true;
                        }
                    }
                    for (const quiz of (chapter.quizs || [])) {
                        const task = quiz.test;
                        if (!task) continue;
                        const expired = task.deadline && task.deadline < Date.now();
                        const fullScore = task.userScore != null && task.totalScore != null && task.userScore >= task.totalScore;
                        log(`  [${chapterName}] 📋 ${task.name || '测试'} | 截止:${formatTime(task.deadline)} | 得分:${task.userScore ?? '?'}/${task.totalScore ?? '?'}${expired ? ' ⏰已截止' : ''}${fullScore ? ' ✅已满分' : ''}`);
                        if (!expired && !fullScore) {
                            items.push({ type: 'quiz', id: task.id, name: task.name, chapter: chapterName });
                            hasAny = true;
                        }
                    }
                    const exam = chapter.exam?.objectTestVo;
                    if (exam) {
                        const expired = exam.deadline && exam.deadline < Date.now();
                        const fullScore = exam.userScore != null && exam.totalScore != null && exam.userScore >= exam.totalScore;
                        log(`  [${chapterName}] 📝 ${exam.name || '考试'} | 截止:${formatTime(exam.deadline)} | 得分:${exam.userScore ?? '?'}/${exam.totalScore ?? '?'}${expired ? ' ⏰已截止' : ''}${fullScore ? ' ✅已满分' : ''}`);
                        if (!expired && !fullScore) {
                            items.push({ type: 'exam', id: exam.id, name: exam.name, chapter: chapterName });
                            hasAny = true;
                        }
                    }
                    if (!hasAny) log(`  [${chapterName}] (无待处理项)`);
                }

                if (!items.length) throw new Error('没有待完成的任务（均已满分或已截止）');
                log(`\n🔄 开始处理 ${items.length} 项…`);
                let done = 0;
                for (const item of items) {
                    log(`── ${item.chapter} / ${item.name || item.id} ──`);
                    try {
                        if (item.type === 'hw') await completeHomework(item.id, item.name || item.id);
                        else if (item.type === 'exam') await completeExam(item.id, item.name || item.id);
                        else await completeQuiz(item.id, item.name || item.id);
                        done += 1;
                        log(`✅ ${item.name || item.id} 完成`, 'ok');
                    } catch (error) {
                        log(`❌ ${item.name || item.id} 失败：${error.message || error}`, 'err');
                    }
                }
                log(done === items.length ? `\n🎉 全部完成 (${done}/${items.length})` : `\n⚠ 完成 ${done}/${items.length}，${items.length - done} 项失败`, done === items.length ? 'ok' : 'err');
            });
        } else if (helperEnabled && type === 'quiz' && id) {
            log(`📋 单元测试页面：id=${id}`);
            button('完成单元测试', () => completeQuiz(id));
        } else if (helperEnabled && type === 'hw' && id) {
            log(`📝 单元作业页面：id=${id}`);
            button('完成单元作业', () => completeHomework(id));
        } else if (helperEnabled && type === 'exam' && id) {
            log(`📝 考试页面：id=${id}`);
            button('完成考试', () => completeExam(id));
        }

        if (peerReviewActionAvailable) addPeerReviewControls(panel);
    }

    function scheduleRender(force = false) {
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = setTimeout(() => renderPage(force), 120);
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        let needsRender = false;
        if (changes.injectMoocHelperEnabled) {
            helperEnabled = changes.injectMoocHelperEnabled.newValue !== false;
            needsRender = true;
        }
        if (changes.injectMoocPeerReviewEnabled) {
            peerReviewEnabled = changes.injectMoocPeerReviewEnabled.newValue === true;
            needsRender = true;
        }
        if (changes.moocPeerReviewCount) {
            peerReviewCount = normalizePeerReviewCount(changes.moocPeerReviewCount.newValue);
            if (countInput && document.activeElement !== countInput) countInput.value = String(peerReviewCount);
        }
        if (needsRender) scheduleRender(true);
    });

    window.addEventListener('hashchange', () => scheduleRender(true));
    const observer = new MutationObserver(() => scheduleRender(false));
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    setTimeout(() => renderPage(true), 800);
})();
