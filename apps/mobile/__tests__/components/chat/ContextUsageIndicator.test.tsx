import React from 'react';
import { render } from '@testing-library/react-native';
import { ContextUsageIndicator } from '@/src/components/chat/ContextUsageIndicator';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

describe('ContextUsageIndicator', () => {
  it('renders nothing without usage data', () => {
    const screen = render(<ContextUsageIndicator usage={null} />);
    expect(screen.toJSON()).toBeNull();
  });

  it('shows formatted context usage', () => {
    const screen = render(<ContextUsageIndicator usage={{ used: 32_000, size: 128_000 }} />);

    expect(screen.getByText('25.0%')).toBeTruthy();
    expect(screen.getByText('32.0K / 128K context used')).toBeTruthy();
  });

  it('marks high context usage as danger', () => {
    const screen = render(<ContextUsageIndicator usage={{ used: 118_000, size: 128_000 }} />);

    expect(screen.getByText('92.2%')).toBeTruthy();
    expect(screen.getByText('High')).toBeTruthy();
  });
});
