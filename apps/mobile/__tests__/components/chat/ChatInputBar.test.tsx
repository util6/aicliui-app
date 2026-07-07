import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ChatInputBar } from '@/src/components/chat/ChatInputBar';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

describe('ChatInputBar slash commands', () => {
  it('shows matching slash commands and inserts the selected command', () => {
    const screen = render(
      <ChatInputBar
        onSend={jest.fn()}
        slashCommands={[
          {
            name: 'review',
            description: 'Review current changes',
            kind: 'template',
            source: 'acp',
            selectionBehavior: 'insert',
          },
        ]}
      />,
    );

    const input = screen.getByPlaceholderText('chat.inputPlaceholder');
    fireEvent.changeText(input, '/rev');

    expect(screen.getByText('/review')).toBeTruthy();
    expect(screen.getByText('Review current changes')).toBeTruthy();

    fireEvent.press(screen.getByText('/review'));

    expect(input.props.value).toBe('/review ');
  });
});
