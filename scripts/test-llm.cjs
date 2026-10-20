'use strict';
/**
 * 模型适配器测试：node scripts/test-llm.cjs
 *
 * 为什么需要这个测试：
 *   默认的 mock 适配器**完全不经过** openai / anthropic 分支，
 *   所以「重试、超时、错误分类、SSE 解析、usage 映射、成本计量」这些真正容易出错的地方，
 *   之前一条都没被验证过。这里起一个本地假模型服务器，把真实 HTTP 路径走一遍。
 *
 * 不需要联网、不需要 API key。
 */

const http = require('node:http');
const llm = require('../lib/llm.js');

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
  }
}

/* ------------------------------------------------------------ 假模型服务器 */

let chatHits = 0;
let chatOk = 0;
let lastBody = null;
let lastHeaders = null;

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

const server = http.createServer(async (req, res) => {
  const raw = await readBody(req);
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch {
    /* 空体 */
  }
  lastBody = body;
  lastHeaders = req.headers;

  const isAnthropic = /\/messages$/.test(req.url);
  const isChat = /\/chat\/completions$/.test(req.url);

  /* ---- Anthropic ---- */
  if (isAnthropic) {
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const piece of ['你好', '世界']) {
        res.write(
          'event: content_block_delta\ndata: ' +
            JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: piece } }) +
            '\n\n'
        );
      }
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        content: [{ type: 'text', text: 'anthropic-ok' }],
        usage: { input_tokens: 100, output_tokens: 20 }
      })
    );
    return;
  }

  /* ---- OpenAI 兼容 ---- */
  if (isChat) {
    chatHits++;
    // 第 1 次故意 429：验证指数退避重试真的会重发
    if (chatHits === 1) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'rate limited' } }));
      return;
    }
    // 指定 model 名即可触发 401：验证不可重试错误立刻抛出
    if (body.model === 'fail-401') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'bad key' } }));
      return;
    }
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const piece of ['流式', '输出', '正常']) {
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: piece } }] }) + '\n\n');
      }
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    chatOk++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'openai-ok' } }],
        usage: { prompt_tokens: 120, completion_tokens: 30 }
      })
    );
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

/* ------------------------------------------------------------ 跑测试 */

