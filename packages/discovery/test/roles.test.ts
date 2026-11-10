import { expect, it } from 'vitest';
import { toolSchemas, unavailableToolCode } from '../src/roles.js';

it('keeps deferred coordinator repair/finish unavailable and forbids unknown tools', () => {
  expect(unavailableToolCode('coordinator', 'beginRepair')).toBe('TOOL_UNAVAILABLE');
  expect(unavailableToolCode('coordinator', 'finishRun')).toBe('TOOL_UNAVAILABLE');
  expect(unavailableToolCode('coordinator', 'shell')).toBe('TOOL_FORBIDDEN');
  expect(unavailableToolCode('identity', 'delegateTask')).toBe('TOOL_FORBIDDEN');
  expect(unavailableToolCode('identity', 'beginRepair')).toBe('TOOL_FORBIDDEN');
  expect(toolSchemas('coordinator').map(tool => tool.name)).toEqual(['delegateTask']);
  expect(toolSchemas('connector')).toEqual([]);
});
