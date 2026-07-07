import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ConversationArtifactCard } from '@/src/components/chat/ConversationArtifactCard';
import { useChat } from '@/src/context/ChatContext';

jest.mock('@/src/context/ChatContext', () => ({
  useChat: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; name?: string }) => {
      if (options?.defaultValue) return options.defaultValue.replace('{{name}}', options.name ?? '');
      return key;
    },
  }),
}));

const mockUseChat = useChat as jest.Mock;

describe('ConversationArtifactCard', () => {
  beforeEach(() => {
    mockUseChat.mockReturnValue({
      updateArtifactStatus: jest.fn().mockResolvedValue(undefined),
    });
  });

  it('renders a skill suggestion and updates its status from card actions', async () => {
    const screen = render(
      <ConversationArtifactCard
        artifact={{
          id: 'artifact-1',
          conversation_id: 'conv-1',
          kind: 'skill_suggest',
          status: 'pending',
          payload: {
            cron_job_id: 'cron-1',
            name: 'Review skill',
            description: 'Review local changes',
            skill_content: '# Review',
          },
          created_at: 1200,
          updated_at: 1200,
        }}
      />,
    );
    const chat = mockUseChat.mock.results.at(-1)?.value;

    expect(screen.getByText('Review skill')).toBeTruthy();
    expect(screen.getByText('Review local changes')).toBeTruthy();

    fireEvent.press(screen.getByTestId('artifact-save'));
    await waitFor(() => expect(chat.updateArtifactStatus).toHaveBeenCalledWith('artifact-1', 'saved'));

    fireEvent.press(screen.getByTestId('artifact-dismiss'));
    await waitFor(() => expect(chat.updateArtifactStatus).toHaveBeenCalledWith('artifact-1', 'dismissed'));
  });

  it('renders an active cron trigger artifact summary', () => {
    const screen = render(
      <ConversationArtifactCard
        artifact={{
          id: 'artifact-cron',
          conversation_id: 'conv-1',
          kind: 'cron_trigger',
          status: 'active',
          payload: {
            cron_job_id: 'cron-1',
            cron_job_name: 'Nightly review',
            triggered_at: 1200,
          },
          created_at: 1200,
          updated_at: 1200,
        }}
      />,
    );

    expect(screen.getByText('Nightly review')).toBeTruthy();
  });
});
