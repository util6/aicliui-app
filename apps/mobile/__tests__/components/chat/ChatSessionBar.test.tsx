import React from 'react';
import { render } from '@testing-library/react-native';
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
    sessionMode: 'autoEdit',
  },
};

describe('ChatSessionBar', () => {
  it('renders persisted conversation execution context as compact chips', () => {
    const screen = render(<ChatSessionBar conversation={conversation} />);

    expect(screen.getByText('project')).toBeTruthy();
    expect(screen.getByText('2 file(s) selected')).toBeTruthy();
    expect(screen.getByText('gpt-5-codex')).toBeTruthy();
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
});
