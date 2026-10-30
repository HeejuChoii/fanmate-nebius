// Nebius Token Factory 임베딩으로 의미 기반 아이템 검색.
// 글자가 안 맞는 묘사("꾸안꾸 갈색 모자", "청량한 여름 셔츠")도 의미가 가까운 아이템을 찾는다.
// NEBIUS_API_KEY가 없거나 호출이 실패하면 null → 기존 글자 매칭 결과를 그대로 쓴다.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./config.js";

const env = process.env;
const apiKey = () => env.NEBIUS_API_KEY?.trim();
const baseUrl = () => (env.NEBIUS_BASE_URL?.trim() || "https://api.tokenfactory.nebius.com/v1").replace(/\/$/, "");
export const embedModel = () => env.NEBIUS_EMBED_MODEL?.trim() || "Qwen/Qwen3-Embedding-8B";
const cacheFile = () => path.join(DATA_DIR, "embedding-cache.json");

let cache: Record<string, number[]> | null = null;
async function loadCache(): Promise<Record<string, number[]>> {
  if (cache) return cache;
  try { cache = JSON.parse(await readFile(cacheFile(), "utf8")); } catch { cache = {}; }
  return cache!;
}
async function saveCache(): Promise<void> {
  await mkdir(path.dirname(cacheFile()), { recursive: true });
  await writeFile(cacheFile(), JSON.stringify(cache ?? {}));
}

async function embed(texts: string[]): Promise<number[][]> {
  const response = await fetch(`${baseUrl()}/embeddings`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey()}`, "content-type": "application/json" },
    body: JSON.stringify({ model: embedModel(), input: texts }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Nebius embeddings ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = (await response.json()) as { data: Array<{ embedding: number[]; index: number }> };
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

const cosine = (a: number[], b: number[]) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};

/** query와 의미가 가까운 순서로 후보를 돌려준다(점수 포함). 실패하면 null. */
export async function semanticRank<T extends { id: string }>(query: string, candidates: T[], describe: (c: T) => string, minScore = 0.3): Promise<Array<{ item: T; score: number }> | null> {
  if (!apiKey() || !query.trim() || !candidates.length) return null;
  try {
    const store = await loadCache();
    const model = embedModel();
    const missing = candidates.filter((c) => !store[`${model}|${c.id}`]);
    for (let i = 0; i < missing.length; i += 64) {
      const batch = missing.slice(i, i + 64);
      const vectors = await embed(batch.map(describe));
      batch.forEach((c, j) => { store[`${model}|${c.id}`] = vectors[j]!; });
    }
    if (missing.length) await saveCache().catch(() => {});
    const [q] = await embed([query]);
    return candidates
      .map((item) => ({ item, score: cosine(q!, store[`${model}|${item.id}`]!) }))
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score);
  } catch (error) {
    console.error("semantic search failed:", (error as Error).message);
    return null;
  }
}
