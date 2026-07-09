import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { MessageBubble } from '@/src/components/chat/MessageBubble';
import type { TMessage } from '@/src/utils/messageAdapter';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const makeThinkingMessage = (content: TMessage['content']): TMessage => ({
  id: 'thinking-1',
  msg_id: 'msg-1',
  conversation_id: 'conv-1',
  type: 'thinking',
  position: 'left',
  createdAt: Date.now(),
  content,
});

const makeAgentStatusMessage = (content: TMessage['content']): TMessage => ({
  id: 'status-1',
  msg_id: 'msg-1',
  conversation_id: 'conv-1',
  type: 'agent_status',
  position: 'center',
  createdAt: Date.now(),
  content,
});

const makePlanMessage = (content: TMessage['content']): TMessage => ({
  id: 'plan-1',
  msg_id: 'msg-1',
  conversation_id: 'conv-1',
  type: 'plan',
  position: 'left',
  createdAt: Date.now(),
  content,
});

describe('MessageBubble thinking', () => {
  it('renders active thinking summary and body', () => {
    const message = makeThinkingMessage({
      content: 'Reading project files',
      subject: 'Inspecting',
      status: 'thinking',
    });

    const screen = render(<MessageBubble message={message} />);

    expect(screen.getByText(/Inspecting/)).toBeTruthy();
    expect(screen.getByText('Reading project files')).toBeTruthy();
  });

  it('collapses completed thinking by default and expands on press', () => {
    const message = makeThinkingMessage({
      content: 'Finished checking imports',
      status: 'done',
      duration: 2400,
    });

    const screen = render(<MessageBubble message={message} />);

    const summary = screen.getByText(/Thought complete/);
    expect(summary).toBeTruthy();
    expect(screen.queryByText('Finished checking imports')).toBeNull();

    fireEvent.press(summary);

    expect(screen.getByText('Finished checking imports')).toBeTruthy();
  });
});

describe('MessageBubble agent status', () => {
  it('renders optional status detail', () => {
    const message = makeAgentStatusMessage({
      backend: 'opencode',
      agentName: 'OpenCode',
      status: 'error',
      message: 'provider rejected the request',
    });

    const screen = render(<MessageBubble message={message} />);

    expect(screen.getByText('OpenCode: error')).toBeTruthy();
    expect(screen.getByText('provider rejected the request')).toBeTruthy();
  });
});

describe('MessageBubble plan', () => {
  it('renders progress and the active OpenCode todo preview', () => {
    const message = makePlanMessage({
      sessionId: 'ses_todo',
      entries: [
        { title: 'Inspect AionUi client', status: 'completed', priority: 'high' },
        { title: 'Implement Android proxy', status: 'in_progress', priority: 'medium' },
        { title: 'Verify local runtime', status: 'pending', priority: 'low' },
      ],
    });

    const screen = render(<MessageBubble message={message} />);

    expect(screen.getByText('Plan')).toBeTruthy();
    expect(screen.getByText('1/3 done')).toBeTruthy();
    expect(screen.getByText('Current: Implement Android proxy')).toBeTruthy();
    expect(screen.getByText('Inspect AionUi client')).toBeTruthy();
    expect(screen.getByText('Implement Android proxy')).toBeTruthy();
    expect(screen.getByText('Verify local runtime')).toBeTruthy();
  });
});
