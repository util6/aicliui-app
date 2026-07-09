import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ConfirmationCard } from '@/src/components/chat/ConfirmationCard';
import { useChat } from '@/src/context/ChatContext';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

jest.mock('@/src/context/ChatContext', () => ({
  useChat: jest.fn(),
}));

const mockUseChat = useChat as jest.Mock;

describe('ConfirmationCard', () => {
  beforeEach(() => {
    mockUseChat.mockReturnValue({
      confirmAction: jest.fn(),
    });
  });

  it('confirms desktop-style permission payloads with call_id', async () => {
    const confirmAction = jest.fn().mockResolvedValue(undefined);
    mockUseChat.mockReturnValue({ confirmAction });

    const screen = render(
      <ConfirmationCard
        content={{
          id: 'permission-1',
          action: 'execute',
          description: 'Run npm test',
          call_id: 'call-1',
          options: [
            { label: 'Allow once', value: 'once' },
            { label: 'Reject', value: 'reject' },
          ],
        }}
      />,
    );

    await act(async () => {
      fireEvent.press(screen.getByText('Allow once'));
    });

    expect(confirmAction).toHaveBeenCalledWith('permission-1', 'call-1', 'once');
  });

  it('confirms ACP option_id payloads', async () => {
    const confirmAction = jest.fn().mockResolvedValue(undefined);
    mockUseChat.mockReturnValue({ confirmAction });

    const screen = render(
      <ConfirmationCard
        content={{
          id: 'permission-1',
          title: 'Run command',
          call_id: 'call-1',
          options: [{ name: 'Allow once', option_id: 'once' }],
        }}
      />,
    );

    await act(async () => {
      fireEvent.press(screen.getByText('Allow once'));
    });

    expect(confirmAction).toHaveBeenCalledWith('permission-1', 'call-1', 'once');
  });

  it('confirms ACP tool_call payloads with message id fallback', async () => {
    const confirmAction = jest.fn().mockResolvedValue(undefined);
    mockUseChat.mockReturnValue({ confirmAction });

    const screen = render(
      <ConfirmationCard
        msgId='permission-message-1'
        content={{
          options: [{ name: 'Allow once', option_id: 'once' }],
          tool_call: {
            tool_call_id: 'tool-call-1',
            title: 'Edit file',
            raw_input: { description: 'Update README.md' },
          },
        }}
      />,
    );

    expect(screen.getByText('Edit file')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByText('Allow once'));
    });

    expect(confirmAction).toHaveBeenCalledWith('permission-message-1', 'tool-call-1', 'once');
  });

  it('answers OpenCode multi-step questions with selected and custom answers', async () => {
    const confirmAction = jest.fn().mockResolvedValue(undefined);
    mockUseChat.mockReturnValue({ confirmAction });

    const screen = render(
      <ConfirmationCard
        content={{
          id: 'que_1',
          title: 'OpenCode question',
          action: 'question',
          description: 'Style\nWhich output style?',
          callId: 'tool_question',
          command_type: 'question',
          questions: [
            {
              header: 'Style',
              question: 'Which output style?',
              multiple: false,
              custom: true,
              options: [
                { label: 'Brief', value: 'Brief', description: 'Short answer' },
                { label: 'Detailed', value: 'Detailed', description: 'Long answer' },
              ],
            },
            {
              header: 'Extras',
              question: 'Pick extra sections',
              multiple: true,
              custom: true,
              options: [
                { label: 'Tests', value: 'Tests', description: 'Include test notes' },
                { label: 'Risks', value: 'Risks', description: 'Include risk notes' },
              ],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.getByText('Which output style?')).toBeTruthy();
    fireEvent.press(screen.getByText('Detailed'));
    fireEvent.press(screen.getByText('Next'));

    expect(screen.getByText('2 / 2')).toBeTruthy();
    expect(screen.getByText('Pick extra sections')).toBeTruthy();
    fireEvent.press(screen.getByText('Tests'));
    fireEvent.press(screen.getByText('Type own answer'));
    fireEvent.changeText(screen.getByPlaceholderText('Custom answer'), 'Accessibility');

    await act(async () => {
      fireEvent.press(screen.getByText('Submit'));
    });

    expect(confirmAction).toHaveBeenCalledWith('que_1', 'tool_question', [
      ['Detailed'],
      ['Tests', 'Accessibility'],
    ]);
  });

  it('disables confirmation options while a response is being sent', async () => {
    let resolveConfirm!: () => void;
    const confirmAction = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    mockUseChat.mockReturnValue({ confirmAction });

    const screen = render(
      <ConfirmationCard
        content={{
          id: 'permission-1',
          title: 'Run command',
          callId: 'call-1',
          options: [
            { label: 'Allow once', value: 'once' },
            { label: 'Reject', value: 'reject' },
          ],
        }}
      />,
    );

    fireEvent.press(screen.getByText('Allow once'));
    expect(screen.getByText('chat.processing')).toBeTruthy();

    fireEvent.press(screen.getByText('Reject'));
    expect(confirmAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveConfirm();
    });

    await waitFor(() => expect(screen.getByText('chat.responseSentSuccessfully')).toBeTruthy());
  });

  it('shows confirmation errors and allows retry', async () => {
    const confirmAction = jest.fn().mockRejectedValueOnce(new Error('Network down')).mockResolvedValueOnce(undefined);
    mockUseChat.mockReturnValue({ confirmAction });

    const screen = render(
      <ConfirmationCard
        content={{
          id: 'permission-1',
          title: 'Run command',
          callId: 'call-1',
          options: [{ label: 'Allow once', value: 'once' }],
        }}
      />,
    );

    fireEvent.press(screen.getByText('Allow once'));

    await waitFor(() => expect(screen.getByText('Network down')).toBeTruthy());

    fireEvent.press(screen.getByText('Allow once'));

    await waitFor(() => expect(screen.getByText('chat.responseSentSuccessfully')).toBeTruthy());
    expect(confirmAction).toHaveBeenCalledTimes(2);
  });
});
