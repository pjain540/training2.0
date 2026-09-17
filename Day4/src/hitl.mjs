import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentStatus } from './state.mjs';

/**
 * HumanInTheLoopGate
 * Role: Checkpoint before high-impact or final state mutation (persisting output).
 * Supports both interactive CLI prompts and programmatic invocation for testing.
 */
export class HumanInTheLoopGate {
  /**
   * Prompts the human operator in the terminal for approval/edit/rejection.
   * @param {import('./state.mjs').PipelineState} state
   * @param {string} [outputDir='./output']
   * @returns {Promise<Object>} Decision result
   */
  async promptHuman(state, outputDir = './output') {
    const rl = createInterface({ input, output });

    const lastCritique = state.critiqueHistory[state.critiqueHistory.length - 1] || {};

    console.log('\n' + '═'.repeat(65));
    console.log(' 🛑 HUMAN-IN-THE-LOOP APPROVAL GATE');
    console.log('═'.repeat(65));
    console.log(`Topic:           ${state.topic}`);
    console.log(`Total Revisions: ${state.iteration}`);
    console.log(`Critic Score:    ${lastCritique.score ?? 'N/A'}/10 (${lastCritique.status || 'UNKNOWN'})`);
    console.log(`Facts Gathered:  ${state.facts.length} chunks`);
    console.log('─'.repeat(65));
    console.log('DRAFT PREVIEW:\n');
    console.log(state.draft);
    console.log('─'.repeat(65));
    console.log('Actions:');
    console.log('  [A] Approve & Save output to disk');
    console.log('  [E] Edit / Add custom editorial notes before saving');
    console.log('  [R] Reject output and discard');
    console.log('─'.repeat(65));

    try {
      const choice = (await rl.question('Choose action [A/E/R] (default A): ')).trim().toUpperCase() || 'A';

      if (choice === 'A') {
        rl.close();
        return await this.applyDecision(state, { action: 'APPROVED' }, outputDir);
      } else if (choice === 'E') {
        console.log('\nEnter your custom editorial notes or revisions (press Enter when done):');
        const customNote = await rl.question('> ');
        rl.close();
        return await this.applyDecision(state, { action: 'EDITED', notes: customNote }, outputDir);
      } else {
        rl.close();
        return await this.applyDecision(state, { action: 'REJECTED' }, outputDir);
      }
    } catch (err) {
      rl.close();
      throw err;
    }
  }

  /**
   * Programmatically apply a human decision (used for automated tests & integrations).
   * @param {import('./state.mjs').PipelineState} state
   * @param {Object} decision
   * @param {'APPROVED'|'EDITED'|'REJECTED'} decision.action
   * @param {string} [decision.notes]
   * @param {string} [outputDir='./output']
   * @returns {Promise<Object>}
   */
  async applyDecision(state, decision, outputDir = './output') {
    const { action, notes } = decision;

    if (action === 'REJECTED') {
      state.status = AgentStatus.REJECTED;
      state.humanDecision = {
        action: 'REJECTED',
        decidedAt: new Date().toISOString()
      };
      state.log('HITL', 'Human operator REJECTED the generated draft. Output was discarded.');
      return { success: false, status: 'REJECTED', state: state.toJSON() };
    }

    // Prepare final content
    let finalContent = state.draft;
    if (action === 'EDITED' && notes) {
      finalContent = `${state.draft}\n\n---\n### 📝 Human Editorial Addendum\n${notes}\n`;
    }

    await mkdir(outputDir, { recursive: true });

    // Filename safe topic
    const slug = state.topic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 30)
      .replace(/^-|-$/g, '');
    const filename = `content-${slug}-${Date.now()}.md`;
    const targetPath = join(outputDir, filename);

    const lastCritique = state.critiqueHistory[state.critiqueHistory.length - 1] || {};

    const payload = `---
title: "${state.topic}"
revisions: ${state.iteration}
critic_score: ${lastCritique.score || 'N/A'}
human_decision: "${action}"
generated_at: "${new Date().toISOString()}"
facts_used: ${state.facts.length}
citations_count: ${state.citations.length}
---

${finalContent}
`;

    await writeFile(targetPath, payload, 'utf-8');

    state.status = AgentStatus.COMPLETED;
    state.humanDecision = {
      action,
      notes: notes || null,
      savedPath: targetPath,
      decidedAt: new Date().toISOString()
    };

    state.log('HITL', `Human operator ${action} draft. Successfully saved to ${targetPath}`);
    return {
      success: true,
      status: state.status,
      savedPath: targetPath,
      content: finalContent
    };
  }
}
