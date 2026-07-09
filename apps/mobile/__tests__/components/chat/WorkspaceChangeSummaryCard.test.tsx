import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { WorkspaceChangeSummaryCard } from '@/src/components/chat/WorkspaceChangeSummaryCard';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; defaultValue?: string }) =>
      options?.defaultValue ?? (typeof options?.count === 'number' ? `${key}:${options.count}` : key),
  }),
}));

describe('WorkspaceChangeSummaryCard', () => {
  it('summarizes staged and unstaged local file changes', () => {
    const screen = render(
      <WorkspaceChangeSummaryCard
        summary={{
          mode: 'git-repo',
          branch: 'main',
          staged: [
            {
              file_path: '/tmp/project/README.md',
              relativePath: 'README.md',
              operation: 'modify',
              additions: 2,
              deletions: 1,
            },
          ],
          unstaged: [
            {
              file_path: '/tmp/project/src/App.tsx',
              relativePath: 'src/App.tsx',
              operation: 'create',
              additions: 12,
              deletions: 0,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('2 changed files')).toBeTruthy();
    expect(screen.getByText('main')).toBeTruthy();
    expect(screen.getByText('README.md')).toBeTruthy();
    expect(screen.getByText('src/App.tsx')).toBeTruthy();
    expect(screen.getByText('+14')).toBeTruthy();
    expect(screen.getAllByText('-1').length).toBeGreaterThan(0);
  });

  it('can collapse the file list without hiding the summary', () => {
    const screen = render(
      <WorkspaceChangeSummaryCard
        summary={{
          mode: 'git-repo',
          branch: null,
          staged: [],
          unstaged: [
            {
              file_path: '/tmp/project/new.md',
              relativePath: 'new.md',
              operation: 'create',
              additions: 1,
              deletions: 0,
            },
          ],
        }}
      />,
    );

    fireEvent.press(screen.getByText('1 changed file'));

    expect(screen.getByText('1 changed file')).toBeTruthy();
    expect(screen.queryByText('new.md')).toBeNull();
  });

  it('opens a changed file from the summary list', () => {
    const onOpenFile = jest.fn();
    const screen = render(
      <WorkspaceChangeSummaryCard
        onOpenFile={onOpenFile}
        summary={{
          mode: 'git-repo',
          branch: null,
          staged: [],
          unstaged: [
            {
              file_path: '/tmp/project/src/App.tsx',
              relativePath: 'src/App.tsx',
              operation: 'modify',
              additions: 3,
              deletions: 1,
            },
          ],
        }}
      />,
    );

    fireEvent.press(screen.getByText('src/App.tsx'));

    expect(onOpenFile).toHaveBeenCalledWith({
      file_path: '/tmp/project/src/App.tsx',
      relativePath: 'src/App.tsx',
      operation: 'modify',
      additions: 3,
      deletions: 1,
    });
  });

  it('requests a diff for a changed file with its source', () => {
    const onOpenDiff = jest.fn();
    const screen = render(
      <WorkspaceChangeSummaryCard
        onOpenDiff={onOpenDiff}
        summary={{
          mode: 'git-repo',
          branch: null,
          staged: [
            {
              file_path: '/tmp/project/README.md',
              relativePath: 'README.md',
              operation: 'modify',
              additions: 2,
              deletions: 1,
            },
          ],
          unstaged: [],
        }}
      />,
    );

    fireEvent.press(screen.getByTestId('open-diff-README.md'));

    expect(onOpenDiff).toHaveBeenCalledWith(
      {
        file_path: '/tmp/project/README.md',
        relativePath: 'README.md',
        operation: 'modify',
        additions: 2,
        deletions: 1,
      },
      'staged',
    );
  });
});
