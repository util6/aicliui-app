import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ToolCallBlock } from '@/src/components/chat/ToolCallBlock';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

describe('ToolCallBlock', () => {
  it('renders desktop-style tool_group result_display when expanded', () => {
    const screen = render(
      <ToolCallBlock
        type='tool_group'
        content={[
          {
            call_id: 'call-1',
            name: 'ReadFile',
            description: 'Read package.json',
            status: 'Success',
            result_display: 'package contents',
          },
        ]}
      />,
    );

    fireEvent.press(screen.getByText('Read package.json'));

    expect(screen.getByText('ReadFile')).toBeTruthy();
    expect(screen.getByText('package contents')).toBeTruthy();
  });

  it('renders desktop-style tool_call output when expanded', () => {
    const screen = render(
      <ToolCallBlock
        type='tool_call'
        content={{
          call_id: 'call-2',
          name: 'Shell',
          status: 'completed',
          output: 'build passed',
        }}
      />,
    );

    fireEvent.press(screen.getByText('Shell'));

    expect(screen.getByText('build passed')).toBeTruthy();
  });

  it('renders ACP raw_input details when expanded', () => {
    const screen = render(
      <ToolCallBlock
        type='acp_tool_call'
        content={{
          update: {
            tool_call_id: 'call-3',
            title: 'Shell',
            kind: 'execute',
            status: 'completed',
            raw_input: { command: 'npm test' },
          },
        }}
      />,
    );

    fireEvent.press(screen.getByText('Shell'));

    expect(screen.getByText(/npm test/)).toBeTruthy();
  });
});
