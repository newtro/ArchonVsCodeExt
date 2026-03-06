/**
 * Bridge that translates HookEngine fire() calls into AgentLoopHooks callbacks.
 *
 * This is the glue between the HookEngine (which manages chains/nodes/variables)
 * and the AgentLoop (which has thin callback slots).
 */

import type { AgentLoopHooks } from '../agent/agent-loop';
import type { ChatMessage, ToolCall, ToolResult, Attachment } from '../types';
import type { HookEngine } from './hook-engine';
import type {
  TurnStartData,
  TurnEndData,
  TurnErrorData,
  LLMBeforeData,
  LLMAfterData,
  ToolBeforeData,
  ToolAfterData,
  LoopIterateData,
} from './types';

/**
 * Create AgentLoopHooks that delegate to a HookEngine instance.
 * Attach these to an AgentLoop via `agentLoop.setHooks(createHookBridge(engine))`.
 */
export function createHookBridge(engine: HookEngine): AgentLoopHooks {
  return {
    async onTurnStart(userMessage: string, attachments?: Attachment[]) {
      engine.beginTurn();

      if (!engine.hasHooks('turn:start')) {
        return { userMessage, attachments };
      }

      const data: TurnStartData = {
        type: 'turn:start',
        userMessage,
        attachments,
        sessionState: engine.getVariableSnapshot(),
      };

      const result = await engine.fire('turn:start', data);
      const modified = result.data as TurnStartData;

      return {
        userMessage: modified.userMessage,
        attachments: modified.attachments as Attachment[] | undefined,
      };
    },

    async onTurnEnd(messages: ChatMessage[], toolCallsMade: ToolCall[]) {
      if (engine.hasHooks('turn:end')) {
        const data: TurnEndData = {
          type: 'turn:end',
          messages,
          toolCallsMade,
          finalResponse: messages.filter(m => m.role === 'assistant').pop()?.content ?? '',
        };
        await engine.fire('turn:end', data);
      }
      await engine.endTurn();
    },

    async onTurnError(error: Error, partialHistory: ChatMessage[]) {
      if (!engine.hasHooks('turn:error')) return;

      const data: TurnErrorData = {
        type: 'turn:error',
        error,
        partialHistory,
      };
      await engine.fire('turn:error', data);
    },

    async onBeforeLLMCall(messages: ChatMessage[]) {
      if (!engine.hasHooks('llm:before')) return messages;

      const data: LLMBeforeData = {
        type: 'llm:before',
        messages,
        systemPrompt: messages.find(m => m.role === 'system')?.content ?? '',
        model: '',  // Model info not available here — could be passed through config
      };

      const result = await engine.fire('llm:before', data);
      if (result.action === 'abort') return messages;

      const modified = result.data as LLMBeforeData;
      return modified.messages;
    },

    async onAfterLLMCall(response: { textContent: string; toolCalls: ToolCall[] }) {
      if (!engine.hasHooks('llm:after')) return response;

      const data: LLMAfterData = {
        type: 'llm:after',
        textContent: response.textContent,
        toolCalls: response.toolCalls,
      };

      const result = await engine.fire('llm:after', data);
      const modified = result.data as LLMAfterData;

      return {
        textContent: modified.textContent,
        toolCalls: modified.toolCalls,
      };
    },

    async onBeforeToolExec(toolCall: ToolCall) {
      if (!engine.hasHooks('tool:before')) return toolCall;

      const data: ToolBeforeData = {
        type: 'tool:before',
        toolCall,
        toolName: toolCall.name,
        arguments: toolCall.arguments,
      };

      const result = await engine.fire('tool:before', data);

      if (result.action === 'block') return null;

      const modified = result.data as ToolBeforeData;
      return modified.toolCall;
    },

    async onAfterToolExec(toolCall: ToolCall, toolResult: ToolResult) {
      if (!engine.hasHooks('tool:after')) return toolResult;

      const data: ToolAfterData = {
        type: 'tool:after',
        toolCall,
        result: toolResult,
        duration: 0,
      };

      const result = await engine.fire('tool:after', data);
      const modified = result.data as ToolAfterData;
      return modified.result;
    },

    async onIteration(state: { iteration: number; messages: ChatMessage[] }) {
      if (!engine.hasHooks('loop:iterate')) return {};

      const data: LoopIterateData = {
        type: 'loop:iterate',
        iteration: state.iteration,
        messages: state.messages,
        toolCallHistory: [],
      };

      const result = await engine.fire('loop:iterate', data);

      return {
        stop: result.action === 'abort' || result.action === 'block',
        inject: undefined,
      };
    },
  };
}
