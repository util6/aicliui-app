import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  description?: string;
};

type QuestionItem = {
  header?: string;
  question: string;
  multiple: boolean;
  custom: boolean;
  options: ConfirmationOption[];
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
  const textColor = useThemeColor({}, 'text');
  const [respondingValue, setRespondingValue] = useState<string | null>(null);
  const [hasResponded, setHasResponded] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [questionAnswers, setQuestionAnswers] = useState<string[][]>([]);
  const [customAnswers, setCustomAnswers] = useState<string[]>([]);
  const [customEnabled, setCustomEnabled] = useState<boolean[]>([]);

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
  const questions = normalizeQuestions(confirmation.questions);
  const callId =
    stringOrUndefined(confirmation.callId) ??
    stringOrUndefined(confirmation.call_id) ??
    stringOrUndefined(toolCall?.tool_call_id) ??
    msgId ??
    '';
  const isResponding = respondingValue !== null;
  const isQuestion = confirmation.action === 'question' && questions.length > 0;

  const handleConfirm = async (optionValue: unknown) => {
    if (isResponding || hasResponded || !confirmationId || !callId) return;

    setRespondingValue(typeof optionValue === 'string' ? optionValue : 'submit');
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

  const setQuestionAnswer = (index: number, answer: string, multiple: boolean) => {
    setQuestionAnswers((current) => {
      const next = current.map((item) => [...item]);
      const answers = next[index] ?? [];
      next[index] = multiple
        ? answers.includes(answer)
          ? answers.filter((item) => item !== answer)
          : [...answers, answer]
        : [answer];
      return next;
    });
    if (!multiple) {
      setCustomEnabled((current) => withArrayValue(current, index, false));
    }
  };

  const enableCustomAnswer = (index: number, multiple: boolean) => {
    setCustomEnabled((current) => withArrayValue(current, index, true));
    if (!multiple) {
      setQuestionAnswers((current) => withArrayValue(current, index, []));
    }
  };

  const updateCustomAnswer = (index: number, value: string) => {
    setCustomAnswers((current) => withArrayValue(current, index, value));
  };

  const buildQuestionAnswerPayload = (): string[][] =>
    questions.map((question, index) => {
      const selected = questionAnswers[index] ?? [];
      const custom = customEnabled[index] ? customAnswers[index]?.trim() : '';
      if (!custom) return selected;
      if (question.multiple) {
        return selected.includes(custom) ? selected : [...selected, custom];
      }
      return [custom];
    });

  const handleQuestionSubmit = () => {
    void handleConfirm(buildQuestionAnswerPayload());
  };

  if (isQuestion) {
    const question = questions[Math.min(questionIndex, questions.length - 1)];
    const selected = questionAnswers[questionIndex] ?? [];
    const isLastQuestion = questionIndex >= questions.length - 1;
    const isCustomOn = customEnabled[questionIndex] === true;

    return (
      <View style={[styles.container, { backgroundColor: confirmBg, borderColor: confirmBorder }]}>
        <View style={styles.questionHeader}>
          <ThemedText style={styles.title}>{title}</ThemedText>
          <ThemedText type='caption' style={[styles.questionProgress, { color: textSecondary }]}>
            {questionIndex + 1} / {questions.length}
          </ThemedText>
        </View>
        {question.header ? (
          <ThemedText type='caption' style={[styles.questionHeaderLabel, { color: textSecondary }]}>
            {question.header}
          </ThemedText>
        ) : null}
        <ThemedText style={styles.questionText}>{question.question}</ThemedText>
        <ThemedText type='caption' style={[styles.description, { color: textSecondary }]}>
          {question.multiple
            ? t('chat.questionMultiHint', { defaultValue: 'Select one or more answers.' })
            : t('chat.questionSingleHint', { defaultValue: 'Select one answer.' })}
        </ThemedText>
        <View style={styles.questionOptions}>
          {question.options.map((option) => {
            const picked = selected.includes(option.value);
            return (
              <TouchableOpacity
                key={option.value}
                style={[styles.questionOption, { backgroundColor: surface, borderColor: picked ? success : border }]}
                onPress={() => setQuestionAnswer(questionIndex, option.value, question.multiple)}
                activeOpacity={0.72}
              >
                <View style={styles.questionOptionMark}>
                  <Ionicons
                    name={picked ? (question.multiple ? 'checkmark-circle' : 'radio-button-on') : question.multiple ? 'ellipse-outline' : 'radio-button-off'}
                    size={20}
                    color={picked ? success : textSecondary}
                  />
                </View>
                <View style={styles.questionOptionBody}>
                  <ThemedText style={styles.questionOptionLabel}>{option.label}</ThemedText>
                  {option.description ? (
                    <ThemedText type='caption' style={[styles.questionOptionDescription, { color: textSecondary }]}>
                      {option.description}
                    </ThemedText>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          })}
          {question.custom && (
            <View style={[styles.questionOption, { backgroundColor: surface, borderColor: isCustomOn ? success : border }]}>
              <TouchableOpacity
                style={styles.customToggle}
                onPress={() => enableCustomAnswer(questionIndex, question.multiple)}
                activeOpacity={0.72}
              >
                <ThemedText style={[styles.questionOptionLabel, { color: isCustomOn ? success : textColor }]}>
                  {t('chat.typeOwnAnswer', { defaultValue: 'Type own answer' })}
                </ThemedText>
              </TouchableOpacity>
              {isCustomOn ? (
                <TextInput
                  style={[styles.customInput, { color: textColor, borderColor: border }]}
                  value={customAnswers[questionIndex] ?? ''}
                  onChangeText={(value) => updateCustomAnswer(questionIndex, value)}
                  placeholder={t('chat.customAnswerPlaceholder', { defaultValue: 'Custom answer' })}
                  placeholderTextColor={textSecondary}
                  multiline
                />
              ) : null}
            </View>
          )}
        </View>
        {!hasResponded && (
          <View style={styles.questionFooter}>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: surface, borderWidth: 1, borderColor: border }]}
              onPress={() => void handleConfirm('reject')}
              disabled={isResponding}
              activeOpacity={0.72}
            >
              <ThemedText style={[styles.buttonText, { color: textSecondary }]}>
                {isResponding && respondingValue === 'reject' ? t('chat.processing') : t('common.dismiss', { defaultValue: 'Dismiss' })}
              </ThemedText>
            </TouchableOpacity>
            {questionIndex > 0 && (
              <TouchableOpacity
                style={[styles.button, { backgroundColor: surface, borderWidth: 1, borderColor: border }]}
                onPress={() => setQuestionIndex((current) => Math.max(0, current - 1))}
                disabled={isResponding}
                activeOpacity={0.72}
              >
                <ThemedText style={[styles.buttonText, { color: textSecondary }]}>
                  {t('common.back', { defaultValue: 'Back' })}
                </ThemedText>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.button, { backgroundColor: success }]}
              onPress={() => {
                if (isLastQuestion) {
                  handleQuestionSubmit();
                } else {
                  setQuestionIndex((current) => Math.min(questions.length - 1, current + 1));
                }
              }}
              disabled={isResponding}
              activeOpacity={0.72}
            >
              <ThemedText style={[styles.buttonText, styles.approveText]}>
                {isResponding && respondingValue === 'submit'
                  ? t('chat.processing')
                  : isLastQuestion
                    ? t('common.submit', { defaultValue: 'Submit' })
                    : t('common.next', { defaultValue: 'Next' })}
              </ThemedText>
            </TouchableOpacity>
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
  questionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  questionProgress: {
    fontSize: 12,
    fontWeight: '700',
  },
  questionHeaderLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  questionText: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
  },
  questionOptions: {
    gap: 8,
  },
  questionOption: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 8,
  },
  questionOptionMark: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 22,
    alignItems: 'center',
  },
  questionOptionBody: {
    paddingLeft: 30,
    gap: 2,
  },
  questionOptionLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  questionOptionDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  customToggle: {
    minHeight: 26,
    justifyContent: 'center',
  },
  customInput: {
    minHeight: 38,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    lineHeight: 18,
  },
  questionFooter: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
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
      const data = option as { label?: unknown; value?: unknown; name?: unknown; option_id?: unknown; description?: unknown };
      const value = stringOrUndefined(data.value) ?? stringOrUndefined(data.option_id);
      if (!value) return null;
      const label = stringOrUndefined(data.label) ?? stringOrUndefined(data.name) ?? value ?? `Option ${index + 1}`;
      const description = stringOrUndefined(data.description);
      return { label, value, ...(description ? { description } : {}) };
    })
    .filter((option): option is ConfirmationOption => option !== null);
}

function normalizeQuestions(questions: unknown): QuestionItem[] {
  if (!Array.isArray(questions)) return [];
  return questions
    .map<QuestionItem | null>((question) => {
      const data = recordOrUndefined(question);
      if (!data) return null;
      const prompt = stringOrUndefined(data.question);
      if (!prompt) return null;
      const header = stringOrUndefined(data.header);
      return {
        ...(header ? { header } : {}),
        question: prompt,
        multiple: data.multiple === true,
        custom: data.custom !== false,
        options: normalizeOptions(data.options),
      };
    })
    .filter((question): question is QuestionItem => question !== null);
}

function withArrayValue<T>(current: T[], index: number, value: T): T[] {
  const next = [...current];
  next[index] = value;
  return next;
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
