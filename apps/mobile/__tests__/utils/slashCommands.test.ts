import {
  filterSlashCommands,
  mapAvailableCommandsToSlashCommands,
  matchSlashQuery,
} from '@/src/utils/slashCommands';

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

describe('slash command matching', () => {
  const commands = [
    {
      name: 'review',
      description: 'Inspect the current changes',
      kind: 'template' as const,
      source: 'acp' as const,
      selectionBehavior: 'insert' as const,
    },
    {
      name: 'test',
      description: 'Review regressions',
      kind: 'template' as const,
      source: 'acp' as const,
      selectionBehavior: 'insert' as const,
    },
  ];

  it('matches only a slash command query token', () => {
    expect(matchSlashQuery('/')).toBe('');
    expect(matchSlashQuery('/rev')).toBe('rev');
    expect(matchSlashQuery('/review-now')).toBe('review-now');
    expect(matchSlashQuery('/review_now')).toBe('review_now');
    expect(matchSlashQuery('/review now')).toBeNull();
    expect(matchSlashQuery('please /review')).toBeNull();
    expect(matchSlashQuery('/review!')).toBeNull();
  });

  it('filters commands by command name, matching the AionUi client controller', () => {
    expect(filterSlashCommands(commands, 'rev').map((command) => command.name)).toEqual(['review']);
    expect(filterSlashCommands(commands, 'regressions')).toEqual([]);
  });
});
