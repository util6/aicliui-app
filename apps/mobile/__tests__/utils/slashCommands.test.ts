import { mapAvailableCommandsToSlashCommands } from '@/src/utils/slashCommands';

describe('mapAvailableCommandsToSlashCommands', () => {
  it('maps ACP available_commands payloads to insertable slash commands', () => {
    expect(
      mapAvailableCommandsToSlashCommands([
        {
          name: 'review',
          description: 'Review the current changes',
          input: { hint: 'focus on regressions' },
          _meta: { completion_behavior: 'neutral_tip_on_empty' },
        },
      ]),
    ).toEqual([
      {
        name: 'review',
        description: 'Review the current changes',
        hint: 'focus on regressions',
        kind: 'template',
        source: 'acp',
        selectionBehavior: 'insert',
        completionBehavior: 'neutral_tip_on_empty',
      },
    ]);
  });

  it('also accepts HTTP-style command payloads for compatibility', () => {
    expect(
      mapAvailableCommandsToSlashCommands([
        {
          command: 'plan',
          description: 'Create a plan',
          hint: 'outline the next steps',
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        name: 'plan',
        description: 'Create a plan',
        hint: 'outline the next steps',
      }),
    ]);
  });
});
