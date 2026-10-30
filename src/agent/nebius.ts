// Nebius Token Factory + NVIDIA Nemotron 에이전트 (OpenAI 호환 API).
// Croche SDK 대신 이 파일이 에이전트 루프(도구 호출 반복)·대화 이력·장기 기억을 직접 맡는다.
// pool.ts의 AgentOpener 인터페이스를 그대로 지켜서 server.ts·도구·화면은 바뀌지 않는다.
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ToolDeclaration, ToolHandler } from "@h1r-ai/croche";
import { crocheStorageDir } from "../paths.js";
import { toolDeclarations, toolHandlers } from "../tools/index.js";
import { INSTRUCTIONS, MARKER_GUIDE, MEMORY_POLICY } from "./prompt.js";
import { limitToolCallsPerTurn } from "./toolGuard.js";
import type { AgentEvent, AgentHandle, AgentOpener } from "./pool.js";

export interface NebiusConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 모델별 추가 요청 옵션(JSON). 예: {"chat_template_kwargs":{"enable_thinking":false}} */
  extraBody: Record<string, unknown>;
  maxIterations: number;
  historyMessages: number;
}

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

interface Memory { id: string; text: string; at: string }
interface Store { history: ChatMessage[]; memories: Memory[] }

// ---- 도구 선언(Croche 형식) → OpenAI function 스키마 ----
type Flag = { name: string; type: string; description?: string; required?: boolean; list?: boolean; minimum?: number; maximum?: number };
interface FnRoute { tool: string; key: string }

function flagSchema(flag: Flag): Record<string, unknown> {
  const base: Record<string, unknown> = { type: flag.type === "integer" ? "integer" : flag.type === "number" ? "number" : flag.type === "boolean" ? "boolean" : "string" };
  if (flag.description) base.description = flag.description;
  if (flag.minimum !== undefined) base.minimum = flag.minimum;
  if (flag.maximum !== undefined) base.maximum = flag.maximum;
  return flag.list ? { type: "array", items: { type: base.type }, ...(flag.description ? { description: flag.description } : {}) } : base;
}

export function buildFunctions(declarations: ToolDeclaration[]) {
  const routes = new Map<string, FnRoute>();
  const functions: Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }> = [];
  for (const decl of declarations as unknown as Array<{ name: string; summary: string; commands: Array<{ key: string; summary: string; flags?: Flag[] }> }>) {
    for (const command of decl.commands) {
      const name = decl.commands.length === 1 ? decl.name : `${decl.name}_${command.key}`;
      routes.set(name, { tool: decl.name, key: command.key });
      const flags = command.flags ?? [];
      functions.push({
        type: "function",
        function: {
          name,
          description: `${decl.summary}\n${command.summary}`.slice(0, 1000),
          parameters: {
            type: "object",
            properties: Object.fromEntries(flags.map((f) => [f.name, flagSchema(f)])),
            required: flags.filter((f) => f.required).map((f) => f.name),
          },
        },
      });
    }
  }
  return { functions, routes };
}

const REMEMBER_FN = {
  type: "function" as const,
  function: {
    name: "rememberFact",
    description: "사용자에 대해 다음 대화에서도 기억해야 할 사실 하나를 장기 기억에 저장한다. " + MEMORY_POLICY,
    parameters: { type: "object", properties: { fact: { type: "string", description: "저장할 사실 한 문장 (예: 최애는 NCT WISH 시온, 옷 사이즈 M)" } }, required: ["fact"] },
  },
};

// ---- 저장 (사용자 폴더 하나, 프로세스 하나가 소유) ----
const storeFile = (userId: string) => path.join(crocheStorageDir(userId), "nebius-agent.json");
async function loadStore(userId: string): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(storeFile(userId), "utf8"));
    return { history: Array.isArray(parsed.history) ? parsed.history : [], memories: Array.isArray(parsed.memories) ? parsed.memories : [] };
  } catch {
    return { history: [], memories: [] };
  }
}
async function saveStore(userId: string, store: Store): Promise<void> {
  const file = storeFile(userId);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(store));
  await rename(tmp, file);
}

const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*?<\/think>/, "").trim();

/** 이력이 길어지면 앞을 자르되, tool 메시지가 고아가 되지 않게 user 메시지에서 시작한다. */
function trimHistory(history: ChatMessage[], max: number): ChatMessage[] {
  if (history.length <= max) return history;
  let start = history.length - max;
  while (start < history.length && history[start]!.role !== "user") start += 1;
  return history.slice(start);
}

