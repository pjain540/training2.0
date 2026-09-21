import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { interrupt } from '@langchain/langgraph';
import { AgentStatus, formatLog } from '../state.mjs';

/**
 * Human Approval Node with LangGraph Interrupt
 * Role: Pauses execution via LangGraph checkpointer interrupt and resumes
 *       upon receiving human decision (APPROVED, EDITED, REJECTED).
 */
export function createHumanApprovalNode({
  outputDir = './output'
} = {}) {
  return async function humanApprovalNode(state) {
    const lastCritique = (state.critiqueHistory && state.critiqueHistory.length > 0)
      ? state.critiqueHistory[state.critiqueHistory.length - 1]
      : null;

    // Interrupt graph execution. The checkpointer captures state at this point.
    // When resumed with Command({ resume: decision }), interrupt() returns that decision.
    const interruptPayload = {
      message: 'Human review required for generated draft.',
      topic: state.topic,
      iteration: state.iteration,
      draftPreview: state.draft,
      lastCritique: lastCritique ? {
        status: lastCritique.status,
        score: lastCritique.score,
        feedback: lastCritique.feedback
      } : null,
      actions: ['APPROVED', 'EDITED', 'REJECTED']
    };

    const rawDecision = interrupt(interruptPayload);

    // Normalize decision whether passed as string or object
    let decision = typeof rawDecision === 'string'
      ? { action: rawDecision }
      : (rawDecision || { action: 'APPROVED' });

    const action = (decision.action || 'APPROVED').toUpperCase();
    const notes = decision.notes || null;
    const decidedAt = new Date().toISOString();

    const logs = [];

    if (action === 'REJECTED') {
      logs.push(formatLog('HITL', 'Human operator REJECTED the generated draft. Output discarded.'));
      return {
        status: AgentStatus.REJECTED,
        humanDecision: {
          action: 'REJECTED',
          notes,
          decidedAt
        },
        logs
      };
    }

    // Process APPROVED or EDITED
    let finalContent = state.draft;
    if (action === 'EDITED' && notes) {
      finalContent = `${state.draft}\n\n---\n### 📝 Human Editorial Addendum\n${notes}\n`;
    }

    let savedPath = null;
    try {
      await mkdir(outputDir, { recursive: true });
      const slug = (state.topic || 'briefing')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 30)
        .replace(/^-|-$/g, '');
      const filename = `content-${slug}-${Date.now()}.md`;
      savedPath = join(outputDir, filename);

      const markdownPayload = `---
title: "${state.topic}"
revisions: ${state.iteration}
critic_score: ${lastCritique?.score || 'N/A'}
human_decision: "${action}"
generated_at: "${decidedAt}"
facts_used: ${(state.facts || []).length}
citations_count: ${(state.citations || []).length}
---

${finalContent}
`;

      await writeFile(savedPath, markdownPayload, 'utf-8');
      logs.push(formatLog('HITL', `Human operator ${action} draft. Saved to ${savedPath}`));
    } catch (err) {
      logs.push(formatLog('HITL', `Notice: file persistence skipped (${err.message})`));
    }

    return {
      draft: finalContent,
      status: AgentStatus.COMPLETED,
      humanDecision: {
        action,
        notes,
        savedPath,
        decidedAt
      },
      logs
    };
  };
}
