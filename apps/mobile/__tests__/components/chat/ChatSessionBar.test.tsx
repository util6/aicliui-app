import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ChatSessionBar, buildSessionChips } from '@/src/components/chat/ChatSessionBar';
import type { Conversation } from '@/src/context/ConversationContext';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      key === 'chat.filesSelected' ? `${options?.count ?? 0} file(s) selected` : key,
  }),
}));

const conversation: Conversation = {
  id: 'conv-1',
  name: 'Implement feature',
  type: 'acp',
  createTime: 1000,
  modifyTime: 1000,
  model: { id: '', useModel: '' },
  extra: {
    backend: 'codex',
    workspace: '/tmp/project',
    defaultFiles: ['/tmp/project/README.md', '/tmp/project/src/app.ts'],
    currentModelId: 'gpt-5-codex',
    currentModelLabel: 'GPT-5 Codex',
    sessionMode: 'autoEdit',
  },
};

describe('ChatSessionBar', () => {
  it('renders persisted conversation execution context as compact chips', () => {
    const screen = render(<ChatSessionBar conversation={conversation} />);

    expect(screen.getByText('project')).toBeTruthy();
    expect(screen.getByText('2 file(s) selected')).toBeTruthy();
    expect(screen.getByText('GPT-5 Codex')).toBeTruthy();
    expect(screen.getByText('Auto Edit')).toBeTruthy();
  });

  it('renders a waiting confirmation chip while permission is pending', () => {
    const screen = render(<ChatSessionBar conversation={{ ...conversation, status: 'waiting_confirmation' }} />);

    expect(screen.getByText('chat.waitingForConfirmation')).toBeTruthy();
  });

  it('returns no chips when conversation has no execution context', () => {
    const chips = buildSessionChips({ ...conversation, extra: {} }, (key) => key);

    expect(chips).toEqual([]);
  });

  it('opens the model picker from the active model chip and reports the selected model', () => {
    const onModelSelect = jest.fn();
    const screen = render(
      <ChatSessionBar
        conversation={conversation}
        availableModels={[
          { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
          { id: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
        ]}
        canSwitchModel
        onModelSelect={onModelSelect}
      />,
    );

    fireEvent.press(screen.getByText('GPT-5 Codex'));
    fireEvent.press(screen.getByText('Claude Sonnet 4'));

    expect(onModelSelect).toHaveBeenCalledWith({
      id: 'claude-sonnet-4',
      label: 'Claude Sonnet 4',
    });
  });

  it('opens the mode picker from the active mode chip and reports the selected mode', () => {
    const onModeSelect = jest.fn();
    const screen = render(
      <ChatSessionBar
        conversation={conversation}
        onModeSelect={onModeSelect}
      />,
    );

    fireEvent.press(screen.getByText('Auto Edit'));
    fireEvent.press(screen.getByText('Full Auto'));

    expect(onModeSelect).toHaveBeenCalledWith('yolo');
  });
});