async function chat(config: NebiusConfig, messages: ChatMessage[], tools: unknown[]): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const started = Date.now();
  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: config.model, messages, tools, tool_choice: "auto", temperature: 0.4, max_tokens: 4096, ...config.extraBody }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`Nebius Token Factory ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = (await response.json()) as { choices?: Array<{ finish_reason?: string; message?: { content?: string | null; tool_calls?: ToolCall[] } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const message = data.choices?.[0]?.message ?? {};
  console.log(`[nebius] ${config.model} ${Date.now() - started}ms finish=${data.choices?.[0]?.finish_reason} tokens=${data.usage?.prompt_tokens}/${data.usage?.completion_tokens} tools=${(message.tool_calls ?? []).map((c) => c.function.name).join(",") || "-"} content=${JSON.stringify((message.content ?? "").slice(0, 80))}`);
  return { content: stripThinking(message.content ?? ""), toolCalls: message.tool_calls ?? [] };
}

// 작은 모델용 핵심 규칙(맨 앞에 둔다).
const FINAL_RULES = `[MOST IMPORTANT RULES]
1. Reply in the language given by context.replyLanguage (en = English, ko = Korean, ja = Japanese, zh-CN/zh-TW = Chinese). Never switch to Korean when replyLanguage is en.
2. Act first, ask later. If the user asks for a route/course, call planRoute immediately (put the area like "Seoul" in area, group/member if mentioned; leave others empty). If the user asks for items, call searchItem immediately. Do not ask follow-up questions before calling a tool.
3. Never ask the user for ids (itemId, placeId). Ids come only from tool results. Never mention ids, tool names or field names in replies.
4. Only pass search conditions the user actually said. Do not add situation, category or maxPrice on your own.
5. Keep replies short: 2-5 sentences. Cards and maps are shown separately by the app.`;

export function nebiusOpener(config: NebiusConfig, options: { toolCallsPerTurn: number }): AgentOpener {
  const handlers: Record<string, ToolHandler> = limitToolCallsPerTurn(toolHandlers, options.toolCallsPerTurn);
  const { functions, routes } = buildFunctions(toolDeclarations);
  const tools = [...functions, REMEMBER_FN];
  const systemPrompt = `${FINAL_RULES}\n\n${INSTRUCTIONS}\n\n[표정 마커 안내]\n${MARKER_GUIDE}\n\n[장기 기억]\n${MEMORY_POLICY} 저장은 rememberFact 도구로 한다.`;

  return async (userId, onEvent) => {
    const store = await loadStore(userId);
    await saveStore(userId, store); // 저장 폴더 생성(server의 hasCrocheStore가 이걸로 재방문을 판단)
    let running = false;
    let pendingMemoryClear = false;
    const emit = (event: AgentEvent) => onEvent(event);

    async function runTool(call: ToolCall, inputId: string): Promise<string> {
      let args: Record<string, unknown> = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        return JSON.stringify({ status: "rejected", reason: "arguments가 올바른 JSON이 아니다. 다시 호출한다." });
      }
      if (call.function.name === "rememberFact") {
        const fact = String(args.fact ?? "").trim().slice(0, 300);
        if (!fact) return JSON.stringify({ status: "ignored" });
        if (!store.memories.some((m) => m.text === fact)) store.memories.push({ id: randomUUID(), text: fact, at: new Date().toISOString() });
        store.memories = store.memories.slice(-50);
        return JSON.stringify({ status: "saved", fact });
      }
      const route = routes.get(call.function.name);
      const handler = route && handlers[route.tool];
      if (!route || !handler) return JSON.stringify({ status: "rejected", reason: `없는 도구: ${call.function.name}` });
      try {
        let result = (await handler({ key: route.key, args } as never, { user: userId, causedBy: [inputId] } as never)) as Record<string, unknown>;
        // 작은 모델이 사용자가 말하지 않은 조건(상황·카테고리·가격)을 붙여 결과가 0개가 되면, 멤버/그룹만 남기고 한 번 더 찾는다.
        if (route.tool === "searchItem" && result && result.count === 0 && (args.situation || args.category || args.maxPrice || args.keywords)) {
          const relaxed = { group: args.group, member: args.member, limit: args.limit ?? 5 };
          console.log(`[nebius] searchItem relaxed ${JSON.stringify(args)} -> ${JSON.stringify(relaxed)}`);
          const retry = (await handler({ key: route.key, args: relaxed } as never, { user: userId, causedBy: [inputId, "relaxed"] } as never)) as Record<string, unknown>;
          if (retry && Number(retry.count) > 0) result = { ...retry, note: "The exact conditions matched nothing, so these are other items this member wore. Say so briefly and show them." };
        }
        return JSON.stringify(result).slice(0, 12_000);
      } catch (error) {
        console.error(`tool ${call.function.name} failed:`, error);
        return JSON.stringify({ status: "error", reason: "도구 실행 중 오류" });
      }
    }

    const handle: AgentHandle = {
      async send(input) {
        console.log(`[turn] ${userId.slice(0, 8)} ${JSON.stringify(input.text.slice(0, 60))}`);
        running = true;
        emit({ type: "input", kind: "user", id: input.id, text: input.text });
        emit({ type: "state", status: "running" });
        const replyId = `${input.id}-reply`;
        try {
          const ctx = (input.context ?? {}) as { replyLanguage?: string; replyInstruction?: string };
          const lang = ctx.replyLanguage ?? "ko";
          const langName: Record<string, string> = { ko: "Korean (한국어)", en: "English", ja: "Japanese (日本語)", "zh-CN": "Simplified Chinese (简体中文)", "zh-TW": "Traditional Chinese (繁體中文)" };
          // 작은 모델이 긴 지침 속 언어 규칙을 놓치지 않게, 사용자 메시지 바로 뒤에 짧게 다시 붙인다.
          const turn: ChatMessage[] = [{ role: "user", content: `${input.text}\n\n[system note: reply ONLY in ${langName[lang] ?? lang}. Call the tools you need right away instead of asking for ids or extra details.]` }];
          const contextNote = `[이번 메시지 context — 앱이 저장한 실제 정보]\n${JSON.stringify(input.context)}\n[nebiusLongTermMemories]\n${store.memories.map((m) => `- ${m.text}`).join("\n") || "(없음)"}`;
          let finalText = "";
          for (let i = 0; i < config.maxIterations; i += 1) {
            const messages: ChatMessage[] = [{ role: "system", content: `${systemPrompt}\n\n${contextNote}` }, ...trimHistory(store.history, config.historyMessages), ...turn];
            const isLast = i === config.maxIterations - 1;
            const { content, toolCalls } = await chat(config, messages, isLast ? [] : tools);
            if (!toolCalls.length) {
              finalText = content;
              break;
            }
            turn.push({ role: "assistant", content: content || null, tool_calls: toolCalls });
            emit({ type: "state", status: "running", activity: "tool", tools: toolCalls.map((c) => routes.get(c.function.name)?.tool ?? c.function.name) });
            for (const call of toolCalls) turn.push({ role: "tool", tool_call_id: call.id, content: await runTool(call, input.id) });
          }
          if (!finalText) finalText = ":sorry: 지금은 답을 정리하지 못했어. 한 번만 다시 말해줄래?";
          turn.push({ role: "assistant", content: finalText });
          store.history = trimHistory([...store.history, ...turn], config.historyMessages * 2);
          emit({ type: "message.delta", id: replyId, text: finalText });
          emit({ type: "message.end", id: replyId, text: finalText, markers: [] });
        } catch (error) {
          console.error("nebius turn failed:", error);
          const text = ":sorry: 잠깐 연결이 불안정했어. 다시 한 번 보내줄래?";
          emit({ type: "message.delta", id: replyId, text });
          emit({ type: "message.end", id: replyId, text, markers: [] });
        } finally {
          if (pendingMemoryClear) {
            store.memories = [];
            pendingMemoryClear = false;
          }
          await saveStore(userId, store).catch((e) => console.error("save failed:", e));
          running = false;
          emit({ type: "state", status: "idle" });
        }
        return { id: input.id, accepted: true };
      },
      async clearHistory() {
        store.history = [];
        await saveStore(userId, store);
      },
      memoryList: () => store.memories.map((m) => ({ id: m.id, text: m.text })),
      async memoryClear() {
        if (running) {
          pendingMemoryClear = true;
          return { deferred: true };
        }
        store.memories = [];
        await saveStore(userId, store);
        return { deferred: false };
      },
      async memoryDelete(id) {
        const before = store.memories.length;
        store.memories = store.memories.filter((m) => m.id !== id);
        await saveStore(userId, store);
        return { deleted: store.memories.length < before };
      },
      async close() {
        await saveStore(userId, store).catch(() => {});
      },
    };
    return handle;
  };
}
