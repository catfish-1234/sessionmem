// LoCoMo evidence labels are held out from capture. No answer-text matching or
// model judge is used: the unit of relevance is an annotated dialogue turn.
export const CATEGORY_NAMES = {
  1: "multi-hop", 2: "temporal", 3: "open-domain", 4: "single-hop", 5: "adversarial",
};

export function prepareCorpus(samples) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error("Empty corpus");
  const seenSamples = new Set();
  return samples.map((sample) => {
    const { sample_id: id, conversation, qa } = sample;
    if (typeof id !== "string" || !id || seenSamples.has(id)) throw new Error("Invalid/duplicate sample ID");
    seenSamples.add(id);
    const seenTurns = new Set();
    const sessions = Object.keys(conversation)
      .filter((key) => /^session_\d+$/.test(key))
      .sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)))
      .map((key) => {
        const timestamp = conversation[`${key}_date_time`];
        if (typeof timestamp !== "string") throw new Error(`Missing timestamp: ${id}/${key}`);
        const turns = conversation[key].map((turn) => {
          if (typeof turn.dia_id !== "string" || seenTurns.has(turn.dia_id) ||
              typeof turn.speaker !== "string" || typeof turn.text !== "string" || !turn.text.trim()) {
            throw new Error(`Invalid/duplicate turn: ${id}/${turn.dia_id}`);
          }
          seenTurns.add(turn.dia_id);
          return {
            id: `${id}/${turn.dia_id}`,
            // Only original dialogue, speaker, session date, and supplied image
            // captions enter memory. Image URLs are never fetched.
            content: `${timestamp}\n${turn.speaker}: ${turn.text}` +
              (turn.blip_caption ? `\nImage caption: ${turn.blip_caption}` : ""),
          };
        });
        return { id: `${id}/${key}`, timestamp, turns };
      });
    if (sessions.length < 2 || !sessions.every((s) => s.turns.length)) {
      throw new Error(`Expected multi-session dialogue: ${id}`);
    }
    const questions = qa.map((question, index) => {
      if (typeof question.question !== "string" || !question.question.trim() || !CATEGORY_NAMES[question.category]) {
        throw new Error(`Invalid question: ${id}/${index}`);
      }
      const evidence = question.evidence;
      // Fail the entire question on unresolved evidence; never silently shorten
      // its denominator. Preserve upstream annotation issues in the report.
      const excluded = question.category === 5 ? "adversarial" :
        question.answer === undefined || !String(question.answer).trim() ? "missing_answer" :
        !Array.isArray(evidence) || evidence.length === 0 ? "missing_evidence" :
        evidence.some((e) => !seenTurns.has(e)) ? "invalid_evidence" : null;
      return {
        id: `${id}/q${index + 1}`,
        question: question.question,
        answer: question.answer ?? null,
        category: question.category,
        evidence: Array.isArray(evidence) ? [...new Set(evidence)].map((e) => `${id}/${e}`) : [],
        excluded,
      };
    });
    return { id, sessions, questions };
  });
}

export function scoreQuestion(expectedIds, retrievedIds) {
  const expected = new Set(expectedIds);
  if (!expected.size) throw new Error("Cannot score a question without evidence");
  const retrieved = new Set(retrievedIds);
  const hits = [...retrieved].filter((id) => expected.has(id));
  return {
    hits,
    hit: hits.length > 0,
    all_evidence: hits.length === expected.size,
    precision: retrieved.size ? hits.length / retrieved.size : 0,
    recall: hits.length / expected.size,
  };
}

export function aggregate(rows) {
  if (!rows.length) throw new Error("No eligible questions to evaluate");
  const average = (key) => rows.reduce((sum, row) => sum + Number(row[key]), 0) / rows.length;
  const latencies = rows.map((row) => row.latency_ms).sort((a, b) => a - b);
  const middle = Math.floor(latencies.length / 2);
  return {
    questions: rows.length,
    hit_rate: average("hit"),
    precision: average("precision"),
    recall: average("recall"),
    all_evidence_rate: average("all_evidence"),
    latency_ms: {
      mean: average("latency_ms"),
      median: latencies.length % 2 ? latencies[middle] : (latencies[middle - 1] + latencies[middle]) / 2,
      p95: latencies[Math.ceil(latencies.length * 0.95) - 1],
      max: latencies.at(-1),
    },
  };
}

export async function captureConversation(service, conversation) {
  let memories = 0;
  for (const session of conversation.sessions) {
    for (const turn of session.turns) {
      const result = await service.storeMemory({
        projectId: conversation.id,
        sessionId: session.id,
        memoryId: turn.id,
        sourceAdapter: "locomo-benchmark",
        kind: "fact",
        importance: 5,
        redactionEnabled: true,
        content: turn.content,
      });
      if (!result.ok) throw new Error(`Capture failed: ${turn.id}: ${JSON.stringify(result.error)}`);
      memories += 1;
    }
  }
  return memories;
}

export async function recallConversation(service, conversation, topK) {
  const rows = [];
  for (const question of conversation.questions) {
    if (question.excluded) continue;
    const start = performance.now();
    const result = await service.retrieveMemories({
      projectId: conversation.id,
      query: question.question,
      limit: topK,
      mode: "on-demand",
      depth: "default",
    });
    const latency_ms = performance.now() - start;
    if (!result.ok) throw new Error(`Recall failed: ${question.id}: ${JSON.stringify(result.error)}`);
    const retrieved = result.memories.map((memory) => memory.id);
    rows.push({ ...question, retrieved, ...scoreQuestion(question.evidence, retrieved), latency_ms });
  }
  return rows;
}
