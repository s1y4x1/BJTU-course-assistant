/* 通义千问智能代理：解析回复末尾的 sandbox/app/background 代码块并循环执行。 */
(function initBjtuQwenAgent(global) {
  'use strict';

  const EXECUTION_BLOCK_PATTERN = /```(sandbox|app|background)\s*\n?([\s\S]*?)```/gi;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function formatOutcomeError(outcome) {
    const parts = [];
    if (outcome?.code) parts.push(`错误代码：${outcome.code}`);
    parts.push(String(outcome?.error || '操作失败'));
    return parts.join('\n');
  }

  function parseTrailingExecution(reply) {
    const text = String(reply || '');
    EXECUTION_BLOCK_PATTERN.lastIndex = 0;
    let match;
    let last = null;
    while ((match = EXECUTION_BLOCK_PATTERN.exec(text))) {
      last = match;
    }
    if (!last) return null;
    const remainder = text.slice(last.index + last[0].length).trim();
    if (remainder) return null;
    return {
      mode: String(last[1] || '').toLowerCase(),
      code: String(last[2] || ''),
      name: `code.${String(last[1] || '').toLowerCase()}`
    };
  }

  function buildSystemPrompt({ qwenDocs = '' }) {
    const lines = [
      '你是「BJTU 课程助手」的智能代理，可以调用扩展提供的操作来获取或操作数据。',
      '',
      '# 发现可用操作',
      '可用的操作由本扩展各模块提供，名称会随模块与配置而变化。请通过 app 代码块直接调用 `qwen.getDoc()` 查询具体某个操作的说明（含参数与返回示例），确认参数名与格式后再调用。',
      '',
      ...(String(qwenDocs || '').trim() ? [qwenDocs, ''] : []),
      '',
      '# 如何执行代码与调用操作',
      '需要计算或调用扩展能力时，只能在回复末尾附上一个代码块；代码块之后不能再有内容。代码块语言决定执行环境：',
      '',
      '## sandbox',
      '- `sandbox` 在隔离沙箱中执行，不访问 app 页面、扩展后台、DOM 或 chrome API，也不需要询问用户。',
      '- 适合纯计算、数据整理和格式转换。表达式会直接返回；多条语句请显式 `return`。',
      '```sandbox',
      '[1, 2, 3].map((value) => value * 2)',
      '```',
      '',
      '## app',
      '- `app` 的代码仍由隔离执行器求值，但可以直接调用 app.html 上的全局函数；执行前需要用户授权。',
      '- 各模块操作已作为页面全局命名空间提供，例如 `ve.login()`、`ve.assignments({status:"pending"})`；调用前先用 `qwen.getDoc()` 查参数。',
      '- 单个函数调用可以直接作为末尾表达式，扩展会自动等待 Promise，不必额外写 `await`。',
      '```app',
      've.login()',
      '```',
      '',
      '## background',
      '- `background` 的代码在隔离执行器中求值，可以直接调用扩展 Service Worker 的全局函数与对象；执行前需要用户授权。',
      '- 它适合调用扩展已获权限的 `chrome.tabs`、`chrome.storage`、`chrome.cookies`、通知等后台 API，或后台模块公开的函数。',
      '- 后台没有 DOM，也不能依赖长久存在的页面状态；Service Worker 可能休眠。参数和返回值必须可结构化克隆/序列化。',
      '```background',
      'chrome.tabs.query({})',
      '```',
      '',
      '# 执行规范',
      '- 一次回复只能附一个 sandbox、app 或 background 代码块，且必须位于回复末尾。',
      '- 扩展会把执行结果（无论成功或失败）作为新的输入继续发给你。',
      '- app/background 权限更高，仅在确有必要时使用；sandbox 能完成的任务优先使用 sandbox。',
      '- 若执行失败是因为需要登录、能力不可用或连续重试仍无法解决，请直接告知用户，不要无限重复。',
      '- 如果不需要执行代码，直接给出最终答复，不附执行代码块。',
      '',
      '# 回答要求',
      '- 使用与用户问题相同的语言回答。',
      '- 基于真实操作返回的数据作答，不要编造。',
      '- 内容简洁、条理清晰。',
      '',
      '---',
      '现在，请**立即**在 app 代码块中直接调用 `qwen.listOperations()` 获取当前可用操作名列表（按模块分组），再做个开场白（可以用诗歌，新旧形式皆可，或其他形式）。'
    ];
    return lines.join('\n');
  }

  async function ensureLoggedIn() {
    const client = global.BjtuQwenClient;
    if (!client) throw new Error('通义千问客户端未就绪');
    if (await client.isLoggedIn()) return;
    throw Object.assign(new Error('尚未登录通义千问，请先打开 https://chat.qwen.ai/ 登录'), { code: 'NOT_LOGGED_IN' });
  }

  async function runTurn(options) {
    const {
      modelId,
      userText,
      chatId,
      parentId: previousParentId = '',
      enabledOps,
      groups,
      onDelta,
      onEvent,
      signal,
      turnRef,
      maxIterations = 6,
      thinking = false,
      askUser,
      onRetryRequest,
      sessionRef,
      alwaysAllow = false,
      parentIdExplicit = false
    } = options || {};
    const client = global.BjtuQwenClient;
    const operations = global.BjtuQwenOperations;
    if (!client || !operations) throw new Error('通义千问模块未就绪');
    await ensureLoggedIn();

    const providedChatId = String(chatId || '');
    let effectiveChatId = providedChatId;
    let fetchedHistory = [];
    if (providedChatId && typeof client.fetchChatHistory === 'function') {
      try {
        fetchedHistory = await client.fetchChatHistory(providedChatId);
      } catch {
        // 拉取失败：保守按已有会话处理
      }
    }
    if (!effectiveChatId) effectiveChatId = await client.newChat(modelId);
    if (turnRef) turnRef.chatId = effectiveChatId;

    let parentId = String(previousParentId || '');
    if (!parentIdExplicit && fetchedHistory.length && !parentId) {
      const list = Array.isArray(fetchedHistory) ? fetchedHistory : [];
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const msg = list[i];
        if (String(msg?.role || '') === 'assistant') {
          const id = String(msg?.response_id || msg?.id || '');
          if (id) {
            parentId = id;
            break;
          }
        }
      }
    }
    const history = [];
    let fullText = '';
    let lastResultText = '';
    let lastCleanReply = '';
    let pendingOperationResult;
    let hasPendingOperationResult = false;

    const loopSession = options.sessionRef || {};
    if (alwaysAllow === true) loopSession.alwaysAllow = true;
    const iterationLimit = Number(maxIterations) > 0 ? Number(maxIterations) : 6;
    let effectiveLimit = loopSession.alwaysAllow === true ? Infinity : iterationLimit;
    let iteration = 0;

    while (true) {
      if (signal?.aborted) throw signal.reason || new DOMException('生成中止', 'AbortError');

      if (iteration >= effectiveLimit) {
        const decision = typeof askUser === 'function'
          ? await askUser({ message: '操作调用次数过多，是否继续？', mode: 'iterate', count: iterationLimit })
          : null;
        if (!decision || decision.action === 'stop') {
          onEvent?.({ stoppedByLimit: true, iteration });
          return {
            chatId: effectiveChatId,
            responseId: parentId,
            modelId,
            text: lastCleanReply,
            fullText,
            operations: [],
            final: lastCleanReply,
            stoppedByLimit: true
          };
        }
        if (decision.action === 'always') {
          loopSession.alwaysAllow = true;
          effectiveLimit = Infinity;
          continue;
        }
        const extra = Math.max(1, Number(decision.count) || 0);
        effectiveLimit = iteration + extra;
        continue;
      }

      const content = iteration === 0 ? userText : lastResultText;
      if (turnRef) {
        turnRef.retryText = content;
        turnRef.retryParentId = parentId;
      }
      const message = client.buildUserMessage({ modelId, content, thinking });
      message.parent_id = parentId || null;
      message.parentId = parentId || null;

      let response;
      try {
        response = await client.streamCompletions({
          chatId: effectiveChatId,
          modelId,
          parentId,
          messages: [message],
          onEvent: (event) => {
            if (event?.responseId && turnRef) {
              turnRef.responseId = String(event.responseId);
            }
            if (event?.responseParentId && turnRef) {
              turnRef.lastMessageId = String(event.responseParentId);
            }
            if (event?.thinking) {
              onEvent?.({ thinking: event.thinking, iteration });
            } else if (event?.text) {
              fullText += event.text;
              onDelta?.(event.text);
            } else if (event?.finished) {
              onEvent?.({ finished: true, iteration });
            } else if (event?.meta) {
              onEvent?.({ meta: event.meta, iteration });
            }
          },
          signal
        });
      } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) throw error;
        const code = String(error?.code || '');
        if (code === 'NOT_LOGGED_IN' || code === 'DISABLED') throw error;
        const decision = typeof onRetryRequest === 'function'
          ? await onRetryRequest({
            message: String(error?.message || error),
            code,
            chatId: effectiveChatId,
            afterOperationResult: hasPendingOperationResult,
            operationResult: hasPendingOperationResult ? pendingOperationResult : undefined
          })
          : null;
        if (decision !== 'retry') throw error;
        continue;
      }
      hasPendingOperationResult = false;
      pendingOperationResult = undefined;
      parentId = String(response?.responseId || parentId);
      if (turnRef) turnRef.responseId = parentId;
      if (turnRef) turnRef.lastMessageId = String(response?.responseParentId || turnRef.lastMessageId || '');
      const replyText = String(response?.text || '');
      history.push(message, {
        id: null,
        fid: parentId || `asst-${iteration}`,
        parentId: null,
        childrenIds: [],
        role: 'assistant',
        content: replyText,
        user_action: 'chat',
        files: [],
        timestamp: Math.floor(Date.now() / 1000),
        models: [String(modelId || '')],
        model: String(modelId || ''),
        chat_type: 't2t',
        feature_config: { thinking_enabled: thinking === true, output_schema: 'phase', research_mode: 'normal', auto_thinking: false, thinking_mode: 'Auto', auto_search: false },
        extra: { meta: { subChatType: 't2t' } },
        sub_chat_type: 't2t',
        parent_id: null,
        response_id: parentId
      });

      const execution = parseTrailingExecution(replyText);
      if (!execution) {
        return {
          chatId: effectiveChatId,
          responseId: parentId,
          modelId,
          text: replyText,
          fullText,
          operations: [],
          final: replyText
        };
      }

      lastCleanReply = replyText;
      onEvent?.({ operation: { name: execution.name, mode: execution.mode }, iteration });
      let outcome;
      if (execution.mode !== 'sandbox') {
        const permissionKey = `code.${execution.mode}`;
        const alwaysAllowed = loopSession.alwaysAllowedOperations || (loopSession.alwaysAllowedOperations = {});
        let allowed = alwaysAllowed[permissionKey] === true;
        if (!allowed && typeof askUser === 'function') {
          const preview = execution.code.trim().slice(0, 500);
          const decision = await askUser({
            mode: 'operation-permission',
            message: `通义千问请求在 ${execution.mode} 环境执行 JavaScript，是否允许？${preview ? `\n\n${preview}` : ''}`,
            count: 1
          });
          if (decision?.action === 'always') {
            alwaysAllowed[permissionKey] = true;
            allowed = true;
          } else {
            allowed = decision?.action === 'continue';
          }
        }
        outcome = allowed
          ? await operations.executeCode(execution.mode, execution.code)
          : { ok: false, name: execution.name, code: 'USER_DENIED', error: `用户拒绝在 ${execution.mode} 环境执行 JavaScript` };
      } else {
        outcome = await operations.executeCode(execution.mode, execution.code);
      }
      onEvent?.({ operationResult: outcome, iteration });
      pendingOperationResult = outcome;
      hasPendingOperationResult = true;

      if (outcome.ok) {
        lastResultText = `\`\`\`res\n${operations.formatResult(outcome.result)}\n\`\`\``;
      } else {
        lastResultText = [
          '```res',
          formatOutcomeError(outcome),
          '```',
          '',
          '若该操作无法成功（例如需要用户先登录、操作不可用，或修正后仍失败），请直接给出最终答复，不要再重复调用。'
        ].join('\n');
      }
      iteration += 1;
    }
  }

  global.BjtuQwenAgent = {
    parseTrailingExecution,
    buildSystemPrompt,
    runTurn
  };
})(globalThis);
