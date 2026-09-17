import { PipelineState, AgentStatus } from './state.mjs';
import { ResearcherAgent } from './agents/researcher.mjs';
import { WriterAgent } from './agents/writer.mjs';
import { CriticAgent } from './agents/critic.mjs';

/**
 * PipelineSupervisor
 * Role: Manager/Coordinator pattern.
 * Manages the state machine, agent delegation, and enforces convergence (max 1 revision).
 */
export class PipelineSupervisor {
  /**
   * @param {Object} [options]
   * @param {string} [options.apiKey]
   * @param {number} [options.maxRevisions=1]
   * @param {ResearcherAgent} [options.researcher]
   * @param {WriterAgent} [options.writer]
   * @param {CriticAgent} [options.critic]
   */
  constructor({
    apiKey = process.env.GEMINI_API_KEY,
    maxRevisions = 1,
    researcher = null,
    writer = null,
    critic = null
  } = {}) {
    this.apiKey = apiKey;
    this.maxRevisions = maxRevisions;
    this.researcher = researcher || new ResearcherAgent({ apiKey: this.apiKey });
    this.writer = writer || new WriterAgent({ apiKey: this.apiKey });
    this.critic = critic || new CriticAgent({ apiKey: this.apiKey });
  }

  /**
   * Execute the multi-agent workflow for a given topic.
   * @param {string|PipelineState} topicOrState
   * @param {Function} [onStep] - Optional callback for live monitoring
   * @returns {Promise<PipelineState>}
   */
  async run(topicOrState, onStep = null) {
    const state = typeof topicOrState === 'string'
      ? new PipelineState(topicOrState, { maxIterations: this.maxRevisions })
      : topicOrState;

    state.log('Supervisor', `Initializing multi-agent pipeline for "${state.topic}"...`);
    if (onStep) onStep('START', state);

    // ── Phase 1: Research (Grounded Knowledge Retrieval) ────────────
    state.log('Supervisor', 'Step 1/3: Delegating to ResearcherAgent...');
    await this.researcher.run(state);
    if (onStep) onStep('RESEARCH_COMPLETE', state);

    // ── Phase 2: Initial Draft ──────────────────────────────────────
    state.log('Supervisor', 'Step 2/3: Delegating to WriterAgent (Initial Draft)...');
    await this.writer.run(state);
    if (onStep) onStep('DRAFT_COMPLETE', state);

    // ── Phase 3: Critic Review & Controlled Revision Loop ───────────
    state.log('Supervisor', 'Step 3/3: Delegating to CriticAgent for review...');
    let critique = await this.critic.run(state);
    if (onStep) onStep('CRITIQUE_COMPLETE', state);

    // Conditional Revision Loop (enforces at most maxRevisions)
    while (critique.status === 'REVISE' && state.iteration < state.maxIterations) {
      state.iteration++;
      state.log('Supervisor', `Revision requested by Critic. Entering iteration ${state.iteration}/${state.maxIterations}...`);

      // Writer refines draft using critique feedback
      await this.writer.run(state);
      if (onStep) onStep('REVISION_DRAFT_COMPLETE', state);

      // Critic evaluates refined draft
      critique = await this.critic.run(state);
      if (onStep) onStep('REVISION_CRITIQUE_COMPLETE', state);
    }

    // Phase 4: Ready for Human Gate
    state.status = AgentStatus.HITL_PENDING;
    state.log('Supervisor', `Orchestration complete. Handoff to Human-In-The-Loop checkpoint.`);
    if (onStep) onStep('HITL_READY', state);

    return state;
  }
}
