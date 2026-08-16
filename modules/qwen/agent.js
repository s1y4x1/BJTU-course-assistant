/* 通义千问智能代理：注入操作清单与调用约定，解析回复末尾的操作调用并循环执行。 */
(function initBjtuQwenAgent(global) {
  'use strict';

  const OPERATION_BLOCK_PATTERN = /```op\s*\n?([\s\S]*?)```/g;

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
    try {
      const parsed = JSON.parse(last[1].trim());
      const name = String(parsed?.name || '').trim();
      if (!name) return null;
      return { name, arguments: (parsed?.arguments || {}) };
    } catch {
      return null;
    }
  }

  function renderOperationCall({ name, arguments: args }) {
    return [
      '```op',
      JSON.stringify({ name, arguments: args || {} }),
      '```'
    ].join('\n');
  }

  function buildSystemPrompt({ groups, enabledOps = null, qwenDocs = '' }) {
    const enabledSet = Array.isArray(enabledOps) && enabledOps.length
      ? new Set(enabledOps.map((item) => String(item).trim()))
      : null;
    const lines = [
      '你是「BJTU 课程助手」的智能代理，可以调用扩展提供的操作来获取或操作数据。',
      '',
      '## 可用操作（按模块分组）',
      '**请优先获取操作的调用说明再调用它**：在调用任何非 qwen 模块的操作之前，必须先调用 `qwen.getOperationDocs` 查询该操作的说明（含参数与返回示例），确认参数名与格式后再调用。',
      ''
    ];
    for (const group of (Array.isArray(groups) ? groups : [])) {
      const names = (group.operations || []).filter((name) => !enabledSet || enabledSet.has(name) || name.startsWith('qwen.'));
      if (!names.length) continue;
      lines.push(`### ${group.label}`);
      lines.push(names.map((name) => `- \`${name}\``).join('\n'));
      lines.push('');
    }
    lines.push(
      '## 元操作说明（已内嵌，可直接照此调用）',
      ...(String(qwenDocs || '').trim() ? [qwenDocs, ''] : []),
      '## 如何调用操作',
      '当你需要调用某个操作时，在你的**回复末尾**附上一个以 ```op 标记的代码块，内容为一个 JSON 对象：',
      '',
      '```op',
      '{"name":"操作名","arguments":{参数对象}}',
      '```',
      '',
      '- 操作调用必须位于回复的最后，代码块之后不能再有其它内容。',
      '- 一次回复只能附一个操作调用。',
      '- 调用操作后，扩展会把操作结果（无论成功或失败）作为新的输入继续发给你；若操作失败，输入中会附带该操作的说明文档，请据此修正参数后重试。',
      '- 若操作失败是因为需要用户登录、操作不可用或连续重试仍无法解决，请直接在回复中告知用户，不要无限重复调用。',
      '- 如果你不需要调用操作，直接给出最终答复即可。',
      '',
      '## 回答要求',
      '- 使用与用户问题相同的语言回答。',
      '- 基于真实操作返回的数据作答，不要编造。',
      '- 内容简洁、条理清晰。'
    );
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
      enabledOps,
      groups,
      onDelta,
      onEvent,
      signal,
      turnRef,
      maxIterations = 6,
      thinking = false
    } = options || {};
    const client = global.BjtuQwenClient;
    const operations = global.BjtuQwenOperations;
    if (!client || !operations) throw new Error('通义千问模块未就绪');
    await ensureLoggedIn();

    const effectiveChatId = String(chatId || '') || await client.newChat(modelId);
    if (turnRef) turnRef.chatId = effectiveChatId;
    const systemPrompt = buildSystemPrompt({
      groups: Array.isArray(groups) && groups.length ? groups : operations.groups(),
      enabledOps,
      qwenDocs: [
        operations.docs('qwen.listOperations')?.doc,
        operations.docs('qwen.getOperationDocs')?.doc
      ].filter(Boolean).join('\n\n')
    });

    let parentId = '';
    const history = [];
    let fullText = '';
    let lastResultText = '';

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
      const content = iteration === 0
        ? [systemPrompt, '', '---', '', '用户问题：', userText].join('\n')
        : lastResultText;
      const message = client.buildUserMessage({ modelId, content, thinking });
      message.parent_id = parentId || null;
      message.parentId = parentId || null;

      const response = await client.streamCompletions({
        chatId: effectiveChatId,
        modelId,
        messages: history.concat([message]),
        onEvent: (event) => {
          if (event?.text) {
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
      parentId = String(response?.responseId || parentId);
      if (turnRef) turnRef.responseId = parentId;
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
        return {
          chatId: effectiveChatId,
          modelId,
          text: replyText,
          fullText,
          operations: [],
          final: replyText
        };
      }

      onEvent?.({ operation: call, iteration });
      const outcome = await operations.run(call.name, call.arguments);
      onEvent?.({ operationResult: outcome, iteration });

      const doc = operations.docs(call.name)?.doc || '';
      if (outcome.ok) {
        lastResultText = [
          '你此前在回复末尾调用了操作，操作调用与结果如下：',
          '',
          renderOperationCall(call),
          '',
          '操作结果（JSON）：',
          JSON.stringify(outcome.result)
        ].join('\n');
      } else {
        lastResultText = [
          '你此前调用的操作失败了，调用与失败结果如下：',
          '',
          renderOperationCall(call),
          '',
          '操作结果（JSON）：',
          JSON.stringify(outcome),
          '',
          ...(doc ? ['该操作的说明文档如下，请按文档修正参数后重试：', '', doc] : []),
          '',
          '若该操作无法成功（例如需要用户先登录、操作不可用，或修正后仍失败），请直接给出最终答复，不要再重复调用。'
        ].join('\n');
      }
    }

    throw new Error('操作调用次数过多，已停止循环。');
  }

  global.BjtuQwenAgent = {
    parseTrailingOperation,
    renderOperationCall,
    buildSystemPrompt,
    runTurn
  };
})(globalThis);