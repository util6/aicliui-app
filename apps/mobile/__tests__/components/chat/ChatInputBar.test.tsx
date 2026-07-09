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
  it('opens a compact AionUi-style action sheet for attachments, model, and mode', () => {
    const onAttachPress = jest.fn();
    const onModelSelect = jest.fn();
    const onModeSelect = jest.fn();
    const screen = render(
      <ChatInputBar
        onSend={jest.fn()}
        onAttachPress={onAttachPress}
        availableModels={[
          { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
          { id: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
        ]}
        currentModelId='gpt-5-codex'
        canSwitchModel
        onModelSelect={onModelSelect}
        modes={[
          { value: 'default', label: 'Plan' },
          { value: 'yolo', label: 'Full Auto' },
        ]}
        currentMode='default'
        onModeSelect={onModeSelect}
      />,
    );

    fireEvent.press(screen.getByLabelText('Open chat actions'));

    expect(screen.getByText('Attach files')).toBeTruthy();
    expect(screen.getByText('Model')).toBeTruthy();
    expect(screen.getByText('GPT-5 Codex')).toBeTruthy();
    expect(screen.getByText('Permission')).toBeTruthy();
    expect(screen.getByText('Plan')).toBeTruthy();

    fireEvent.press(screen.getByText('Attach files'));
    expect(onAttachPress).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByLabelText('Open chat actions'));
    fireEvent.press(screen.getByText('Model'));
    fireEvent.press(screen.getByText('Claude Sonnet 4'));
    expect(onModelSelect).toHaveBeenCalledWith({
      id: 'claude-sonnet-4',
      label: 'Claude Sonnet 4',
    });

    fireEvent.press(screen.getByLabelText('Open chat actions'));
    fireEvent.press(screen.getByText('Permission'));
    fireEvent.press(screen.getByText('Full Auto'));
    expect(onModeSelect).toHaveBeenCalledWith('yolo');
  });

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

  it('shows queued command validation warnings', () => {
    const screen = render(<ChatInputBar onSend={jest.fn()} queueWarning='queueFull' />);

    expect(screen.getByText('warning-outline')).toBeTruthy();
    expect(screen.getByText('Queue is full. Remove a command before adding more.')).toBeTruthy();
  });

  it('shows active attachments, opens the picker, and sends files with the message', () => {
    const onSend = jest.fn();
    const onAttachPress = jest.fn();
    const onRemoveAttachedFile = jest.fn();
    const onClearAttachedFiles = jest.fn();
    const screen = render(
      <ChatInputBar
        onSend={onSend}
        attachedFiles={['/tmp/project/src/App.tsx', '/tmp/project/README.md']}
        onAttachPress={onAttachPress}
        onRemoveAttachedFile={onRemoveAttachedFile}
        onClearAttachedFiles={onClearAttachedFiles}
      />,
    );

    expect(screen.getByText('App.tsx')).toBeTruthy();
    expect(screen.getByText('README.md')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Open chat actions'));
    fireEvent.press(screen.getByText('Attach files'));
    expect(onAttachPress).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByLabelText('Remove attached file App.tsx'));
    expect(onRemoveAttachedFile).toHaveBeenCalledWith('/tmp/project/src/App.tsx');

    const input = screen.getByPlaceholderText('chat.inputPlaceholder');
    fireEvent.changeText(input, 'inspect attached files');
    fireEvent.press(screen.getByText('arrow-up-circle'));

    expect(onSend).toHaveBeenCalledWith('inspect attached files', [
      '/tmp/project/src/App.tsx',
      '/tmp/project/README.md',
    ]);
    expect(onClearAttachedFiles).toHaveBeenCalledTimes(1);
  });

  it('loads an external draft and sends its files', () => {
    const onSend = jest.fn();
    const onDraftConsumed = jest.fn();
    const screen = render(
      <ChatInputBar
        onSend={onSend}
        draft={{
          id: 'queue-1',
          text: 'queued command',
          files: ['src/App.tsx'],
        }}
        onDraftConsumed={onDraftConsumed}
      />,
    );

    const input = screen.getByPlaceholderText('chat.inputPlaceholder');
    expect(input.props.value).toBe('queued command');

    fireEvent.changeText(input, 'edited command');
    fireEvent.press(screen.getByText('arrow-up-circle'));

    expect(onSend).toHaveBeenCalledWith('edited command', ['src/App.tsx']);
    expect(onDraftConsumed).toHaveBeenCalledWith('queue-1');
    expect(input.props.value).toBe('');
  });
});
