import { GoogleGenAI } from '@google/genai';
import { AgentStatus, formatLog } from '../state.mjs';
import { withRetry } from '../retry.mjs';

/**
 * Writer Node
 * Role: Produces initial technical draft or refines it according to Critic feedback.
 */
export function createWriterNode({
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'
} = {}) {
  let ai = null;
  function getClient() {
    if (!ai) {
      if (!apiKey) throw new Error('GEMINI_API_KEY is required for WriterNode.');
      ai = new GoogleGenAI({ apiKey });
    }
    return ai;
  }

  return async function writerNode(state) {
    const isRevision = (state.critiqueHistory && state.critiqueHistory.length > 0);
    const logs = [
      formatLog('Writer', isRevision ? `Revising draft (Iteration ${state.iteration})...` : 'Writing initial draft...')
    ];

    const factsFormatted = (state.facts || [])
      .map(f => `[Source: ${f.source}, Chunk: ${f.chunkIndex}]:\n${f.content}`)
      .join('\n\n');

    let revisionContext = '';
    if (isRevision) {
      const lastCritique = state.critiqueHistory[state.critiqueHistory.length - 1];
      revisionContext = `
========================================
PREVIOUS DRAFT:
${state.draft}

CRITIC REVISION INSTRUCTIONS:
- Score given: ${lastCritique.score}/10
- Feedback: ${lastCritique.feedback}
- Missing/Incomplete Points: ${(lastCritique.missingPoints || []).join('; ') || 'None noted'}
========================================
Please improve the previous draft by addressing EVERY point of criticism while maintaining accurate citations.
`;
    }

    const systemPrompt = `You are a Principal Technical Writer.
Your goal is to write an authoritative, clear, and comprehensive technical briefing on: "${state.topic}".

CRITICAL GUIDELINES:
1. Ground your text firmly in the provided Grounded Facts. Do not hallucinate capabilities or numbers.
2. For every key claim, include its citation in the exact format: [Source: <filename>, Chunk: <index>].
3. Use markdown with clear sections:
   - # Title
   - ## Overview & Executive Summary
   - ## Architecture & Key Mechanisms (with citations)
   - ## Reliability, Consensus & Performance
   - ## Practical Summary & Recommendations
4. Keep the tone crisp, objective, and professional.`;

    const userPrompt = `GROUNDED FACTS:
${factsFormatted}

${revisionContext}

Write the technical document:`;

    const client = getClient();
    const response = await withRetry(
      () => client.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
          }
        ],
        config: {
          temperature: 0.3
        }
      }),
      { label: 'WriterNode' }
    );

    const content = response.text ? response.text.trim() : '';
    logs.push(formatLog('Writer', `Draft completed (${content.length} characters).`));

    return {
      draft: content,
      draftHistory: state.draft ? [state.draft] : [],
      iteration: isRevision ? state.iteration + 1 : state.iteration,
      status: AgentStatus.DRAFTED,
      logs
    };
  };
}
