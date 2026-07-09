import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NewConversationModal } from '@/src/components/conversation/NewConversationModal';

const mockFetchAgents = jest.fn();
const mockUseConversations = jest.fn();
const mockPush = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      const labels: Record<string, string> = {
        'common.close': 'Close',
        'conversations.newConversation': 'New Conversation',
        'conversations.noAgents': 'No agents available',
        'connect.statusReady': 'Ready',
        'connect.statusMissing': 'Missing',
        'connect.statusError': 'Error',
        'connect.statusInstalling': 'Installing',
        'settings.openRuntimeSettings': 'Open runtime settings',
      };
      return options?.defaultValue ?? labels[key] ?? key;
    },
  }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

jest.mock('@/src/context/ConversationContext', () => ({
  useConversations: () => mockUseConversations(),
}));

describe('NewConversationModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchAgents.mockResolvedValue(undefined);
    mockUseConversations.mockReturnValue({
      availableAgents: [
        { backend: 'opencode', name: 'opencode', label: 'OpenCode', state: 'ready', version: '1.0.0' },
        {
          backend: 'codex',
          name: 'codex',
          label: 'Codex CLI',
          state: 'missing',
          detail: 'codex command not found',
        },
      ],
      fetchAgents: mockFetchAgents,
    });
  });

  it('shows local CLI health and prevents selecting unavailable agents', async () => {
    const onAgentSelected = jest.fn();
    const onClose = jest.fn();

    const screen = render(
      <NewConversationModal visible onClose={onClose} onAgentSelected={onAgentSelected} />,
    );

    await waitFor(() => expect(mockFetchAgents).toHaveBeenCalled());
    expect(screen.getByText('OpenCode')).toBeTruthy();
    expect(screen.getByText('Ready · 1.0.0')).toBeTruthy();
    expect(screen.getByText('Codex CLI')).toBeTruthy();
    expect(screen.getByText('Missing · codex command not found')).toBeTruthy();

    fireEvent.press(screen.getByTestId('agent-row-codex'));
    expect(onAgentSelected).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('agent-runtime-settings-codex'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/settings');
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('agent-row-opencode'));
    expect(onAgentSelected).toHaveBeenCalledWith(
      expect.objectContaining({ backend: 'opencode', state: 'ready' }),
    );
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
