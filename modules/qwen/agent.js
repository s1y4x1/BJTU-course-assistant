/* 通义千问智能代理：解析 sandbox/app/background 代码块并按顺序循环执行。 */
(function initBjtuQwenAgent(global) {
  'use strict';

  const EXECUTION_BLOCK_PATTERN = /```(sandbox|app|background)\s*\n?([\s\S]*?)```/gi;
  const SYSTEM_PROMPT_PATH = 'modules/qwen/SystemPrompt.md';
  const SYSTEM_PROMPT_DOCS_PLACEHOLDER = '{{QWEN_DOCS}}';
  let systemPromptTemplatePromise = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function formatOutcomeError(outcome) {
    const parts = [];
    if (outcome?.code) parts.push(`错误代码：${outcome.code}`);
    parts.push(String(outcome?.error || '操作失败'));
    return parts.join('\n');
  }

  function parseExecutionBlocks(reply) {
    const originalText = String(reply || '');
    const suggestions = /(?:^|\n)[ \t]*```suggestions[ \t]*\n[\s\S]*?```[ \t]*$/i.exec(originalText);
    const text = suggestions ? originalText.slice(0, suggestions.index).trimEnd() : originalText;
    EXECUTION_BLOCK_PATTERN.lastIndex = 0;
    let match;
    const matches = [];
    while ((match = EXECUTION_BLOCK_PATTERN.exec(text))) {
      matches.push({
        index: match.index,
        end: match.index + match[0].length,
        mode: String(match[1] || '').toLowerCase(),
        code: String(match[2] || '')
      });
    }
    if (matches.length !== 1) return null;
    return {
      cleanText: text.slice(0, matches[0].index).trimEnd(),
      executions: matches.map((item, index) => ({
        mode: item.mode,
        code: item.code,
        name: `code.${item.mode}`,
        description: text.slice(item.end, matches[index + 1]?.index ?? text.length).trim()
      }))
    };
  }

  function parseTrailingExecution(reply) {
    return parseExecutionBlocks(reply)?.executions?.at(-1) || null;
  }

  function operationNamesInCode(code, operations, groups = []) {
    const source = String(code || '');
    const availableNames = new Set((groups || []).flatMap((group) => group?.operations || []).map((entry) => String(entry?.name ?? entry ?? '')));
    return (typeof operations?.list === 'function' ? operations.list() : [])
      .map((operation) => String(operation?.name || ''))
      .filter(Boolean)
      .filter((name) => availableNames.size === 0 || availableNames.has(name))
      .filter((name) => {
        const [namespace, method] = name.split('.');
        if (!namespace || !method) return false;
        const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(?:^|[^\\w$])${escapePattern(namespace)}\\s*\\.\\s*${escapePattern(method)}\\s*\\(`).test(source);
      });
  }

  function loadSystemPromptTemplate() {
    if (!systemPromptTemplatePromise) {
      const url = chrome.runtime.getURL(SYSTEM_PROMPT_PATH);
      systemPromptTemplatePromise = fetch(url).then(async (response) => {
        if (!response.ok) throw new Error(`系统提示词加载失败：HTTP ${response.status}`);
        const template = (await response.text()).trim();
        if (!template.includes(SYSTEM_PROMPT_DOCS_PLACEHOLDER)) {
          throw new Error(`系统提示词缺少占位符 ${SYSTEM_PROMPT_DOCS_PLACEHOLDER}`);
        }
        return template;
      });
    }
    return systemPromptTemplatePromise;
  }

  async function buildSystemPrompt({ qwenDocs = '' } = {}) {
    const template = await loadSystemPromptTemplate();
    return template.replace(SYSTEM_PROMPT_DOCS_PLACEHOLDER, String(qwenDocs || '').trim());
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
      alwaysAllowedOperations = [],
      onAlwaysAllowOperations,
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
    const turnAllowedModes = new Set();
    const persistentAllowedOperations = new Set((alwaysAllowedOperations || []).map(String));
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
      const fullTextBeforeRequest = fullText;
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
            if (event?.streamRestart) {
              fullText = fullTextBeforeRequest;
              onEvent?.({ streamRestart: true, iteration });
            } else if (event?.thinking) {
              onEvent?.({ thinking: event.thinking, iteration });
            } else if (event?.text) {
              fullText += event.text;
              onDelta?.(event.text);
            } else if (event?.functionCall) {
              onEvent?.({ functionCall: event.functionCall, iteration });
            } else if (event?.functionResult) {
              onEvent?.({ functionResult: event.functionResult, iteration });
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
        if (code === 'REQUEST_ENDED') {
          return {
            chatId: effectiveChatId,
            responseId: String(error?.responseId || turnRef?.responseId || parentId || ''),
            modelId,
            text: '',
            fullText: fullTextBeforeRequest,
            operations: [],
            final: '',
            historyReloadRequired: true
          };
        }
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

      const parsedExecution = parseExecutionBlocks(replyText);
      if (!parsedExecution) {
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

      lastCleanReply = parsedExecution.cleanText;
      const outcomes = [];
      for (const execution of parsedExecution.executions) {
        const operationNames = operationNamesInCode(execution.code, operations, groups);
        onEvent?.({ operation: { name: execution.name, mode: execution.mode, description: execution.description, operationNames }, iteration });
        let outcome;
        if (execution.mode !== 'sandbox') {
          const sessionAllowedModes = loopSession.alwaysAllowedModes || (loopSession.alwaysAllowedModes = {});
          const operationsAllowed = operationNames.length > 0
            && operationNames.every((name) => persistentAllowedOperations.has(name));
          let allowed = turnAllowedModes.has(execution.mode)
            || sessionAllowedModes[execution.mode] === true
            || operationsAllowed;
          if (!allowed && typeof askUser === 'function') {
            const preview = execution.code.trim().slice(0, 500);
            const explanation = String(execution.description || '').trim();
            const decision = await askUser({
              mode: 'operation-permission',
              executionMode: execution.mode,
              operationNames,
              message: [
                `通义千问请求在 ${execution.mode} 环境执行 JavaScript，是否允许？`,
                explanation ? `操作说明：${explanation}` : '',
                preview ? `代码：\n${preview}` : ''
              ].filter(Boolean).join('\n\n'),
              count: 1
            });
            if (decision?.action === 'always-turn') {
              turnAllowedModes.add(execution.mode);
              allowed = true;
            } else if (decision?.action === 'always-session') {
              sessionAllowedModes[execution.mode] = true;
              allowed = true;
            } else if (decision?.action === 'always-operations' && operationNames.length) {
              operationNames.forEach((name) => persistentAllowedOperations.add(name));
              await onAlwaysAllowOperations?.([...persistentAllowedOperations]);
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
        outcomes.push({ execution, outcome });
        onEvent?.({ operationResult: outcome, iteration });
      }
      pendingOperationResult = outcomes.map(({ outcome }) => outcome);
      hasPendingOperationResult = true;

      const { execution, outcome } = outcomes[0];
      lastResultText = [
        `\`\`\`res: ${execution.mode}`,
        outcome.ok ? operations.formatResult(outcome.result) : formatOutcomeError(outcome),
        '```',
        outcome.ok ? '' : '若该操作无法成功（例如需要用户先登录、操作不可用，或修正后仍失败），请直接给出最终答复，不要再重复调用。'
      ].filter(Boolean).join('\n');
      iteration += 1;
    }
  }

  global.BjtuQwenAgent = {
    parseTrailingExecution,
    parseExecutionBlocks,
    operationNamesInCode,
    buildSystemPrompt,
    runTurn
  };
})(globalThis);
