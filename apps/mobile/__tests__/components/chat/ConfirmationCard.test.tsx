import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
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

  it('confirms desktop-style permission payloads with call_id', () => {
    const confirmAction = jest.fn();
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

    fireEvent.press(screen.getByText('Allow once'));

    expect(confirmAction).toHaveBeenCalledWith('permission-1', 'call-1', 'once');
  });
});
