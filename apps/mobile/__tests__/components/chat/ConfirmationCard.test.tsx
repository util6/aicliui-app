import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ConfirmationCard } from '@/src/components/chat/ConfirmationCard';
import { useChat } from '@/src/context/ChatContext';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
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
