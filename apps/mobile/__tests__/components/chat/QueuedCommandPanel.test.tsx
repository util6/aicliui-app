import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { QueuedCommandPanel } from '@/src/components/chat/QueuedCommandPanel';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

describe('QueuedCommandPanel', () => {
  it('renders queued command previews, file counts, and queue controls', () => {
    const onRemove = jest.fn();
    const onClear = jest.fn();
    const screen = render(
      <QueuedCommandPanel
        items={[
          {
            id: 'queue-1',
            input: '  run    tests  ',
            files: ['src/App.tsx', 'package.json'],
            createdAt: 1,
          },
        ]}
        onRemove={onRemove}
        onClear={onClear}
      />,
    );

    expect(screen.getByText('Queued commands')).toBeTruthy();
    expect(screen.getByText('run tests')).toBeTruthy();
    expect(screen.getByText('2 files')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Remove queued command'));
    expect(onRemove).toHaveBeenCalledWith('queue-1');

    fireEvent.press(screen.getByText('Clear'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('shows paused status and resumes the queue', () => {
    const onResume = jest.fn();
    const screen = render(
      <QueuedCommandPanel
        items={[
          {
            id: 'queue-1',
            input: 'retry this command',
            files: [],
            createdAt: 1,
          },
        ]}
        isPaused
        onRemove={jest.fn()}
        onClear={jest.fn()}
        onResume={onResume}
      />,
    );

    expect(screen.getByText('Paused')).toBeTruthy();
    fireEvent.press(screen.getByText('Resume'));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('stays hidden when there are no queued commands', () => {
    const screen = render(<QueuedCommandPanel items={[]} onRemove={jest.fn()} onClear={jest.fn()} />);

    expect(screen.toJSON()).toBeNull();
  });
});
