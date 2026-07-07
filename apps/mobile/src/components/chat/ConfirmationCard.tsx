import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '../ui/ThemedText';
import { useChat } from '../../context/ChatContext';
import { useThemeColor } from '../../hooks/useThemeColor';

type ConfirmationCardProps = {
  content: any;
  msgId?: string;
};

type ConfirmationOption = {
  label: string;
  value: string;
};

export function ConfirmationCard({ content, msgId }: ConfirmationCardProps) {
  const { t } = useTranslation();
  const { confirmAction } = useChat();
  const confirmBg = useThemeColor({}, 'confirmBg');
  const confirmBorder = useThemeColor({}, 'confirmBorder');
  const success = useThemeColor({}, 'success');
  const error = useThemeColor({}, 'error');
  const tipErrorBg = useThemeColor({}, 'tipErrorBg');
  const tipSuccessBg = useThemeColor({}, 'tipSuccessBg');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const textSecondary = useThemeColor({}, 'textSecondary');
  const [respondingValue, setRespondingValue] = useState<string | null>(null);
  const [hasResponded, setHasResponded] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ACP permission format: { confirmation: { id, action, description, callId/call_id, options } }
  const confirmation = content.confirmation || content;
  const toolCall = recordOrUndefined(confirmation.tool_call);
  const rawInput = recordOrUndefined(toolCall?.raw_input);
  const confirmationId = stringOrUndefined(confirmation.id) ?? msgId ?? '';
  const title =
    stringOrUndefined(confirmation.title) ??
    stringOrUndefined(confirmation.action) ??
    stringOrUndefined(toolCall?.title) ??
    stringOrUndefined(rawInput?.description) ??
    t('chat.permissionRequest');
  const description =
    stringOrUndefined(confirmation.description) ??
    (stringOrUndefined(rawInput?.description) !== title ? stringOrUndefined(rawInput?.description) : undefined) ??
    stringOrUndefined(rawInput?.command) ??
    '';
  const options = normalizeOptions(confirmation.options);
  const callId =
    stringOrUndefined(confirmation.callId) ??
    stringOrUndefined(confirmation.call_id) ??
    stringOrUndefined(toolCall?.tool_call_id) ??
    msgId ??
    '';
  const isResponding = respondingValue !== null;

  const handleConfirm = async (optionValue: string) => {
    if (isResponding || hasResponded || !confirmationId || !callId) return;

    setRespondingValue(optionValue);
    setErrorMessage(null);
    try {
      await confirmAction(confirmationId, callId, optionValue);
      setHasResponded(true);
    } catch (e) {
      setErrorMessage(formatConfirmationError(e, t('chat.confirmationFailed')));
    } finally {
      setRespondingValue(null);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: confirmBg, borderColor: confirmBorder }]}>
      <ThemedText style={styles.title}>{title}</ThemedText>
      {description ? (
        <ThemedText type='caption' style={styles.description} numberOfLines={6}>
          {description}
        </ThemedText>
      ) : null}
      {!hasResponded && (
        <View style={styles.actions}>
          {options.map((opt, i) => {
            const isApprove =
              opt.value === 'allow' ||
              opt.value === 'approve' ||
              opt.value === 'once' ||
              opt.value === 'always' ||
              opt.value === 'proceed_once' ||
              opt.value === 'proceed_always' ||
              opt.value === 'yes' ||
              opt.label?.toLowerCase().includes('allow') ||
              opt.label?.toLowerCase().includes('approve');
            const disabled = isResponding;
            const isCurrentResponse = respondingValue === opt.value;

            return (
              <TouchableOpacity
                key={i}
                style={[
                  styles.button,
                  isApprove
                    ? { backgroundColor: success }
                    : { backgroundColor: surface, borderWidth: 1, borderColor: border },
                  disabled && styles.disabledButton,
                ]}
                onPress={() => handleConfirm(opt.value)}
                disabled={disabled}
                accessibilityState={{ disabled }}
                activeOpacity={0.7}
              >
                <ThemedText style={[styles.buttonText, isApprove ? styles.approveText : { color: textSecondary }]}>
                  {isCurrentResponse
                    ? t('chat.processing')
                    : opt.label || (isApprove ? t('chat.approve') : t('chat.deny'))}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {errorMessage ? (
        <View style={[styles.statusBox, { backgroundColor: tipErrorBg }]}>
          <ThemedText style={[styles.statusText, { color: error }]}>{errorMessage}</ThemedText>
        </View>
      ) : null}
      {hasResponded ? (
        <View style={[styles.statusBox, { backgroundColor: tipSuccessBg }]}>
          <ThemedText style={[styles.statusText, { color: success }]}>
            {t('chat.responseSentSuccessfully')}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    gap: 8,
    marginVertical: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  button: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  disabledButton: {
    opacity: 0.55,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  approveText: {
    color: '#fff',
  },
  statusBox: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statusText: {
    fontSize: 13,
    lineHeight: 18,
  },
});

function normalizeOptions(options: unknown): ConfirmationOption[] {
  if (!Array.isArray(options)) return [];

  return options
    .map((option, index) => {
      if (typeof option !== 'object' || option === null) return null;
      const data = option as { label?: unknown; value?: unknown; name?: unknown; option_id?: unknown };
      const value = stringOrUndefined(data.value) ?? stringOrUndefined(data.option_id);
      if (!value) return null;
      const label = stringOrUndefined(data.label) ?? stringOrUndefined(data.name) ?? value ?? `Option ${index + 1}`;
      return { label, value };
    })
    .filter((option): option is ConfirmationOption => option !== null);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function formatConfirmationError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  return fallback;
}
