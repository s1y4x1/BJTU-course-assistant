(function () {
    'use strict';

    /* ============================= Constants ============================= */

    const API = {
        QUIZ_PAPER: 'https://www.icourse163.org/web/j/mocQuizRpcBean.getOpenQuizPaperDto.rpc',
        HW_PAPER:   'https://www.icourse163.org/web/j/mocQuizRpcBean.getOpenHomeworkPaperDto.rpc',
        SUBMIT:     'https://www.icourse163.org/web/j/mocQuizRpcBean.submitAnswers.rpc',
        COURSE:     'https://www.icourse163.org/web/j/courseBean.getLastLearnedMocTermDto.rpc',
        ANSWER:     'https://ginnnnnn.top/api/mooc/test/',
    };

    /* ============================= Utilities ============================= */

    function getCookie(name) {
        const m = document.cookie.match(new RegExp('(?:^| )' + name + '=([^;]*)'));
        return m ? decodeURIComponent(m[1]) : '';
    }

    function csrfKey() { return getCookie('NTESSTUDYSI'); }

    function getTid() {
        const m = location.search.match(/[?&]tid=(\d+)/);
        return m ? m[1] : '';
    }

    function getId() {
        const m = location.hash.match(/[?&]id=(\d+)/);
        return m ? m[1] : '';
    }

    function pageType() {
        const h = location.hash;
        if (/examObject/i.test(h)) return 'exam';
        if (/\/quiz/i.test(h))    return 'quiz';
        if (/\/hw/i.test(h))      return 'hw';
        return 'course';
    }

    function formatTime(ms) {
        if (!ms) return '无期限';
        const d = new Date(ms);
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    /* ============================= API calls ============================= */

    async function apiPost(url, data) {
        const r = await fetch(url + '?csrfKey=' + encodeURIComponent(csrfKey()), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json;charset=UTF-8' },
            body: JSON.stringify(data),
            credentials: 'include',
        });
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + r.statusText);
        return r.json();
    }

    async function apiGet(url) {
        const r = await fetch(url);
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + r.statusText);
        return r.json();
    }

    /* ============================= Actions ============================= */

    async function completeQuiz(tid, info) {
        log(`📥 获取答案… [${info || tid}]`);
        let extData, qCount = 0, optCount = 0;
        try {
            extData = await apiGet(API.ANSWER + tid);
            const qList = extData.data?.questionList || [];
            qCount = qList.length;
            optCount = qList.reduce((s, q) => s + (q.optionList || []).filter(o => o.answer).length, 0);
            log(`答案API: ${qCount} 题, ${optCount} 个正确选项`);
            if (qCount > 0) {
                for (const q of qList) {
                    const opts = (q.optionList || []).filter(o => o.answer).map(o => o.name || o.content || o.id);
                    log(`  Q: ${q.name || q.id} → ${opts.join(', ') || '无答案'}`);
                }
            }
        } catch (e) {
            log(`⚠ 答案API不可用: ${e.message || e}，使用空答案集`, 'warn');
            extData = { data: { questionList: [] } };
        }

        log(`📄 获取试卷…`);
        const paperResp = await apiPost(API.QUIZ_PAPER, { tid });
        const result = paperResp.result;
        if (!result) throw new Error('试卷数据为空');

        const correctIds = new Set();
        for (const q of (extData.data?.questionList || []))
            for (const o of (q.optionList || []))
                if (o.answer) correctIds.add(o.id);

        const questions = result.objectiveQList || [];
        log(`试卷共 ${questions.length} 题`);
        const answers = questions.map(Q => {
            const matched = (Q.optionDtos || []).filter(o => correctIds.has(o.id));
            return {
                qid: Q.id, type: Q.type,
                optIds: matched.map(o => o.id),
                time: Math.floor(Date.now() / 1000),
            };
        });
        result.answers = answers;

        const matchedCount = answers.filter(a => a.optIds.length > 0).length;
        log(`📤 提交答案 (${matchedCount}/${answers.length} 题已匹配选项)`);
        const resp = await apiPost(API.SUBMIT, { paperDto: result, preview: false });
        log(`✅ 提交成功`, 'ok');
        if (resp.result) {
            const s = resp.result;
            log(`  得分: ${s.score !== undefined ? s.score : '?'}  /  ${s.totalScore !== undefined ? s.totalScore : '?'}`);
        }
        console.log('[mooc-helper] 提交响应:', resp);
        return resp;
    }

    async function completeHomework(tid, info) {
        log(`📄 获取作业… [${info || tid}]`);
        let paper;
        for (let i = 0; i < 10; i++) {
            const res = await apiPost(API.HW_PAPER, { tid, withStdAnswerAndAnalyse: false });
            if (res.result) { paper = res; break; }
            log(`  并发限制，重试 (${i + 1}/10)…`, 'warn');
            if (i < 9) await new Promise(r => setTimeout(r, 1000));
        }
        if (!paper) throw new Error('获取作业失败（并发限制）');
        const result = paper.result;

        log(`构建答案 (${(result.subjectiveQList || []).length} 道主观题)`);
        const answers = (result.subjectiveQList || []).map(a => {
            const texts = (a.judgeDtos || []).map(j => j.msg);
            log(`  Q: ${a.name || a.id} → ${texts[0] ? texts[0].slice(0, 80) + (texts[0].length > 80 ? '…' : '') : '(空)'}`);
            return {
                qid: a.id, type: a.type,
                content: { content: texts.join('\n'), attachments: [] },
            };
        });
        result.answers = answers;
        log(`📤 提交答案…`);
        const resp = await apiPost(API.SUBMIT, { paperDto: result, preview: false });
        log(`✅ 提交成功`, 'ok');
        if (resp.result) {
            const s = resp.result;
            log(`  得分: ${s.score !== undefined ? s.score : '?'}  /  ${s.totalScore !== undefined ? s.totalScore : '?'}`);
        }
        console.log('[mooc-helper] 提交响应:', resp);
        return resp;
    }

    function completeExam(tid, info) {
        log(`📝 考试 (同测试逻辑)`);
        return completeQuiz(tid, info);
    }

    /* ============================= UI ============================= */

    const style = document.createElement('style');
    style.textContent = `
        .mh-wrap { position:fixed; top:64px; right:16px; z-index:999999; display:flex; flex-direction:column; gap:8px; max-width:340px; }
        .mh-panel { background:#fff; border:1px solid #e0e0e0; border-radius:8px; padding:12px 16px; box-shadow:0 4px 16px rgba(0,0,0,.12); font:14px/1.5 "Microsoft YaHei",sans-serif; min-width:150px; box-sizing:border-box; overflow:hidden; }
        .mh-btn { display:block; width:100%; max-width:100%; box-sizing:border-box; padding:8px 14px; margin-bottom:6px; border:none; border-radius:4px; cursor:pointer; font-size:13px; font-weight:600; text-align:center; transition:.15s; white-space:normal; overflow-wrap:anywhere; }
        .mh-btn:last-child { margin-bottom:0; }
        .mh-btn:active { transform:scale(.97); }
        .mh-btn:disabled { opacity:.6; cursor:not-allowed; transform:none; }
        .mh-btn-red { background:#00cc7e; color:#fff; }
        .mh-btn-red:hover:not(:disabled) { background:#00a866; box-shadow:0 2px 8px rgba(0,204,126,.35); }
        .mh-btn-green { background:#00cc7e; color:#fff; }
        .mh-btn-green:hover:not(:disabled) { background:#00a866; box-shadow:0 2px 8px rgba(0,204,126,.35); }
        .mh-log { max-height:260px; overflow-y:auto; font-size:11px; line-height:1.5; margin-top:6px; border-top:1px solid #eee; padding-top:6px; }
        .mh-log-line { padding:1px 0; color:#555; word-break:break-all; }
        .mh-log-line.ok   { color:#00a866; }
        .mh-log-line.err  { color:#e4393c; }
        .mh-log-line.info { color:#1890ff; }
        .mh-log-line.warn { color:#d48806; }
    `;
    let container = null;
    let logEl = null;

    function buildUI() {
        if (!style.isConnected) document.head.appendChild(style);
        if (container) container.remove();
        container = document.createElement('div');
        container.className = 'mh-wrap';
        const panel = document.createElement('div');
        panel.className = 'mh-panel';
        container.appendChild(panel);
        document.body.appendChild(container);
        logEl = null;
        return panel;
    }

    function btn(text, onClick, color = 'red') {
        const el = document.createElement('button');
        el.className = 'mh-btn mh-btn-' + color;
        el.textContent = text;
        container.querySelector('.mh-panel').appendChild(el);
        el.addEventListener('click', async () => {
            el.disabled = true;
            el.textContent = '处理中…';
            clearLog();
            try {
                await onClick();
                el.textContent = '✅ 已完成';
            } catch (e) {
                log('❌ ' + (e.message || e), 'err');
                el.textContent = text;
                el.disabled = false;
            }
        });
        return el;
    }

    function clearLog() {
        if (logEl) { logEl.innerHTML = ''; }
    }

    function log(msg, cls = '') {
        if (!logEl) {
            logEl = document.createElement('div');
            logEl.className = 'mh-log';
            container.querySelector('.mh-panel').appendChild(logEl);
        }
        const line = document.createElement('div');
        line.className = 'mh-log-line' + (cls ? ' ' + cls : '');
        line.textContent = msg;
        logEl.appendChild(line);
        logEl.scrollTop = logEl.scrollHeight;
        console.log('[mooc-helper]', msg);
    }

    /* ============================= Page handler ============================= */

    function handlePage() {
        const type = pageType();
        const id   = getId();
        const tid  = getTid();
        if (type === 'course' && !tid) {
            if (container) {
                container.remove();
                container = null;
                logEl = null;
            }
            if (style.isConnected) style.remove();
            return;
        }
        if (type !== 'course' && !id) return;
        buildUI();

        if (type === 'course') {
            btn('一键扫描并完成全部', async () => {
                log(`📡 获取课程信息 (tid=${tid})…`);
                const res = await apiPost(API.COURSE, { termId: parseInt(tid) });
                const term = res.result?.mocTermDto;
                if (!term) throw new Error('获取课程信息失败');
                const courseName = term.courseName || '(未知课程)';
                log(`📚 ${courseName}`);

                const chapters = term.chapters || [];
                log(`共 ${chapters.length} 章`);
                const items = [];
                for (const ch of chapters) {
                    const chName = ch.name || '(未命名章节)';
                    let hasAny = false;

                    for (const hw of (ch.homeworks || [])) {
                        const t = hw.test;
                        if (!t) continue;
                        const deadline = formatTime(t.deadline);
                        const isDead = t.deadline && t.deadline < Date.now();
                        log(`  [${chName}] 📝 ${t.name || '作业'} | 截止:${deadline} | 得分:${t.userScore ?? '?'}/${t.totalScore ?? '?'}${isDead ? ' ⏰已截止' : ''}`);
                        if (!isDead) {
                            items.push({ type: 'hw', id: t.id, name: t.name, ch: chName });
                            hasAny = true;
                        }
                    }

                    for (const q of (ch.quizs || [])) {
                        const t = q.test;
                        if (!t) continue;
                        const deadline = formatTime(t.deadline);
                        const isDead = t.deadline && t.deadline < Date.now();
                        const fullScore = t.userScore != null && t.totalScore != null && t.userScore >= t.totalScore;
                        log(`  [${chName}] 📋 ${t.name || '测试'} | 截止:${deadline} | 得分:${t.userScore ?? '?'}/${t.totalScore ?? '?'}${isDead ? ' ⏰已截止' : ''}${fullScore ? ' ✅已满分' : ''}`);
                        if (!isDead && !fullScore) {
                            items.push({ type: 'quiz', id: t.id, name: t.name, ch: chName });
                            hasAny = true;
                        }
                    }

                    const ex = ch.exam?.objectTestVo;
                    if (ex) {
                        const deadline = formatTime(ex.deadline);
                        const isDead = ex.deadline && ex.deadline < Date.now();
                        const fullScore = ex.userScore != null && ex.totalScore != null && ex.userScore >= ex.totalScore;
                        log(`  [${chName}] 📝 ${ex.name || '考试'} | 截止:${deadline} | 得分:${ex.userScore ?? '?'}/${ex.totalScore ?? '?'}${isDead ? ' ⏰已截止' : ''}${fullScore ? ' ✅已满分' : ''}`);
                        if (!isDead && !fullScore) {
                            items.push({ type: 'exam', id: ex.id, name: ex.name, ch: chName });
                            hasAny = true;
                        }
                    }

                    if (!hasAny) log(`  [${chName}] (无待处理项)`);
                }

                if (items.length === 0) {
                    throw new Error('没有待完成的任务（均已满分或已截止）');
                }

                log(`\n🔄 开始处理 ${items.length} 项…`);
                let done = 0;
                for (const item of items) {
                    log(`── ${item.ch} / ${item.name || item.id} ──`);
                    try {
                        if (item.type === 'hw') await completeHomework(item.id, item.name || item.id);
                        else if (item.type === 'exam') await completeExam(item.id, item.name || item.id);
                        else await completeQuiz(item.id, item.name || item.id);
                        done++;
                        log(`✅ ${item.name || item.id} 完成`, 'ok');
                    } catch (e) {
                        log(`❌ ${item.name || item.id} 失败: ${e.message || e}`, 'err');
                        console.error('[mooc-helper] 失败:', item, e);
                    }
                }
                log(done === items.length ? `\n🎉 全部完成 (${done}/${items.length})` : `\n⚠ 完成 ${done}/${items.length}，${items.length - done} 项失败`,
                    done === items.length ? 'ok' : 'err');
            });
        } else if (type === 'quiz' && id) {
            log(`📋 单元测试页面: id=${id}`);
            btn('完成单元测试', () => completeQuiz(id));
        } else if (type === 'hw' && id) {
            log(`📝 单元作业页面: id=${id}`);
            btn('完成单元作业', () => completeHomework(id));
        } else if (type === 'exam' && id) {
            log(`📝 考试页面: id=${id}`);
            btn('完成考试', () => completeExam(id));
        }
    }

    /* ============================= Init ============================= */

    setTimeout(handlePage, 800);
    window.addEventListener('hashchange', () => setTimeout(handlePage, 800));

})();
