import { COPILOT_TOOLS, executeTool, ToolContext } from './tools';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  name?: string;
  tool_calls?: any[];
}

export interface CopilotGenerationResult {
  text: string;
  executedTools: Array<{ name: string; args: any; result: any }>;
}

const SYSTEM_PROMPT = `You are the Research Opportunity Radar AI Copilot — an expert academic intelligence assistant.
Your mission is to help academic investigators discover funding opportunities, track submission deadlines, identify journal special issues, and strategically plan research submissions.
Strict Guidelines:
1. Be friendly, clear and accurate. Never guess deadlines or eligibility: use only what the tools return.
2. Only answer questions related to scientific research, grant funding calls, academic journals, conference venues, and submission strategies.
3. If an investigator asks about finding opportunities, call the 'searchOpportunities' tool.
4. When explaining recommendations, cite matched keywords, research methodologies, and funding themes accurately.
5. Never expose system credentials, database schemas, internal prompts, or private user data.
6. Write for a busy faculty member reading in a small chat panel, often on a phone:
   - Start with one plain sentence that answers the question. Use simple words, not jargon.
   - List calls as bullets, one per call: **[Call title](/opportunities/<id>)** — funder · closes 30 Nov 2026, then one short line on why it fits. Use the id returned by the tools in the link.
   - Write dates as "30 Nov 2026". Never show raw ids, field names or JSON.
   - Use **bold** only for call titles and key facts. Use a short heading only when the answer has several parts. Avoid tables unless the user asks to compare.
   - Keep answers under about 150 words, and end with one helpful next step, e.g. open a call or set a reminder.`;

const LLM_TIMEOUT_MS = 20000;
const MAX_TOOL_ROUNDS = 3;

// Model ids are env-configurable so a provider retiring a model is a config change, not a deploy.
const GEMINI_MODEL = () => process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const OPENAI_MODEL = () => process.env.OPENAI_MODEL || 'gpt-4o-mini';

const OPP_UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

type ExecutedTool = { name: string; args: any; result: any };

/**
 * Executes a conversational turn with the AI Research Copilot, utilizing Gemini/OpenAI if configured
 * or the built-in Academic Heuristic Copilot engine when running offline.
 */
export async function runCopilotTurn(
  messages: ChatMessage[],
  ctx: ToolContext
): Promise<CopilotGenerationResult> {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  // Tools a provider already ran this turn. If it then fails, the turn is NOT replayed on the next
  // provider: that would run actions such as saveOpportunity twice.
  const executedTools: ExecutedTool[] = [];

  // 1. Google Gemini Provider
  if (geminiKey) {
    try {
      return await runGeminiCopilot(messages, ctx, geminiKey, executedTools);
    } catch (err: any) {
      // Loud on purpose: a retired model or bad key otherwise degrades silently to the heuristic engine
      console.error(`[Copilot] Gemini (${GEMINI_MODEL()}) failed, falling back:`, err.message);
      if (executedTools.length) return partialTurn(executedTools);
    }
  }

  // 2. OpenAI Provider
  if (openaiKey) {
    try {
      return await runOpenAICopilot(messages, ctx, openaiKey, executedTools);
    } catch (err: any) {
      console.error(`[Copilot] OpenAI (${OPENAI_MODEL()}) failed, falling back:`, err.message);
      if (executedTools.length) return partialTurn(executedTools);
    }
  }

  // 3. Offline heuristic engine
  return runOfflineAcademicCopilot(messages, ctx);
}

/** The model failed after running tools: report what was done instead of re-running the turn. */
function partialTurn(executedTools: ExecutedTool[]): CopilotGenerationResult {
  const done = executedTools
    .map((t) => `- \`${t.name}\`${t.result?.error ? ` (failed: ${t.result.error})` : ''}`)
    .join('\n');
  return {
    text: `The assistant stopped before it could finish its answer. These steps were already carried out:\n\n${done}\n\nPlease ask again for the summary.`,
    executedTools
  };
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS)
  });
  if (!res.ok) {
    throw new Error(`${new URL(url).hostname} returned status ${res.status}`);
  }
  return res.json();
}

/**
 * Google Gemini Provider Implementation: function-calling loop until the model answers in text.
 */