const messages = [{ role: 'user', content: '你好' }];

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;
  console.log('模型适配器测试 · 假服务器 ' + base + '\n');

  try {
    /* ---------- 1. OpenAI 兼容 + 失败重试 ---------- */
    console.log('[1] OpenAI 兼容分支（首次 429 → 自动重试）');
    const r1 = await llm.generate({
      provider: 'openai',
      baseURL: base + '/v1',
      model: 'gpt-4o-mini',
      apiKey: 'test-key',
      messages,
      maxRetries: 2
    });
    check('拿到文本', r1.text === 'openai-ok', r1.text);
    check('解析出 usage', r1.usage.promptTokens === 120 && r1.usage.completionTokens === 30, JSON.stringify(r1.usage));
    check('记录了重试次数 1', r1.retries === 1, String(r1.retries));
    check('估算了成本（>0）', r1.costUsd > 0, String(r1.costUsd));
    check('provider / model 回填正确', r1.provider === 'openai' && r1.model === 'gpt-4o-mini');
    check('确实发了 2 次请求', chatHits === 2, String(chatHits));
    check('请求体带 model / messages / max_tokens', !!lastBody.model && Array.isArray(lastBody.messages) && typeof lastBody.max_tokens === 'number');
    check('带了 Authorization: Bearer', (lastHeaders.authorization || '') === 'Bearer test-key', lastHeaders.authorization);
    check('key 没有出现在返回结果里', !JSON.stringify(r1).includes('test-key'));

    /* ---------- 2. 不可重试错误 ---------- */
    console.log('\n[2] 不可重试错误（401 应立刻抛出、不重试）');
    const before = chatHits;
    let err401 = null;
    try {
      await llm.generate({
        provider: 'openai',
        baseURL: base + '/v1',
        model: 'fail-401',
        apiKey: 'test-key',
        messages,
        maxRetries: 3
      });
    } catch (e) {
      err401 = e;
    }
    check('抛出了 LlmError', err401 && err401.name === 'LlmError', err401 && err401.name);
    check('状态码是 401', err401 && err401.status === 401, err401 && String(err401.status));
    check('标记为不可重试', err401 && err401.retryable === false, err401 && String(err401.retryable));
    check('只发了 1 次请求（没有重试）', chatHits === before + 1, 'delta=' + (chatHits - before));

    /* ---------- 3. 流式 ---------- */
    console.log('\n[3] 流式 SSE 解析');
    let acc = '';
    let usageSeen = null;
    for await (const ev of llm.generateStream({
      provider: 'openai',
      baseURL: base + '/v1',
      model: 'gpt-4o-mini',
      apiKey: 'test-key',
      messages
    })) {
      if (ev.delta) acc += ev.delta;
      if (ev.done) usageSeen = ev.usage;
    }
    check('拼出完整文本', acc === '流式输出正常', acc);
    check('done 事件带 usage', !!usageSeen && usageSeen.completionTokens > 0, JSON.stringify(usageSeen));
    check('流式请求体带 stream:true', lastBody.stream === true);

    /* ---------- 4. Anthropic ---------- */
    console.log('\n[4] Anthropic 分支（system 必须单独传）');
    const r4 = await llm.generate({
      provider: 'anthropic',
      baseURL: base,
      model: 'claude-x',
      apiKey: 'test-key',
      messages: [{ role: 'system', content: '你是助手' }, ...messages]
    });
    check('拿到文本', r4.text === 'anthropic-ok', r4.text);
    check('usage 映射正确（input/output → prompt/completion）', r4.usage.promptTokens === 100 && r4.usage.completionTokens === 20, JSON.stringify(r4.usage));
    check('system 被拆到 body.system', lastBody.system === '你是助手', JSON.stringify(lastBody.system));
    check('messages 里不再含 system 角色', Array.isArray(lastBody.messages) && lastBody.messages.every((m) => m.role !== 'system'));
    check('带了 x-api-key 与 anthropic-version 头', lastHeaders['x-api-key'] === 'test-key' && !!lastHeaders['anthropic-version']);

    /* ---------- 5. Anthropic 流式 ---------- */
    console.log('\n[5] Anthropic 流式');
    let acc2 = '';
    for await (const ev of llm.generateStream({
      provider: 'anthropic',
      baseURL: base,
      model: 'claude-x',
      apiKey: 'test-key',
      messages
    })) {
      if (ev.delta) acc2 += ev.delta;
    }
    check('拼出完整文本', acc2 === '你好世界', acc2);

    /* ---------- 6. 主备降级 ---------- */
    console.log('\n[6] 主备降级（主 provider 401 → 自动切备用）');
    const r6 = await llm.generate({
      provider: 'openai',
      baseURL: base + '/v1',
      model: 'fail-401',
      apiKey: 'test-key',
      messages,
      providers: ['anthropic'],
      maxRetries: 0
    });
    check('主备切换后拿到了备用 provider 的结果', r6.text === 'anthropic-ok', r6.text);
    check('结果标记为备用 provider', r6.provider === 'anthropic', r6.provider);

    /* ---------- 7. 缺 key ---------- */
    console.log('\n[7] 未配置 key 应给出清晰错误');
    const saved = process.env.DD_LLM_API_KEY;
    delete process.env.DD_LLM_API_KEY;
    let keyErr = null;
    try {
      await llm.generate({ provider: 'moonshot', messages, apiKey: '' });
    } catch (e) {
      keyErr = e;
    }
    if (saved) process.env.DD_LLM_API_KEY = saved;
    check('报错信息说明了缺 key', keyErr && /未配置 API key/.test(keyErr.message), keyErr && keyErr.message);

    /* ---------- 8. token 估算与成本 ---------- */
    console.log('\n[8] token 估算与成本计量');
    const cjk = llm.estimateTokens('中文内容十个字需要估算');
    const ascii = llm.estimateTokens('abcdefgh');
    check('中文按字估算（接近字数）', cjk >= 10 && cjk <= 14, String(cjk));
    check('英文按 4 字符≈1 token 估算', ascii >= 1 && ascii <= 3, String(ascii));
    check('未知模型不炸、成本记 0', llm.estimateCost('no-such-model', { promptTokens: 10, completionTokens: 10 }) === 0);
    check('已知模型成本按价目表计算', llm.estimateCost('gpt-4o-mini', { promptTokens: 1e6, completionTokens: 0 }) > 0);
  } catch (e) {
    fail++;
    console.log('  ✗ 测试异常：' + (e && e.message ? e.message : e));
    if (e && e.stack) console.log(e.stack.split('\n').slice(0, 5).join('\n'));
  }

  console.log('\n汇总：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  server.close();
  process.exit(fail ? 1 : 0);
});
