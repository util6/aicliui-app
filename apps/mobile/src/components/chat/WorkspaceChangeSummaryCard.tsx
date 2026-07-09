import React, { useMemo, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '../ui/ThemedText';
import { useThemeColor } from '../../hooks/useThemeColor';

export type WorkspaceFileChange = {
  file_path: string;
  relativePath: string;
  operation: 'create' | 'modify' | 'delete';
  additions: number;
  deletions: number;
};

export type WorkspaceFileChangeSummary = {
  mode: 'git-repo' | 'snapshot';
  branch: string | null;
  staged: WorkspaceFileChange[];
  unstaged: WorkspaceFileChange[];
};

type WorkspaceChangeSummaryCardProps = {
  summary: WorkspaceFileChangeSummary;
  onOpenFile?: (change: WorkspaceFileChange) => void;
  onOpenDiff?: (change: WorkspaceFileChange, source: 'staged' | 'unstaged') => void;
};

export function WorkspaceChangeSummaryCard({ summary, onOpenFile, onOpenDiff }: WorkspaceChangeSummaryCardProps) {
  const [expanded, setExpanded] = useState(true);
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const tint = useThemeColor({}, 'tint');
  const icon = useThemeColor({}, 'icon');
  const success = useThemeColor({}, 'success');
  const error = useThemeColor({}, 'error');
  const textSecondary = useThemeColor({}, 'textSecondary');
  const changes = useMemo(() => [...summary.staged, ...summary.unstaged], [summary.staged, summary.unstaged]);
  const totals = useMemo(
    () =>
      changes.reduce(
        (acc, change) => ({
          additions: acc.additions + Math.max(0, change.additions || 0),
          deletions: acc.deletions + Math.max(0, change.deletions || 0),
        }),
        { additions: 0, deletions: 0 },
      ),
    [changes],
  );

  if (changes.length === 0) return null;

  return (
    <View style={styles.row}>
      <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
        <TouchableOpacity style={styles.header} onPress={() => setExpanded((value) => !value)} activeOpacity={0.75}>
          <Ionicons name='git-compare-outline' size={16} color={tint} />
          <View style={styles.headerBody}>
            <ThemedText style={styles.title}>{formatChangedFiles(changes.length)}</ThemedText>
            <View style={styles.metaRow}>
              {summary.branch ? (
                <ThemedText type='caption' style={[styles.branch, { color: textSecondary }]} numberOfLines={1}>
                  {summary.branch}
                </ThemedText>
              ) : null}
              {totals.additions > 0 ? (
                <ThemedText type='caption' style={[styles.stat, { color: success }]}>
                  +{totals.additions}
                </ThemedText>
              ) : null}
              {totals.deletions > 0 ? (
                <ThemedText type='caption' style={[styles.stat, { color: error }]}>
                  -{totals.deletions}
                </ThemedText>
              ) : null}
            </View>
          </View>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={15} color={icon} />
        </TouchableOpacity>
        {expanded ? (
          <View style={[styles.fileList, { borderTopColor: border }]}>
            {summary.staged.map((change) => (
              <ChangeRow
                key={`staged:${change.relativePath}`}
                change={change}
                label='staged'
                source='staged'
                onOpenFile={onOpenFile}
                onOpenDiff={onOpenDiff}
              />
            ))}
            {summary.unstaged.map((change) => (
              <ChangeRow
                key={`unstaged:${change.relativePath}`}
                change={change}
                label='worktree'
                source='unstaged'
                onOpenFile={onOpenFile}
                onOpenDiff={onOpenDiff}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ChangeRow({
  change,
  label,
  source,
  onOpenFile,
  onOpenDiff,
}: {
  change: WorkspaceFileChange;
  label: string;
  source: 'staged' | 'unstaged';
  onOpenFile?: (change: WorkspaceFileChange) => void;
  onOpenDiff?: (change: WorkspaceFileChange, source: 'staged' | 'unstaged') => void;
}) {
  const success = useThemeColor({}, 'success');
  const warning = useThemeColor({}, 'warning');
  const error = useThemeColor({}, 'error');
  const textSecondary = useThemeColor({}, 'textSecondary');
  const statusColor = change.operation === 'create' ? success : change.operation === 'delete' ? error : warning;

  return (
    <TouchableOpacity
      accessibilityRole='button'
      style={styles.fileRow}
      onPress={onOpenFile ? () => onOpenFile(change) : undefined}
      activeOpacity={onOpenFile ? 0.72 : 1}
    >
      <ThemedText style={[styles.operation, { color: statusColor }]}>{operationLabel(change.operation)}</ThemedText>
      <View style={styles.fileBody}>
        <ThemedText style={styles.filePath} numberOfLines={1}>
          {change.relativePath}
        </ThemedText>
        <ThemedText type='caption' style={[styles.fileMeta, { color: textSecondary }]}>
          {label}
        </ThemedText>
      </View>
      <View style={styles.fileStats}>
        {change.additions > 0 ? (
          <ThemedText type='caption' style={[styles.fileStat, { color: success }]}>
            +{change.additions}
          </ThemedText>
        ) : null}
        {change.deletions > 0 ? (
          <ThemedText type='caption' style={[styles.fileStat, { color: error }]}>
            -{change.deletions}
          </ThemedText>
        ) : null}
        {onOpenDiff ? (
          <TouchableOpacity
            accessibilityRole='button'
            testID={`open-diff-${change.relativePath}`}
            style={styles.diffButton}
            onPress={() => onOpenDiff(change, source)}
            activeOpacity={0.72}
          >
            <Ionicons name='git-pull-request-outline' size={14} color={textSecondary} />
            <ThemedText type='caption' style={[styles.diffText, { color: textSecondary }]}>
              Diff
            </ThemedText>
          </TouchableOpacity>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

function formatChangedFiles(count: number): string {
  return `${count} changed ${count === 1 ? 'file' : 'files'}`;
}

function operationLabel(operation: WorkspaceFileChange['operation']): string {
  if (operation === 'create') return 'A';
  if (operation === 'delete') return 'D';
  return 'M';
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'flex-start',
  },
  card: {
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: 'hidden',
  },
  header: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  headerBody: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
  },
  metaRow: {
    minHeight: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  branch: {
    maxWidth: 140,
    fontSize: 12,
  },
  stat: {
    fontSize: 12,
    fontWeight: '700',
  },
  fileList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 5,
  },
  fileRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  operation: {
    width: 15,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '800',
  },
  fileBody: {
    flex: 1,
    minWidth: 0,
  },
  filePath: {
    fontSize: 13,
    lineHeight: 17,
  },
  fileMeta: {
    marginTop: 1,
    fontSize: 11,
  },
  fileStats: {
    minWidth: 76,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 5,
  },
  fileStat: {
    fontSize: 11,
    fontWeight: '700',
  },
  diffButton: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  diffText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