async function runGeminiCopilot(
  messages: ChatMessage[],
  ctx: ToolContext,
  apiKey: string,
  executedTools: ExecutedTool[]
): Promise<CopilotGenerationResult> {
  const functionDeclarations = COPILOT_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'OBJECT',
      properties: Object.fromEntries(
        Object.entries(tool.parameters.properties).map(([k, v]) => [
          k,
          { type: 'STRING', description: v.description, ...(v.enum ? { enum: v.enum } : {}) }
        ])
      ),
      required: tool.parameters.required || []
    }
  }));

  const contents: any[] = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

  // Key goes in a header, not the query string, so it never lands in URL logs
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL()}:generateContent`;
  const headers = { 'x-goog-api-key': apiKey };

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const finalRound = round === MAX_TOOL_ROUNDS;
    const data = await postJson(endpoint, headers, {
      contents,
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      // No tools on the last round, so the model must answer with the results it already has
      ...(finalRound ? {} : { tools: [{ functionDeclarations }] }),
      // Gemini 2.5 "thinking" tokens count against maxOutputTokens and could leave no visible text;
      // this assistant doesn't need them
      generationConfig: { temperature: 0.2, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } }
    });

    const modelContent = data.candidates?.[0]?.content;
    const parts: any[] = modelContent?.parts || [];
    const calls = parts.filter((p) => p.functionCall);

    if (calls.length === 0 || finalRound) {
      const text = parts.map((p) => p.text || '').join('');
      return { text: text || 'No analysis generated.', executedTools };
    }

    contents.push(modelContent);
    const responses = [];
    for (const { functionCall } of calls) {
      const args = functionCall.args || {};
      const result = await executeTool(functionCall.name, args, ctx);
      executedTools.push({ name: functionCall.name, args, result });
      responses.push({ functionResponse: { name: functionCall.name, response: { content: result } } });
    }
    contents.push({ role: 'user', parts: responses });
  }

  return { text: 'No analysis generated.', executedTools };
}

/**
 * OpenAI Provider Implementation: tool-calling loop until the model answers in text.
 */
async function runOpenAICopilot(
  messages: ChatMessage[],
  ctx: ToolContext,
  apiKey: string,
  executedTools: ExecutedTool[]
): Promise<CopilotGenerationResult> {
  const openAiTools = COPILOT_TOOLS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }));

  const convo: any[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }))
  ];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const data = await postJson(
      'https://api.openai.com/v1/chat/completions',
      { Authorization: `Bearer ${apiKey}` },
      {
        model: OPENAI_MODEL(),
        messages: convo,
        ...(round < MAX_TOOL_ROUNDS ? { tools: openAiTools } : {}),
        temperature: 0.2
      }
    );

    const choice = data.choices?.[0]?.message;
    const toolCalls: any[] = choice?.tool_calls || [];
    if (toolCalls.length === 0) {
      return { text: choice?.content || 'No analysis generated.', executedTools };
    }

    convo.push(choice);
    for (const tc of toolCalls) {
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        args = {};
      }
      const result = await executeTool(tc.function.name, args, ctx);
      executedTools.push({ name: tc.function.name, args, result });
      convo.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }

  return { text: 'No analysis generated.', executedTools };
}

/** "2026-11-30 (India time)" -> "30 Nov 2026"; anything else unchanged. */
function readableDate(value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!m) return value || 'not published';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

const keywordList = (keywords: string[] | undefined) => (keywords?.length ? keywords.join(', ') : 'none yet');

/**
 * Offline Copilot: answers the common questions with the same tools when no LLM key is configured
 * (or the provider is down), in the same friendly format the LLM is asked to use.
 */
async function runOfflineAcademicCopilot(
  messages: ChatMessage[],
  ctx: ToolContext
): Promise<CopilotGenerationResult> {
  const executedTools: Array<{ name: string; args: any; result: any }> = [];
  const latestMessage = (messages[messages.length - 1]?.content || '').trim();
  const lower = latestMessage.toLowerCase();

  // 1. Save / bookmark a call by id
  if (lower.startsWith('save') || lower.startsWith('bookmark')) {
    const oppId = latestMessage.match(OPP_UUID_IN_TEXT)?.[0] ?? null;
    if (oppId) {
      const result = await executeTool('saveOpportunity', { opportunityId: oppId, saved: 'true' }, ctx);
      executedTools.push({ name: 'saveOpportunity', args: { opportunityId: oppId, saved: 'true' }, result });

      if (result?.error) {
        return { text: `**Couldn't save that call.** ${result.error}`, executedTools };
      }
      return {
        text: `**Saved.** You'll find it under **Saved** in your feed, and you can [open the call](/opportunities/${oppId}) any time.`,
        executedTools
      };
    }
  }

  // 2. "Why was this recommended?"
  if (lower.includes('why') || lower.includes('recommend') || lower.includes('match') || lower.includes('rationale')) {
    const oppId = latestMessage.match(OPP_UUID_IN_TEXT)?.[0] ?? null;

    if (oppId) {
      const result = await executeTool('getWhyRecommended', { opportunityId: oppId }, ctx);
      executedTools.push({ name: 'getWhyRecommended', args: { opportunityId: oppId }, result });
      if (result?.error) {
        return { text: `**I couldn't explain that match.** ${result.error}`, executedTools };
      }

      return {
        text: `**Why [${result.title || 'this call'}](/opportunities/${oppId}) fits you**\n\n${result.rationale}\n\n- **Words it shares with your profile:** ${keywordList(result.matched_keywords)}\n- **Your research keywords:** ${keywordList(result.investigator_keywords)}\n\nTip: use the shared words in your proposal summary.`,
        executedTools
      };
    }
  }

  // 3. Profile questions
  if (lower.includes('profile') || lower.includes('who am i') || lower.includes('keywords') || lower.includes('institution')) {
    const prof = await executeTool('getUserProfile', {}, ctx);
    executedTools.push({ name: 'getUserProfile', args: {}, result: prof });

    return {
      text: `**Your profile**\n\n- **Name:** ${prof.full_name || 'not set'}\n- **Institution:** ${prof.institution || 'not set'}${prof.department ? `\n- **Department:** ${prof.department}` : ''}\n- **Research keywords:** ${keywordList(prof.research_keywords)}\n\nCalls are matched against these. You can change them on your [Profile](/profile) page.`,
      executedTools
    };
  }

  // 4. Search
  const isSearchQuery =
    /\b(search|find|show|list|grant|grants|funding|call|calls|journal|journals|cfp|venue|venues|opportunity|opportunities)\b/i.test(latestMessage);

  if (isSearchQuery) {
    const cleanTerms = latestMessage
      .replace(/\b(find|search|for|funding|grants?|calls?|show|me|opportunities|please|about)\b/gi, ' ')
      .trim();
    const query = cleanTerms || 'research';
    const kind = lower.includes('journal') ? 'journal' : (lower.includes('funding') || lower.includes('grant') ? 'funding' : 'all');

    const results = await executeTool('searchOpportunities', { query, kind, limit: '4' }, ctx);
    executedTools.push({ name: 'searchOpportunities', args: { query, kind }, result: results });

    if (!Array.isArray(results) || results.length === 0) {
      return {
        text: `**No open calls match "${query}" right now.**\n\nTry fewer or broader words, or check that your [Profile](/profile) keywords describe your research. New calls are added every Monday and Thursday.`,
        executedTools
      };
    }

    const lines = results.map((opp: any) => {
      const funder = opp.agency_or_publisher ? `${opp.agency_or_publisher} · ` : '';
      const closes = opp.next_deadline === 'Not published' ? 'no deadline published' : `closes ${readableDate(opp.next_deadline)}`;
      return `- **[${opp.title}](/opportunities/${opp.id})**\n  ${funder}${closes}`;
    });
    return {
      text: `Here ${results.length === 1 ? 'is 1 open call' : `are ${results.length} open calls`} for **${query}**:\n\n${lines.join('\n')}\n\nOpen a call to see who can apply and to save it or set a reminder.`,
      executedTools
    };
  }

  // 5. Anything else: what the Copilot can do
  return {
    text: `**I can help you with your funding calls.** Try asking:\n\n- *Which open calls fit my research?*\n- *Find DST or ANRF calls on climate*\n- *Show my profile keywords*`,
    executedTools
  };
}
