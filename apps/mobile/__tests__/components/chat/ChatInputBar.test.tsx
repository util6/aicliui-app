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

  it('selects the first slash command on submit instead of sending a partial query', () => {
    const onSend = jest.fn();
    const screen = render(
      <ChatInputBar
        onSend={onSend}
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
    fireEvent(input, 'submitEditing');

    expect(onSend).not.toHaveBeenCalled();
    expect(input.props.value).toBe('/review ');
  });

  it('blocks sending and slash command selection while disabled', () => {
    const onSend = jest.fn();
    const onStop = jest.fn();
    const slashCommands = [
      {
        name: 'review',
        description: 'Review current changes',
        kind: 'template' as const,
        source: 'acp' as const,
        selectionBehavior: 'insert' as const,
      },
    ];

    const screen = render(<ChatInputBar onSend={onSend} onStop={onStop} slashCommands={slashCommands} />);
    const input = screen.getByPlaceholderText('chat.inputPlaceholder');
    fireEvent.changeText(input, '/rev');
    expect(screen.getByText('/review')).toBeTruthy();

    screen.rerender(
      <ChatInputBar onSend={onSend} onStop={onStop} slashCommands={slashCommands} disabled />,
    );

    expect(screen.queryByText('/review')).toBeNull();
    fireEvent(input, 'submitEditing');
    expect(onSend).not.toHaveBeenCalled();

    screen.rerender(
      <ChatInputBar onSend={onSend} onStop={onStop} slashCommands={slashCommands} disabled isStreaming />,
    );
    expect(screen.queryByText('stop-circle')).toBeNull();
  });

  it('queues input while busy and keeps the stop action visible', () => {
    const onSend = jest.fn();
    const onStop = jest.fn();
    const screen = render(<ChatInputBar onSend={onSend} onStop={onStop} canSend={false} isStreaming />);
    const input = screen.getByPlaceholderText('chat.inputPlaceholder');

    fireEvent.changeText(input, 'hello');

    expect(screen.getByText('add-circle-outline')).toBeTruthy();
    expect(screen.getByText('stop-circle')).toBeTruthy();

    fireEvent.press(screen.getByText('add-circle-outline'));
    expect(onSend).toHaveBeenCalledWith('hello');
    expect(input.props.value).toBe('');

    fireEvent.press(screen.getByText('stop-circle'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
