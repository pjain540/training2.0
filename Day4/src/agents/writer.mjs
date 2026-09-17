import { GoogleGenAI } from '@google/genai';
import { AgentStatus } from '../state.mjs';
import { withRetry } from '../retry.mjs';

/**
 * WriterAgent
 * Role: Synthesizes technical content from facts and applies Critic feedback during revision cycles.
 */
export class WriterAgent {
  /**
   * @param {Object} [options]
   * @param {string} [options.apiKey]
   * @param {string} [options.model]
   */
  constructor({
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'
  } = {}) {
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required for WriterAgent.');
    }
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  /**
   * Produce draft or revision based on current state.
   * @param {import('../state.mjs').PipelineState} state
   * @returns {Promise<import('../state.mjs').PipelineState>}
   */
  async run(state) {
    const isRevision = state.critiqueHistory.length > 0;
    state.log('Writer', isRevision ? `Revising draft (Iteration ${state.iteration})...` : 'Writing initial draft...');

    // Save previous draft if revising
    if (state.draft) {
      state.draftHistory.push(state.draft);
    }

    const factsFormatted = state.facts
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

    const response = await withRetry(
      () => this.ai.models.generateContent({
        model: this.model,
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
      { label: 'WriterAgent' }
    );

    const content = response.text ? response.text.trim() : '';
    state.draft = content;
    state.status = AgentStatus.DRAFTED;
    state.log('Writer', `Draft completed (${content.length} characters).`);

    return state;
  }
}
