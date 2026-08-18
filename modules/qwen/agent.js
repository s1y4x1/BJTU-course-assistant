/* 通义千问智能代理：注入操作清单与调用约定，解析回复末尾的操作调用并循环执行。 */
(function initBjtuQwenAgent(global) {
  'use strict';

  const OPERATION_BLOCK_PATTERN = /```op\s*\n?([\s\S]*?)```/g;
  const OP_CALL_PATTERN = /^\s*([A-Za-z_$][A-Za-z0-9_$.]*)\s*\((.*)\)\s*$/s;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function formatOutcomeError(outcome) {
    const parts = [];
    if (outcome?.code) parts.push(`错误代码：${outcome.code}`);
    parts.push(String(outcome?.error || '操作失败'));
    return parts.join('\n');
  }

  function parseOpArguments(argText) {
    const trimmed = String(argText || '').trim();
    if (!trimmed) return {};
    const jsonText = trimmed.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":');
    const parsed = JSON.parse(jsonText);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  }

  function parseTrailingOperation(reply) {
    const text = String(reply || '');
    OPERATION_BLOCK_PATTERN.lastIndex = 0;
    let match;
    let last = null;
    while ((match = OPERATION_BLOCK_PATTERN.exec(text))) {
      last = match;
    }
    if (!last) return null;
    const remainder = text.slice(last.index + last[0].length).trim();
    if (remainder) return null;
    const call = OP_CALL_PATTERN.exec(last[1].trim());
    if (!call) return null;
    const name = String(call[1] || '').trim();
    if (!name) return null;
    try {
      return { name, arguments: parseOpArguments(call[2]) };
    } catch {
      return null;
    }
  }

  function renderOperationCall({ name, arguments: args }) {
    const entries = Object.keys(args || {});
    const argText = entries.map((key) => `${key}: ${JSON.stringify(args[key])}`).join(', ');
    return [
      '```op',
      entries.length ? `${name}({${argText}})` : `${name}()`,
      '```'
    ].join('\n');
  }

  function buildSystemPrompt({ qwenDocs = '' }) {
    const lines = [
      '你是「BJTU 课程助手」的智能代理，可以调用扩展提供的操作来获取或操作数据。',
      '',
      '# 发现可用操作',
      '可用的操作由本扩展各模块提供，名称会随模块与配置而变化。请先调用 `qwen.getDoc` 查询具体某个操作的说明（含参数与返回示例），确认参数名与格式后再调用。',
      '',
      ...(String(qwenDocs || '').trim() ? [qwenDocs, ''] : []),
      '',
      '# 调用操作的规范',
      '- 操作调用必须位于回复的最后，代码块之后不能再有其它内容。',
      '- 一次回复只能附一个操作调用。',
      '- 调用操作后，扩展会把操作结果（无论成功或失败）作为新的输入继续发给你；若操作失败，输入中会附带该操作的说明文档，请据此修正参数后重试。',
      '- 若操作失败是因为需要用户登录、操作不可用或连续重试仍无法解决，请直接在回复中告知用户，不要无限重复调用。',
      '- 如果你不需要调用操作，直接给出最终答复即可。',
      '',
      '# 回答要求',
      '- 使用与用户问题相同的语言回答。',
      '- 基于真实操作返回的数据作答，不要编造。',
      '- 内容简洁、条理清晰。',
      '',
      '---',
      '现在，请**立即**调用 `qwen.listOperations` 获取当前可用的操作名列表（按模块分组），再做个开场白（可以用诗歌，新旧形式皆可，或其他形式）。'
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

    const loopSession = options.sessionRef || {};
    if (alwaysAllow === true) loopSession.alwaysAllow = true;
    const iterationLimit = Number(maxIterations) > 0 ? Number(maxIterations) : 6;
    let effectiveLimit = loopSession.alwaysAllow === true ? Infinity : iterationLimit;
    let iteration = 0;

    while (true) {
      if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');

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
        const code = String(error?.code || '');
        if (code === 'NOT_LOGGED_IN' || code === 'DISABLED') throw error;
        const decision = typeof onRetryRequest === 'function'
          ? await onRetryRequest({ message: String(error?.message || error), code })
          : null;
        if (decision !== 'retry') throw error;
        continue;
      }
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

      const call = parseTrailingOperation(replyText);
      if (!call) {
        OPERATION_BLOCK_PATTERN.lastIndex = 0;
        if (OPERATION_BLOCK_PATTERN.test(replyText)) {
          lastResultText = [
            '```res',
            '操作调用语法有误，请按规范重新编写 op 代码块',
            '```',
            '',
            '调用规范：在回复末尾附上以 ```op 标记的代码块，形式为 `操作名({参数名: 参数值, ...})`，参数名无需加引号，参数值用 JSON 语法（字符串加引号）；无参数时写作 `操作名()`。',
            '若无法给出正确的调用，请直接给出最终答复，不要再重复调用。'
          ].join('\n');
          iteration += 1;
          continue;
        }
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
      onEvent?.({ operation: call, iteration });
      const outcome = await operations.run(call.name, call.arguments);
      onEvent?.({ operationResult: outcome, iteration });

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
    parseTrailingOperation,
    renderOperationCall,
    buildSystemPrompt,
    runTurn
  };
})(globalThis);